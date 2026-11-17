import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveEntry } from "./Add";
import { detectKind } from "../lib/detect";
import { Spinner } from "../components/ui";
import { ActionDetail, ActionEditor, ActionRow, setActionStatus } from "../components/actions";
import { Icon } from "../components/Icon";
import { ErrorNote, Loading } from "../components/ui";
import { addDaysIso, daysFromToday, formatDate, todayIso } from "../lib/dates";
import { notifyChanged, useOnChanged } from "../lib/events";
import { EFFECT_LABELS, KIND_LABELS, TIMELINE_LABELS, TIMELINE_STYLES } from "../lib/labels";
import { todayIso as today } from "../lib/dates";
import { supabase } from "../lib/supabase";
import type { Action, Entry, Intervention, Recommendation, TimelineEvent } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

function Panel({ title, children, link, className = "" }: { title: string; children: ReactNode; link?: { to: string; label: string }; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title">{title}</h2>
        {link && <Link to={link.to} className="text-xs font-medium text-sage-700 hover:underline">{link.label}</Link>}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-stone-500">{children}</p>;
}

export default function HomePage() {
  const { wsId, workspace, me, aiEnabled } = useWs();
  const navigate = useNavigate();
  const today = todayIso();

  const { data, error, loading, reload } = useLoad(async () => {
    const [open, events, upcoming, entries, recs, interventions, counts] = await Promise.all([
      supabase.from("actions").select("*").eq("workspace_id", wsId).neq("status", "completed")
        .order("due_date", { ascending: true, nullsFirst: false }).limit(200),
      supabase.from("timeline_events").select("*").eq("workspace_id", wsId).lte("occurred_on", today)
        .gte("occurred_on", addDaysIso(today, -90)).order("occurred_on", { ascending: false }).limit(60),
      supabase.from("timeline_events").select("*").eq("workspace_id", wsId).gt("occurred_on", today)
        .lte("occurred_on", addDaysIso(today, 90)).order("occurred_on").limit(10),
      supabase.from("entries").select("id, kind, title, raw_text, occurred_on, analysis_status, review_status, created_at, analysis")
        .eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(8),
      supabase.from("recommendations").select("*").eq("workspace_id", wsId).eq("status", "active").order("created_at", { ascending: false }).limit(4),
      supabase.from("interventions").select("*, intervention_observations(*)").eq("workspace_id", wsId).eq("status", "active").order("started_on", { ascending: false }).limit(5),
      supabase.from("profile_entries").select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    ]);
    return {
      open: must(open) as Action[],
      events: must(events) as TimelineEvent[],
      upcoming: must(upcoming) as TimelineEvent[],
      entries: must(entries) as Entry[],
      recs: must(recs) as Recommendation[],
      interventions: must(interventions) as Intervention[],
      profileCount: counts.count ?? 0,
    };
  }, [wsId, today]);

  useOnChanged(useCallback(() => void reload(), [reload]));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Action | null>(null);
  const [fromRec, setFromRec] = useState<Recommendation | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Couldn't load"} onRetry={reload} />;

  const waitingDays = (a: Action) => -daysFromToday(a.status_changed_at.slice(0, 10));
  const attentionGroups = [
    { title: "Overdue", items: data.open.filter((a) => a.due_date && daysFromToday(a.due_date) < 0) },
    { title: "This week", items: data.open.filter((a) => a.due_date && daysFromToday(a.due_date) >= 0 && daysFromToday(a.due_date) <= 7) },
    { title: "Dates to confirm", items: data.open.filter((a) => (a.due_date && !a.date_confirmed && daysFromToday(a.due_date) > 7) || (!a.due_date && a.due_text)) },
    { title: "Waiting for a reply", items: data.open.filter((a) => a.status === "waiting" && waitingDays(a) >= 7 && !(a.due_date && daysFromToday(a.due_date) <= 7)) },
    { title: "Important, no date", items: data.open.filter((a) => !a.due_date && !a.due_text && a.priority === "high" && a.status !== "waiting").slice(0, 3) },
  ].filter((g) => g.items.length);
  // Appointments (e.g. annual reviews) are worth seeing further ahead than ordinary deadlines.
  const upcomingActions = data.open.filter((a) => a.due_date && daysFromToday(a.due_date) > 7 && daysFromToday(a.due_date) <= (a.kind === "appointment" ? 120 : 60));
  const toReview = data.entries.filter((e) => e.analysis_status === "done" && e.review_status === "unreviewed");
  const positives = data.events.filter((e) => e.category === "positive").slice(0, 3);
  const challenges = data.events.filter((e) => e.category === "dysregulation" || e.category === "anxiety").slice(0, 3);
  const isNew = !data.entries.length && !data.events.length && !data.open.length && data.profileCount === 0;
  const selected = data.open.find((a) => a.id === selectedId) ?? null;

  const setRec = async (r: Recommendation, status: "done" | "dismissed") => {
    must(await supabase.from("recommendations").update({ status }).eq("id", r.id));
    notifyChanged();
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">{greeting}{me ? `, ${me.display_name}` : ""}</p>
          <h1 className="font-display text-2xl font-semibold sm:text-3xl">What's happening with {workspace.child_name}</h1>
        </div>
      </div>

      <QuickCapture />

      {isNew && (
        <section className="card p-5">
          <h2 className="section-title">Getting started</h2>
          <p className="mt-1 text-sm text-stone-600">A few things that make everything else more useful:</p>
          <ol className="mt-3 space-y-2 text-sm">
            <li><Link className="font-medium text-sage-700 underline" to="/sammy">Write down what Sammy is great at</Link> and what you already know helps him.</li>
            <li><Link className="font-medium text-sage-700 underline" to="/add?kind=document">Upload his EHCP</Link> and any professional reports, so answers can quote them.</li>
            {!aiEnabled && <li><Link className="font-medium text-sage-700 underline" to="/settings">Review and switch on AI analysis</Link> when you're comfortable with the provider's terms.</li>}
            <li><Link className="font-medium text-sage-700 underline" to="/add">Add the latest email from school</Link> and see what the analysis suggests.</li>
          </ol>
        </section>
      )}

      {toReview.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Waiting for your review</p>
          <ul className="mt-2 space-y-1">
            {toReview.slice(0, 4).map((e) => (
              <li key={e.id}><Link to={`/entries/${e.id}`} className="text-sm text-amber-900 underline">{e.title || e.analysis?.what_happened.summary.slice(0, 80) || KIND_LABELS[e.kind]}</Link></li>
            ))}
          </ul>
          {toReview.length > 4 && <p className="mt-1 text-xs text-amber-800">and {toReview.length - 4} more</p>}
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Needs attention" link={{ to: "/actions", label: "All actions" }} className="lg:col-span-2">
          {attentionGroups.length === 0 ? (
            <Quiet>Nothing overdue, due this week or waiting on anyone. </Quiet>
          ) : (
            <div className="space-y-3">
              {attentionGroups.map((g) => (
                <div key={g.title}>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${g.title === "Overdue" ? "text-rose-700" : "text-stone-500"}`}>{g.title}</p>
                  <div className="-mx-4 divide-y divide-sand-200 sm:-mx-5">
                    {g.items.map((a) => (
                      <ActionRow key={a.id} action={a} onOpen={() => setSelectedId(a.id)} onToggle={() => setActionStatus(wsId, a, "completed")} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Upcoming">
          {data.upcoming.length + upcomingActions.length + data.open.filter((a) => a.kind === "appointment" && a.due_date && daysFromToday(a.due_date) >= 0).length === 0 ? <Quiet>No appointments or deadlines in the next few weeks.</Quiet> : (
            <ul className="space-y-3">
              {[
                ...data.open.filter((a) => a.kind === "appointment" && a.due_date && daysFromToday(a.due_date) >= 0 && daysFromToday(a.due_date) <= 7).map((a) => ({ date: a.due_date!, key: `appt-${a.id}`, node: <button className="text-left hover:underline" onClick={() => setSelectedId(a.id)}>{a.title}</button>, kind: `Appointment${a.due_time ? ` · ${a.due_time.slice(0, 5)}` : ""}` })),
                ...data.upcoming.map((e) => ({ date: e.occurred_on, key: e.id, node: <Link to={`/timeline?focus=${e.id}`} className="hover:underline">{e.title}</Link>, kind: TIMELINE_LABELS[e.category] })),
                ...upcomingActions.map((a) => ({ date: a.due_date!, key: a.id, node: <button className="text-left hover:underline" onClick={() => setSelectedId(a.id)}>{a.title}</button>, kind: `${a.kind === "appointment" ? `Appointment${a.due_time ? ` · ${a.due_time.slice(0, 5)}` : ""}` : "Deadline"}${a.date_confirmed ? "" : " · date to confirm"}` })),
              ].sort((x, y) => x.date.localeCompare(y.date)).map((u) => (
                <li key={u.key} className="flex gap-3">
                  <div className="w-12 shrink-0 rounded-lg bg-sand-100 py-1 text-center">
                    <div className="text-[10px] uppercase text-stone-500">{new Date(u.date + "T00:00").toLocaleDateString("en-GB", { month: "short" })}</div>
                    <div className="text-base font-semibold leading-none text-stone-800">{Number(u.date.slice(8))}</div>
                  </div>
                  <div className="min-w-0 text-sm"><div className="text-stone-800">{u.node}</div><div className="text-xs text-stone-500">{u.kind}</div></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Suggested next steps" className="lg:col-span-2">
          {data.recs.length === 0 ? <Quiet>Suggestions you keep from analyses will appear here.</Quiet> : (
            <ul className="space-y-3">
              {data.recs.map((r) => (
                <li key={r.id} className="rounded-xl border border-sand-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-stone-900">{r.title}</p>
                    <span className={`chip shrink-0 ${r.timeframe === "immediate" ? "bg-sage-100 text-sage-800" : "bg-sky-50 text-sky-800"}`}>{r.timeframe === "immediate" ? "Now" : "Longer term"}</span>
                  </div>
                  {r.detail && <p className="mt-1 text-sm text-stone-600">{r.detail}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.source_entry_id && <Link to={`/entries/${r.source_entry_id}`} className="text-xs text-stone-500 underline">Why this was suggested</Link>}
                    <span className="flex-1" />
                    <button className="btn-ghost btn-sm" onClick={() => setRec(r, "dismissed")}>Dismiss</button>
                    <button className="btn-ghost btn-sm" onClick={() => setFromRec(r)}>Make it an action</button>
                    <button className="btn-secondary btn-sm" onClick={() => setRec(r, "done")}><Icon name="check" className="h-3.5 w-3.5" />Done</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity">
          {data.entries.length === 0 ? <Quiet>Nothing added yet.</Quiet> : (
            <ul className="space-y-2.5">
              {data.entries.slice(0, 6).map((e) => (
                <li key={e.id}>
                  <Link to={`/entries/${e.id}`} className="block rounded-lg hover:bg-sand-50">
                    <p className="truncate text-sm text-stone-800">{e.title || e.analysis?.what_happened.summary || e.raw_text.slice(0, 80)}</p>
                    <p className="text-xs text-stone-500">{KIND_LABELS[e.kind]} · {formatDate(e.occurred_on ?? e.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Progress" link={{ to: "/timeline?tab=progress", label: "See progress" }} className="lg:col-span-3">
          <p className="-mt-1 mb-3 text-xs text-stone-500">From the last three months of the timeline. A handful of entries is a snapshot, not a trend.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <h3 className="label">Going well</h3>
              {positives.length ? positives.map((e) => <EventLine key={e.id} e={e} />) : <Quiet>No positive developments recorded recently — they're worth noting too.</Quiet>}
            </div>
            <div>
              <h3 className="label">Harder moments</h3>
              {challenges.length ? challenges.map((e) => <EventLine key={e.id} e={e} />) : <Quiet>None recorded recently.</Quiet>}
            </div>
            <div>
              <h3 className="label">What's being tried</h3>
              {data.interventions.length ? data.interventions.map((i) => {
                const last = [...(i.intervention_observations ?? [])].sort((a, b) => b.observed_on.localeCompare(a.observed_on))[0];
                return (
                  <Link key={i.id} to={`/timeline?tab=interventions&focus=${i.id}`} className="mb-2 block text-sm hover:underline">
                    <span className="text-stone-800">{i.name}</span>
                    <span className="block text-xs text-stone-500">{last ? `${EFFECT_LABELS[last.apparent_effect]} (${formatDate(last.observed_on)})` : "No observations yet"}</span>
                  </Link>
                );
              }) : <Quiet>No active interventions recorded.</Quiet>}
            </div>
          </div>
        </Panel>
      </div>

      <ActionDetail action={selected} onClose={() => setSelectedId(null)} onEdit={(a) => setEditing(a)} onDeleted={() => setSelectedId(null)} />
      <ActionEditor open={!!editing} action={editing} onClose={() => setEditing(null)} />
      <ActionEditor open={!!fromRec} action={null} onClose={() => setFromRec(null)}
        source={fromRec ? { entryId: fromRec.source_entry_id, label: `Suggested next step: ${fromRec.title}` } : undefined}
        defaults={fromRec ? { title: fromRec.title, description: fromRec.detail ?? "" } : undefined}
        onSaved={() => { if (fromRec) void setRec(fromRec, "done"); navigate("/actions"); }} />
    </div>
  );
}

function EventLine({ e }: { e: TimelineEvent }) {
  return (
    <Link to={`/timeline?focus=${e.id}`} className="mb-2 flex gap-2 text-sm hover:underline">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TIMELINE_STYLES[e.category].dot}`} />
      <span><span className="text-stone-800">{e.title}</span> <span className="text-xs text-stone-500">{formatDate(e.occurred_on)}</span></span>
    </Link>
  );
}

function QuickCapture() {
  const { wsId, aiEnabled, workspace } = useWs();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = detectKind(text);

  const go = async (analyse: boolean) => {
    if (!text.trim()) return navigate("/add");
    if (kind === "question") return navigate(`/ask?q=${encodeURIComponent(text.trim())}`);
    setBusy(true);
    setError(null);
    try {
      const entry = await saveEntry(wsId, { kind, text, date: today() }, analyse && aiEnabled);
      notifyChanged();
      navigate(`/entries/${entry.id}${analyse && aiEnabled ? "?analyse=1" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5">
      <label htmlFor="quick" className="mb-2 block font-medium text-stone-900">How was {workspace.child_name}'s day?</label>
      <textarea id="quick" className="input min-h-[72px] resize-y" rows={2} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="A sentence or two is plenty — a good moment, a hard one, or paste an email. You can also ask a question." />
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-3 text-xs text-stone-500">
          <Link to="/add?kind=document" className="inline-flex items-center gap-1 hover:text-stone-800"><Icon name="upload" className="h-3.5 w-3.5" />Upload a document</Link>
          {text.trim() && <span>{kind === "email" ? "Looks like an email" : kind === "question" ? "Looks like a question" : "Saved as an observation"}</span>}
        </div>
        <div className="flex gap-2">
          {busy ? <Spinner className="h-5 w-5" /> : kind === "question" && text.trim() ? (
            <button className="btn-primary" onClick={() => go(false)}><Icon name="chat" className="h-4 w-4" />Ask</button>
          ) : (
            <>
              {text.trim() && <button className="btn-ghost" onClick={() => go(false)}>Just save</button>}
              <button className="btn-primary" onClick={() => go(true)} disabled={!text.trim() && false}>
                {aiEnabled ? <><Icon name="sparkles" className="h-4 w-4" />{text.trim() ? "Save & get advice" : "Add"}</> : text.trim() ? "Save" : "Add"}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
