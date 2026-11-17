// Row types mirroring supabase/migrations. Kept by hand so the app has no
// build-time dependency on a running database.

export type EvidenceType = "professional" | "observation" | "ai_hypothesis";
export type EntryKind = "email" | "observation" | "document" | "question";
export type ActionOwner = "ido" | "helen" | "both_parents" | "school" | "local_authority" | "therapist" | "other";
export type ActionStatus = "todo" | "waiting" | "in_progress" | "completed";
export type Priority = "high" | "medium" | "low";
export type TimelineCategory =
  | "positive" | "dysregulation" | "anxiety" | "school_change" | "intervention"
  | "appointment" | "decision" | "observation" | "other";
export type ProfileSection =
  | "strengths" | "emotional_needs" | "triggers" | "early_signs" | "helpful_strategies"
  | "unhelpful_strategies" | "educational_needs" | "social" | "professional_recommendations";
export type ProgressArea =
  | "emotional_regulation" | "recovering" | "anxiety_confidence" | "social" | "learning" | "independence" | "wellbeing";
export type DocCategory =
  | "ehcp" | "school_report" | "professional_report" | "assessment" | "letter"
  | "meeting_notes" | "medical" | "correspondence" | "other";

export interface Workspace { id: string; name: string; child_name: string; about: string | null; school_calendar: string | null }
export interface Member { workspace_id: string; user_id: string; display_name: string }

export interface AiSettingsRow {
  workspace_id: string;
  provider: string;
  model: string;
  terms_accepted: boolean;
  terms_accepted_at: string | null;
  terms_accepted_by: string | null;
  terms_version: string | null;
  redact_contact_details: boolean;
}

export interface SourceRef {
  ref: string;
  type: "profile_entry" | "timeline_event" | "action" | "intervention" | "document_chunk" | "entry" | "commitment" | "document";
  id: string;
  label: string;
  document_id?: string;
  page?: number | null;
  section?: string | null;
  date?: string | null;
}

export type Effect = "seems_helpful" | "mixed" | "no_clear_effect" | "seems_worse" | "unclear";
export type CommitmentKind = "ehcp_provision" | "professional_recommendation" | "professional_commitment" | "school_arrangement";
export type Certainty = "confirmed" | "proposed" | "reported";

export interface AnalysisFollowUp {
  title: string; description: string; owner: ActionOwner; owner_detail: string | null; kind?: "task" | "appointment";
  origin: "explicit_commitment" | "suggested"; date_phrase?: string | null; due_date: string | null; due_time?: string | null;
  date_status?: "stated" | "worked_out" | "none"; priority: Priority; commitment_index?: number | null;
  date_confirmed?: boolean; date_removed?: boolean;
  /** v1 analyses */
  due_date_quote?: string | null; due_date_removed?: boolean;
}

export interface AnalysisCommitment {
  description: string; kind: CommitmentKind; certainty: Certainty; made_by: string | null; ehcp_section: string | null;
  frequency: string | null; page: number | null; review_date: string | null;
}

export interface InterventionUpdate {
  intervention_ref: string | null; new_intervention: { name: string; goal: string; setting: Intervention["setting"] } | null;
  observation: string; apparent_effect: Effect; assessment: string; refs: string[];
  intervention_id?: string | null; intervention_name?: string | null; prior_observations?: number;
}

export interface Analysis {
  schema_version?: number;
  what_happened: { summary: string; event_date: string | null; key_facts: string[]; people: { name: string; role: string }[] };
  relevant_context?: { fact: string; why_it_matters: string; refs: string[] }[];
  /** v1 analyses */
  related_history?: { note: string; refs: string[] }[];
  what_it_might_mean: { statement: string; basis: "stated_in_submission" | "recorded_history" | "possible_explanation"; refs: string[] }[];
  what_we_can_do: { title: string; detail: string; timeframe: "immediate" | "longer_term"; refs: string[] }[];
  questions_to_ask?: { question: string; ask_who: string; why: string }[];
  follow_up_actions: AnalysisFollowUp[];
  commitments?: AnalysisCommitment[];
  progress?: { summary: string; signals: { area: ProgressArea; direction: "positive" | "difficulty" | "mixed"; note: string }[]; intervention_updates: InterventionUpdate[] };
  what_to_remember: {
    title: string; text: string; target: "timeline" | "profile"; timeline_category: TimelineCategory | null;
    profile_section: ProfileSection | null; evidence_type: EvidenceType; progress_areas: ProgressArea[];
  }[];
  safety: { concern: boolean; guidance: string | null };
  evidence_note: string;
  sources: SourceRef[];
  documents_consulted?: string[];
  truncated: boolean;
  document_title: string | null;
  generated_at: string;
}

export interface Entry {
  id: string;
  workspace_id: string;
  kind: EntryKind;
  title: string | null;
  raw_text: string;
  occurred_on: string | null;
  document_id: string | null;
  analysis: Analysis | null;
  analysis_model: string | null;
  analysis_status: "none" | "pending" | "done" | "failed" | "skipped";
  analysis_error: string | null;
  analysed_at: string | null;
  review_status: "unreviewed" | "reviewed";
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  workspace_id: string;
  occurred_on: string;
  category: TimelineCategory;
  title: string;
  description: string | null;
  progress_areas: ProgressArea[];
  evidence_type: EvidenceType;
  source_label: string | null;
  source_entry_id: string | null;
  source_document_id: string | null;
  intervention_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Action {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  owner: ActionOwner;
  owner_detail: string | null;
  due_date: string | null;
  status: ActionStatus;
  priority: Priority;
  origin: "manual" | "ai_suggested" | "explicit_commitment";
  kind: "task" | "appointment";
  due_time: string | null;
  due_text: string | null;
  date_confirmed: boolean;
  outcome: string | null;
  commitment_id: string | null;
  intervention_id: string | null;
  status_changed_at: string;
  source_label: string | null;
  source_entry_id: string | null;
  source_document_id: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionUpdate {
  id: string;
  action_id: string;
  kind: "note" | "change";
  body: string;
  author_name: string | null;
  created_at: string;
}

export interface ProfileEntry {
  id: string;
  workspace_id: string;
  section: ProfileSection;
  content: string;
  evidence_type: EvidenceType;
  source_label: string | null;
  source_entry_id: string | null;
  source_document_id: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  workspace_id: string;
  title: string;
  doc_date: string | null;
  category: DocCategory;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  extraction_status: "pending" | "done" | "failed" | "empty" | "partial";
  text_source: "extracted" | "ai_transcribed" | "mixed";
  notes: string | null;
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  page: number | null;
  section: string | null;
  content: string;
}

export interface Intervention {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  setting: "home" | "school" | "both" | "clinic" | "other";
  started_on: string | null;
  ended_on: string | null;
  status: "planned" | "active" | "paused" | "stopped";
  goal: string | null;
  progress_areas: ProgressArea[];
  commitment_id: string | null;
  source_entry_id: string | null;
  created_at: string;
  intervention_observations?: InterventionObservation[];
}

export interface InterventionObservation {
  id: string;
  intervention_id: string;
  observed_on: string;
  apparent_effect: Effect;
  note: string;
  assessment: string | null;
  source_entry_id: string | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  title: string;
  detail: string | null;
  timeframe: "immediate" | "longer_term";
  status: "active" | "done" | "dismissed";
  source_entry_id: string | null;
  created_at: string;
}

export interface ChatThread { id: string; title: string; created_at: string; updated_at: string }
export interface ChatMessage {
  id: string;
  thread_id?: string;
  role: "user" | "assistant";
  content: string;
  citations: SourceRef[];
  meta: {
    evidence_level?: "well_supported" | "partly_supported" | "insufficient"; safety_concern?: boolean; model?: string;
    follow_up_questions?: string[]; documents_consulted?: string[];
  };
  created_at: string;
}

export interface RedactionTerm { id: string; term: string; replacement: string }

export interface Commitment {
  id: string;
  workspace_id: string;
  kind: CommitmentKind;
  certainty: Certainty;
  description: string;
  made_by: string | null;
  ehcp_section: string | null;
  frequency: string | null;
  starts_on: string | null;
  review_on: string | null;
  status: "unknown" | "in_place" | "partially_delivered" | "not_delivered" | "ended";
  notes: string | null;
  source_label: string | null;
  source_document_id: string | null;
  source_page: number | null;
  source_entry_id: string | null;
  created_at: string;
}

export interface ReviewPoint { point: string; refs: string[] }
export interface ProgressReview {
  id: string;
  period_days: number;
  content: {
    headline: string;
    going_well: ReviewPoint[];
    still_difficult: ReviewPoint[];
    interventions: { intervention_ref: string; intervention_id?: string; name?: string; what_we_have_seen: string; evidence_strength: "too_early" | "some_signs" | "consistent"; refs: string[] }[];
    worth_considering: ReviewPoint[];
    caveats: string;
  };
  citations: SourceRef[];
  model: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ReminderSettingsRow {
  user_id: string;
  workspace_id: string;
  enabled: boolean;
  email: string | null;
  owner_key: "ido" | "helen" | null;
  scope: "mine" | "all";
  due_soon_days: number;
  overdue_repeat_days: number;
  waiting_after_days: number;
  include_titles: boolean;
}
