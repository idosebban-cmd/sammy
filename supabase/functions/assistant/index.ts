// POST /assistant { thread_id?, message }                → conversational answer
// POST /assistant { mode: "progress_review", days? }     → stored qualitative progress review
//
// Retrieval runs on every turn (not just conversation memory); citations are
// validated against the retrieved sources before they are stored or shown.

import { type Caller, getCaller, requireAiConsent, type AiSettings } from "../_shared/auth.ts";
import { buildContext, cleanRefMarkers, type SourceRef, validRefs } from "../_shared/context.ts";
import { handle, HttpError, json } from "../_shared/http.ts";
import { callJson, SHARED_PRINCIPLES } from "../_shared/llm.ts";
import { Redactor } from "../_shared/redact.ts";

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "The reply in Markdown. Put reference ids like [T3] or [D2] right after the statements they support." },
    evidence_level: { type: "string", enum: ["well_supported", "partly_supported", "insufficient"] },
    safety_concern: { type: "boolean" },
    follow_up_questions: { type: "array", items: { type: "string" }, description: "Up to 3 short follow-up questions the parents might want to ask next." },
  },
  required: ["answer", "evidence_level", "safety_concern", "follow_up_questions"],
  additionalProperties: false,
};

interface Reply {
  answer: string;
  evidence_level: "well_supported" | "partly_supported" | "insufficient";
  safety_concern: boolean;
  follow_up_questions: string[];
}

const point = { type: "object", properties: { point: { type: "string" }, refs: { type: "array", items: { type: "string" } } }, required: ["point", "refs"], additionalProperties: false };
const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One or two sentences: the overall picture." },
    going_well: { type: "array", items: point },
    still_difficult: { type: "array", items: point },
    interventions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          intervention_ref: { type: "string" },
          what_we_have_seen: { type: "string" },
          evidence_strength: { type: "string", enum: ["too_early", "some_signs", "consistent"] },
          refs: { type: "array", items: { type: "string" } },
        },
        required: ["intervention_ref", "what_we_have_seen", "evidence_strength", "refs"],
        additionalProperties: false,
      },
    },
    worth_considering: { type: "array", items: point },
    caveats: { type: "string", description: "What the record cannot tell us, e.g. gaps or small numbers." },
  },
  required: ["headline", "going_well", "still_difficult", "interventions", "worth_considering", "caveats"],
  additionalProperties: false,
};

interface Review {
  headline: string;
  going_well: { point: string; refs: string[] }[];
  still_difficult: { point: string; refs: string[] }[];
  interventions: { intervention_ref: string; what_we_have_seen: string; evidence_strength: string; refs: string[]; intervention_id?: string; name?: string }[];
  worth_considering: { point: string; refs: string[] }[];
  caveats: string;
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const caller = await getCaller(req);
  const settings = await requireAiConsent(caller);
  const { data: terms } = await caller.db.from("redaction_terms").select("term, replacement").eq("workspace_id", caller.workspaceId);
  const redactor = new Redactor(terms ?? [], settings.redact_contact_details);

  if (body.mode === "progress_review") return progressReview(caller, settings, redactor, Number(body.days) || 90);
  return chat(caller, settings, redactor, body);
}));

async function chat(caller: Caller, settings: AiSettings, redactor: Redactor, body: Record<string, unknown>) {
  const message = body.message;
  let threadId: string | null = typeof body.thread_id === "string" ? body.thread_id : null;
  if (typeof message !== "string" || !message.trim()) throw new HttpError(400, "message is required");
  if (message.length > 20_000) throw new HttpError(400, "That message is too long. Please shorten it or add it as a document.");
  const { db, workspaceId } = caller;

  if (!threadId) {
    const { data, error } = await db.from("chat_threads").insert({ workspace_id: workspaceId, title: message.trim().slice(0, 80) }).select("id").single();
    if (error) throw error;
    threadId = data.id;
  }

  const { data: history, error: hErr } = await db.from("chat_messages")
    .select("role, content").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(12);
  if (hErr) throw hErr;

  const { error: insErr } = await db.from("chat_messages").insert({ workspace_id: workspaceId, thread_id: threadId, role: "user", content: message.trim() });
  if (insErr) throw insErr;

  const prevUser = (history ?? []).filter((m) => m.role === "user").slice(0, 2).map((m) => m.content).join(" ");
  const ctx = await buildContext(caller, redactor, { query: `${message} ${prevUser}`, maxSearch: 30, fullDocuments: true });

  const today = new Date().toISOString().slice(0, 10);
  const system = `${SHARED_PRINCIPLES}

You are the parents' assistant inside their private app about Sammy. The latest message contains Sammy's
record (retrieved for this question) followed by the question. Answer it.
- Lead with the answer. Usually a short paragraph or a few bullet points; practical next steps where useful.
- Make the advice specific to Sammy: connect it to his recorded strengths, triggers, early signs, what has
  helped, interventions in progress and what has been observed, and upcoming reviews. Cite them.
- If the record doesn't contain enough to answer well, say so plainly and say what would help to know.
  General, widely accepted guidance is fine, but label it as general.
- Questions about documents: quote or closely paraphrase the passage and cite its page or section.
  Distinguish confirmed provision, proposed changes and reported implementation. If the relevant
  document isn't in the library or its text isn't readable, say so rather than guessing.
- Comparing documents: compare like with like (same provision or topic), list what was added, removed
  or changed, and cite both sides.
- "Not followed up" questions: compare recommendations/commitments with the actions and interventions
  recorded against them, and say clearly when nothing has been recorded (which is not proof nothing happened).
- Do not present speculation as fact. Do not diagnose.
Today's date is ${today}.`;

  const past = [...(history ?? [])].reverse().map((m) => ({ role: m.role as "user" | "assistant", content: redactor.redact(m.content) }));
  const latest = `# Sammy's record (retrieved for this question)\n\n${ctx.text}\n\n# Question\n${redactor.redact(message.trim())}`;

  const { data: raw, model } = await callJson<Reply>({
    model: settings.model,
    system,
    messages: [...past, { role: "user", content: latest }],
    schema: CHAT_SCHEMA,
    effort: "medium",
    maxTokens: 16000,
  });

  const reply = redactor.restoreDeep(raw);
  const { text, used } = cleanRefMarkers(reply.answer, ctx.refs);
  const citations: SourceRef[] = used.map((id) => ctx.refs.get(id)!);

  const { data: saved, error: saveErr } = await db.from("chat_messages").insert({
    workspace_id: workspaceId,
    thread_id: threadId,
    role: "assistant",
    content: text,
    citations,
    meta: {
      evidence_level: reply.evidence_level,
      safety_concern: reply.safety_concern,
      follow_up_questions: (reply.follow_up_questions ?? []).slice(0, 3),
      documents_consulted: ctx.documentsIncluded,
      model,
    },
  }).select("id, role, content, citations, meta, created_at").single();
  if (saveErr) throw saveErr;

  await db.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
  return json({ thread_id: threadId, message: saved });
}

async function progressReview(caller: Caller, settings: AiSettings, redactor: Redactor, days: number) {
  const ctx = await buildContext(caller, redactor, { query: "", maxSearch: 0 });
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const system = `${SHARED_PRINCIPLES}

Write a short, qualitative progress review of Sammy for his parents, focused on ${from} to ${today}
(use earlier records only as background for comparison).
- going_well first: achievements and positive developments, as prominently as difficulties.
- still_difficult: what remains hard.
- interventions: for each intervention with observations, what has been seen since it started and how
  strong the evidence is. "too_early" for one or two observations or a few weeks; "consistent" only for
  repeated, comparable observations over time. Never claim an intervention caused a change.
- worth_considering: 1-3 practical ideas grounded in the record.
- No numbers, scores or percentages unless they are counts stated in the record.
- Every point cites its sources. Keep each point to one or two sentences.`;

  const { data: raw, model } = await callJson<Review>({
    model: settings.model,
    system,
    messages: [{ role: "user", content: `# Sammy's record\n\n${ctx.text}\n\nWrite the progress review.` }],
    schema: REVIEW_SCHEMA,
    effort: "high",
    maxTokens: 16000,
  });

  const r = redactor.restoreDeep(raw);
  const used = new Set<string>();
  const fix = (xs: { point: string; refs: string[] }[]) => xs.map((x) => {
    const refs = validRefs(x.refs, ctx.refs);
    const { text, used: inline } = cleanRefMarkers(x.point, ctx.refs);
    [...refs, ...inline].forEach((id) => used.add(id));
    return { point: text, refs };
  });
  const review: Review = {
    headline: cleanRefMarkers(r.headline, ctx.refs).text,
    going_well: fix(r.going_well),
    still_difficult: fix(r.still_difficult),
    worth_considering: fix(r.worth_considering),
    caveats: r.caveats,
    interventions: r.interventions.flatMap((i) => {
      const ref = ctx.refs.get(i.intervention_ref);
      if (!ref || ref.type !== "intervention") return [];
      const refs = validRefs(i.refs, ctx.refs);
      refs.forEach((id) => used.add(id));
      used.add(ref.ref);
      return [{ ...i, refs, intervention_id: ref.id, name: ref.label, what_we_have_seen: cleanRefMarkers(i.what_we_have_seen, ctx.refs).text }];
    }),
  };
  const citations = [...used].map((id) => ctx.refs.get(id)!);

  const { data: saved, error } = await caller.db.from("progress_reviews").insert({
    workspace_id: caller.workspaceId, period_days: days, content: review, citations, model,
  }).select("*").single();
  if (error) throw error;
  return json({ review: saved });
}
