// POST /assistant { thread_id?, message }
// Conversational assistant grounded in Sammy's records. Retrieval runs on
// every turn (not just conversation memory); citations are validated against
// the retrieved sources before they are stored or shown.

import { getCaller, requireAiConsent } from "../_shared/auth.ts";
import { buildContext, cleanRefMarkers, type SourceRef } from "../_shared/context.ts";
import { handle, HttpError, json } from "../_shared/http.ts";
import { callJson, SHARED_PRINCIPLES } from "../_shared/llm.ts";
import { Redactor } from "../_shared/redact.ts";

const SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "The reply in Markdown. Put reference ids like [T3] or [D2] right after the statements they support.",
    },
    evidence_level: {
      type: "string",
      enum: ["well_supported", "partly_supported", "insufficient"],
      description: "How well the recorded information supports the answer.",
    },
    safety_concern: { type: "boolean" },
  },
  required: ["answer", "evidence_level", "safety_concern"],
  additionalProperties: false,
};

interface Reply {
  answer: string;
  evidence_level: "well_supported" | "partly_supported" | "insufficient";
  safety_concern: boolean;
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const message: unknown = body.message;
  let threadId: string | null = typeof body.thread_id === "string" ? body.thread_id : null;
  if (typeof message !== "string" || !message.trim()) throw new HttpError(400, "message is required");
  if (message.length > 20_000) throw new HttpError(400, "That message is too long. Please shorten it or add it as a document.");

  const caller = await getCaller(req);
  const settings = await requireAiConsent(caller);
  const { db, workspaceId } = caller;

  if (!threadId) {
    const { data, error } = await db.from("chat_threads")
      .insert({ workspace_id: workspaceId, title: message.trim().slice(0, 80) })
      .select("id").single();
    if (error) throw error;
    threadId = data.id;
  }

  const { data: history, error: hErr } = await db.from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (hErr) throw hErr;

  const { error: insErr } = await db.from("chat_messages")
    .insert({ workspace_id: workspaceId, thread_id: threadId, role: "user", content: message.trim() });
  if (insErr) throw insErr;

  const { data: terms } = await db.from("redaction_terms").select("term, replacement").eq("workspace_id", workspaceId);
  const redactor = new Redactor(terms ?? [], settings.redact_contact_details);

  const prevUser = (history ?? []).find((m) => m.role === "user")?.content ?? "";
  const ctx = await buildContext(caller, redactor, { query: `${message} ${prevUser}`, maxSearch: 24 });

  const today = new Date().toISOString().slice(0, 10);
  const system = `${SHARED_PRINCIPLES}

You are the parents' assistant inside their private app about Sammy. Answer their question using the
records provided in the latest message. Be concise: usually a short paragraph or a few bullet points,
with practical next steps where helpful.
- Cite the reference ids of the records you rely on, directly after the relevant statement.
- If the records do not contain enough information, say so plainly and say what would help to know.
  General, widely accepted parenting or SEND guidance is fine, but label it as general rather than
  something specific to Sammy's records.
- When asked what a document (e.g. the EHCP) requires, quote or closely paraphrase the retrieved
  passage and cite it; if the relevant passage was not retrieved, say you could not find it.
- Do not present speculation as fact. Do not diagnose.
Today's date is ${today}.`;

  const past = [...(history ?? [])].reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: redactor.redact(m.content),
  }));
  const latest = `# Sammy's records (retrieved for this question)\n\n${ctx.text}\n\n# Question\n${redactor.redact(message.trim())}`;

  const { data: raw, model } = await callJson<Reply>({
    model: settings.model,
    system,
    messages: [...past, { role: "user", content: latest }],
    schema: SCHEMA,
    effort: "medium",
    maxTokens: 8000,
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
    meta: { evidence_level: reply.evidence_level, safety_concern: reply.safety_concern, model },
  }).select("id, role, content, citations, meta, created_at").single();
  if (saveErr) throw saveErr;

  await db.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

  return json({ thread_id: threadId, message: saved });
}));
