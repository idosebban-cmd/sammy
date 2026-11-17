import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TimelineEditor } from "../components/forms";
import { Icon } from "../components/Icon";
import { Empty, ErrorNote, EvidenceBadge, Field, Loading, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { addDaysIso, formatDate, monthKey, todayIso } from "../lib/dates";
import { notifyChanged, useOnChanged } from "../lib/events";
import {
  EFFECT_LABELS, INTERVENTION_STATUS_LABELS, PROGRESS_LABELS, SETTING_LABELS, TIMELINE_LABELS, TIMELINE_STYLES, options,
} from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { Intervention, InterventionObservation, ProgressArea, TimelineCategory, TimelineEvent } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

type Tab = "timeline" | "progress" | "interventions";

export default function TimelinePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "timeline";
  const setTab = (t: Tab) => setParams(t === "timeline" ? {} : { tab: t });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Timeline & progress" subtitle="Sammy's story so far — the good days, the hard ones, and what's being tried." />
      <div className="mb-5 flex gap-1 rounded-xl bg-sand-100 p-1" role="tablist">
        {(["timeline", "progress", "interventions"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? "bg-white text-sage-800 shadow-soft" : "text-stone-600"}`}>{t}</button>
        ))}
      </div>
      {tab === "timeline" && <TimelineTab focus={params.get("focus")} />}
      {tab === "progress" && <ProgressTab />}
      {tab === "interventions" && <InterventionsTab focus={params.get("focus")} />}
    </div>
  );
}

function useEvents() {
  const { wsId } = useWs();
  const res = useLoad(async () => must(await supabase.from("timeline_events").select("*").eq("workspace_id", wsId)
    .order("occurred_on", { ascending: false }).order("created_at", { ascending: false })) as TimelineEvent[], [wsId]);
  const { reload } = res;
  useOnChanged(useCallback(() => void reload(), [reload]));
  return res;
}

function useFocus(id: string | null, ready: boolean) {
  useEffect(() => {
    if (!id || !ready) return;
    const el = document.getElementById(`item-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [id, ready]);
}

function EventCard({ e, focused, onEdit, onDelete }: { e: TimelineEvent; focused: boolean; onEdit: () => void; onDelete: () => void }) {
  const st = TIMELINE_STYLES[e.category];
  return (
    <li id={`item-${e.id}`} className="relative pl-7">
      <span className={`absolute left-[5px] top-5 h-3 w-3 rounded-full ring-4 ring-sand-50 ${st.dot}`} />
      <div className={`card p-4 ${focused ? "ring-2 ring-sage-400" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-stone-500">{formatDate(e.occurred_on, { withYear: true })}</span>
          <span className={`chip ${st.chip}`}>{TIMELINE_LABELS[e.category]}</span>
          {e.evidence_type !== "observation" && <EvidenceBadge type={e.evidence_type} />}
          <span className="flex-1" />
          <button className="btn-ghost p-1.5" onClick={onEdit} aria-label="Edit"><Icon name="edit" className="h-4 w-4" /></button>
          <button className="btn-ghost p-1.5" onClick={onDelete} aria-label="Delete"><Icon name="trash" className="h-4 w-4" /></button>
        </div>
        <h3 className="mt-1 font-medium text-stone-900">{e.title}</h3>
        {e.description && <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">{e.description}</p>}
        {(e.progress_areas.length > 0 || e.source_label || e.source_entry_id) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {e.progress_areas.map((a) => <span key={a} className="chip bg-sand-100 text-stone-600">{PROGRESS_LABELS[a]}</span>)}
            {e.source_entry_id ? (
              <Link to={`/entries/${e.source_entry_id}`} className="text-xs text-stone-500 underline">Source: {e.source_label ?? "original record"}</Link>
            ) : e.source_document_id ? (
              <Link to={`/documents/${e.source_document_id}`} className="text-xs text-stone-500 underline">Source: {e.source_label ?? "document"}</Link>
            ) : e.source_label && <span className="text-xs text-stone-500">Source: {e.source_label}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function TimelineTab({ focus }: { focus: string | null }) {
  const { data, error, loading, reload } = useEvents();
  const [category, setCategory] = useState<TimelineCategory | "">("");
  const [area, setArea] = useState<ProgressArea | "">("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<TimelineEvent | null>(null);
  const [creating, setCreating] = useState(false);
  useFocus(focus, !!data);

  const today = todayIso();
  const filtered = useMemo(() => (data ?? []).filter((e) =>
    (!category || e.category === category) && (!area || e.progress_areas.includes(area)) &&
    (!q || `${e.title} ${e.description ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [data, category, area, q]);
  const future = filtered.filter((e) => e.occurred_on > today).reverse();
  const past = filtered.filter((e) => e.occurred_on <= today);
  const months = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>();
    for (const e of past) {
      const k = monthKey(e.occurred_on);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [past]);

  const remove = async (e: TimelineEvent) => {
    if (!window.confirm(`Delete "${e.title}" from the timeline?`)) return;
    must(await supabase.from("timeline_events").delete().eq("id", e.id));
    notifyChanged();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input className="input !py-2 pl-9" placeholder="Search the timeline" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="!w-auto !py-2 text-xs" value={category} onChange={setCategory} options={options(TIMELINE_LABELS)} allowEmpty emptyLabel="All types" />
        <Select className="!w-auto !py-2 text-xs" value={area} onChange={setArea} options={options(PROGRESS_LABELS)} allowEmpty emptyLabel="All areas" />
        <button className="btn-primary !py-2" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />Add</button>
      </div>

      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} onRetry={reload} /> : !filtered.length ? (
        <Empty title={data?.length ? "Nothing matches those filters" : "The timeline is empty"}
          action={!data?.length ? <button className="btn-secondary" onClick={() => setCreating(true)}>Add the first entry</button> : undefined}>
          {!data?.length && "Record achievements, difficult moments, changes at school, appointments and decisions. Entries you confirm after an analysis are added here automatically."}
        </Empty>
      ) : (
        <div className="space-y-6">
          {future.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">Coming up</h2>
              <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[10px] before:top-2 before:w-px before:bg-sand-300">
                {future.map((e) => <EventCard key={e.id} e={e} focused={focus === e.id} onEdit={() => setEditing(e)} onDelete={() => remove(e)} />)}
              </ol>
            </section>
          )}
          {months.map(([month, events]) => (
            <section key={month}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{month}</h2>
              <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[10px] before:top-2 before:w-px before:bg-sand-300">
                {events.map((e) => <EventCard key={e.id} e={e} focused={focus === e.id} onEdit={() => setEditing(e)} onDelete={() => remove(e)} />)}
              </ol>
            </section>
          ))}
        </div>
      )}
      <TimelineEditor open={creating || !!editing} event={editing} onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function ProgressTab() {
  const { data, error, loading, reload } = useEvents();
  const since = addDaysIso(todayIso(), -90);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Couldn't load"} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Each area shows the timeline entries you've linked to it, newest first. There are no scores: read the entries
        together to see how things are changing. With only a few entries, treat any impression as tentative.
      </p>
      {(Object.keys(PROGRESS_LABELS) as ProgressArea[]).map((area) => {
        const items = data.filter((e) => e.progress_areas.includes(area));
        const recent = items.filter((e) => e.occurred_on >= since);
        const good = recent.filter((e) => e.category === "positive").length;
        const hard = recent.filter((e) => e.category === "dysregulation" || e.category === "anxiety").length;
        return (
          <section key={area} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="section-title">{PROGRESS_LABELS[area]}</h2>
              <span className="text-xs text-stone-500">
                {items.length === 0 ? "No entries yet" : `Last 3 months: ${good} positive, ${hard} difficult, ${recent.length - good - hard} other`}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Tag timeline entries with this area to follow it here.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {items.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex gap-2 text-sm">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TIMELINE_STYLES[e.category].dot}`} />
                    <Link to={`/timeline?focus=${e.id}`} className="hover:underline">
                      <span className="text-stone-800">{e.title}</span> <span className="text-xs text-stone-500">{formatDate(e.occurred_on, { withYear: true })}</span>
                    </Link>
                  </li>
                ))}
                {items.length > 5 && <li className="text-xs text-stone-500">and {items.length - 5} earlier</li>}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function InterventionsTab({ focus }: { focus: string | null }) {
  const { wsId } = useWs();
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from("interventions").select("*, intervention_observations(*)").eq("workspace_id", wsId)
      .order("status").order("started_on", { ascending: false, nullsFirst: false })) as Intervention[], [wsId]);
  useOnChanged(useCallback(() => void reload(), [reload]));
  useFocus(focus, !!data);
  const [editing, setEditing] = useState<Intervention | null>(null);
  const [creating, setCreating] = useState(false);
  const [observing, setObserving] = useState<Intervention | null>(null);

  const remove = async (i: Intervention) => {
    if (!window.confirm(`Delete "${i.name}" and its observations?`)) return;
    must(await supabase.from("interventions").delete().eq("id", i.id));
    notifyChanged();
  };
  const removeObs = async (o: InterventionObservation) => {
    if (!window.confirm("Delete this observation?")) return;
    must(await supabase.from("intervention_observations").delete().eq("id", o.id));
    notifyChanged();
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-stone-600">What's been tried, and what you've noticed. Early impressions are just that.</p>
        <button className="btn-primary shrink-0" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />Add</button>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} onRetry={reload} /> : !data?.length ? (
        <Empty title="No interventions recorded" action={<button className="btn-secondary" onClick={() => setCreating(true)}>Add one</button>}>
          For example: a calm corner, a visual timetable, 1:1 support at lunchtime, OT sessions, a new bedtime routine.
        </Empty>
      ) : (
        <ul className="space-y-4">
          {data.map((i) => {
            const obs = [...(i.intervention_observations ?? [])].sort((a, b) => b.observed_on.localeCompare(a.observed_on));
            return (
              <li key={i.id} id={`item-${i.id}`} className={`card p-4 ${focus === i.id ? "ring-2 ring-sage-400" : ""}`}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-stone-900">{i.name}</h3>
                    <p className="text-xs text-stone-500">
                      {SETTING_LABELS[i.setting]} · {INTERVENTION_STATUS_LABELS[i.status]}
                      {i.started_on && ` · since ${formatDate(i.started_on, { withYear: true })}`}
                      {i.ended_on && ` until ${formatDate(i.ended_on, { withYear: true })}`}
                    </p>
                  </div>
                  <button className="btn-ghost p-1.5" onClick={() => setEditing(i)} aria-label="Edit"><Icon name="edit" className="h-4 w-4" /></button>
                  <button className="btn-ghost p-1.5" onClick={() => remove(i)} aria-label="Delete"><Icon name="trash" className="h-4 w-4" /></button>
                </div>
                {i.description && <p className="mt-2 whitespace-pre-wrap text-sm text-stone-600">{i.description}</p>}
                <div className="mt-3 border-t border-sand-200 pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label !mb-0">What we've noticed</span>
                    <button className="btn-ghost btn-sm" onClick={() => setObserving(i)}>+ Add observation</button>
                  </div>
                  {obs.length === 0 ? <p className="text-sm text-stone-500">No observations yet.</p> : (
                    <ul className="space-y-2">
                      {obs.map((o) => (
                        <li key={o.id} className="group flex gap-3 text-sm">
                          <span className="w-16 shrink-0 text-xs text-stone-500">{formatDate(o.observed_on)}</span>
                          <div className="flex-1">
                            <span className={`chip mr-1 ${o.apparent_effect === "seems_helpful" ? "bg-emerald-50 text-emerald-800" : o.apparent_effect === "not_helpful" ? "bg-rose-50 text-rose-800" : "bg-stone-100 text-stone-600"}`}>{EFFECT_LABELS[o.apparent_effect]}</span>
                            <span className="text-stone-700">{o.note}</span>
                          </div>
                          <button className="opacity-0 transition group-hover:opacity-100" onClick={() => removeObs(o)} aria-label="Delete observation"><Icon name="x" className="h-4 w-4 text-stone-400" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <InterventionEditor open={creating || !!editing} intervention={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <ObservationEditor intervention={observing} onClose={() => setObserving(null)} />
    </>
  );
}

function InterventionEditor({ open, intervention, onClose }: { open: boolean; intervention: Intervention | null; onClose: () => void }) {
  const { wsId } = useWs();
  const blank = { name: "", description: "", setting: "school" as Intervention["setting"], started_on: todayIso(), ended_on: "", status: "active" as Intervention["status"] };
  const [d, setD] = useState(blank);
  const [addToTimeline, setAddToTimeline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setD(intervention ? {
      name: intervention.name, description: intervention.description ?? "", setting: intervention.setting,
      started_on: intervention.started_on ?? "", ended_on: intervention.ended_on ?? "", status: intervention.status,
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, intervention]);

  const save = async () => {
    if (!d.name.trim()) return setError("Please name the intervention.");
    setBusy(true);
    try {
      const row = { ...d, name: d.name.trim(), description: d.description.trim() || null, started_on: d.started_on || null, ended_on: d.ended_on || null };
      if (intervention) {
        must(await supabase.from("interventions").update(row).eq("id", intervention.id));
      } else {
        const created = must(await supabase.from("interventions").insert({ ...row, workspace_id: wsId }).select("id").single()) as { id: string };
        if (addToTimeline) {
          must(await supabase.from("timeline_events").insert({
            workspace_id: wsId, occurred_on: row.started_on ?? todayIso(), category: "intervention",
            title: `Started: ${row.name}`, description: row.description, intervention_id: created.id,
          }));
        }
      }
      notifyChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD({ ...d, [k]: v });
  return (
    <Modal open={open} onClose={onClose} title={intervention ? "Edit intervention" : "New intervention or strategy"}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner className="h-4 w-4" />}Save</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Movement break before carpet time" /></Field>
        <Field label="Description"><textarea className="input min-h-[80px]" value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="What it involves, who delivers it, how often" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Where"><Select value={d.setting} onChange={(v) => set("setting", v)} options={options(SETTING_LABELS)} /></Field>
          <Field label="Status"><Select value={d.status} onChange={(v) => set("status", v)} options={options(INTERVENTION_STATUS_LABELS)} /></Field>
          <Field label="Started"><input type="date" className="input" value={d.started_on} onChange={(e) => set("started_on", e.target.value)} /></Field>
          <Field label="Ended"><input type="date" className="input" value={d.ended_on} onChange={(e) => set("ended_on", e.target.value)} /></Field>
        </div>
        {!intervention && (
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={addToTimeline} onChange={(e) => setAddToTimeline(e.target.checked)} />
            Also add a timeline entry for the start date
          </label>
        )}
      </div>
    </Modal>
  );
}

function ObservationEditor({ intervention, onClose }: { intervention: Intervention | null; onClose: () => void }) {
  const { wsId } = useWs();
  const [date, setDate] = useState(todayIso());
  const [effect, setEffect] = useState<InterventionObservation["apparent_effect"]>("unclear");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (intervention) { setDate(todayIso()); setEffect("unclear"); setNote(""); setError(null); } }, [intervention]);
  const save = async () => {
    if (!intervention) return;
    if (!note.trim()) return setError("Please describe what you noticed.");
    setBusy(true);
    try {
      must(await supabase.from("intervention_observations").insert({ workspace_id: wsId, intervention_id: intervention.id, observed_on: date, apparent_effect: effect, note: note.trim() }));
      notifyChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!intervention} onClose={onClose} title={`What have you noticed? ${intervention ? `— ${intervention.name}` : ""}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>Save</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="So far it…"><Select value={effect} onChange={setEffect} options={options(EFFECT_LABELS)} /></Field>
        </div>
        <Field label="What you noticed"><textarea className="input min-h-[100px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Teacher says he joined carpet time without prompting 3 days this week" /></Field>
      </div>
    </Modal>
  );
}
