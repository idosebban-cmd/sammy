import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDate, formatDateTime, relativeDue, daysFromToday } from "../lib/dates";
import { notifyChanged } from "../lib/events";
import { OWNER_LABELS, PRIORITY_LABELS, STATUS_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { Action, ActionOwner, ActionStatus, ActionUpdate, Priority } from "../lib/types";
import { must } from "../lib/useLoad";
import { useWs } from "../lib/workspace";
import { Icon } from "./Icon";
import { ErrorNote, Field, Modal, PriorityTag, Select, Spinner, StatusBadge } from "./ui";

export interface ActionDraft {
  title: string;
  description: string;
  owner: ActionOwner;
  owner_detail: string;
  due_date: string;
  status: ActionStatus;
  priority: Priority;
}

export const emptyAction = (owner: ActionOwner = "both_parents"): ActionDraft => ({
  title: "", description: "", owner, owner_detail: "", due_date: "", status: "todo", priority: "medium",
});

export function ActionFields({ value, onChange }: { value: ActionDraft; onChange: (v: ActionDraft) => void }) {
  const set = <K extends keyof ActionDraft>(k: K, v: ActionDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <Field label="What needs doing">
        <input className="input" value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Ask school about an alternative to collective worship" />
      </Field>
      <Field label="Details">
        <textarea className="input min-h-[80px]" value={value.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Owner">
          <Select value={value.owner} onChange={(v) => set("owner", v)} options={options(OWNER_LABELS)} />
        </Field>
        <Field label="Who specifically (optional)">
          <input className="input" value={value.owner_detail} onChange={(e) => set("owner_detail", e.target.value)} placeholder="e.g. Class teacher, SENCo" />
        </Field>
        <Field label="Due date (if known)">
          <input type="date" className="input" value={value.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select value={value.priority} onChange={(v) => set("priority", v)} options={options(PRIORITY_LABELS)} />
        </Field>
        <Field label="Status">
          <Select value={value.status} onChange={(v) => set("status", v)} options={options(STATUS_LABELS)} />
        </Field>
      </div>
    </div>
  );
}

function describeChanges(before: Action, after: ActionDraft): string[] {
  const out: string[] = [];
  if (before.status !== after.status) out.push(`Status: ${STATUS_LABELS[before.status]} → ${STATUS_LABELS[after.status]}`);
  if (before.owner !== after.owner) out.push(`Owner: ${OWNER_LABELS[before.owner]} → ${OWNER_LABELS[after.owner]}`);
  if ((before.due_date ?? "") !== after.due_date) out.push(`Due date: ${before.due_date ? formatDate(before.due_date, { withYear: true }) : "none"} → ${after.due_date ? formatDate(after.due_date, { withYear: true }) : "none"}`);
  if (before.priority !== after.priority) out.push(`Priority: ${PRIORITY_LABELS[before.priority]} → ${PRIORITY_LABELS[after.priority]}`);
  if (before.title !== after.title.trim()) out.push("Title edited");
  if ((before.description ?? "") !== after.description.trim()) out.push("Details edited");
  return out;
}

export async function logActionChange(wsId: string, actionId: string, body: string) {
  must(await supabase.from("action_updates").insert({ workspace_id: wsId, action_id: actionId, kind: "change", body }));
}

export async function setActionStatus(wsId: string, action: Action, status: ActionStatus) {
  must(await supabase.from("actions").update({ status }).eq("id", action.id));
  await logActionChange(wsId, action.id, `Status: ${STATUS_LABELS[action.status]} → ${STATUS_LABELS[status]}`);
  notifyChanged();
}

/** Create (action = null) or edit an action. */
export interface RecordSource { entryId?: string | null; documentId?: string | null; label: string }

export function ActionEditor({ open, action, onClose, onSaved, source, defaults }: {
  open: boolean; action: Action | null; onClose: () => void; onSaved?: (a: Action) => void; source?: RecordSource;
  defaults?: Partial<ActionDraft>;
}) {
  const { wsId } = useWs();
  const [draft, setDraft] = useState<ActionDraft>(emptyAction());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(action ? {
      title: action.title, description: action.description ?? "", owner: action.owner,
      owner_detail: action.owner_detail ?? "", due_date: action.due_date ?? "", status: action.status, priority: action.priority,
    } : { ...emptyAction(), ...defaults });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  const save = async () => {
    if (!draft.title.trim()) return setError("Please give the action a title.");
    setSaving(true);
    setError(null);
    try {
      const row = {
        title: draft.title.trim(), description: draft.description.trim() || null, owner: draft.owner,
        owner_detail: draft.owner_detail.trim() || null, due_date: draft.due_date || null,
        status: draft.status, priority: draft.priority,
      };
      let saved: Action;
      if (action) {
        const changes = describeChanges(action, draft);
        saved = must(await supabase.from("actions").update(row).eq("id", action.id).select("*").single());
        if (changes.length) await logActionChange(wsId, action.id, changes.join("; "));
      } else {
        saved = must(await supabase.from("actions").insert({
          ...row, workspace_id: wsId, origin: "manual",
          source_entry_id: source?.entryId ?? null, source_document_id: source?.documentId ?? null, source_label: source?.label ?? null,
        }).select("*").single());
        await logActionChange(wsId, saved.id, "Created");
      }
      notifyChanged();
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={action ? "Edit action" : "New action"}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner className="h-4 w-4" />}Save</button>
      </>}
    >
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <ActionFields value={draft} onChange={setDraft} />
    </Modal>
  );
}

export function DueLabel({ action }: { action: Pick<Action, "due_date" | "status"> }) {
  if (!action.due_date) return <span className="text-xs text-stone-400">No due date</span>;
  if (action.status === "completed") return <span className="text-xs text-stone-500">Was due {formatDate(action.due_date)}</span>;
  const n = daysFromToday(action.due_date);
  const cls = n < 0 ? "text-rose-700 font-medium" : n <= 3 ? "text-amber-700 font-medium" : "text-stone-500";
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${cls}`}>
      <Icon name="clock" className="h-3.5 w-3.5" />
      {relativeDue(action.due_date)}
    </span>
  );
}

export function ActionRow({ action, onOpen, onToggle }: { action: Action; onOpen: () => void; onToggle: () => void }) {
  const done = action.status === "completed";
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <button
        onClick={onToggle}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${done ? "border-sage-500 bg-sage-500 text-white" : "border-sand-400 bg-white hover:border-sage-500"}`}
        aria-label={done ? "Mark as not completed" : "Mark as completed"}
      >
        {done && <Icon name="check" className="h-3.5 w-3.5" />}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className={`text-sm font-medium ${done ? "text-stone-400 line-through" : "text-stone-800"}`}>{action.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-stone-500">{OWNER_LABELS[action.owner]}{action.owner_detail ? ` · ${action.owner_detail}` : ""}</span>
          <DueLabel action={action} />
          {action.status !== "todo" && action.status !== "completed" && <StatusBadge status={action.status} />}
          {action.priority === "high" && !done && <PriorityTag priority="high" />}
        </div>
      </button>
    </div>
  );
}

/** Detail view with notes and change history. */
export function ActionDetail({ action, onClose, onEdit, onDeleted }: {
  action: Action | null; onClose: () => void; onEdit: (a: Action) => void; onDeleted: () => void;
}) {
  const { wsId, memberName } = useWs();
  const [updates, setUpdates] = useState<ActionUpdate[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!action) return;
    setUpdates(must(await supabase.from("action_updates").select("*").eq("action_id", action.id).order("created_at", { ascending: false })));
  }, [action]);

  useEffect(() => {
    setUpdates(null);
    setNote("");
    setError(null);
    void load().catch((e) => setError(String(e.message ?? e)));
  }, [load]);

  if (!action) return null;

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      must(await supabase.from("action_updates").insert({ workspace_id: wsId, action_id: action.id, kind: "note", body: note.trim() }));
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (s: ActionStatus) => {
    setBusy(true);
    try {
      await setActionStatus(wsId, action, s); // parent reloads via notifyChanged
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this action and its notes? This can't be undone.")) return;
    try {
      must(await supabase.from("actions").delete().eq("id", action.id));
      notifyChanged();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={action.title}
      footer={<>
        <button className="btn-danger mr-auto" onClick={remove}><Icon name="trash" className="h-4 w-4" />Delete</button>
        <button className="btn-secondary" onClick={() => onEdit(action)}><Icon name="edit" className="h-4 w-4" />Edit</button>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </>}
    >
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={action.status} />
          <PriorityTag priority={action.priority} />
          <DueLabel action={action} />
          {action.origin !== "manual" && (
            <span className="chip bg-amber-50 text-amber-800">
              {action.origin === "explicit_commitment" ? "Commitment stated in source" : "Suggested by AI, approved by you"}
            </span>
          )}
        </div>
        {action.description && <p className="whitespace-pre-wrap text-sm text-stone-700">{action.description}</p>}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="label">Owner</dt><dd>{OWNER_LABELS[action.owner]}{action.owner_detail ? ` · ${action.owner_detail}` : ""}</dd></div>
          <div><dt className="label">Due</dt><dd>{action.due_date ? formatDate(action.due_date, { withYear: true }) : "Not set"}</dd></div>
          <div><dt className="label">Created</dt><dd>{formatDate(action.created_at, { withYear: true })}{memberName(action.created_by) ? ` by ${memberName(action.created_by)}` : ""}</dd></div>
          <div>
            <dt className="label">Source</dt>
            <dd>
              {action.source_entry_id ? <Link className="text-sage-700 underline" to={`/entries/${action.source_entry_id}`}>{action.source_label ?? "Original record"}</Link>
                : action.source_document_id ? <Link className="text-sage-700 underline" to={`/documents/${action.source_document_id}`}>{action.source_label ?? "Document"}</Link>
                : action.source_label ?? "Added manually"}
            </dd>
          </div>
        </dl>

        <div>
          <span className="label">Update status</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_LABELS) as ActionStatus[]).map((s) => (
              <button key={s} disabled={busy || s === action.status} onClick={() => changeStatus(s)}
                className={`btn-sm btn ${s === action.status ? "bg-sage-600 text-white" : "border border-sand-300 bg-white text-stone-700 hover:bg-sand-100"}`}>
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">Notes & history</span>
          <div className="flex gap-2">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note, e.g. 'Emailed Mrs Patel'"
              onKeyDown={(e) => e.key === "Enter" && addNote()} />
            <button className="btn-secondary" onClick={addNote} disabled={busy || !note.trim()}>Add</button>
          </div>
          <ul className="mt-3 space-y-2">
            {updates === null && <li><Spinner className="h-4 w-4" /></li>}
            {updates?.map((u) => (
              <li key={u.id} className={`rounded-lg px-3 py-2 text-sm ${u.kind === "note" ? "bg-sand-100 text-stone-800" : "text-stone-500"}`}>
                <span className="text-xs text-stone-400">{formatDateTime(u.created_at)}{u.author_name ? ` · ${u.author_name}` : ""}</span>
                <p className="whitespace-pre-wrap">{u.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
