import type {
  ActionOwner, ActionStatus, DocCategory, EntryKind, EvidenceType, Priority,
  ProfileSection, ProgressArea, TimelineCategory,
} from "./types";

export const OWNER_LABELS: Record<ActionOwner, string> = {
  ido: "Ido",
  helen: "Helen",
  both_parents: "Ido & Helen",
  school: "School",
  local_authority: "Local Authority",
  therapist: "Therapist",
  other: "Other",
};

export const STATUS_LABELS: Record<ActionStatus, string> = {
  todo: "To do",
  waiting: "Waiting for response",
  in_progress: "In progress",
  completed: "Completed",
};

export const PRIORITY_LABELS: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

export const KIND_LABELS: Record<EntryKind, string> = {
  email: "Email or correspondence",
  observation: "Observation or update",
  document: "Document",
  question: "Question",
};

export const EVIDENCE_LABELS: Record<EvidenceType, string> = {
  professional: "Professional finding",
  observation: "Parent or school observation",
  ai_hypothesis: "AI hypothesis",
};

export const TIMELINE_LABELS: Record<TimelineCategory, string> = {
  positive: "Positive development",
  dysregulation: "Dysregulation",
  anxiety: "Anxiety",
  school_change: "School arrangement",
  intervention: "Intervention or strategy",
  appointment: "Appointment or assessment",
  decision: "Decision",
  observation: "Observation",
  other: "Other",
};

export const TIMELINE_STYLES: Record<TimelineCategory, { dot: string; chip: string }> = {
  positive: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-800" },
  dysregulation: { dot: "bg-rose-400", chip: "bg-rose-50 text-rose-800" },
  anxiety: { dot: "bg-amber-400", chip: "bg-amber-50 text-amber-800" },
  school_change: { dot: "bg-sky-400", chip: "bg-sky-50 text-sky-800" },
  intervention: { dot: "bg-violet-400", chip: "bg-violet-50 text-violet-800" },
  appointment: { dot: "bg-indigo-400", chip: "bg-indigo-50 text-indigo-800" },
  decision: { dot: "bg-stone-500", chip: "bg-stone-100 text-stone-700" },
  observation: { dot: "bg-sage-400", chip: "bg-sage-50 text-sage-800" },
  other: { dot: "bg-stone-300", chip: "bg-stone-100 text-stone-600" },
};

export const SECTION_LABELS: Record<ProfileSection, string> = {
  strengths: "Strengths, interests & personality",
  emotional_needs: "Emotional & psychological needs",
  triggers: "Known triggers & sensitivities",
  early_signs: "Early signs of dysregulation",
  helpful_strategies: "Strategies that have helped",
  unhelpful_strategies: "Strategies that haven't helped",
  educational_needs: "Educational needs",
  social: "Social relationships",
  professional_recommendations: "Professional recommendations",
};

export const SECTION_HINTS: Record<ProfileSection, string> = {
  strengths: "What he's good at, loves and brings to the people around him.",
  emotional_needs: "What he needs to feel safe, understood and settled.",
  triggers: "Situations, sensations or demands that tend to be hard.",
  early_signs: "What it looks like before things escalate.",
  helpful_strategies: "Approaches that have made a difference.",
  unhelpful_strategies: "Approaches that haven't worked or made things harder.",
  educational_needs: "Support he needs to learn well.",
  social: "Friendships, peers and relationships with adults.",
  professional_recommendations: "What professionals have recommended.",
};

export const PROGRESS_LABELS: Record<ProgressArea, string> = {
  emotional_regulation: "Emotional regulation",
  recovering: "Recovery after dysregulation",
  anxiety_confidence: "Anxiety & confidence",
  social: "Social interactions & friendships",
  learning: "Learning & classroom participation",
  independence: "Independence",
  wellbeing: "Self-esteem & wellbeing",
};

/** Labels for any older area keys that might still be stored. */
export function progressLabel(area: string): string {
  return (PROGRESS_LABELS as Record<string, string>)[area] ?? area.replace(/_/g, " ");
}

export const DOC_CATEGORY_LABELS: Record<DocCategory, string> = {
  ehcp: "EHCP",
  school_report: "School report",
  professional_report: "Professional report",
  assessment: "Assessment",
  letter: "Letter",
  meeting_notes: "Meeting notes",
  medical: "Medical",
  correspondence: "Correspondence",
  other: "Other",
};

export const EFFECT_LABELS = {
  seems_helpful: "Seems to help",
  mixed: "Mixed",
  no_clear_effect: "No clear effect",
  seems_worse: "Seems to make things harder",
  unclear: "Too early to tell",
} as const;

export const EFFECT_STYLES: Record<keyof typeof EFFECT_LABELS, string> = {
  seems_helpful: "bg-emerald-50 text-emerald-800",
  mixed: "bg-amber-50 text-amber-800",
  no_clear_effect: "bg-stone-100 text-stone-600",
  seems_worse: "bg-rose-50 text-rose-800",
  unclear: "bg-sky-50 text-sky-800",
};

export const COMMITMENT_KIND_LABELS = {
  ehcp_provision: "EHCP provision",
  professional_recommendation: "Professional recommendation",
  professional_commitment: "Commitment",
  school_arrangement: "School arrangement",
} as const;

export const CERTAINTY_LABELS = {
  confirmed: "Confirmed",
  proposed: "Proposed",
  reported: "Reported",
} as const;

export const CERTAINTY_HINTS = {
  confirmed: "In a final plan or agreed",
  proposed: "Draft or suggested change, not yet agreed",
  reported: "Someone says it is happening or will happen",
} as const;

export const DELIVERY_LABELS = {
  unknown: "Not known",
  in_place: "In place",
  partially_delivered: "Partly in place",
  not_delivered: "Not in place",
  ended: "Ended",
} as const;

export const INTERVENTION_STATUS_LABELS = {
  planned: "Planned",
  active: "Active",
  paused: "Paused",
  stopped: "Stopped",
} as const;

export const SETTING_LABELS = {
  home: "Home",
  school: "School",
  both: "Home & school",
  clinic: "Clinic / therapy",
  other: "Other",
} as const;

export function options<T extends string>(rec: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(rec) as T[]).map((value) => ({ value, label: rec[value] }));
}
