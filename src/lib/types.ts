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
  | "recognising_emotions" | "accepting_support" | "recovering" | "managing_anxiety"
  | "social" | "classroom_engagement" | "confidence";
export type DocCategory =
  | "ehcp" | "school_report" | "professional_report" | "assessment" | "letter"
  | "meeting_notes" | "medical" | "correspondence" | "other";

export interface Workspace { id: string; name: string; child_name: string }
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
  type: "profile_entry" | "timeline_event" | "action" | "intervention" | "document_chunk" | "entry";
  id: string;
  label: string;
  document_id?: string;
  page?: number | null;
  section?: string | null;
  date?: string | null;
}

export interface Analysis {
  what_happened: { summary: string; event_date: string | null; key_facts: string[]; people: { name: string; role: string }[] };
  related_history: { note: string; refs: string[] }[];
  what_it_might_mean: { statement: string; basis: "stated_in_submission" | "recorded_history" | "possible_explanation"; refs: string[] }[];
  what_we_can_do: { title: string; detail: string; timeframe: "immediate" | "longer_term"; refs: string[] }[];
  follow_up_actions: {
    title: string; description: string; owner: ActionOwner; owner_detail: string | null;
    origin: "explicit_commitment" | "suggested"; due_date: string | null; due_date_quote: string | null;
    priority: Priority; due_date_removed?: boolean;
  }[];
  what_to_remember: {
    title: string; text: string; target: "timeline" | "profile"; timeline_category: TimelineCategory | null;
    profile_section: ProfileSection | null; evidence_type: EvidenceType; progress_areas: ProgressArea[];
  }[];
  safety: { concern: boolean; guidance: string | null };
  evidence_note: string;
  sources: SourceRef[];
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
  extraction_status: "pending" | "done" | "failed" | "empty";
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
  source_entry_id: string | null;
  created_at: string;
  intervention_observations?: InterventionObservation[];
}

export interface InterventionObservation {
  id: string;
  intervention_id: string;
  observed_on: string;
  apparent_effect: "seems_helpful" | "unclear" | "not_helpful";
  note: string;
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
  meta: { evidence_level?: "well_supported" | "partly_supported" | "insufficient"; safety_concern?: boolean; model?: string };
  created_at: string;
}

export interface RedactionTerm { id: string; term: string; replacement: string }
