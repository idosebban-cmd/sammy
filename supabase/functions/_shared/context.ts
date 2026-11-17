// Gathers what is recorded about Sammy and labels every item with a short
// reference id (P3, T12, D4 ...). The model may only cite these ids, and every
// citation it returns is checked against this map before it is shown.
//
// Sammy's record is small (hundreds of items, a handful of documents), so the
// whole structured record is included on every call rather than a few search
// hits: that is what lets the AI notice that "collective worship" connects to
// a trigger recorded months ago, or that 1:1 support started recently.
// Documents are included in full when the request is about them, and by
// keyword-matched passages otherwise.

import type { Caller } from "./auth.ts";
import type { Redactor } from "./redact.ts";

export type SourceType =
  | "profile_entry" | "timeline_event" | "action" | "intervention" | "document_chunk"
  | "entry" | "commitment" | "document";

export interface SourceRef {
  ref: string;
  type: SourceType;
  id: string;
  label: string;
  document_id?: string;
  page?: number | null;
  section?: string | null;
  date?: string | null;
  observations?: number;
}

export interface BuiltContext {
  text: string;
  refs: Map<string, SourceRef>;
  schoolCalendar: string | null;
  documentsIncluded: string[];
}

const SECTION_LABELS: Record<string, string> = {
  strengths: "Strengths, interests & personality",
  emotional_needs: "Emotional & psychological needs",
  triggers: "Known triggers & sensitivities",
  early_signs: "Early signs of dysregulation",
  helpful_strategies: "Strategies that have helped",
  unhelpful_strategies: "Strategies that have not helped",
  educational_needs: "Educational needs",
  social: "Social relationships",
  professional_recommendations: "Professional recommendations",
};

const EVIDENCE_LABELS: Record<string, string> = {
  professional: "professional finding",
  observation: "parent/school observation",
  ai_hypothesis: "AI hypothesis (unconfirmed)",
};

const CERTAINTY_LABELS: Record<string, string> = {
  confirmed: "CONFIRMED (agreed/final)",
  proposed: "PROPOSED (not yet agreed)",
  reported: "REPORTED (someone says this is happening/will happen)",
};

const DOC_CATEGORY_WORDS: Record<string, string[]> = {
  ehcp: ["ehcp", "ehc", "plan", "provision", "section f", "education health"],
  school_report: ["school report", "report card", "end of term"],
  professional_report: ["educational psychologist", "psychologist", "ep", "report", "camhs", "paediatrician", "speech", "salt", "occupational", "ot"],
  assessment: ["assessment", "assessed"],
  letter: ["letter"],
  meeting_notes: ["meeting", "notes", "minutes", "review"],
  medical: ["medical", "gp", "doctor", "paediatrician"],
  correspondence: ["email", "correspondence"],
  other: [],
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function clip(s: string | null | undefined, n: number): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

const today = () => new Date().toISOString().slice(0, 10);

interface DocRow { id: string; title: string; doc_date: string | null; category: string; page_count: number | null; extraction_status: string }

/** Scores how strongly a request refers to a specific document. */
export function documentScore(query: string, d: Pick<DocRow, "title" | "doc_date" | "category">): number {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  let score = 0;
  for (const w of DOC_CATEGORY_WORDS[d.category] ?? []) if (q.includes(` ${w} `) || (w.length > 4 && q.includes(w))) score += 2;
  const titleWords = d.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  for (const w of new Set(titleWords)) if (q.includes(` ${w} `)) score += 1;
  if (d.doc_date) {
    const month = MONTHS[Number(d.doc_date.slice(5, 7)) - 1];
    if (q.includes(` ${month} `) || q.includes(` ${month.slice(0, 3)} `)) score += 2;
    if (q.includes(d.doc_date.slice(0, 4))) score += 1;
  }
  return score;
}

export interface ContextOptions {
  query: string;
  excludeEntryId?: string;
  excludeDocumentId?: string;
  maxSearch?: number;
  /** Include whole documents that the request clearly refers to. */
  fullDocuments?: boolean;
  maxDocChars?: number;
}

export async function buildContext(caller: Caller, redactor: Redactor, opts: ContextOptions): Promise<BuiltContext> {
  const { db, workspaceId } = caller;
  const refs = new Map<string, SourceRef>();
  const lines: string[] = [];
  const counters: Record<string, number> = {};
  const add = (prefix: string, ref: Omit<SourceRef, "ref">): string => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const id = `${prefix}${counters[prefix]}`;
    refs.set(id, { ...ref, ref: id });
    return id;
  };
  const sinceTimeline = new Date(Date.now() - 548 * 86_400_000).toISOString().slice(0, 10);
  const now = today();

  const [ws, profile, timeline, actions, interventions, commitments, entries, docs, search] = await Promise.all([
    db.from("workspaces").select("child_name, about, school_calendar").eq("id", workspaceId).single(),
    db.from("profile_entries").select("id, section, content, evidence_type, source_label, created_at")
      .eq("workspace_id", workspaceId).eq("status", "active").order("section").order("created_at"),
    db.from("timeline_events").select("id, occurred_on, category, title, description, progress_areas, evidence_type, source_label")
      .eq("workspace_id", workspaceId).gte("occurred_on", sinceTimeline).order("occurred_on", { ascending: false }).limit(150),
    db.from("actions").select("id, title, description, owner, owner_detail, kind, due_date, due_time, due_text, date_confirmed, status, priority, origin, outcome, completed_at, status_changed_at, commitment_id, created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(150),
    db.from("interventions").select("id, name, description, goal, setting, started_on, ended_on, status, commitment_id, intervention_observations(observed_on, apparent_effect, note, assessment)")
      .eq("workspace_id", workspaceId).order("started_on", { ascending: false, nullsFirst: false }),
    db.from("commitments").select("id, kind, certainty, description, made_by, ehcp_section, frequency, review_on, status, source_page, source_label, source_document_id, created_at")
      .eq("workspace_id", workspaceId).order("created_at"),
    db.from("entries").select("id, kind, title, raw_text, occurred_on, created_at, analysis")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(16),
    db.from("documents").select("id, title, doc_date, category, page_count, extraction_status")
      .eq("workspace_id", workspaceId).order("doc_date", { ascending: false, nullsFirst: false }),
    opts.query.trim()
      ? db.rpc("search_records", { ws: workspaceId, q: opts.query.slice(0, 2000), max_results: opts.maxSearch ?? 24 })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [ws, profile, timeline, actions, interventions, commitments, entries, docs, search]) if (r.error) throw r.error;

  const about = (ws.data ?? { child_name: "Sammy", about: null, school_calendar: null }) as { child_name: string; about: string | null; school_calendar: string | null };
  const docTitle = new Map<string, string>((docs.data as DocRow[] ?? []).map((d) => [d.id, d.title]));

  // About
  lines.push(`## About ${about.child_name}`);
  lines.push(about.about?.trim() || "(No background written yet.)");

  // Profile
  lines.push("", "## Profile (parent-approved entries)");
  if (!profile.data?.length) lines.push("(No profile entries recorded yet.)");
  let lastSection = "";
  for (const p of profile.data ?? []) {
    if (p.section !== lastSection) {
      lines.push(`### ${SECTION_LABELS[p.section] ?? p.section}`);
      lastSection = p.section;
    }
    const ref = add("P", { type: "profile_entry", id: p.id, label: `${SECTION_LABELS[p.section] ?? p.section}: ${clip(p.content, 60)}` });
    lines.push(`[${ref}] (${EVIDENCE_LABELS[p.evidence_type]}${p.source_label ? `; source: ${p.source_label}` : ""}) ${p.content}`);
  }

  // Commitments / provision
  const linkedActions = new Map<string, string[]>();
  for (const a of actions.data ?? []) if (a.commitment_id) linkedActions.set(a.commitment_id, [...(linkedActions.get(a.commitment_id) ?? []), `${a.title} (${a.status})`]);
  const linkedInterventions = new Map<string, string[]>();
  for (const i of interventions.data ?? []) if (i.commitment_id) linkedInterventions.set(i.commitment_id, [...(linkedInterventions.get(i.commitment_id) ?? []), `${i.name} (${i.status})`]);
  lines.push("", "## Provision, professional recommendations and commitments");
  if (!commitments.data?.length) lines.push("(None recorded yet.)");
  for (const c of commitments.data ?? []) {
    const src = c.source_document_id ? `${docTitle.get(c.source_document_id) ?? "document"}${c.source_page ? ` p. ${c.source_page}` : ""}` : c.source_label ?? "";
    const ref = add("C", { type: "commitment", id: c.id, label: `${clip(c.description, 70)}${src ? ` (${src})` : ""}`, document_id: c.source_document_id ?? undefined, page: c.source_page });
    const followUp = [...(linkedActions.get(c.id) ?? []).map((x) => `action: ${x}`), ...(linkedInterventions.get(c.id) ?? []).map((x) => `intervention: ${x}`)];
    lines.push(`[${ref}] ${c.kind.replace(/_/g, " ")} · ${CERTAINTY_LABELS[c.certainty] ?? c.certainty}${c.made_by ? ` · by ${c.made_by}` : ""}${c.ehcp_section ? ` · EHCP section ${c.ehcp_section}` : ""}${c.frequency ? ` · ${c.frequency}` : ""}${c.review_on ? ` · review ${c.review_on}` : ""} · delivery: ${c.status.replace(/_/g, " ")}${src ? ` · source: ${src}` : ""}\n    ${c.description}\n    Followed up by: ${followUp.length ? followUp.join("; ") : "nothing recorded"}`);
  }

  // Interventions
  lines.push("", "## Interventions and strategies (with what has been observed)");
  if (!interventions.data?.length) lines.push("(No interventions recorded yet.)");
  for (const i of interventions.data ?? []) {
    const obs = ((i.intervention_observations ?? []) as { observed_on: string; apparent_effect: string; note: string; assessment: string | null }[])
      .sort((a, b) => a.observed_on.localeCompare(b.observed_on));
    const ref = add("I", { type: "intervention", id: i.id, label: i.name, date: i.started_on, observations: obs.length });
    lines.push(`[${ref}] ${i.name} (${i.setting}, ${i.status}${i.started_on ? `, from ${i.started_on}` : ""}${i.ended_on ? ` to ${i.ended_on}` : ""}; ${obs.length} observation${obs.length === 1 ? "" : "s"} so far)${i.goal ? `\n    Goal: ${clip(i.goal, 200)}` : ""}${i.description ? `\n    ${clip(i.description, 300)}` : ""}`);
    for (const o of obs) {
      lines.push(`    - ${o.observed_on}: ${o.apparent_effect.replace(/_/g, " ")} — ${clip(o.note, 300)}${o.assessment ? ` (parents' assessment: ${clip(o.assessment, 200)})` : ""}`);
    }
  }

  // Timeline
  lines.push("", "## Timeline (most recent first; last 18 months)");
  if (!timeline.data?.length) lines.push("(No timeline events recorded yet.)");
  for (const t of timeline.data ?? []) {
    const ref = add("T", { type: "timeline_event", id: t.id, label: `${t.occurred_on}: ${t.title}`, date: t.occurred_on });
    const areas = t.progress_areas?.length ? ` [areas: ${t.progress_areas.join(", ")}]` : "";
    const upcoming = t.occurred_on > now ? " (scheduled, not yet happened)" : "";
    lines.push(`[${ref}] ${t.occurred_on}${upcoming} · ${t.category} · ${t.title}${areas}${t.evidence_type === "ai_hypothesis" ? " (AI hypothesis)" : ""}${t.description ? ` — ${clip(t.description, 500)}` : ""}`);
  }

  // Actions
  lines.push("", "## Actions and appointments (open first)");
  const acts = [...(actions.data ?? [])].sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed"));
  const open = acts.filter((a) => a.status !== "completed");
  const done = acts.filter((a) => a.status === "completed").slice(0, 30);
  if (!acts.length) lines.push("(No actions recorded yet.)");
  for (const a of [...open, ...done]) {
    const ref = add("A", { type: "action", id: a.id, label: a.title, date: a.due_date });
    const due = a.due_date ? `${a.due_date}${a.due_time ? ` ${String(a.due_time).slice(0, 5)}` : ""}${a.date_confirmed ? "" : " (date not yet confirmed)"}` : a.due_text ? `"${a.due_text}" (no exact date)` : "no date";
    const waiting = a.status === "waiting" ? `; waiting since ${String(a.status_changed_at).slice(0, 10)}` : "";
    lines.push(`[${ref}] ${a.kind === "appointment" ? "APPOINTMENT: " : ""}${a.title} — owner: ${a.owner}${a.owner_detail ? ` (${a.owner_detail})` : ""}; status: ${a.status}${waiting}; due: ${due}${a.origin === "explicit_commitment" ? "; explicit commitment" : ""}${a.description ? ` — ${clip(a.description, 200)}` : ""}${a.outcome ? ` — outcome: ${clip(a.outcome, 200)}` : ""}`);
  }

  // Recent submissions (summaries)
  lines.push("", "## Recent emails, observations and uploads (summaries)");
  const recent = (entries.data ?? []).filter((e) => e.id !== opts.excludeEntryId).slice(0, 15);
  if (!recent.length) lines.push("(None yet.)");
  const recentIds = new Set<string>();
  for (const e of recent) {
    recentIds.add(e.id);
    const summary = e.analysis?.what_happened?.summary ?? clip(e.raw_text, 400);
    const ref = add("E", { type: "entry", id: e.id, label: `${e.title ?? e.kind}${e.occurred_on ? ` (${e.occurred_on})` : ""}`, date: e.occurred_on });
    lines.push(`[${ref}] ${e.occurred_on ?? e.created_at.slice(0, 10)} · ${e.kind}${e.title ? ` · ${e.title}` : ""}: ${clip(summary, 450)}`);
  }

  // Document library
  const docRows = (docs.data ?? []) as DocRow[];
  lines.push("", "## Document library (what exists; use passages below for content)");
  if (!docRows.length) lines.push("(No documents uploaded.)");
  for (const d of docRows) {
    const ref = add("F", { type: "document", id: d.id, document_id: d.id, label: d.title, date: d.doc_date });
    lines.push(`[${ref}] ${d.title} · ${d.category}${d.doc_date ? ` · ${d.doc_date}` : ""}${d.page_count ? ` · ${d.page_count} pages` : ""}${d.extraction_status !== "done" ? ` · text ${d.extraction_status === "partial" ? "partly" : "not"} readable` : ""}`);
  }

  // Full documents the request refers to
  const included: string[] = [];
  const includedIds = new Set<string>();
  if (opts.fullDocuments && docRows.length) {
    const scored = docRows
      .filter((d) => d.id !== opts.excludeDocumentId && d.extraction_status !== "empty")
      .map((d) => ({ d, s: documentScore(opts.query, d) }))
      .filter((x) => x.s >= 2)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4);
    let budget = opts.maxDocChars ?? 160_000;
    for (const { d } of scored) {
      const { data: chunks, error } = await db.from("document_chunks").select("id, page, section, content")
        .eq("document_id", d.id).order("chunk_index");
      if (error) throw error;
      const size = (chunks ?? []).reduce((n, c) => n + c.content.length, 0);
      if (!chunks?.length || size > budget) continue;
      budget -= size;
      included.push(d.title);
      includedIds.add(d.id);
      lines.push("", `## Full text: "${d.title}"${d.doc_date ? ` (${d.doc_date})` : ""} — ${d.category}`);
      for (const c of chunks) {
        const loc = c.page ? `p. ${c.page}` : c.section ? `section "${clip(c.section, 60)}"` : "";
        const ref = add("D", { type: "document_chunk", id: c.id, document_id: d.id, page: c.page, section: c.section, label: `${d.title}${loc ? `, ${loc}` : ""}`, date: d.doc_date });
        lines.push(`[${ref}] (${loc || "text"}) ${c.content}`);
      }
    }
  }

  // Keyword-retrieved passages
  type Hit = { kind: string; id: string; parent_id: string | null; title: string; snippet: string; page: number | null; section: string | null; occurred_on: string | null };
  const hits = ((search.data ?? []) as Hit[]).filter((h) => {
    if (h.kind === "document_chunk") return h.parent_id !== opts.excludeDocumentId && !includedIds.has(h.parent_id ?? "");
    if (h.kind === "entry") return h.id !== opts.excludeEntryId && !recentIds.has(h.id);
    return false; // everything else is already listed in full above
  });
  lines.push("", "## Passages matching this request (keyword search)");
  if (!hits.length) lines.push("(No further matching passages.)");
  for (const h of hits) {
    if (h.kind === "document_chunk") {
      const loc = h.page ? `p. ${h.page}` : h.section ? `section "${clip(h.section, 60)}"` : "";
      const ref = add("D", { type: "document_chunk", id: h.id, document_id: h.parent_id ?? undefined, page: h.page, section: h.section, label: `${h.title}${loc ? `, ${loc}` : ""}`, date: h.occurred_on });
      lines.push(`[${ref}] Document "${h.title}"${h.occurred_on ? ` (${h.occurred_on})` : ""}${loc ? `, ${loc}` : ""}:\n"""${clip(h.snippet, 1800)}"""`);
    } else {
      const ref = add("E", { type: "entry", id: h.id, label: `${h.title}${h.occurred_on ? ` (${h.occurred_on})` : ""}`, date: h.occurred_on });
      lines.push(`[${ref}] Earlier submission "${h.title}"${h.occurred_on ? ` dated ${h.occurred_on}` : ""}:\n"""${clip(h.snippet, 1500)}"""`);
    }
  }

  return {
    text: redactor.redact(lines.join("\n")),
    refs,
    schoolCalendar: about.school_calendar ? redactor.redact(about.school_calendar) : null,
    documentsIncluded: included,
  };
}

/** Removes any [X12] markers the model wrote that do not exist in the context. */
export function cleanRefMarkers(text: string, refs: Map<string, SourceRef>): { text: string; used: string[] } {
  const used = new Set<string>();
  const out = text.replace(/\s?\[([A-Z]\d{1,3})\]/g, (m, id: string) => {
    if (refs.has(id)) {
      used.add(id);
      return m;
    }
    return "";
  });
  return { text: out, used: [...used] };
}

export function validRefs(ids: unknown, refs: Map<string, SourceRef>): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && refs.has(x)))];
}
