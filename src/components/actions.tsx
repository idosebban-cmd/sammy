import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { daysFromToday, formatDate, formatDateTime, parseNaturalDate, relativeDue } from "../lib/dates";
import { notifyChanged } from "../lib/events";
import { OWNER_LABELS, PRIORITY_LABELS, STATUS_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { Action, ActionOwner, ActionStatus, ActionUpdate, Commitment, Priority } from "../lib/types";
import { must } from "../lib/useLoad";
import { useWs } from "../lib/workspace";
import { Icon } from "./Icon";
import { ErrorNote, Field, Modal, PriorityTag, Select, Spinner, StatusBadge } from "./ui";

export interface ActionDraft {
  title: string;
  description: string;
  owner: ActionOwner;
  owner_detail: string;
  kind: "task" | "appointment";
  due_date: string;
  due_time: string;
  due_text: string;
  date_confirmed: boolean;
  status: ActionStatus;
  priority: Priority;
}

export const emptyAction = (owner: ActionOwner = "both_parents"): ActionDraft => ({
  title: "", description: "", owner, owner_detail: "", kind: "task", due_date: "", due_time: "", due_text: "",
  date_confirmed: true, status: "todo", priority: "medium",
});

export function draftFromAction(a: Action): ActionDraft {
  return {
    title: a.title, description: a.description ?? "", owner: a.owner, owner_detail: a.owner_detail ?? "", kind: a.kind ?? "task",
    due_date: a.due_date ?? "", due_time: a.due_time?.slice(0, 5) ?? "", due_text: a.due_text ?? "",
    date_confirmed: a.date_confirmed ?? true, status: a.status, priority: a.priority,
  };
}

export function draftToRow(d: ActionDraft) {
  return {
    title: d.title.trim(), description: d.description.trim() || null, owner: d.owner, owner_detail: d.owner_detail.trim() || null,
    kind: d.kind, due_date: d.due_date || null, due_time: d.due_date && d.due_time ? d.due_time : null,
    due_text: d.due_text.trim() || null, date_confirmed: d.due_date ? d.date_confirmed : true,
    status: d.status, priority: d.priority,
  };
}

/** Date entry that accepts a date picker or everyday words ("next Friday", "in 2 weeks"). */
export function WhenField({ value, onChange }: { value: ActionDraft; onChange: (v: ActionDraft) => void }) {
  const [typed, setTyped] = useState("");
  const parsed = typed ? parseNaturalDate(typed) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input type="date" className="input !w-auto" value={value.due_date}
          onChange={(e) => onChange({ ...value, due_date: e.target.value, date_confirmed: true })} aria-label="Date" />
        {value.kind === "appointment" && (
          <input type="time" className="input !w-auto" value={value.due_time} onChange={(e) => onChange({ ...value, due_time: e.target.value })} aria-label="Time" />
        )}
        <input className="input min-w-[140px] flex-1" value={typed} placeholder="or type: next Fri, in 2 weeks, 21 Nov"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && parsed) { e.preventDefault(); onChange({ ...value, due_date: parsed, date_confirmed: true }); setTyped(""); } }} />
      </div>
      {typed && (parsed ? (
        <button type="button" className="chip bg-sage-50 text-sage-800 ring-1 ring-sage-200"
          onClick={() => { onChange({ ...value, due_date: parsed, date_confirmed: true }); setTyped(""); }}>
          Use {new Date(parsed + "T00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
        </button>
      ) : (
        <p className="text-xs text-stone-500">Can't turn that into a date. It'll be saved as a note on timing instead: "{typed}".
          <button type="button" className="ml-1 underline" onClick={() => { onChange({ ...value, due_text: typed }); setTyped(""); }}>Save as note</button></p>
      ))}
      {value.due_text && (
        <p className="text-xs text-stone-500">Timing from source: "{value.due_text}" <button type="button" className="underline" onClick={() => onChange({ ...value, due_text: "" })}>clear</button></p>
      )}
      {value.due_date && (
        <label className="flex items-center gap-2 text-xs text-stone-600">
          <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={!value.date_confirmed}
            onChange={(e) => onChange({ ...value, date_confirmed: !e.target.checked })} />
          This date still needs confirming
        </label>
      )}
    </div>
  );
}

export function ActionFields({ value, onChange }: { value: ActionDraft; onChange: (v: ActionDraft) => void }) {
  const set = <K extends keyof ActionDraft>(k: K, v: ActionDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-xl bg-sand-100 p-1 text-xs">
        {(["task", "appointment"] as const).map((k) => (
          <button key={k} type="button" onClick={() => set("kind", k)}
            className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${value.kind === k ? "bg-white text-sage-800 shadow-soft" : "text-stone-600"}`}>
            {k === "task" ? "Something to do" : "Appointment or meeting"}
          </button>
        ))}
      </div>
      <Field label={value.kind === "appointment" ? "What is it" : "What needs doing"}>
        <input className="input" value={value.title} onChange={(e) => set("title", e.target.value)}
          placeholder={value.kind === "appointment" ? "e.g. Annual review meeting at school" : "e.g. Ask school about an alternative to collective worship"} />
      </Field>
      <Field label="When">
        <WhenField value={value} onChange={onChange} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Who's responsible">
          <Select value={value.owner} onChange={(v) => set("owner", v)} options={options(OWNER_LABELS)} />
        </Field>
        <Field label="Who specifically (optional)">
          <input className="input" value={value.owner_detail} onChange={(e) => set("owner_detail", e.target.value)} placeholder="e.g. Class teacher, SENCo" />
        </Field>
        <Field label="Status">
          <Select value={value.status} onChange={(v) => set("status", v)} options={options(STATUS_LABELS)} />
        </Field>
        <Field label="Priority">
          <Select value={value.priority} onChange={(v) => set("priority", v)} options={options(PRIORITY_LABELS)} />
        </Field>
      </div>
      <Field label="Details (optional)">
        <textarea className="input min-h-[70px]" value={value.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
    </div>
  );
}

function describeChanges(before: Action, after: ActionDraft): string[] {
  const out: string[] = [];
  const fmt = (d: string | null) => (d ? formatDate(d, { withYear: true }) : "none");
  if (before.status !== after.status) out.push(`Status: ${STATUS_LABELS[before.status]} → ${STATUS_LABELS[after.status]}`);
  if (before.owner !== after.owner) out.push(`Owner: ${OWNER_LABELS[before.owner]} → ${OWNER_LABELS[after.owner]}`);
  if ((before.due_date ?? "") !== after.due_date) out.push(`Date: ${fmt(before.due_date)} → ${fmt(after.due_date || null)}`);
  if (before.due_date && after.due_date && before.date_confirmed === false && after.date_confirmed) out.push("Date confirmed");
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

export async function confirmActionDate(wsId: string, action: Action) {
  must(await supabase.from("actions").update({ date_confirmed: true }).eq("id", action.id));
  await logActionChange(wsId, action.id, `Date confirmed: ${formatDate(action.due_date, { withYear: true })}`);
  notifyChanged();
}

export interface RecordSource { entryId?: string | null; documentId?: string | null; commitmentId?: string | null; label: string }

/** Create (action = null) or edit an action. */
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
    setDraft(action ? draftFromAction(action) : { ...emptyAction(), ...defaults });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  const save = async () => {
    if (!draft.title.trim()) return setError("Please give it a title.");
    setSaving(true);
    setError(null);
    try {
      const row = draftToRow(draft);
      let saved: Action;
      if (action) {
        const changes = describeChanges(action, draft);
        saved = must(await supabase.from("actions").update(row).eq("id", action.id).select("*").single());
        if (changes.length) await logActionChange(wsId, action.id, changes.join("; "));
      } else {
        saved = must(await supabase.from("actions").insert({
          ...row, workspace_id: wsId, origin: "manual",
          source_entry_id: source?.entryId ?? null, source_document_id: source?.documentId ?? null,
          commitment_id: source?.commitmentId ?? null, source_label: source?.label ?? null,
        }).select("*").single());
        await logActionChange(wsId, saved.id, source ? `Created from ${source.label}` : "Created");
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
      title={action ? "Edit" : "New action or appointment"}
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

export function DueLabel({ action }: { action: Pick<Action, "due_date" | "status" | "kind" | "due_time" | "date_confirmed" | "due_text" | "status_changed_at"> }) {
  const waitingDays = action.status === "waiting" && action.status_changed_at ? -daysFromToday(action.status_changed_at.slice(0, 10)) : 0;
  const waiting = waitingDays >= 1 && (
    <span className={`inline-flex items-center gap-1 text-xs ${waitingDays >= 7 ? "font-medium text-amber-700" : "text-stone-500"}`}>
      <Icon name="clock" className="h-3.5 w-3.5" />Waiting {waitingDays} day{waitingDays === 1 ? "" : "s"}
    </span>
  );
  if (!action.due_date) {
    return <>{action.due_text ? <span className="text-xs text-stone-500">"{action.due_text}" · date to confirm</span> : !waiting && <span className="text-xs text-stone-400">No date</span>}{waiting}</>;
  }
  if (action.status === "completed") return <span className="text-xs text-stone-500">Was due {formatDate(action.due_date)}</span>;
  const n = daysFromToday(action.due_date);
  const cls = n < 0 ? "text-rose-700 font-medium" : n <= 3 ? "text-amber-700 font-medium" : "text-stone-500";
  const time = action.kind === "appointment" && action.due_time ? ` at ${action.due_time.slice(0, 5)}` : "";
  return (
    <>
      <span className={`inline-flex items-center gap-1 text-xs ${cls}`}>
        <Icon name={action.kind === "appointment" ? "calendar" : "clock"} className="h-3.5 w-3.5" />
        {action.kind === "appointment"
          ? `${n === 0 ? "Today" : n === 1 ? "Tomorrow" : formatDate(action.due_date)}${time}`
          : relativeDue(action.due_date)}
      </span>
      {action.date_confirmed === false && <span className="chip bg-amber-50 text-amber-800">Date to confirm</span>}
      {waiting}
    </>
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
          {action.status === "in_progress" && <StatusBadge status={action.status} />}
          {action.status === "waiting" && <StatusBadge status={action.status} />}
          {action.priority === "high" && !done && <PriorityTag priority="high" />}
        </div>
        {done && action.outcome && <p className="mt-1 text-xs text-stone-500">Outcome: {action.outcome}</p>}
      </button>
    </div>
  );
}

/** Detail view with notes, outcome and change history. */
export function ActionDetail({ action, onClose, onEdit, onDeleted }: {
  action: Action | null; onClose: () => void; onEdit: (a: Action) => void; onDeleted: () => void;
}) {
  const { wsId, memberName } = useWs();
  const [updates, setUpdates] = useState<ActionUpdate[] | null>(null);
  const [commitment, setCommitment] = useState<Commitment | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!action) return;
    setUpdates(must(await supabase.from("action_updates").select("*").eq("action_id", action.id).order("created_at", { ascending: false })));
    setCommitment(action.commitment_id ? must(await supabase.from("commitments").select("*").eq("id", action.commitment_id).maybeSingle()) : null);
  }, [action]);

  useEffect(() => {
    setUpdates(null);
    setNote("");
    setOutcome(action?.outcome ?? "");
    setError(null);
    void load().catch((e) => setError(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.id, load]);

  if (!action) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const addNote = () => note.trim() && run(async () => {
    must(await supabase.from("action_updates").insert({ workspace_id: wsId, action_id: action.id, kind: "note", body: note.trim() }));
    setNote("");
  });

  const saveOutcome = () => run(async () => {
    must(await supabase.from("actions").update({ outcome: outcome.trim() || null }).eq("id", action.id));
    if (outcome.trim()) await logActionChange(wsId, action.id, `Outcome: ${outcome.trim()}`);
    notifyChanged();
  });

  const remove = async () => {
    if (!window.confirm("Delete this and its notes? This can't be undone.")) return;
    await run(async () => {
      must(await supabase.from("actions").delete().eq("id", action.id));
      notifyChanged();
      onDeleted();
    });
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
          {action.kind === "appointment" && <span className="chip bg-indigo-50 text-indigo-800">Appointment</span>}
          <StatusBadge status={action.status} />
          <PriorityTag priority={action.priority} />
          <DueLabel action={action} />
          {action.origin !== "manual" && (
            <span className="chip bg-amber-50 text-amber-800">
              {action.origin === "explicit_commitment" ? "Commitment stated in source" : "Suggested by AI, approved by you"}
            </span>
          )}
        </div>
        {action.date_confirmed === false && action.due_date && action.status !== "completed" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <span>The date ({formatDate(action.due_date, { withYear: true })}) was worked out{action.due_text ? ` from "${action.due_text}"` : ""} and hasn't been confirmed.</span>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onEdit(action)}>Change</button>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => run(() => confirmActionDate(wsId, action))}>Confirm date</button>
            </div>
          </div>
        )}
        {action.description && <p className="whitespace-pre-wrap text-sm text-stone-700">{action.description}</p>}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="label">Who</dt><dd>{OWNER_LABELS[action.owner]}{action.owner_detail ? ` · ${action.owner_detail}` : ""}</dd></div>
          <div><dt className="label">When</dt><dd>{action.due_date ? `${formatDate(action.due_date, { withYear: true })}${action.due_time ? ` at ${action.due_time.slice(0, 5)}` : ""}` : action.due_text ? `"${action.due_text}"` : "Not set"}</dd></div>
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
        {commitment && (
          <div className="rounded-xl border border-sand-200 p-3 text-sm">
            <span className="label">Follows up</span>
            <Link to={`/documents?tab=provision&focus=${commitment.id}`} className="text-stone-800 hover:underline">{commitment.description}</Link>
          </div>
        )}

        <div>
          <span className="label">Status</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_LABELS) as ActionStatus[]).map((s) => (
              <button key={s} disabled={busy || s === action.status} onClick={() => run(() => setActionStatus(wsId, action, s))}
                className={`btn-sm btn ${s === action.status ? "bg-sage-600 text-white" : "border border-sand-300 bg-white text-stone-700 hover:bg-sand-100"}`}>
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {(action.status === "completed" || action.outcome) && (
          <div>
            <span className="label">Outcome</span>
            <div className="flex gap-2">
              <input className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened? e.g. School agreed to trial it from Monday" />
              <button className="btn-secondary" onClick={saveOutcome} disabled={busy || outcome === (action.outcome ?? "")}>Save</button>
            </div>
          </div>
        )}

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

