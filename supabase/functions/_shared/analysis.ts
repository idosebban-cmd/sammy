// Post-processing that enforces the reliability rules a JSON schema cannot:
// citations must exist, "recorded history" must point at a record, and
// deadlines must be quoted from the source text.

import { cleanRefMarkers, type SourceRef, validRefs } from "./context.ts";

export interface Analysis {
  what_happened: { summary: string; event_date: string | null; key_facts: string[]; people: { name: string; role: string }[] };
  related_history: { note: string; refs: string[] }[];
  what_it_might_mean: { statement: string; basis: string; refs: string[] }[];
  what_we_can_do: { title: string; detail: string; timeframe: string; refs: string[] }[];
  follow_up_actions: {
    title: string; description: string; owner: string; owner_detail: string | null; origin: string;
    due_date: string | null; due_date_quote: string | null; priority: string; due_date_removed?: boolean;
  }[];
  what_to_remember: {
    title: string; text: string; target: string; timeline_category: string | null; profile_section: string | null;
    evidence_type: string; progress_areas: string[];
  }[];
  safety: { concern: boolean; guidance: string | null };
  evidence_note: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();
export const isIsoDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Enforces the reliability rules the schema alone cannot guarantee. */
export function postProcess(a: Analysis, refMap: Map<string, SourceRef>, submission: string): Analysis {
  const sub = norm(submission);

  a.related_history = a.related_history
    .map((r) => ({ note: cleanRefMarkers(r.note, refMap).text, refs: validRefs(r.refs, refMap) }))
    .filter((r) => r.refs.length > 0);

  a.what_it_might_mean = a.what_it_might_mean.map((m) => {
    const r = validRefs(m.refs, refMap);
    // A claim of recorded history with nothing valid to point at is downgraded.
    const basis = m.basis === "recorded_history" && r.length === 0 ? "possible_explanation" : m.basis;
    return { statement: cleanRefMarkers(m.statement, refMap).text, basis, refs: r };
  });

  a.what_we_can_do = a.what_we_can_do.slice(0, 4).map((w) => ({
    ...w,
    detail: cleanRefMarkers(w.detail, refMap).text,
    refs: validRefs(w.refs, refMap),
  }));

  // Never invent deadlines: keep a due date only when its quoted wording
  // really appears in the submission.
  a.follow_up_actions = a.follow_up_actions.map((f) => {
    const quoteOk = !!f.due_date_quote && f.due_date_quote.trim().length >= 3 && sub.includes(norm(f.due_date_quote));
    if (f.due_date && (!isIsoDate(f.due_date) || !quoteOk)) {
      return { ...f, due_date: null, due_date_quote: null, due_date_removed: true };
    }
    return f.due_date ? f : { ...f, due_date_quote: null };
  });

  a.what_to_remember = a.what_to_remember.map((w) => ({
    ...w,
    text: cleanRefMarkers(w.text, refMap).text,
    timeline_category: w.target === "timeline" ? (w.timeline_category ?? "observation") : null,
    profile_section: w.target === "profile" ? (w.profile_section ?? "emotional_needs") : null,
  }));

  if (a.what_happened.event_date && !isIsoDate(a.what_happened.event_date)) a.what_happened.event_date = null;
  return a;
}

export function collectRefs(a: Analysis, refMap: Map<string, SourceRef>): SourceRef[] {
  const ids = new Set<string>();
  for (const r of a.related_history) r.refs.forEach((x) => ids.add(x));
  for (const r of a.what_it_might_mean) r.refs.forEach((x) => ids.add(x));
  for (const r of a.what_we_can_do) r.refs.forEach((x) => ids.add(x));
  return [...ids].map((id) => refMap.get(id)!).filter(Boolean);
}
