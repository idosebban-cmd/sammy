import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ActionEditor, ActionFields, draftToRow, emptyAction, type ActionDraft } from "../components/actions";
import { EvidencePicker, ProgressAreaPicker, TimelineEditor } from "../components/forms";
import { Icon } from "../components/Icon";
import { SourceList, stripRefs } from "../components/Sources";
import { AiNote, ErrorNote, EvidenceBadge, Field, Loading, Modal, Select, Spinner, StatusBadge } from "../components/ui";
import { ApiError, analyseEntry } from "../lib/api";
import { formatDate, formatDateTime, todayIso } from "../lib/dates";
import { notifyChanged } from "../lib/events";
import {
  CERTAINTY_HINTS, CERTAINTY_LABELS, COMMITMENT_KIND_LABELS, EFFECT_LABELS, EFFECT_STYLES, KIND_LABELS, OWNER_LABELS,
  SECTION_LABELS, TIMELINE_LABELS, options, progressLabel,
} from "../lib/labels";
import { supabase } from "../lib/supabase";
import type {
  Action, Analysis, AnalysisCommitment, Commitment, Effect, Entry, EvidenceType, InterventionObservation, ProfileEntry,
  ProfileSection, ProgressArea, Recommendation, TimelineCategory, TimelineEvent,
} from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

interface InterpItem { include: boolean; text: string; section: ProfileSection; evidence_type: EvidenceType }
interface RecItem { include: boolean; title: string; detail: string; timeframe: "immediate" | "longer_term" }
interface QuestionItem { include: boolean; question: string; ask_who: string; why: string }
interface ActItem {
  include: boolean; draft: ActionDraft; origin: "explicit_commitment" | "suggested"; phrase: string | null;
  dateStatus: "stated" | "worked_out" | "none"; removed: boolean; open: boolean; commitmentIndex: number | null;
}
interface CommitItem extends AnalysisCommitment { include: boolean }
interface ObsItem {
  include: boolean; interventionId: string | null; interventionName: string; isNew: boolean; goal: string; setting: string;
  observation: string; effect: Effect; assessment: string; prior: number; refs: string[];
}
interface MemItem {
  include: boolean; title: string; text: string; target: "timeline" | "profile"; category: TimelineCategory; section: ProfileSection;
  evidence_type: EvidenceType; areas: ProgressArea[]; date: string;
}

function sourceLabel(e: Entry): string {
  const what = e.title || e.analysis?.what_happened.summary.slice(0, 60) || KIND_LABELS[e.kind];
  return `${KIND_LABELS[e.kind]}: ${what}${e.occurred_on ? ` (${formatDate(e.occurred_on, { withYear: true })})` : ""}`;
}

/** Older (v1) analyses stored "related_history" instead of "relevant_context". */
function contextOf(a: Analysis) {
  return a.relevant_context ?? (a.related_history ?? []).map((r) => ({ fact: r.note, why_it_matters: "", refs: r.refs }));
}

const PARENTS = ["ido", "helen", "both_parents"];

function shorten(t: string | undefined, n = 90): string {
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t;
}

function buildReview(a: Analysis, e: Entry) {
  const eventDate = a.what_happened.event_date ?? e.occurred_on ?? todayIso();
  return {
    interp: a.what_it_might_mean.map<InterpItem>((m) => ({
      include: false, text: stripRefs(m.statement), section: "emotional_needs",
      evidence_type: m.basis === "possible_explanation" ? "ai_hypothesis" : "observation",
    })),
    recs: a.what_we_can_do.map<RecItem>((r) => ({ include: true, title: r.title, detail: stripRefs(r.detail), timeframe: r.timeframe })),
    questions: (a.questions_to_ask ?? []).map<QuestionItem>((q) => ({ include: false, ...q })),
    acts: a.follow_up_actions.map<ActItem>((f) => {
      const phrase = f.date_phrase ?? f.due_date_quote ?? null;
      const dateStatus = f.date_status ?? (f.due_date ? "stated" : "none");
      return {
        include: true, origin: f.origin, phrase, dateStatus, removed: !!(f.date_removed ?? f.due_date_removed), open: false,
        commitmentIndex: f.commitment_index ?? null,
        draft: {
          ...emptyAction(f.owner), title: f.title, description: f.description, owner_detail: f.owner_detail ?? "",
          kind: f.kind ?? "task", due_date: f.due_date ?? "", due_time: f.due_time ?? "",
          due_text: !f.due_date && phrase ? phrase : dateStatus === "worked_out" ? phrase ?? "" : "",
          date_confirmed: f.date_confirmed ?? dateStatus !== "worked_out", priority: f.priority,
          status: f.origin === "explicit_commitment" && !PARENTS.includes(f.owner) && (f.kind ?? "task") === "task" ? "waiting" : "todo",
        },
      };
    }),
    commits: (a.commitments ?? []).map<CommitItem>((c) => ({ ...c, include: true })),
    obs: (a.progress?.intervention_updates ?? []).map<ObsItem>((u) => ({
      include: true, interventionId: u.intervention_id ?? null, interventionName: u.intervention_name ?? u.new_intervention?.name ?? "Intervention",
      isNew: !u.intervention_id, goal: u.new_intervention?.goal ?? "", setting: u.new_intervention?.setting ?? "school",
      observation: stripRefs(u.observation), effect: u.apparent_effect, assessment: stripRefs(u.assessment),
      prior: u.prior_observations ?? 0, refs: u.refs,
    })),
    mem: a.what_to_remember.map<MemItem>((w) => ({
      include: true, title: w.title, text: stripRefs(w.text), target: w.target,
      category: w.timeline_category ?? "observation", section: w.profile_section ?? "emotional_needs",
      evidence_type: w.evidence_type, areas: w.progress_areas ?? [], date: eventDate,
    })),
  };
}

function Section({ n, title, children, aside, hint }: { n: number; title: string; children: ReactNode; aside?: ReactNode; hint?: string }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage-100 text-xs font-semibold text-sage-800">{n}</span>
        <div className="flex-1">
          <h2 className="section-title">{title}</h2>
          {hint && <p className="text-xs text-stone-500">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-600">
      <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600 focus:ring-sage-400" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function evidenceNote(prior: number): string {
  const n = prior + 1;
  if (n <= 2) return `This would be observation ${n} — too early to judge.`;
  if (n <= 4) return `${n} observations so far — early signs only.`;
  return `${n} observations so far.`;
}

export default function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { aiEnabled, memberName } = useWs();

  const { data: entry, error, loading, reload, setData: setEntry } = useLoad<Entry>(
    async () => must(await supabase.from("entries").select("*").eq("id", id!).single()) as Entry, [id],
  );
  const saved = useLoad(async () => {
    const [a, t, p, r, o, c] = await Promise.all([
      supabase.from("actions").select("*").eq("source_entry_id", id!).order("created_at"),
      supabase.from("timeline_events").select("*").eq("source_entry_id", id!).order("occurred_on"),
      supabase.from("profile_entries").select("*").eq("source_entry_id", id!).order("created_at"),
      supabase.from("recommendations").select("*").eq("source_entry_id", id!).order("created_at"),
      supabase.from("intervention_observations").select("*, interventions(name)").eq("source_entry_id", id!).order("created_at"),
      supabase.from("commitments").select("*").eq("source_entry_id", id!).order("created_at"),
    ]);
    return {
      actions: must(a) as Action[], timeline: must(t) as TimelineEvent[], profile: must(p) as ProfileEntry[], recs: must(r) as Recommendation[],
      obs: must(o) as (InterventionObservation & { interventions: { name: string } | null })[], commitments: must(c) as Commitment[],
    };
  }, [id]);

  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<{ message: string; refusal: boolean } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [manualAction, setManualAction] = useState(false);
  const [manualEvent, setManualEvent] = useState(false);
  const started = useRef(false);

  const runAnalysis = useCallback(async () => {
    if (!id) return;
    setAnalysing(true);
    setAnalysisError(null);
    try {
      await analyseEntry(id);
      await reload();
      setReviewing(true);
    } catch (e) {
      setAnalysisError({ message: e instanceof Error ? e.message : String(e), refusal: e instanceof ApiError && e.code === "ai_refusal" });
      await reload();
    } finally {
      setAnalysing(false);
    }
  }, [id, reload]);

  useEffect(() => {
    if (!entry || started.current) return;
    if (params.get("analyse") === "1") {
      started.current = true;
      setParams({}, { replace: true });
      if (entry.analysis_status !== "done" && aiEnabled) void runAnalysis();
    }
    if (entry.analysis_status === "done" && entry.review_status === "unreviewed") setReviewing(true);
  }, [entry, params, setParams, aiEnabled, runAnalysis]);

  if (loading && !entry) return <Loading />;
  if (error || !entry) return <ErrorNote message={error ?? "Not found"} onRetry={reload} />;

  const analysis = entry.analysis_status === "done" ? entry.analysis : null;
  const label = sourceLabel(entry);
  const s = saved.data;
  const savedCount = s ? s.actions.length + s.timeline.length + s.profile.length + s.recs.length + s.obs.length + s.commitments.length : 0;

  const remove = async () => {
    if (!window.confirm("Delete this record and its AI analysis? Anything you already saved from it (actions, timeline, profile) is kept, but will no longer link back here.")) return;
    try {
      must(await supabase.from("entries").delete().eq("id", entry.id));
      notifyChanged();
      navigate("/");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{KIND_LABELS[entry.kind]}{entry.occurred_on && ` · ${formatDate(entry.occurred_on, { withYear: true })}`}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">{entry.title || shorten(analysis?.what_happened.summary.split(". ")[0]) || "Untitled record"}</h1>
          <p className="mt-1 text-xs text-stone-400">Added {formatDateTime(entry.created_at)}{memberName(entry.created_by) && ` by ${memberName(entry.created_by)}`}{entry.updated_at !== entry.created_at && ` · edited ${formatDateTime(entry.updated_at)}`}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}><Icon name="edit" className="h-3.5 w-3.5" />Correct</button>
          <button className="btn-danger btn-sm" onClick={remove}><Icon name="trash" className="h-3.5 w-3.5" />Delete</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-stone-700 sm:px-5" onClick={() => setShowOriginal(!showOriginal)} aria-expanded={showOriginal}>
          <span className="flex items-center gap-2"><Icon name="file" className="h-4 w-4 text-stone-400" />Original {entry.kind === "document" ? "upload" : entry.kind === "observation" ? "note" : "email"} (unchanged)</span>
          <Icon name="chevronDown" className={`h-4 w-4 transition ${showOriginal ? "rotate-180" : ""}`} />
        </button>
        {(showOriginal || !analysis) && (
          <div className="border-t border-sand-200 bg-sand-50/60 px-4 py-3 sm:px-5">
            {entry.document_id && <Link to={`/documents/${entry.document_id}`} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-sage-700 underline"><Icon name="file" className="h-4 w-4" />Open the document</Link>}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{entry.raw_text}</p>
          </div>
        )}
      </div>

      {analysing && (
        <div className="card flex items-center gap-3 p-5" role="status">
          <Spinner />
          <div>
            <p className="text-sm font-medium">Reading this alongside everything you've recorded about Sammy…</p>
            <p className="text-xs text-stone-500">Usually under a minute. Your {entry.kind === "observation" ? "note" : "submission"} is already saved.</p>
          </div>
        </div>
      )}
      {!analysing && analysisError?.refusal && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          <p className="font-semibold">The AI declined to analyse this</p>
          <p className="mt-1">{analysisError.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setManualEvent(true)}>Add to timeline yourself</button>
            <button className="btn-secondary btn-sm" onClick={() => setManualAction(true)}>Add an action</button>
            <button className="btn-ghost btn-sm" onClick={runAnalysis}>Try again</button>
          </div>
        </div>
      )}
      {!analysing && !analysisError?.refusal && (analysisError || entry.analysis_status === "failed") && (
        <ErrorNote message={analysisError?.message ?? entry.analysis_error ?? "The analysis didn't complete."} onRetry={aiEnabled ? runAnalysis : undefined} />
      )}
      {!analysing && !analysis && entry.analysis_status !== "failed" && !analysisError && (
        <div className="card p-4 sm:p-5">
          <p className="text-sm text-stone-600">{aiEnabled ? "This hasn't been analysed yet." : "AI analysis is switched off. You can record what matters yourself."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {aiEnabled && <button className="btn-primary btn-sm" onClick={runAnalysis}><Icon name="sparkles" className="h-3.5 w-3.5" />Analyse now</button>}
            <button className="btn-secondary btn-sm" onClick={() => setManualEvent(true)}>Add to timeline</button>
            <button className="btn-secondary btn-sm" onClick={() => setManualAction(true)}>Add an action</button>
          </div>
        </div>
      )}

      {analysis && reviewing && (
        <Review entry={entry} analysis={analysis} label={label}
          onDone={async () => { setReviewing(false); await Promise.all([reload(), saved.reload()]); notifyChanged(); }} />
      )}
      {analysis && !reviewing && (
        <ReadOnlyAnalysis analysis={analysis} model={entry.analysis_model} analysedAt={entry.analysed_at}
          onReview={() => setReviewing(true)} onReanalyse={aiEnabled ? runAnalysis : undefined} />
      )}

      {savedCount > 0 && s && (
        <div className="card p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Saved from this record</h2>
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={() => setManualEvent(true)}>+ Timeline</button>
              <button className="btn-ghost btn-sm" onClick={() => setManualAction(true)}>+ Action</button>
            </div>
          </div>
          <ul className="divide-y divide-sand-200 text-sm">
            {s.actions.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/actions?id=${a.id}`} className="min-w-0 truncate hover:underline"><span className="text-stone-400">{a.kind === "appointment" ? "Appointment" : "Action"} · </span>{a.title}</Link>
                <StatusBadge status={a.status} />
              </li>
            ))}
            {s.obs.map((o) => (
              <li key={o.id} className="py-2"><Link to={`/timeline?tab=interventions&focus=${o.intervention_id}`} className="hover:underline"><span className="text-stone-400">Intervention · {o.interventions?.name} · </span>{EFFECT_LABELS[o.apparent_effect]}</Link></li>
            ))}
            {s.commitments.map((c) => (
              <li key={c.id} className="py-2"><Link to={`/documents?tab=provision&focus=${c.id}`} className="hover:underline"><span className="text-stone-400">{COMMITMENT_KIND_LABELS[c.kind]} · </span>{c.description}</Link></li>
            ))}
            {s.timeline.map((t) => (
              <li key={t.id} className="py-2"><Link to={`/timeline?focus=${t.id}`} className="hover:underline"><span className="text-stone-400">Timeline · {formatDate(t.occurred_on)} · </span>{t.title}</Link></li>
            ))}
            {s.profile.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/sammy?focus=${p.id}`} className="min-w-0 truncate hover:underline"><span className="text-stone-400">Profile · {SECTION_LABELS[p.section]} · </span>{p.content}</Link>
                <EvidenceBadge type={p.evidence_type} />
              </li>
            ))}
            {s.recs.map((r) => (
              <li key={r.id} className="py-2"><Link to="/" className="hover:underline"><span className="text-stone-400">Next step · </span>{r.title}</Link></li>
            ))}
          </ul>
        </div>
      )}

      <EditOriginal open={editing} entry={entry} onClose={() => setEditing(false)} onSaved={(e) => { setEntry(e); notifyChanged(); }} />
      <ActionEditor open={manualAction} action={null} onClose={() => setManualAction(false)} source={{ entryId: entry.id, documentId: entry.document_id, label }} onSaved={() => saved.reload()} />
      <TimelineEditor open={manualEvent} event={null} onClose={() => { setManualEvent(false); void saved.reload(); }}
        source={{ entryId: entry.id, documentId: entry.document_id, label }}
        defaults={{ occurred_on: entry.occurred_on ?? todayIso(), title: entry.title ?? "", description: entry.kind === "observation" ? entry.raw_text : "", source_label: label }} />
    </div>
  );
}

function Review({ entry, analysis, label, onDone }: { entry: Entry; analysis: Analysis; label: string; onDone: () => void }) {
  const initial = useMemo(() => buildReview(analysis, entry), [analysis, entry]);
  const [interp, setInterp] = useState(initial.interp);
  const [recs, setRecs] = useState(initial.recs);
  const [questions, setQuestions] = useState(initial.questions);
  const [acts, setActs] = useState(initial.acts);
  const [commits, setCommits] = useState(initial.commits);
  const [obs, setObs] = useState(initial.obs);
  const [mem, setMem] = useState(initial.mem);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const sources = analysis.sources ?? [];
  const context = contextOf(analysis);
  const brief = entry.kind === "observation";

  const upd = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) =>
    set((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const count = [interp, recs, questions, acts, commits, obs, mem].reduce((n, xs) => n + xs.filter((x) => x.include).length, 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const keepCommit = new Set(commits.map((c, i) => (c.include ? i : -1)).filter((i) => i >= 0));
      const newInterventions = obs.map((o, i) => ({ o, i })).filter(({ o }) => o.include && o.isNew);
      const payload = {
        source_label: label,
        commitments: commits.flatMap((c, i) => (c.include ? [{
          key: `c${i}`, kind: c.kind, certainty: c.certainty, description: c.description, made_by: c.made_by,
          ehcp_section: c.ehcp_section, frequency: c.frequency, page: c.page, review_on: c.review_date,
        }] : [])),
        interventions: newInterventions.map(({ o, i }) => ({
          key: `n${i}`, name: o.interventionName, goal: o.goal, setting: o.setting, started_on: analysis.what_happened.event_date ?? entry.occurred_on,
        })),
        observations: obs.flatMap((o, i) => (o.include && o.observation.trim() ? [{
          intervention_id: o.isNew ? null : o.interventionId, intervention_key: o.isNew ? `n${i}` : null,
          apparent_effect: o.effect, note: o.observation.trim(), assessment: o.assessment.trim(),
          observed_on: analysis.what_happened.event_date ?? entry.occurred_on,
        }] : [])),
        actions: [
          ...acts.filter((a) => a.include && a.draft.title.trim()).map((a) => ({
            ...draftToRow(a.draft),
            origin: a.origin === "explicit_commitment" ? "explicit_commitment" : "ai_suggested",
            commitment_key: a.commitmentIndex !== null && keepCommit.has(a.commitmentIndex) ? `c${a.commitmentIndex}` : null,
          })),
          ...questions.filter((q) => q.include).map((q) => ({
            title: `Ask ${q.ask_who}: ${q.question}`, description: q.why, owner: "both_parents", kind: "task", status: "todo",
            priority: "medium", origin: "ai_suggested", date_confirmed: true,
          })),
        ],
        timeline: mem.filter((m) => m.include && m.target === "timeline" && m.text.trim()).map((m) => ({
          occurred_on: m.date || entry.occurred_on || todayIso(), category: m.category, title: m.title.trim() || m.text.slice(0, 80),
          description: m.text.trim(), progress_areas: m.areas, evidence_type: m.evidence_type,
        })),
        profile: [
          ...mem.filter((m) => m.include && m.target === "profile" && m.text.trim()).map((m) => ({ section: m.section, content: m.text.trim(), evidence_type: m.evidence_type })),
          ...interp.filter((m) => m.include && m.text.trim()).map((m) => ({ section: m.section, content: m.text.trim(), evidence_type: m.evidence_type })),
        ],
        recommendations: recs.filter((r) => r.include && r.title.trim()).map((r) => ({ title: r.title.trim(), detail: r.detail.trim(), timeframe: r.timeframe })),
      };
      must(await supabase.rpc("save_review", { p_entry_id: entry.id, p: payload }));
      onDone();
    } catch (e) {
      setError(`Nothing was saved: ${e instanceof Error ? e.message : String(e)}. Your choices are still here — try again.`);
    } finally {
      setSaving(false);
    }
  };

  const copyQuestions = async () => {
    const text = questions.map((q) => `- ${q.question}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };

  const wh = analysis.what_happened;
  const progress = analysis.progress;
  return (
    <div className="space-y-4">
      <AiNote>
        AI analysis for you to review. Nothing below is saved to Sammy's record until you confirm it.
        {analysis.truncated && " This document was very long, so only the first part was analysed."}
      </AiNote>

      {analysis.safety.concern && analysis.safety.guidance && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
          <p className="font-semibold">Safety first</p>
          <p className="mt-1 whitespace-pre-wrap">{analysis.safety.guidance}</p>
          <p className="mt-2 text-xs">If anyone is in immediate danger, call 999. For urgent medical advice, call NHS 111.</p>
        </div>
      )}

      <Section n={1} title="What happened">
        <p className="text-sm leading-relaxed text-stone-800">{wh.summary}</p>
        {!brief && wh.key_facts.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">{wh.key_facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
        {context.length > 0 && (
          <div className="mt-4 rounded-xl bg-sage-50/70 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sage-800">What we already know that's relevant</p>
            <ul className="space-y-3">
              {context.map((r, i) => (
                <li key={i} className="text-sm text-stone-700">
                  <p className="text-stone-900">{stripRefs(r.fact)}</p>
                  {r.why_it_matters && <p className="text-stone-600"><span className="font-medium text-sage-800">Why it matters: </span>{stripRefs(r.why_it_matters)}</p>}
                  <SourceList refs={r.refs} sources={sources} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {interp.length > 0 && (
        <Section n={2} title="Understanding" hint="What might explain it. Possibilities, not conclusions.">
          <ul className="space-y-3">
            {analysis.what_it_might_mean.map((m, i) => {
              const isFact = m.basis !== "possible_explanation";
              return (
                <li key={i} className={`rounded-xl border p-3 ${isFact ? "border-sand-200" : "border-dashed border-amber-300 bg-amber-50/40"}`}>
                  <span className={`chip mb-1 ${isFact ? "bg-sand-100 text-stone-700" : "bg-amber-100 text-amber-800"}`}>
                    {m.basis === "stated_in_submission" ? "Fact · stated here" : m.basis === "recorded_history" ? "Fact · from Sammy's record" : "Possible explanation"}
                  </span>
                  <p className="text-sm text-stone-800">{stripRefs(m.statement)}</p>
                  <SourceList refs={m.refs} sources={sources} />
                  <div className="mt-2"><Toggle checked={interp[i].include} onChange={(v) => upd(setInterp, i, { include: v })} label="Save to Sammy's profile" /></div>
                  {interp[i].include && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Select value={interp[i].section} onChange={(v) => upd(setInterp, i, { section: v })} options={options(SECTION_LABELS)} />
                      <EvidencePicker value={interp[i].evidence_type} onChange={(v) => upd(setInterp, i, { evidence_type: v })} />
                      <textarea className="input sm:col-span-2" value={interp[i].text} onChange={(e) => upd(setInterp, i, { text: e.target.value })} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section n={interp.length ? 3 : 2} title="What we can do">
        <ul className="space-y-3">
          {recs.map((r, i) => (
            <li key={i} className={`rounded-xl border border-sand-200 p-3 ${r.include ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <input className="w-full bg-transparent text-sm font-semibold text-stone-900 focus:outline-none" value={r.title} onChange={(e) => upd(setRecs, i, { title: e.target.value })} aria-label="Recommendation title" />
                <span className={`chip shrink-0 ${r.timeframe === "immediate" ? "bg-sage-100 text-sage-800" : "bg-sky-50 text-sky-800"}`}>{r.timeframe === "immediate" ? "Now" : "Longer term"}</span>
              </div>
              <textarea className="mt-1 w-full resize-y bg-transparent text-sm text-stone-700 focus:outline-none" rows={3} value={r.detail} onChange={(e) => upd(setRecs, i, { detail: e.target.value })} aria-label="Recommendation detail" />
              <SourceList refs={analysis.what_we_can_do[i]?.refs ?? []} sources={sources} />
              <div className="mt-2"><Toggle checked={r.include} onChange={(v) => upd(setRecs, i, { include: v })} label="Keep in suggested next steps" /></div>
            </li>
          ))}
        </ul>
        {questions.length > 0 && (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-900">Questions worth asking</p>
              <button className="btn-ghost btn-sm" onClick={copyQuestions}>{copied ? "Copied" : "Copy all"}</button>
            </div>
            <ul className="space-y-2">
              {questions.map((q, i) => (
                <li key={i} className="text-sm">
                  <p className="text-stone-900">{q.question}</p>
                  <p className="text-xs text-stone-500">Ask: {q.ask_who} · {q.why}</p>
                  <Toggle checked={q.include} onChange={(v) => upd(setQuestions, i, { include: v })} label="Add as an action" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section n={interp.length ? 4 : 3} title="Follow-ups" hint="Who does what, and when." aside={
        <button className="btn-ghost btn-sm" onClick={() => setActs((xs) => [...xs, { include: true, origin: "suggested", phrase: null, dateStatus: "none", removed: false, open: true, commitmentIndex: null, draft: emptyAction() }])}>+ Add</button>
      }>
        {acts.length === 0 && <p className="text-sm text-stone-500">Nothing needs following up.</p>}
        <ul className="space-y-3">
          {acts.map((a, i) => (
            <li key={i} className={`rounded-xl border border-sand-200 p-3 ${a.include ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label="Save this" className="mt-1 h-4 w-4 rounded border-sand-400 text-sage-600" checked={a.include} onChange={(e) => upd(setActs, i, { include: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900">{a.draft.kind === "appointment" && <Icon name="calendar" className="mr-1 inline h-4 w-4 text-indigo-600" />}{a.draft.title || "New action"}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                    <span>{OWNER_LABELS[a.draft.owner]}{a.draft.owner_detail && ` · ${a.draft.owner_detail}`}</span>
                    <span className={a.draft.due_date && !a.draft.date_confirmed ? "font-medium text-amber-700" : ""}>
                      {a.draft.due_date
                        ? `${formatDate(a.draft.due_date, { withYear: true })}${a.draft.due_time ? ` ${a.draft.due_time}` : ""}${a.draft.date_confirmed ? "" : " · please confirm"}`
                        : a.draft.due_text ? `"${a.draft.due_text}" · date to confirm` : "No date given"}
                    </span>
                    <span className={a.origin === "explicit_commitment" ? "font-medium text-sage-700" : "text-amber-700"}>
                      {a.origin === "explicit_commitment" ? "Stated in the source" : "Suggestion — not agreed with anyone"}
                    </span>
                  </div>
                  {a.phrase && a.draft.due_date && <p className="mt-1 text-xs italic text-stone-500">{a.dateStatus === "worked_out" ? "Worked out from" : "From the text"}: "{a.phrase}"</p>}
                  {a.removed && <p className="mt-1 text-xs text-stone-500">A suggested date was removed because the source didn't give one.</p>}
                  {a.commitmentIndex !== null && commits[a.commitmentIndex] && <p className="mt-1 text-xs text-stone-500">Follows up: {commits[a.commitmentIndex].description}</p>}
                  <button className="mt-1 text-xs font-medium text-sage-700 underline" onClick={() => upd(setActs, i, { open: !a.open })}>{a.open ? "Done editing" : "Edit"}</button>
                  {a.open && <div className="mt-3"><ActionFields value={a.draft} onChange={(d) => upd(setActs, i, { draft: d })} /></div>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {commits.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Provision, recommendations & commitments found</p>
            <ul className="space-y-2">
              {commits.map((c, i) => (
                <li key={i} className={`flex items-start gap-3 rounded-xl border border-sand-200 p-3 text-sm ${c.include ? "" : "opacity-60"}`}>
                  <input type="checkbox" aria-label="Save this" className="mt-1 h-4 w-4 rounded border-sand-400 text-sage-600" checked={c.include} onChange={(e) => upd(setCommits, i, { include: e.target.checked })} />
                  <div className="min-w-0 flex-1">
                    <p className="text-stone-900">{c.description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                      <span className="chip bg-sand-100 text-stone-700">{COMMITMENT_KIND_LABELS[c.kind]}</span>
                      <span className={`chip ${c.certainty === "confirmed" ? "bg-emerald-50 text-emerald-800" : c.certainty === "proposed" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`} title={CERTAINTY_HINTS[c.certainty]}>{CERTAINTY_LABELS[c.certainty]}</span>
                      {c.made_by && <span>{c.made_by}</span>}
                      {c.frequency && <span>· {c.frequency}</span>}
                      {c.page && <span>· p. {c.page}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section n={interp.length ? 5 : 4} title="Progress" hint="What this tells us about Sammy's development.">
        {progress?.summary && <p className="text-sm text-stone-800">{stripRefs(progress.summary)}</p>}
        {!!progress?.signals.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {progress.signals.map((sig, i) => (
              <span key={i} title={sig.note} className={`chip ${sig.direction === "positive" ? "bg-emerald-50 text-emerald-800" : sig.direction === "difficulty" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}>
                {sig.direction === "positive" ? "↑" : sig.direction === "difficulty" ? "↓" : "↕"} {progressLabel(sig.area)}
              </span>
            ))}
          </div>
        )}
        {obs.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Interventions: what changed, and what happened</p>
            {obs.map((o, i) => (
              <div key={i} className={`rounded-xl border border-violet-200 bg-violet-50/30 p-3 ${o.include ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" aria-label="Record this" className="mt-1 h-4 w-4 rounded border-sand-400 text-sage-600" checked={o.include} onChange={(e) => upd(setObs, i, { include: e.target.checked })} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-medium text-stone-900">
                      {o.isNew ? "Start tracking: " : "Record against: "}
                      {o.isNew ? <input className="input !inline-block !w-auto !py-1" value={o.interventionName} onChange={(e) => upd(setObs, i, { interventionName: e.target.value })} aria-label="Intervention name" /> : o.interventionName}
                    </p>
                    {o.isNew && <input className="input" value={o.goal} onChange={(e) => upd(setObs, i, { goal: e.target.value })} placeholder="What it's meant to help with" aria-label="Goal" />}
                    <Field label="What happened"><textarea className="input" rows={2} value={o.observation} onChange={(e) => upd(setObs, i, { observation: e.target.value })} /></Field>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[200px_1fr]">
                      <Field label="So far it…"><Select value={o.effect} onChange={(v) => upd(setObs, i, { effect: v })} options={options(EFFECT_LABELS)} /></Field>
                      <Field label="Assessment"><input className="input" value={o.assessment} onChange={(e) => upd(setObs, i, { assessment: e.target.value })} /></Field>
                    </div>
                    {!o.isNew && <p className="text-xs text-stone-500">{evidenceNote(o.prior)}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {mem.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Add to Sammy's record</p>
            <ul className="space-y-3">
              {mem.map((m, i) => (
                <li key={i} className={`rounded-xl border border-sand-200 p-3 ${m.include ? "" : "opacity-60"}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" aria-label="Save this" className="mt-1 h-4 w-4 rounded border-sand-400 text-sage-600" checked={m.include} onChange={(e) => upd(setMem, i, { include: e.target.checked })} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select className="!w-auto !py-1.5 text-xs" value={m.target} onChange={(v) => upd(setMem, i, { target: v })}
                          options={[{ value: "timeline", label: "Timeline" }, { value: "profile", label: "Profile" }]} />
                        {m.target === "timeline"
                          ? <Select className="!w-auto !py-1.5 text-xs" value={m.category} onChange={(v) => upd(setMem, i, { category: v })} options={options(TIMELINE_LABELS)} />
                          : <Select className="!w-auto !py-1.5 text-xs" value={m.section} onChange={(v) => upd(setMem, i, { section: v })} options={options(SECTION_LABELS)} />}
                        {m.target === "timeline" && <input type="date" className="input !w-auto !py-1.5 text-xs" value={m.date} onChange={(e) => upd(setMem, i, { date: e.target.value })} aria-label="Date" />}
                        {m.evidence_type === "ai_hypothesis" && <EvidenceBadge type="ai_hypothesis" />}
                      </div>
                      {m.target === "timeline" && <input className="input" value={m.title} onChange={(e) => upd(setMem, i, { title: e.target.value })} placeholder="Title" aria-label="Title" />}
                      <textarea className="input" rows={2} value={m.text} onChange={(e) => upd(setMem, i, { text: e.target.value })} aria-label="Text" />
                      <details className="text-xs text-stone-500">
                        <summary className="cursor-pointer">Kind of information and progress areas</summary>
                        <div className="mt-2 space-y-2">
                          <div className="sm:w-1/2"><EvidencePicker value={m.evidence_type} onChange={(v) => upd(setMem, i, { evidence_type: v })} /></div>
                          {m.target === "timeline" && <ProgressAreaPicker value={m.areas} onChange={(v) => upd(setMem, i, { areas: v })} />}
                        </div>
                      </details>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!progress?.summary && !obs.length && !mem.length && <p className="text-sm text-stone-500">Nothing new about his progress here.</p>}
      </Section>

      <p className="px-1 text-xs text-stone-500">{analysis.evidence_note}{analysis.documents_consulted?.length ? ` Documents read in full: ${analysis.documents_consulted.join(", ")}.` : ""}</p>

      {error && <ErrorNote message={error} />}
      <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sand-200 bg-white/95 p-3 shadow-soft backdrop-blur md:bottom-4">
        <span className="text-sm text-stone-600">{count} item{count === 1 ? "" : "s"} selected</span>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onDone} disabled={saving}>Not now</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner className="h-4 w-4 text-white" />}Save</button>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyAnalysis({ analysis, model, analysedAt, onReview, onReanalyse }: {
  analysis: Analysis; model: string | null; analysedAt: string | null; onReview: () => void; onReanalyse?: () => void;
}) {
  const sources = analysis.sources ?? [];
  const context = contextOf(analysis);
  return (
    <div className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">AI analysis</h2>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={onReview}>Review suggestions again</button>
          {onReanalyse && <button className="btn-ghost btn-sm" onClick={onReanalyse}>Re-analyse</button>}
        </div>
      </div>
      <AiNote>Generated {analysedAt ? formatDateTime(analysedAt) : ""}{model ? ` by ${model}` : ""}. Interpretations are possibilities, not established facts.</AiNote>
      <div>
        <h3 className="label">What happened</h3>
        <p className="text-sm text-stone-800">{analysis.what_happened.summary}</p>
      </div>
      {context.length > 0 && (
        <div>
          <h3 className="label">What we already knew</h3>
          <ul className="space-y-2 text-sm">
            {context.map((c, i) => <li key={i}>{stripRefs(c.fact)}{c.why_it_matters && <span className="text-stone-500"> — {stripRefs(c.why_it_matters)}</span>}<SourceList refs={c.refs} sources={sources} /></li>)}
          </ul>
        </div>
      )}
      {analysis.what_it_might_mean.length > 0 && (
        <div>
          <h3 className="label">Understanding</h3>
          <ul className="space-y-2 text-sm">
            {analysis.what_it_might_mean.map((m, i) => (
              <li key={i}>
                <span className={`chip mr-1 ${m.basis === "possible_explanation" ? "bg-amber-100 text-amber-800" : "bg-sand-100 text-stone-700"}`}>{m.basis === "possible_explanation" ? "Possible" : "Fact"}</span>
                {stripRefs(m.statement)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {analysis.what_we_can_do.length > 0 && (
        <div>
          <h3 className="label">What we can do</h3>
          <ul className="space-y-2 text-sm">
            {analysis.what_we_can_do.map((r, i) => <li key={i}><strong className="font-medium">{r.title}.</strong> {stripRefs(r.detail)}</li>)}
          </ul>
        </div>
      )}
      {!!analysis.questions_to_ask?.length && (
        <div>
          <h3 className="label">Questions worth asking</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">{analysis.questions_to_ask.map((q, i) => <li key={i}>{q.question} <span className="text-stone-500">({q.ask_who})</span></li>)}</ul>
        </div>
      )}
      {analysis.progress?.summary && (
        <div>
          <h3 className="label">Progress</h3>
          <p className="text-sm text-stone-800">{stripRefs(analysis.progress.summary)}</p>
          {analysis.progress.intervention_updates.map((u, i) => (
            <p key={i} className="mt-1 text-sm text-stone-600"><span className={`chip mr-1 ${EFFECT_STYLES[u.apparent_effect]}`}>{EFFECT_LABELS[u.apparent_effect]}</span>{u.intervention_name}: {stripRefs(u.assessment)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function EditOriginal({ open, entry, onClose, onSaved }: { open: boolean; entry: Entry; onClose: () => void; onSaved: (e: Entry) => void }) {
  const [title, setTitle] = useState(entry.title ?? "");
  const [date, setDate] = useState(entry.occurred_on ?? "");
  const [text, setText] = useState(entry.raw_text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setTitle(entry.title ?? ""); setDate(entry.occurred_on ?? ""); setText(entry.raw_text); setError(null); }
  }, [open, entry]);
  const save = async () => {
    if (!text.trim()) return setError("The text can't be empty.");
    setBusy(true);
    try {
      onSaved(must(await supabase.from("entries").update({ title: title.trim() || null, occurred_on: date || null, raw_text: text }).eq("id", entry.id).select("*").single()) as Entry);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Correct this record" wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>Save correction</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <p className="mb-3 text-xs text-stone-500">Corrections are recorded in the change history (Settings → History), so the earlier version is never lost.</p>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Text"><textarea className="input min-h-[220px]" value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
