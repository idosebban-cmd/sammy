import { useEffect, useState } from "react";
import { todayIso } from "../lib/dates";
import { notifyChanged } from "../lib/events";
import { EVIDENCE_LABELS, PROGRESS_LABELS, SECTION_LABELS, TIMELINE_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { EvidenceType, ProfileEntry, ProfileSection, ProgressArea, TimelineCategory, TimelineEvent } from "../lib/types";
import { must } from "../lib/useLoad";
import { useWs } from "../lib/workspace";
import type { RecordSource } from "./actions";
import { ErrorNote, Field, Modal, Select, Spinner } from "./ui";

export function ProgressAreaPicker({ value, onChange }: { value: ProgressArea[]; onChange: (v: ProgressArea[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(PROGRESS_LABELS) as ProgressArea[]).map((a) => {
        const on = value.includes(a);
        return (
          <button
            key={a}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== a) : [...value, a])}
            className={`chip border transition ${on ? "border-sage-500 bg-sage-500 text-white" : "border-sand-300 bg-white text-stone-600 hover:border-sage-400"}`}
            aria-pressed={on}
          >
            {PROGRESS_LABELS[a]}
          </button>
        );
      })}
    </div>
  );
}

export function EvidencePicker({ value, onChange }: { value: EvidenceType; onChange: (v: EvidenceType) => void }) {
  return (
    <div className="space-y-1">
      <Select value={value} onChange={onChange} options={options(EVIDENCE_LABELS)} />
      {value === "ai_hypothesis" && (
        <p className="text-xs text-amber-700">Kept clearly labelled as an unconfirmed AI idea. Change it only if a professional or your own observation confirms it.</p>
      )}
    </div>
  );
}

interface TimelineDraft {
  occurred_on: string;
  category: TimelineCategory;
  title: string;
  description: string;
  progress_areas: ProgressArea[];
  evidence_type: EvidenceType;
  source_label: string;
}

export function TimelineEditor({ open, event, onClose, defaults, source }: {
  open: boolean; event: TimelineEvent | null; onClose: () => void; defaults?: Partial<TimelineDraft>; source?: RecordSource;
}) {
  const { wsId } = useWs();
  const [d, setD] = useState<TimelineDraft>({ occurred_on: todayIso(), category: "observation", title: "", description: "", progress_areas: [], evidence_type: "observation", source_label: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setD(event ? {
      occurred_on: event.occurred_on, category: event.category, title: event.title, description: event.description ?? "",
      progress_areas: event.progress_areas, evidence_type: event.evidence_type, source_label: event.source_label ?? "",
    } : { occurred_on: todayIso(), category: "observation", title: "", description: "", progress_areas: [], evidence_type: "observation", source_label: "", ...defaults });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event]);

  const save = async () => {
    if (!d.title.trim()) return setError("Please add a short title.");
    if (!d.occurred_on) return setError("Please add a date.");
    setSaving(true);
    try {
      const row = { ...d, title: d.title.trim(), description: d.description.trim() || null, source_label: d.source_label.trim() || null };
      if (event) must(await supabase.from("timeline_events").update(row).eq("id", event.id));
      else must(await supabase.from("timeline_events").insert({
        ...row, workspace_id: wsId, source_entry_id: source?.entryId ?? null, source_document_id: source?.documentId ?? null,
      }));
      notifyChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof TimelineDraft>(k: K, v: TimelineDraft[K]) => setD({ ...d, [k]: v });
  return (
    <Modal open={open} onClose={onClose} title={event ? "Edit timeline entry" : "Add to timeline"} wide
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner className="h-4 w-4" />}Save</button>
      </>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date"><input type="date" className="input" value={d.occurred_on} onChange={(e) => set("occurred_on", e.target.value)} /></Field>
          <Field label="Type"><Select value={d.category} onChange={(v) => set("category", v)} options={options(TIMELINE_LABELS)} /></Field>
        </div>
        <Field label="Title"><input className="input" value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Asked for help when frustrated in maths" /></Field>
        <Field label="What happened"><textarea className="input min-h-[100px]" value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div><span className="label">Relates to (optional)</span><ProgressAreaPicker value={d.progress_areas} onChange={(v) => set("progress_areas", v)} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kind of information"><EvidencePicker value={d.evidence_type} onChange={(v) => set("evidence_type", v)} /></Field>
          <Field label="Source"><input className="input" value={d.source_label} onChange={(e) => set("source_label", e.target.value)} placeholder="e.g. Email from class teacher" /></Field>
        </div>
      </div>
    </Modal>
  );
}

interface ProfileDraft {
  section: ProfileSection;
  content: string;
  evidence_type: EvidenceType;
  source_label: string;
}

export function ProfileEditor({ open, entry, section, onClose }: {
  open: boolean; entry: ProfileEntry | null; section?: ProfileSection; onClose: () => void;
}) {
  const { wsId } = useWs();
  const [d, setD] = useState<ProfileDraft>({ section: "strengths", content: "", evidence_type: "observation", source_label: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setD(entry
      ? { section: entry.section, content: entry.content, evidence_type: entry.evidence_type, source_label: entry.source_label ?? "" }
      : { section: section ?? "strengths", content: "", evidence_type: "observation", source_label: "" });
  }, [open, entry, section]);

  const save = async () => {
    if (!d.content.trim()) return setError("Please write something to save.");
    if (d.evidence_type === "professional" && !d.source_label.trim()) return setError("For a professional finding, please note the source (e.g. which report).");
    setSaving(true);
    try {
      const row = { ...d, content: d.content.trim(), source_label: d.source_label.trim() || null };
      if (entry) must(await supabase.from("profile_entries").update(row).eq("id", entry.id));
      else must(await supabase.from("profile_entries").insert({ ...row, workspace_id: wsId }));
      notifyChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setD({ ...d, [k]: v });
  return (
    <Modal open={open} onClose={onClose} title={entry ? "Edit profile entry" : "Add to Sammy's profile"}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner className="h-4 w-4" />}Save</button>
      </>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <Field label="Section"><Select value={d.section} onChange={(v) => set("section", v)} options={options(SECTION_LABELS)} /></Field>
        <Field label="Entry"><textarea className="input min-h-[100px]" value={d.content} onChange={(e) => set("content", e.target.value)} /></Field>
        <Field label="Kind of information"><EvidencePicker value={d.evidence_type} onChange={(v) => set("evidence_type", v)} /></Field>
        <Field label="Source" hint="Where this comes from, e.g. 'Educational Psychologist report, March 2026' or 'Our observation'.">
          <input className="input" value={d.source_label} onChange={(e) => set("source_label", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
