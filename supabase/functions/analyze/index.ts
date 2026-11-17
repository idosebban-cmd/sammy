// POST /analyze { entry_id }
// Analyses one saved submission against Sammy's whole record and stores the
// structured result on the entry. Nothing is added to the timeline, profile,
// actions or interventions here: parents review and confirm first.

import { ANALYSIS_SCHEMA, type Analysis, collectRefs, postProcess } from "../_shared/analysis.ts";
import { getCaller, requireAiConsent } from "../_shared/auth.ts";
import { buildContext } from "../_shared/context.ts";
import { handle, HttpError, json } from "../_shared/http.ts";
import { callJson, SHARED_PRINCIPLES } from "../_shared/llm.ts";
import { Redactor } from "../_shared/redact.ts";

const MAX_SUBMISSION_CHARS = 400_000;

const KIND_LABEL: Record<string, string> = {
  email: "an email or correspondence",
  observation: "a short parent observation",
  document: "a document",
  question: "a question",
};

export function analysisSystemPrompt(kind: string, today: string, calendar: string | null): string {
  const weekday = new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${SHARED_PRINCIPLES}

Your task: analyse one new submission from the parents in the light of Sammy's record, and return the
structured analysis. The parents will read it on a phone, so keep every field short and useful.

1. Summary (what_happened): facts only, as stated in the submission.
2. relevant_context: the most relevant things ALREADY in Sammy's record — e.g. a trigger he has described
   before, a similar earlier incident, a strategy that helped, an intervention that started recently and
   what has been seen since, a professional recommendation, a school arrangement, an upcoming review.
   For each, say briefly WHY it matters for this submission, and cite it. Include only what genuinely
   helps (usually 2-5 items). If nothing relevant is recorded, return an empty list.
3. Understanding (what_it_might_mean): what might explain what happened. Mark the basis honestly;
   anything you infer is "possible_explanation". Offer more than one possibility when the evidence
   allows several, and do not settle on a single cause from one event.
4. Recommendations (what_we_can_do): 2-4 specific, practical steps for the parents, building on what has
   worked for Sammy before and avoiding what hasn't. Include something they can do at home now where
   useful. questions_to_ask: up to four precise questions worth asking the school or a professional
   (e.g. what exactly preceded the incident, how the new support is being used, what the plan is for
   similar situations). Skip questions the submission already answers.
5. Follow-ups (follow_up_actions): explicit commitments made in the submission (origin
   "explicit_commitment") and sensible suggested actions (origin "suggested"). Suggested actions have
   NOT been agreed by anyone: word them as proposals ("Ask whether…"). Use kind "appointment" for
   meetings, reviews and appointments. Owners: Ido, Helen, both parents, school, local authority,
   therapist or other.
   Dates: copy the exact timing words into date_phrase. If the submission gives a calendar date, set
   due_date and date_status "stated". If it gives a relative phrase ("next Friday", "within two weeks",
   "before half-term"), work out due_date from today's date${calendar ? " and the school calendar" : ""}
   and set date_status "worked_out" — but only if it can be resolved with confidence; otherwise leave
   due_date null. Never give a date that has no basis in the submission.
   commitments: list provisions, recommendations, promises and arrangements the submission states
   (e.g. "school will offer an alternative activity during worship"), with their certainty.
6. Progress: what this tells us about Sammy's development (signals by area), keeping positives as
   prominent as difficulties. If the submission reports how Sammy responded to an existing
   intervention, add an intervention_update linked to it; if it describes a new intervention, use
   new_intervention. The assessment must reflect how much evidence there is (e.g. "Encouraging early
   sign, but too soon to say it is the reason").
7. what_to_remember: items worth keeping. If the submission describes an event, the first item should be
   a timeline item recording it factually. Add profile items only for genuinely new information (e.g. a
   newly identified trigger or a strategy that helped). Inferences must have evidence_type "ai_hypothesis".
${kind === "observation" ? `
This is a short parent observation. Keep the whole analysis brief: a one-sentence summary, the most
relevant context, one or two recommendations, and follow-ups only if something genuinely needs doing.
Positive moments deserve recognition: say what they suggest about his progress.` : ""}${kind === "document" ? `
This is a document. Focus the summary on its key findings and decisions. Capture every provision,
recommendation and commitment in \`commitments\`, with page numbers from the [Page N] markers, and
note how it compares with what is already recorded (e.g. a changed provision, or a recommendation that
has not been followed up).` : ""}
Today is ${weekday} ${today}.${calendar ? `\nSchool calendar provided by the parents:\n${calendar}` : "\nNo school calendar has been provided, so school-term phrases cannot be resolved to dates."}`;
}

Deno.serve(handle(async (req) => {
  const { entry_id } = await req.json().catch(() => ({}));
  if (typeof entry_id !== "string") throw new HttpError(400, "entry_id is required");

  const caller = await getCaller(req);
  const settings = await requireAiConsent(caller);
  const { db, workspaceId } = caller;

  const { data: entry, error } = await db
    .from("entries")
    .select("id, kind, title, raw_text, occurred_on, document_id, created_at")
    .eq("id", entry_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!entry) throw new HttpError(404, "Entry not found");

  await db.from("entries").update({ analysis_status: "pending", analysis_error: null }).eq("id", entry.id);

  try {
    const { data: terms } = await db.from("redaction_terms").select("term, replacement").eq("workspace_id", workspaceId);
    const redactor = new Redactor(terms ?? [], settings.redact_contact_details);

    let submission = entry.raw_text;
    let docTitle: string | null = null;
    if (entry.document_id) {
      const [{ data: doc }, { data: chunks }] = await Promise.all([
        db.from("documents").select("title, doc_date, category").eq("id", entry.document_id).maybeSingle(),
        db.from("document_chunks").select("chunk_index, page, section, content").eq("document_id", entry.document_id).order("chunk_index"),
      ]);
      docTitle = doc?.title ?? null;
      let lastLoc = "";
      const body = (chunks ?? []).map((c) => {
        const loc = c.page ? `[Page ${c.page}]` : c.section ? `[Section: ${c.section}]` : "";
        const head = loc && loc !== lastLoc ? `${loc}\n` : "";
        lastLoc = loc || lastLoc;
        return head + c.content;
      }).join("\n\n");
      submission = `Document: ${doc?.title ?? "Untitled"} (${doc?.category ?? "document"}${doc?.doc_date ? `, dated ${doc.doc_date}` : ""})\n` +
        (entry.raw_text && !entry.raw_text.startsWith("Uploaded document:") ? `Parent's note: ${entry.raw_text}\n\n` : "\n") + body;
    }
    let truncated = false;
    if (submission.length > MAX_SUBMISSION_CHARS) {
      submission = submission.slice(0, MAX_SUBMISSION_CHARS);
      truncated = true;
    }

    const ctx = await buildContext(caller, redactor, {
      query: `${entry.title ?? ""} ${submission.slice(0, 4000)}`,
      excludeEntryId: entry.id,
      excludeDocumentId: entry.document_id ?? undefined,
      fullDocuments: entry.kind !== "document",
      maxDocChars: 80_000,
    });

    const today = new Date().toISOString().slice(0, 10);
    const user = `# Sammy's record\n\n${ctx.text}\n\n# New submission\nType: ${KIND_LABEL[entry.kind]}\n` +
      `Date given by parent: ${entry.occurred_on ?? "not given"}\nSaved on: ${entry.created_at.slice(0, 10)}\n` +
      (entry.title ? `Title: ${redactor.redact(entry.title)}\n` : "") +
      (truncated ? "Note: the submission was very long and has been shortened to fit.\n" : "") +
      `\n"""\n${redactor.redact(submission)}\n"""`;

    const { data: raw, model } = await callJson<Analysis>({
      model: settings.model,
      system: analysisSystemPrompt(entry.kind, today, ctx.schoolCalendar),
      messages: [{ role: "user", content: user }],
      schema: ANALYSIS_SCHEMA,
      effort: "high",
    });

    const analysis = postProcess(redactor.restoreDeep(raw), ctx.refs, submission);
    const stored = {
      ...analysis,
      sources: collectRefs(analysis, ctx.refs),
      documents_consulted: ctx.documentsIncluded,
      truncated,
      document_title: docTitle,
      schema_version: 2,
      generated_at: new Date().toISOString(),
    };

    const { error: upErr } = await db.from("entries").update({
      analysis: stored,
      analysis_model: model,
      analysis_status: "done",
      analysis_error: null,
      analysed_at: new Date().toISOString(),
    }).eq("id", entry.id);
    if (upErr) throw upErr;

    return json({ analysis: stored });
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "Analysis failed.";
    await db.from("entries").update({ analysis_status: "failed", analysis_error: message }).eq("id", entry.id);
    throw err;
  }
}));
