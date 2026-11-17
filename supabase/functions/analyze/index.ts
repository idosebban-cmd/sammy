// POST /analyze { entry_id }
// Analyses one saved submission against what is already recorded about Sammy
// and stores the structured result on the entry. Nothing is added to the
// timeline, profile or actions here: parents review and confirm first.

import { getCaller, requireAiConsent } from "../_shared/auth.ts";
import { type Analysis, collectRefs, postProcess } from "../_shared/analysis.ts";
import { buildContext } from "../_shared/context.ts";
import { handle, HttpError, json } from "../_shared/http.ts";
import { callJson, SHARED_PRINCIPLES } from "../_shared/llm.ts";
import { Redactor } from "../_shared/redact.ts";

const MAX_SUBMISSION_CHARS = 400_000;

const str = { type: "string" };
const nullableStr = { anyOf: [{ type: "string" }, { type: "null" }] };
const refs = { type: "array", items: { type: "string" }, description: "Reference ids from the context, e.g. T3, D1. Empty if none." };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const PROGRESS_AREAS = [
  "recognising_emotions", "accepting_support", "recovering", "managing_anxiety",
  "social", "classroom_engagement", "confidence",
];

const SCHEMA = obj({
  what_happened: obj({
    summary: { ...str, description: "2-4 sentence factual summary of what the submission says." },
    event_date: { ...nullableStr, description: "ISO date (YYYY-MM-DD) of the main event only if stated or unambiguous from the submission, else null." },
    key_facts: { type: "array", items: str, description: "Short factual points stated in the submission: events, dates, people, observations." },
    people: { type: "array", items: obj({ name: str, role: str }) },
  }),
  related_history: {
    type: "array",
    description: "Things already recorded that are relevant to this submission.",
    items: obj({ note: str, refs }),
  },
  what_it_might_mean: {
    type: "array",
    items: obj({
      statement: str,
      basis: {
        type: "string",
        enum: ["stated_in_submission", "recorded_history", "possible_explanation"],
        description: "stated_in_submission / recorded_history = established fact; possible_explanation = your interpretation.",
      },
      refs,
    }),
  },
  what_we_can_do: {
    type: "array",
    description: "Two to four concrete, personalised recommendations.",
    items: obj({
      title: str,
      detail: str,
      timeframe: { type: "string", enum: ["immediate", "longer_term"] },
      refs,
    }),
  },
  follow_up_actions: {
    type: "array",
    items: obj({
      title: str,
      description: str,
      owner: { type: "string", enum: ["ido", "helen", "both_parents", "school", "local_authority", "therapist", "other"] },
      owner_detail: { ...nullableStr, description: "e.g. the named teacher or service, if stated." },
      origin: {
        type: "string",
        enum: ["explicit_commitment", "suggested"],
        description: "explicit_commitment ONLY if the submission states someone has agreed or committed to do it.",
      },
      due_date: { ...nullableStr, description: "YYYY-MM-DD only if the submission explicitly states a date or deadline for this. Otherwise null." },
      due_date_quote: { ...nullableStr, description: "The exact words from the submission that state the deadline. Null if due_date is null." },
      priority: { type: "string", enum: ["high", "medium", "low"] },
    }),
  },
  what_to_remember: {
    type: "array",
    description: "Information worth adding to Sammy's timeline or profile, for parents to approve.",
    items: obj({
      title: { ...str, description: "Short title, at most 10 words." },
      text: { ...str, description: "The information itself, written factually." },
      target: { type: "string", enum: ["timeline", "profile"] },
      timeline_category: {
        anyOf: [{ type: "string", enum: ["positive", "dysregulation", "anxiety", "school_change", "intervention", "appointment", "decision", "observation", "other"] }, { type: "null" }],
      },
      profile_section: {
        anyOf: [{ type: "string", enum: ["strengths", "emotional_needs", "triggers", "early_signs", "helpful_strategies", "unhelpful_strategies", "educational_needs", "social", "professional_recommendations"] }, { type: "null" }],
      },
      evidence_type: {
        type: "string",
        enum: ["professional", "observation", "ai_hypothesis"],
        description: "professional = stated by a professional in the material; observation = reported by parents/school; ai_hypothesis = your inference.",
      },
      progress_areas: { type: "array", items: { type: "string", enum: PROGRESS_AREAS } },
    }),
  },
  safety: obj({
    concern: { type: "boolean" },
    guidance: { ...nullableStr, description: "Immediate safety guidance if concern is true." },
  }),
  evidence_note: { ...str, description: "One sentence on how much recorded evidence this analysis could draw on." },
});

const KIND_LABEL: Record<string, string> = {
  email: "an email or correspondence",
  observation: "a parent observation or update",
  document: "a document",
  question: "a question",
};


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

    // The submission text: for documents, the extracted pages/sections.
    let submission = entry.raw_text;
    let docTitle: string | null = null;
    if (entry.document_id) {
      const [{ data: doc }, { data: chunks }] = await Promise.all([
        db.from("documents").select("title, doc_date, category").eq("id", entry.document_id).maybeSingle(),
        db.from("document_chunks").select("chunk_index, page, section, content").eq("document_id", entry.document_id).order("chunk_index"),
      ]);
      docTitle = doc?.title ?? null;
      const body = (chunks ?? [])
        .map((c) => `${c.page ? `[Page ${c.page}]` : c.section ? `[Section: ${c.section}]` : ""}\n${c.content}`)
        .join("\n\n");
      submission = `Document: ${doc?.title ?? "Untitled"} (${doc?.category ?? "document"}${doc?.doc_date ? `, dated ${doc.doc_date}` : ""})\n` +
        (entry.raw_text ? `Parent's note: ${entry.raw_text}\n\n` : "\n") + body;
    }
    let truncated = false;
    if (submission.length > MAX_SUBMISSION_CHARS) {
      submission = submission.slice(0, MAX_SUBMISSION_CHARS);
      truncated = true;
    }
    const redactedSubmission = redactor.redact(submission);

    const ctx = await buildContext(caller, redactor, {
      query: `${entry.title ?? ""} ${submission.slice(0, 3000)}`,
      excludeEntryId: entry.id,
      excludeDocumentId: entry.document_id ?? undefined,
    });

    const today = new Date().toISOString().slice(0, 10);
    const system = `${SHARED_PRINCIPLES}

Your task: analyse one new submission from the parents and return the structured analysis.
- what_happened: facts only, as stated in the submission.
- related_history: point to anything already recorded that is relevant (cite refs). If nothing is relevant, return an empty list.
- what_it_might_mean: interpretation informed by Sammy's history, strengths, known difficulties and professional recommendations.
  Mark each statement's basis honestly. Anything you infer is "possible_explanation".
- what_we_can_do: 2-4 concrete, personalised recommendations; include immediate practical advice where useful and longer-term ideas.
  Build on strategies recorded as helpful, avoid ones recorded as unhelpful, and cite them.
- follow_up_actions: include explicit commitments made in the submission (origin "explicit_commitment") and sensible suggested actions
  (origin "suggested"). Suggested actions have NOT been agreed by anyone; word them as proposals (e.g. "Ask whether..."). Only give a
  due_date if the submission explicitly states one for that action, and copy the exact words into due_date_quote.
- what_to_remember: only information genuinely worth keeping in Sammy's record. If the submission describes an event, the first
  item should be a timeline item recording that event factually. Add profile items only for information that adds something
  new (e.g. a newly identified trigger, a strategy that helped). Prefer facts. If you include an inference, its evidence_type
  must be "ai_hypothesis".
Today's date is ${today}.`;

    const user = `# What is already recorded about Sammy\n\n${ctx.text}\n\n# New submission\nType: ${KIND_LABEL[entry.kind]}\n` +
      `Date given by parent: ${entry.occurred_on ?? "not given"}\nSaved on: ${entry.created_at.slice(0, 10)}\n` +
      (entry.title ? `Title: ${redactor.redact(entry.title)}\n` : "") +
      (truncated ? "Note: the submission was very long and has been shortened to fit.\n" : "") +
      `\n"""\n${redactedSubmission}\n"""`;

    const { data: raw, model } = await callJson<Analysis>({
      model: settings.model,
      system,
      messages: [{ role: "user", content: user }],
      schema: SCHEMA,
      effort: "high",
    });

    const analysis = postProcess(redactor.restoreDeep(raw), ctx.refs, submission);
    const citedRefs = collectRefs(analysis, ctx.refs);

    const stored = {
      ...analysis,
      sources: citedRefs,
      truncated,
      document_title: docTitle,
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
