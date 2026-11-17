import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TimelineEditor } from "../components/forms";
import { Icon } from "../components/Icon";
import { Empty, ErrorNote, EvidenceBadge, Field, Loading, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { addDaysIso, formatDate, monthKey, todayIso } from "../lib/dates";
import { notifyChanged, useOnChanged } from "../lib/events";
import {
  EFFECT_LABELS, EFFECT_STYLES, INTERVENTION_STATUS_LABELS, PROGRESS_LABELS, SETTING_LABELS, TIMELINE_LABELS, TIMELINE_STYLES, options, progressLabel,
} from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { Effect, Intervention, InterventionObservation, ProgressArea, ProgressReview, TimelineCategory, TimelineEvent } from "../lib/types";
import { ProgressAreaPicker } from "../components/forms";
import { RichText, SourceList } from "../components/Sources";
import { ApiError, requestProgressReview } from "../lib/api";
import { formatDateTime } from "../lib/dates";
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
            {e.progress_areas.map((a) => <span key={a} className="chip bg-sand-100 text-stone-600">{progressLabel(a)}</span>)}
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

function useInterventions() {
  const { wsId } = useWs();
  const res = useLoad(async () =>
    must(await supabase.from("interventions").select("*, intervention_observations(*)").eq("workspace_id", wsId)
      .order("status").order("started_on", { ascending: false, nullsFirst: false })) as Intervention[], [wsId]);
  const { reload } = res;
  useOnChanged(useCallback(() => void reload(), [reload]));
  return res;
}

function sortedObs(i: Intervention) {
  return [...(i.intervention_observations ?? [])].sort((a, b) => b.observed_on.localeCompare(a.observed_on));
}

/** Plain-language summary of how much evidence there is, without statistics. */
function evidenceSummary(obs: InterventionObservation[]): string {
  if (!obs.length) return "No observations yet";
  const n = obs.length;
  const first = obs[obs.length - 1].observed_on;
  const weeks = Math.max(1, Math.round((Date.parse(obs[0].observed_on) - Date.parse(first)) / (7 * 86_400_000)));
  const helped = obs.filter((o) => o.apparent_effect === "seems_helpful").length;
  const span = n === 1 ? "1 observation" : `${n} observations over ${weeks} week${weeks === 1 ? "" : "s"}`;
  const strength = n <= 2 ? "too early to judge" : n <= 4 ? "early signs only" : helped >= Math.ceil(n * 0.75) ? "fairly consistent so far" : "mixed picture";
  return `${span} · ${strength}`;
}

const STRENGTH_LABELS = { too_early: "Too early to tell", some_signs: "Some signs", consistent: "Consistent so far" } as const;

function ProgressReviewCard() {
  const { wsId, aiEnabled, memberName } = useWs();
  const { data, reload } = useLoad(async () =>
    must(await supabase.from("progress_reviews").select("*").eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(1)) as ProgressReview[], [wsId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = data?.[0] ?? null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestProgressReview(90);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const List = ({ title, items, tone }: { title: string; items: { point: string; refs: string[] }[]; tone: string }) => items.length ? (
    <div>
      <h3 className={`label ${tone}`}>{title}</h3>
      <ul className="space-y-2">
        {items.map((p, i) => (
          <li key={i} className="text-sm text-stone-700"><RichText text={p.point.replace(/\s?\[[A-Z]\d{1,3}\]/g, "")} /><SourceList refs={p.refs} sources={review!.citations} /></li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="section-title">How Sammy is getting on</h2>
          <p className="text-xs text-stone-500">{review ? `AI review of the last ${review.period_days} days · ${formatDateTime(review.created_at)}${memberName(review.created_by) ? ` · requested by ${memberName(review.created_by)}` : ""}` : "A short, plain-English review of the last three months, drawn from everything recorded."}</p>
        </div>
        {aiEnabled && (
          <button className={review ? "btn-secondary btn-sm" : "btn-primary btn-sm"} onClick={generate} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}{review ? "Refresh" : "Review progress"}
          </button>
        )}
      </div>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      {busy && <p className="mt-3 text-sm text-stone-500">Reading the last three months… this takes up to a minute.</p>}
      {!aiEnabled && !review && <p className="mt-3 text-sm text-stone-500">Switch on AI in Settings to get a written review. The areas below work without it.</p>}
      {review && (
        <div className="mt-4 space-y-4">
          <p className="text-sm font-medium text-stone-900">{review.content.headline.replace(/\s?\[[A-Z]\d{1,3}\]/g, "")}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <List title="Going well" items={review.content.going_well} tone="!text-emerald-700" />
            <List title="Still difficult" items={review.content.still_difficult} tone="!text-rose-700" />
          </div>
          {review.content.interventions.length > 0 && (
            <div>
              <h3 className="label">What's being tried</h3>
              <ul className="space-y-2">
                {review.content.interventions.map((i, k) => (
                  <li key={k} className="text-sm text-stone-700">
                    <span className="font-medium text-stone-900">{i.name}</span>{" "}
                    <span className={`chip ${i.evidence_strength === "consistent" ? "bg-emerald-50 text-emerald-800" : i.evidence_strength === "some_signs" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}>{STRENGTH_LABELS[i.evidence_strength]}</span>
                    <p>{i.what_we_have_seen.replace(/\s?\[[A-Z]\d{1,3}\]/g, "")}</p>
                    <SourceList refs={i.refs} sources={review.citations} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <List title="Worth considering" items={review.content.worth_considering} tone="" />
          {review.content.caveats && <p className="rounded-lg bg-sand-100 p-2 text-xs text-stone-600">{review.content.caveats}</p>}
        </div>
      )}
    </section>
  );
}

function ProgressTab() {
  const { data, error, loading, reload } = useEvents();
  const interventions = useInterventions();
  const [showAll, setShowAll] = useState<string | null>(null);
  const since = addDaysIso(todayIso(), -90);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Couldn't load"} onRetry={reload} />;
  const active = (interventions.data ?? []).filter((i) => i.status === "active");

  return (
    <div className="space-y-4">
      <ProgressReviewCard />

      {active.length > 0 && (
        <section className="card p-4 sm:p-5">
          <h2 className="section-title mb-3">What's being tried</h2>
          <ul className="space-y-3">
            {active.map((i) => {
              const obs = sortedObs(i);
              return (
                <li key={i.id}>
                  <Link to={`/timeline?tab=interventions&focus=${i.id}`} className="text-sm font-medium text-stone-900 hover:underline">{i.name}</Link>
                  <p className="text-xs text-stone-500">{evidenceSummary(obs)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {obs.slice(0, 8).reverse().map((o) => <span key={o.id} title={`${formatDate(o.observed_on)}: ${o.note}`} className={`chip ${EFFECT_STYLES[o.apparent_effect]}`}>{formatDate(o.observed_on)}</span>)}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="px-1 text-sm text-stone-600">
        Each area shows the timeline entries tagged with it, good moments first. There are no scores: read them together to see how
        things are changing. With only a few entries, any impression is tentative.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(Object.keys(PROGRESS_LABELS) as ProgressArea[]).map((area) => {
          const items = data.filter((e) => e.progress_areas.includes(area) && e.occurred_on <= todayIso());
          const recent = items.filter((e) => e.occurred_on >= since);
          const good = recent.filter((e) => e.category === "positive");
          const hard = recent.filter((e) => e.category === "dysregulation" || e.category === "anxiety");
          const list = showAll === area ? items : items.slice(0, 4);
          return (
            <section key={area} className="card p-4">
              <h2 className="section-title">{PROGRESS_LABELS[area]}</h2>
              <p className="text-xs text-stone-500">
                {items.length === 0 ? "Nothing tagged yet" : `Last 3 months: ${good.length} good moment${good.length === 1 ? "" : "s"}, ${hard.length} harder`}
              </p>
              {items.length === 0 ? (
                <p className="mt-2 text-sm text-stone-400">Analyses tag entries automatically; you can also tag them on the timeline.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {[...list].sort((a, b) => Number(b.category === "positive") - Number(a.category === "positive") || b.occurred_on.localeCompare(a.occurred_on)).map((e) => (
                    <li key={e.id} className="flex gap-2 text-sm">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TIMELINE_STYLES[e.category].dot}`} />
                      <Link to={`/timeline?focus=${e.id}`} className="hover:underline">
                        <span className="text-stone-800">{e.title}</span> <span className="text-xs text-stone-500">{formatDate(e.occurred_on)}</span>
                      </Link>
                    </li>
                  ))}
                  {items.length > 4 && (
                    <li><button className="text-xs text-sage-700 underline" onClick={() => setShowAll(showAll === area ? null : area)}>{showAll === area ? "Show fewer" : `Show all ${items.length}`}</button></li>
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function InterventionsTab({ focus }: { focus: string | null }) {
  const { data, error, loading, reload } = useInterventions();
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
        <p className="text-sm text-stone-600">What we or school changed, what happened afterwards, and whether it seemed to help.</p>
        <button className="btn-primary shrink-0" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />Add</button>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} onRetry={reload} /> : !data?.length ? (
        <Empty title="Nothing recorded yet" action={<button className="btn-secondary" onClick={() => setCreating(true)}>Add an intervention</button>}>
          For example: an alternative to collective worship, a calm corner, a visual timetable, 1:1 support at lunchtime, OT sessions, a new bedtime routine. Analyses of school emails will also suggest these.
        </Empty>
      ) : (
        <ul className="space-y-4">
          {data.map((i) => {
            const obs = sortedObs(i);
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
                {i.goal && <p className="mt-2 text-sm text-stone-700"><span className="font-medium">Hoping to help with: </span>{i.goal}</p>}
                {i.description && <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">{i.description}</p>}
                {!!i.progress_areas?.length && <div className="mt-2 flex flex-wrap gap-1">{i.progress_areas.map((a) => <span key={a} className="chip bg-sand-100 text-stone-600">{progressLabel(a)}</span>)}</div>}
                <div className="mt-3 border-t border-sand-200 pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="label !mb-0">What happened afterwards</span>
                      <span className="text-xs text-stone-500">{evidenceSummary(obs)}</span>
                    </div>
                    <button className="btn-secondary btn-sm" onClick={() => setObserving(i)}>+ Add observation</button>
                  </div>
                  {obs.length === 0 ? <p className="text-sm text-stone-500">Nothing noted yet. A sentence after a good or hard day is enough.</p> : (
                    <ul className="space-y-3">
                      {obs.map((o) => (
                        <li key={o.id} className="group flex gap-3 text-sm">
                          <span className="w-14 shrink-0 pt-0.5 text-xs text-stone-500">{formatDate(o.observed_on)}</span>
                          <div className="flex-1">
                            <span className={`chip mr-1 ${EFFECT_STYLES[o.apparent_effect]}`}>{EFFECT_LABELS[o.apparent_effect]}</span>
                            <span className="text-stone-700">{o.note}</span>
                            {o.assessment && <p className="mt-0.5 text-xs italic text-stone-500">{o.assessment}</p>}
                            {o.source_entry_id && <Link to={`/entries/${o.source_entry_id}`} className="text-xs text-stone-400 underline">source</Link>}
                          </div>
                          <button className="opacity-60 transition hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100" onClick={() => removeObs(o)} aria-label="Delete observation"><Icon name="x" className="h-4 w-4 text-stone-400" /></button>
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
  const blank = { name: "", goal: "", description: "", setting: "school" as Intervention["setting"], started_on: todayIso(), ended_on: "", status: "active" as Intervention["status"], progress_areas: [] as ProgressArea[] };
  const [d, setD] = useState(blank);
  const [addToTimeline, setAddToTimeline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setD(intervention ? {
      name: intervention.name, goal: intervention.goal ?? "", description: intervention.description ?? "", setting: intervention.setting,
      started_on: intervention.started_on ?? "", ended_on: intervention.ended_on ?? "", status: intervention.status, progress_areas: intervention.progress_areas ?? [],
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, intervention]);

  const save = async () => {
    if (!d.name.trim()) return setError("Please say what was changed.");
    setBusy(true);
    try {
      const row = { ...d, name: d.name.trim(), goal: d.goal.trim() || null, description: d.description.trim() || null, started_on: d.started_on || null, ended_on: d.ended_on || null };
      if (intervention) {
        must(await supabase.from("interventions").update(row).eq("id", intervention.id));
      } else {
        const created = must(await supabase.from("interventions").insert({ ...row, workspace_id: wsId }).select("id").single()) as { id: string };
        if (addToTimeline) {
          must(await supabase.from("timeline_events").insert({
            workspace_id: wsId, occurred_on: row.started_on ?? todayIso(), category: "intervention",
            title: `Started: ${row.name}`, description: row.goal ?? row.description, intervention_id: created.id, progress_areas: row.progress_areas,
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
    <Modal open={open} onClose={onClose} title={intervention ? "Edit intervention" : "What did we or school change?"} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner className="h-4 w-4" />}Save</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <Field label="The change"><input className="input" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Alternative activity during collective worship" /></Field>
        <Field label="What we hope it helps with"><input className="input" value={d.goal} onChange={(e) => set("goal", e.target.value)} placeholder="e.g. Calmer mornings; fewer incidents in the hall" /></Field>
        <Field label="Details (optional)"><textarea className="input min-h-[70px]" value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Who delivers it, how often" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Where"><Select value={d.setting} onChange={(v) => set("setting", v)} options={options(SETTING_LABELS)} /></Field>
          <Field label="Status"><Select value={d.status} onChange={(v) => set("status", v)} options={options(INTERVENTION_STATUS_LABELS)} /></Field>
          <Field label="Started"><input type="date" className="input" value={d.started_on} onChange={(e) => set("started_on", e.target.value)} /></Field>
          <Field label="Ended"><input type="date" className="input" value={d.ended_on} onChange={(e) => set("ended_on", e.target.value)} /></Field>
        </div>
        <div><span className="label">Areas it relates to</span><ProgressAreaPicker value={d.progress_areas} onChange={(v) => set("progress_areas", v)} /></div>
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
  const [effect, setEffect] = useState<Effect>("unclear");
  const [note, setNote] = useState("");
  const [assessment, setAssessment] = useState("");
  const [toTimeline, setToTimeline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (intervention) { setDate(todayIso()); setEffect("unclear"); setNote(""); setAssessment(""); setError(null); setToTimeline(true); } }, [intervention]);
  const prior = intervention?.intervention_observations?.length ?? 0;
  const save = async () => {
    if (!intervention) return;
    if (!note.trim()) return setError("Please describe what happened.");
    setBusy(true);
    try {
      let timelineId: string | null = null;
      if (toTimeline) {
        const t = must(await supabase.from("timeline_events").insert({
          workspace_id: wsId, occurred_on: date, category: effect === "seems_helpful" ? "positive" : effect === "seems_worse" ? "dysregulation" : "observation",
          title: `${intervention.name}: ${note.trim().slice(0, 70)}${note.trim().length > 70 ? "…" : ""}`, description: note.trim(),
          progress_areas: intervention.progress_areas ?? [], intervention_id: intervention.id,
        }).select("id").single()) as { id: string };
        timelineId = t.id;
      }
      must(await supabase.from("intervention_observations").insert({
        workspace_id: wsId, intervention_id: intervention.id, observed_on: date, apparent_effect: effect, note: note.trim(),
        assessment: assessment.trim() || null, timeline_event_id: timelineId,
      }));
      notifyChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!intervention} onClose={onClose} title={intervention ? intervention.name : ""}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>Save</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <Field label="What happened afterwards?"><textarea className="input min-h-[90px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Three mornings this week without becoming dysregulated" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Did it seem to help?"><Select value={effect} onChange={setEffect} options={options(EFFECT_LABELS)} /></Field>
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Your assessment (optional)" hint={prior < 2 ? "With only a couple of observations, it's usually too early to say it's working — or that it isn't." : undefined}>
          <input className="input" value={assessment} onChange={(e) => setAssessment(e.target.value)} placeholder="e.g. Encouraging early sign, but too soon to be sure" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={toTimeline} onChange={(e) => setToTimeline(e.target.checked)} />
          Also add to the timeline
        </label>
      </div>
    </Modal>
  );
}
