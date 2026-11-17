// Gathers what is already recorded about Sammy and labels every item with a
// short reference id (P3, T12, D4 ...). The model may only cite these ids, and
// every citation it returns is checked against this map before it is shown.

import type { Caller } from "./auth.ts";
import type { Redactor } from "./redact.ts";

export type SourceType =
  | "profile_entry"
  | "timeline_event"
  | "action"
  | "intervention"
  | "document_chunk"
  | "entry";

export interface SourceRef {
  ref: string;
  type: SourceType;
  id: string;
  label: string;
  document_id?: string;
  page?: number | null;
  section?: string | null;
  date?: string | null;
}

export interface BuiltContext {
  text: string;
  refs: Map<string, SourceRef>;
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

function clip(s: string | null | undefined, n: number): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

export async function buildContext(
  caller: Caller,
  redactor: Redactor,
  opts: { query: string; excludeEntryId?: string; excludeDocumentId?: string; maxSearch?: number },
): Promise<BuiltContext> {
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

  const [profile, timeline, actions, interventions, search] = await Promise.all([
    db.from("profile_entries")
      .select("id, section, content, evidence_type, source_label, created_at")
      .eq("workspace_id", workspaceId).eq("status", "active")
      .order("section").order("created_at"),
    db.from("timeline_events")
      .select("id, occurred_on, category, title, description, progress_areas, evidence_type, source_label")
      .eq("workspace_id", workspaceId)
      .order("occurred_on", { ascending: false }).limit(60),
    db.from("actions")
      .select("id, title, description, owner, owner_detail, due_date, status, priority, origin, completed_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(80),
    db.from("interventions")
      .select("id, name, description, setting, started_on, ended_on, status, intervention_observations(observed_on, apparent_effect, note)")
      .eq("workspace_id", workspaceId)
      .order("started_on", { ascending: false, nullsFirst: false }),
    opts.query.trim()
      ? db.rpc("search_records", { ws: workspaceId, q: opts.query.slice(0, 2000), max_results: opts.maxSearch ?? 18 })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [profile, timeline, actions, interventions, search]) if (r.error) throw r.error;

  // Profile
  lines.push("## Sammy's profile (parent-approved entries)");
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

  // Timeline
  lines.push("", "## Timeline (most recent first)");
  if (!timeline.data?.length) lines.push("(No timeline events recorded yet.)");
  for (const t of timeline.data ?? []) {
    const ref = add("T", { type: "timeline_event", id: t.id, label: `${t.occurred_on}: ${t.title}`, date: t.occurred_on });
    const areas = t.progress_areas?.length ? ` [areas: ${t.progress_areas.join(", ")}]` : "";
    const upcoming = t.occurred_on > new Date().toISOString().slice(0, 10) ? " (scheduled, not yet happened)" : "";
    lines.push(`[${ref}] ${t.occurred_on}${upcoming} · ${t.category} · ${t.title}${areas}${t.evidence_type === "ai_hypothesis" ? " (AI hypothesis)" : ""}${t.description ? ` — ${clip(t.description, 500)}` : ""}`);
  }

  // Interventions
  lines.push("", "## Interventions and strategies being tried");
  if (!interventions.data?.length) lines.push("(No interventions recorded yet.)");
  for (const i of interventions.data ?? []) {
    const ref = add("I", { type: "intervention", id: i.id, label: i.name, date: i.started_on });
    lines.push(`[${ref}] ${i.name} (${i.setting}, ${i.status}${i.started_on ? `, from ${i.started_on}` : ""}${i.ended_on ? ` to ${i.ended_on}` : ""})${i.description ? ` — ${clip(i.description, 300)}` : ""}`);
    const obs = (i.intervention_observations ?? []) as { observed_on: string; apparent_effect: string; note: string }[];
    for (const o of obs.sort((a, b) => a.observed_on.localeCompare(b.observed_on))) {
      lines.push(`    - ${o.observed_on}: ${o.apparent_effect.replace("_", " ")} — ${clip(o.note, 300)}`);
    }
  }

  // Actions
  lines.push("", "## Actions (open first)");
  const acts = [...(actions.data ?? [])].sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed"));
  if (!acts.length) lines.push("(No actions recorded yet.)");
  for (const a of acts.slice(0, 60)) {
    const ref = add("A", { type: "action", id: a.id, label: a.title, date: a.due_date });
    lines.push(`[${ref}] ${a.title} — owner: ${a.owner}${a.owner_detail ? ` (${a.owner_detail})` : ""}; status: ${a.status}; priority: ${a.priority}; due: ${a.due_date ?? "no date"}${a.origin === "explicit_commitment" ? "; explicit commitment" : ""}${a.description ? ` — ${clip(a.description, 240)}` : ""}`);
  }

  // Retrieved passages
  type Hit = { kind: string; id: string; parent_id: string | null; title: string; snippet: string; page: number | null; section: string | null; occurred_on: string | null };
  const hits = ((search.data ?? []) as Hit[]).filter((h) => {
    if (h.kind === "entry" && h.id === opts.excludeEntryId) return false;
    if (h.kind === "document_chunk" && h.parent_id === opts.excludeDocumentId) return false;
    // timeline/profile items are already listed above
    return h.kind === "document_chunk" || h.kind === "entry";
  });
  lines.push("", "## Retrieved passages from documents and earlier submissions (keyword search)");
  if (!hits.length) lines.push("(No closely matching passages found.)");
  for (const h of hits) {
    if (h.kind === "document_chunk") {
      const loc = h.page ? `p. ${h.page}` : h.section ? `section "${h.section}"` : "";
      const ref = add("D", {
        type: "document_chunk", id: h.id, document_id: h.parent_id ?? undefined, page: h.page, section: h.section,
        label: `${h.title}${loc ? `, ${loc}` : ""}`, date: h.occurred_on,
      });
      lines.push(`[${ref}] Document "${h.title}"${h.occurred_on ? ` (${h.occurred_on})` : ""}${loc ? `, ${loc}` : ""}:\n"""${clip(h.snippet, 1800)}"""`);
    } else {
      const ref = add("E", { type: "entry", id: h.id, label: `${h.title}${h.occurred_on ? ` (${h.occurred_on})` : ""}`, date: h.occurred_on });
      lines.push(`[${ref}] Earlier submission "${h.title}"${h.occurred_on ? ` dated ${h.occurred_on}` : ""}:\n"""${clip(h.snippet, 1500)}"""`);
    }
  }

  return { text: redactor.redact(lines.join("\n")), refs };
}

/** Removes any [X12] markers the model wrote that do not exist in the context. */
export function cleanRefMarkers(text: string, refs: Map<string, SourceRef>): { text: string; used: string[] } {
  const used = new Set<string>();
  const out = text.replace(/\[([A-Z]\d{1,3})\]/g, (_m, id: string) => {
    if (refs.has(id)) {
      used.add(id);
      return `[${id}]`;
    }
    return "";
  });
  return { text: out, used: [...used] };
}

export function validRefs(ids: unknown, refs: Map<string, SourceRef>): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && refs.has(x)))];
}
