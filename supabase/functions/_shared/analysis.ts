// The structured analysis returned for emails, observations and documents,
// and the post-processing that enforces rules a JSON schema cannot:
// citations must exist, "facts from the record" must point at a record,
// dates must come from the source text, and intervention links must be real.

import { cleanRefMarkers, type SourceRef, validRefs } from "./context.ts";

const str = { type: "string" };
const nullableStr = { anyOf: [{ type: "string" }, { type: "null" }] };
const refs = { type: "array", items: { type: "string" }, description: "Reference ids from the record, e.g. T3, D1. Empty if none." };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullableEnum = (values: string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });

export const PROGRESS_AREAS = [
  "emotional_regulation", "recovering", "anxiety_confidence", "social", "learning", "independence", "wellbeing",
];
const TIMELINE_CATEGORIES = ["positive", "dysregulation", "anxiety", "school_change", "intervention", "appointment", "decision", "observation", "other"];
const PROFILE_SECTIONS = ["strengths", "emotional_needs", "triggers", "early_signs", "helpful_strategies", "unhelpful_strategies", "educational_needs", "social", "professional_recommendations"];
const OWNERS = ["ido", "helen", "both_parents", "school", "local_authority", "therapist", "other"];
const EFFECTS = ["seems_helpful", "mixed", "no_clear_effect", "seems_worse", "unclear"];

export const ANALYSIS_SCHEMA = obj({
  what_happened: obj({
    summary: { ...str, description: "1-3 sentence factual summary of what the submission says." },
    event_date: { ...nullableStr, description: "YYYY-MM-DD of the main event only if stated or unambiguous, else null." },
    key_facts: { type: "array", items: str, description: "Short factual points stated in the submission." },
    people: { type: "array", items: obj({ name: str, role: str }) },
  }),
  relevant_context: {
    type: "array",
    description: "Things already in Sammy's record that matter here, each with why it matters. Every item must cite refs.",
    items: obj({ fact: str, why_it_matters: str, refs }),
  },
  what_it_might_mean: {
    type: "array",
    description: "Understanding: what might explain it, based on the evidence.",
    items: obj({
      statement: str,
      basis: { type: "string", enum: ["stated_in_submission", "recorded_history", "possible_explanation"] },
      refs,
    }),
  },
  what_we_can_do: {
    type: "array",
    description: "Two to four specific, practical recommendations that build on Sammy's record.",
    items: obj({ title: str, detail: str, timeframe: { type: "string", enum: ["immediate", "longer_term"] }, refs }),
  },
  questions_to_ask: {
    type: "array",
    description: "Up to four useful questions for the school or professionals. Empty if none are needed.",
    items: obj({ question: str, ask_who: str, why: str }),
  },
  follow_up_actions: {
    type: "array",
    items: obj({
      title: str,
      description: str,
      owner: { type: "string", enum: OWNERS },
      owner_detail: { ...nullableStr, description: "The named person or service, if stated." },
      kind: { type: "string", enum: ["task", "appointment"] },
      origin: { type: "string", enum: ["explicit_commitment", "suggested"], description: "explicit_commitment ONLY if the submission says someone agreed or committed to it." },
      date_phrase: { ...nullableStr, description: "The exact words from the submission giving the date or timing (e.g. 'by Friday 21st November', 'before half-term'). Null if none." },
      due_date: { ...nullableStr, description: "YYYY-MM-DD if the date is stated, or can be worked out from date_phrase using today's date and the school calendar. Else null." },
      due_time: { ...nullableStr, description: "HH:MM if a time is stated, else null." },
      date_status: { type: "string", enum: ["stated", "worked_out", "none"], description: "stated = explicit calendar date; worked_out = resolved from a relative phrase (needs parents to confirm); none = no date." },
      priority: { type: "string", enum: ["high", "medium", "low"] },
      commitment_index: { anyOf: [{ type: "integer" }, { type: "null" }], description: "Index into `commitments` if this action follows up one of them." },
    }),
  },
  commitments: {
    type: "array",
    description: "Provisions, professional recommendations, commitments and school arrangements stated in the submission.",
    items: obj({
      description: str,
      kind: { type: "string", enum: ["ehcp_provision", "professional_recommendation", "professional_commitment", "school_arrangement"] },
      certainty: { type: "string", enum: ["confirmed", "proposed", "reported"], description: "confirmed = final/agreed; proposed = draft or suggested change; reported = someone says it is happening or will happen." },
      made_by: nullableStr,
      ehcp_section: nullableStr,
      frequency: nullableStr,
      page: { anyOf: [{ type: "integer" }, { type: "null" }], description: "Page number in the document, if known." },
      review_date: { ...nullableStr, description: "YYYY-MM-DD if a review date is stated." },
    }),
  },
  progress: obj({
    summary: { ...str, description: "1-2 sentences: what this tells us about Sammy's development, with appropriate caution. Empty string if nothing." },
    signals: {
      type: "array",
      items: obj({
        area: { type: "string", enum: PROGRESS_AREAS },
        direction: { type: "string", enum: ["positive", "difficulty", "mixed"] },
        note: str,
      }),
    },
    intervention_updates: {
      type: "array",
      description: "Observations that relate to an intervention: an existing one (intervention_ref) or one newly described in this submission (new_intervention).",
      items: obj({
        intervention_ref: { ...nullableStr, description: "I-reference of an existing intervention, or null." },
        new_intervention: { anyOf: [obj({ name: str, goal: str, setting: { type: "string", enum: ["home", "school", "both", "clinic", "other"] } }), { type: "null" }] },
        observation: str,
        apparent_effect: { type: "string", enum: EFFECTS },
        assessment: { ...str, description: "A cautious one-sentence judgement that states how strong the evidence is." },
        refs,
      }),
    },
  }),
  what_to_remember: {
    type: "array",
    description: "Information worth adding to Sammy's timeline or profile, for parents to approve.",
    items: obj({
      title: { ...str, description: "Short title, at most 10 words." },
      text: str,
      target: { type: "string", enum: ["timeline", "profile"] },
      timeline_category: nullableEnum(TIMELINE_CATEGORIES),
      profile_section: nullableEnum(PROFILE_SECTIONS),
      evidence_type: { type: "string", enum: ["professional", "observation", "ai_hypothesis"] },
      progress_areas: { type: "array", items: { type: "string", enum: PROGRESS_AREAS } },
    }),
  },
  safety: obj({ concern: { type: "boolean" }, guidance: nullableStr }),
  evidence_note: { ...str, description: "One sentence on how much recorded evidence this analysis could draw on." },
});

export interface FollowUp {
  title: string; description: string; owner: string; owner_detail: string | null; kind: "task" | "appointment";
  origin: string; date_phrase: string | null; due_date: string | null; due_time: string | null;
  date_status: "stated" | "worked_out" | "none"; priority: string; commitment_index: number | null;
  date_confirmed?: boolean; date_removed?: boolean;
}

export interface InterventionUpdate {
  intervention_ref: string | null;
  new_intervention: { name: string; goal: string; setting: string } | null;
  observation: string; apparent_effect: string; assessment: string; refs: string[];
  intervention_id?: string | null; intervention_name?: string | null; prior_observations?: number;
}

export interface Analysis {
  what_happened: { summary: string; event_date: string | null; key_facts: string[]; people: { name: string; role: string }[] };
  relevant_context: { fact: string; why_it_matters: string; refs: string[] }[];
  what_it_might_mean: { statement: string; basis: string; refs: string[] }[];
  what_we_can_do: { title: string; detail: string; timeframe: string; refs: string[] }[];
  questions_to_ask: { question: string; ask_who: string; why: string }[];
  follow_up_actions: FollowUp[];
  commitments: {
    description: string; kind: string; certainty: string; made_by: string | null; ehcp_section: string | null;
    frequency: string | null; page: number | null; review_date: string | null;
  }[];
  progress: { summary: string; signals: { area: string; direction: string; note: string }[]; intervention_updates: InterventionUpdate[] };
  what_to_remember: {
    title: string; text: string; target: string; timeline_category: string | null; profile_section: string | null;
    evidence_type: string; progress_areas: string[];
  }[];
  safety: { concern: boolean; guidance: string | null };
  evidence_note: string;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
export const isIsoDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s: string | null) => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const clean = (t: string, refMap: Map<string, SourceRef>) => cleanRefMarkers(t, refMap).text;

/** Enforces the reliability rules the schema alone cannot guarantee. */
export function postProcess(a: Analysis, refMap: Map<string, SourceRef>, submission: string): Analysis {
  const sub = norm(submission);

  // Context claims must point at real records.
  a.relevant_context = (a.relevant_context ?? [])
    .map((r) => ({ fact: clean(r.fact, refMap), why_it_matters: clean(r.why_it_matters, refMap), refs: validRefs(r.refs, refMap) }))
    .filter((r) => r.refs.length > 0);

  a.what_it_might_mean = (a.what_it_might_mean ?? []).map((m) => {
    const r = validRefs(m.refs, refMap);
    const basis = m.basis === "recorded_history" && r.length === 0 ? "possible_explanation" : m.basis;
    return { statement: clean(m.statement, refMap), basis, refs: r };
  });

  a.what_we_can_do = (a.what_we_can_do ?? []).slice(0, 4).map((w) => ({
    ...w, detail: clean(w.detail, refMap), refs: validRefs(w.refs, refMap),
  }));
  a.questions_to_ask = (a.questions_to_ask ?? []).slice(0, 4);

  a.commitments = (a.commitments ?? []).map((c) => ({
    ...c,
    page: Number.isInteger(c.page) && (c.page as number) > 0 ? c.page : null,
    review_date: isIsoDate(c.review_date) ? c.review_date : null,
  }));

  // Never invent deadlines: a date is kept only when the words it came from
  // really appear in the submission. Worked-out dates need confirming.
  a.follow_up_actions = (a.follow_up_actions ?? []).map((f) => {
    const phrase = f.date_phrase?.trim() ?? "";
    const phraseOk = phrase.length >= 3 && sub.includes(norm(phrase));
    const out: FollowUp = {
      ...f,
      kind: f.kind === "appointment" ? "appointment" : "task",
      date_phrase: phraseOk ? phrase : null,
      due_time: isTime(f.due_time) ? f.due_time : null,
      commitment_index: Number.isInteger(f.commitment_index) && (f.commitment_index as number) >= 0 && (f.commitment_index as number) < a.commitments.length ? f.commitment_index : null,
    };
    if (f.due_date && (!isIsoDate(f.due_date) || !phraseOk)) {
      out.due_date = null;
      out.due_time = null;
      out.date_status = "none";
      out.date_removed = true;
    }
    if (!out.due_date) out.date_status = "none";
    out.date_confirmed = out.date_status === "stated";
    return out;
  });

  // Intervention updates must refer to a real intervention or describe a new one.
  a.progress = {
    summary: clean(a.progress?.summary ?? "", refMap),
    signals: a.progress?.signals ?? [],
    intervention_updates: (a.progress?.intervention_updates ?? []).flatMap((u) => {
      const ref = u.intervention_ref && refMap.get(u.intervention_ref)?.type === "intervention" ? refMap.get(u.intervention_ref)! : null;
      if (!ref && !u.new_intervention?.name?.trim()) return [];
      return [{
        ...u,
        intervention_ref: ref ? ref.ref : null,
        new_intervention: ref ? null : u.new_intervention,
        intervention_id: ref?.id ?? null,
        intervention_name: ref?.label ?? u.new_intervention?.name ?? null,
        prior_observations: ref?.observations ?? 0,
        observation: clean(u.observation, refMap),
        assessment: clean(u.assessment, refMap),
        refs: validRefs(u.refs, refMap),
      }];
    }),
  };

  a.what_to_remember = (a.what_to_remember ?? []).map((w) => ({
    ...w,
    text: clean(w.text, refMap),
    timeline_category: w.target === "timeline" ? (w.timeline_category ?? "observation") : null,
    profile_section: w.target === "profile" ? (w.profile_section ?? "emotional_needs") : null,
  }));

  if (a.what_happened.event_date && !isIsoDate(a.what_happened.event_date)) a.what_happened.event_date = null;
  return a;
}

export function collectRefs(a: Analysis, refMap: Map<string, SourceRef>): SourceRef[] {
  const ids = new Set<string>();
  const addAll = (xs: { refs: string[] }[]) => xs.forEach((x) => x.refs.forEach((r) => ids.add(r)));
  addAll(a.relevant_context);
  addAll(a.what_it_might_mean);
  addAll(a.what_we_can_do);
  addAll(a.progress.intervention_updates);
  for (const u of a.progress.intervention_updates) if (u.intervention_ref) ids.add(u.intervention_ref);
  // Inline markers in free text
  const text = JSON.stringify([a.progress.summary, a.relevant_context, a.what_we_can_do]);
  for (const m of text.matchAll(/\[([A-Z]\d{1,3})\]/g)) if (refMap.has(m[1])) ids.add(m[1]);
  return [...ids].map((id) => refMap.get(id)!).filter(Boolean);
}
