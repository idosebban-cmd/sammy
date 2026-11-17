import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ActionEditor, ActionFields, emptyAction, type ActionDraft } from "../components/actions";
import { EvidencePicker, ProgressAreaPicker, TimelineEditor } from "../components/forms";
import { Icon } from "../components/Icon";
import { SourceList, stripRefs } from "../components/Sources";
import { AiNote, ErrorNote, EvidenceBadge, Field, Loading, Modal, Select, Spinner, StatusBadge } from "../components/ui";
import { analyseEntry } from "../lib/api";
import { formatDate, formatDateTime, todayIso } from "../lib/dates";
import { notifyChanged } from "../lib/events";
import { KIND_LABELS, OWNER_LABELS, SECTION_LABELS, TIMELINE_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type {
  Action, Analysis, Entry, EvidenceType, ProfileEntry, ProfileSection, ProgressArea, Recommendation, TimelineCategory, TimelineEvent,
} from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

interface InterpItem { include: boolean; text: string; section: ProfileSection; evidence_type: EvidenceType }
interface RecItem { include: boolean; title: string; detail: string; timeframe: "immediate" | "longer_term" }
interface ActItem { include: boolean; draft: ActionDraft; origin: "explicit_commitment" | "suggested"; quote: string | null; removed: boolean; open: boolean }
interface MemItem {
  include: boolean; title: string; text: string; target: "timeline" | "profile"; category: TimelineCategory; section: ProfileSection;
  evidence_type: EvidenceType; areas: ProgressArea[]; date: string;
}

function sourceLabel(e: Entry): string {
  const what = e.title || e.analysis?.what_happened.summary.slice(0, 60) || KIND_LABELS[e.kind];
  return `${KIND_LABELS[e.kind]}: ${what}${e.occurred_on ? ` (${formatDate(e.occurred_on, { withYear: true })})` : ""}`;
}

function buildReview(a: Analysis, e: Entry) {
  const eventDate = a.what_happened.event_date ?? e.occurred_on ?? todayIso();
  return {
    interp: a.what_it_might_mean.map<InterpItem>((m) => ({
      include: false,
      text: stripRefs(m.statement),
      section: "emotional_needs",
      evidence_type: m.basis === "possible_explanation" ? "ai_hypothesis" : "observation",
    })),
    recs: a.what_we_can_do.map<RecItem>((r) => ({ include: true, title: r.title, detail: stripRefs(r.detail), timeframe: r.timeframe })),
    acts: a.follow_up_actions.map<ActItem>((f) => ({
      include: true,
      origin: f.origin,
      quote: f.due_date_quote,
      removed: !!f.due_date_removed,
      open: false,
      draft: {
        ...emptyAction(f.owner), title: f.title, description: f.description, owner_detail: f.owner_detail ?? "",
        due_date: f.due_date ?? "", priority: f.priority, status: f.origin === "explicit_commitment" && !["ido", "helen", "both_parents"].includes(f.owner) ? "waiting" : "todo",
      },
    })),
    mem: a.what_to_remember.map<MemItem>((w) => ({
      include: true, title: w.title, text: w.text, target: w.target,
      category: w.timeline_category ?? "observation", section: w.profile_section ?? "emotional_needs",
      evidence_type: w.evidence_type, areas: w.progress_areas ?? [], date: eventDate,
    })),
  };
}

function Section({ letter, title, children, aside }: { letter: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage-100 text-xs font-semibold text-sage-800">{letter}</span>
        <h2 className="section-title flex-1">{title}</h2>
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

export default function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { wsId, aiEnabled, memberName } = useWs();

  const { data: entry, error, loading, reload, setData: setEntry } = useLoad<Entry>(
    async () => must(await supabase.from("entries").select("*").eq("id", id!).single()) as Entry, [id],
  );
  const saved = useLoad(async () => {
    const [a, t, p, r] = await Promise.all([
      supabase.from("actions").select("*").eq("source_entry_id", id!).order("created_at"),
      supabase.from("timeline_events").select("*").eq("source_entry_id", id!).order("occurred_on"),
      supabase.from("profile_entries").select("*").eq("source_entry_id", id!).order("created_at"),
      supabase.from("recommendations").select("*").eq("source_entry_id", id!).order("created_at"),
    ]);
    return { actions: must(a) as Action[], timeline: must(t) as TimelineEvent[], profile: must(p) as ProfileEntry[], recs: must(r) as Recommendation[] };
  }, [id]);

  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
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
      setAnalysisError(e instanceof Error ? e.message : String(e));
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
  const savedCount = saved.data ? saved.data.actions.length + saved.data.timeline.length + saved.data.profile.length + saved.data.recs.length : 0;

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
          <h1 className="mt-1 font-display text-2xl font-semibold">{entry.title || analysis?.what_happened.summary.split(". ")[0] || "Untitled record"}</h1>
          <p className="mt-1 text-xs text-stone-400">Added {formatDateTime(entry.created_at)}{memberName(entry.created_by) && ` by ${memberName(entry.created_by)}`}{entry.updated_at !== entry.created_at && ` · edited ${formatDateTime(entry.updated_at)}`}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}><Icon name="edit" className="h-3.5 w-3.5" />Correct</button>
          <button className="btn-danger btn-sm" onClick={remove}><Icon name="trash" className="h-3.5 w-3.5" />Delete</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-stone-700 sm:px-5" onClick={() => setShowOriginal(!showOriginal)} aria-expanded={showOriginal}>
          <span className="flex items-center gap-2"><Icon name="file" className="h-4 w-4 text-stone-400" />Original {entry.kind === "document" ? "upload" : "submission"} (unchanged)</span>
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
        <div className="card flex items-center gap-3 p-5">
          <Spinner />
          <div>
            <p className="text-sm font-medium">Reading this alongside what you've recorded about Sammy…</p>
            <p className="text-xs text-stone-500">This usually takes under a minute. Your submission is already saved.</p>
          </div>
        </div>
      )}
      {!analysing && (analysisError || entry.analysis_status === "failed") && (
        <ErrorNote message={analysisError ?? entry.analysis_error ?? "The analysis didn't complete."} onRetry={aiEnabled ? runAnalysis : undefined} />
      )}
      {!analysing && !analysis && entry.analysis_status !== "failed" && (
        <div className="card p-4 sm:p-5">
          <p className="text-sm text-stone-600">{aiEnabled ? "This record hasn't been analysed." : "AI analysis is switched off. You can record what matters yourself."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {aiEnabled && <button className="btn-primary btn-sm" onClick={runAnalysis}><Icon name="sparkles" className="h-3.5 w-3.5" />Analyse now</button>}
            <button className="btn-secondary btn-sm" onClick={() => setManualEvent(true)}>Add to timeline</button>
            <button className="btn-secondary btn-sm" onClick={() => setManualAction(true)}>Add an action</button>
          </div>
        </div>
      )}

      {analysis && reviewing && (
        <Review entry={entry} analysis={analysis} label={label} wsId={wsId}
          onDone={async () => { setReviewing(false); await Promise.all([reload(), saved.reload()]); notifyChanged(); }} />
      )}
      {analysis && !reviewing && (
        <ReadOnlyAnalysis analysis={analysis} model={entry.analysis_model} analysedAt={entry.analysed_at}
          onReview={() => setReviewing(true)} onReanalyse={aiEnabled ? runAnalysis : undefined} />
      )}

      {savedCount > 0 && saved.data && (
        <div className="card p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Saved from this record</h2>
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={() => setManualEvent(true)}>+ Timeline</button>
              <button className="btn-ghost btn-sm" onClick={() => setManualAction(true)}>+ Action</button>
            </div>
          </div>
          <ul className="divide-y divide-sand-200 text-sm">
            {saved.data.actions.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/actions?id=${a.id}`} className="min-w-0 truncate hover:underline"><span className="text-stone-400">Action · </span>{a.title}</Link>
                <StatusBadge status={a.status} />
              </li>
            ))}
            {saved.data.timeline.map((t) => (
              <li key={t.id} className="py-2"><Link to={`/timeline?focus=${t.id}`} className="hover:underline"><span className="text-stone-400">Timeline · {formatDate(t.occurred_on)} · </span>{t.title}</Link></li>
            ))}
            {saved.data.profile.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/sammy?focus=${p.id}`} className="min-w-0 truncate hover:underline"><span className="text-stone-400">Profile · {SECTION_LABELS[p.section]} · </span>{p.content}</Link>
                <EvidenceBadge type={p.evidence_type} />
              </li>
            ))}
            {saved.data.recs.map((r) => (
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

function Review({ entry, analysis, label, wsId, onDone }: { entry: Entry; analysis: Analysis; label: string; wsId: string; onDone: () => void }) {
  const initial = useMemo(() => buildReview(analysis, entry), [analysis, entry]);
  const [interp, setInterp] = useState(initial.interp);
  const [recs, setRecs] = useState(initial.recs);
  const [acts, setActs] = useState(initial.acts);
  const [mem, setMem] = useState(initial.mem);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = analysis.sources ?? [];

  const upd = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) =>
    set((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const count = interp.filter((x) => x.include).length + recs.filter((x) => x.include).length + acts.filter((x) => x.include).length + mem.filter((x) => x.include).length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const base = { workspace_id: wsId, source_entry_id: entry.id, source_document_id: entry.document_id };
      const chosenActs = acts.filter((a) => a.include && a.draft.title.trim());
      if (chosenActs.length) {
        const rows = must(await supabase.from("actions").insert(chosenActs.map((a) => ({
          ...base, source_label: label,
          title: a.draft.title.trim(), description: a.draft.description.trim() || null, owner: a.draft.owner,
          owner_detail: a.draft.owner_detail.trim() || null, due_date: a.draft.due_date || null,
          status: a.draft.status, priority: a.draft.priority,
          origin: a.origin === "explicit_commitment" ? "explicit_commitment" : "ai_suggested",
        }))).select("id")) as { id: string }[];
        must(await supabase.from("action_updates").insert(rows.map((r) => ({
          workspace_id: wsId, action_id: r.id, kind: "change", body: `Created from ${label}`,
        }))));
      }
      const tl = mem.filter((m) => m.include && m.target === "timeline" && m.text.trim());
      if (tl.length) must(await supabase.from("timeline_events").insert(tl.map((m) => ({
        workspace_id: wsId, source_entry_id: entry.id, source_document_id: entry.document_id, source_label: label,
        occurred_on: m.date || entry.occurred_on || todayIso(), category: m.category, title: m.title.trim() || m.text.slice(0, 80),
        description: m.text.trim(), progress_areas: m.areas, evidence_type: m.evidence_type,
      }))));
      const prof = [
        ...mem.filter((m) => m.include && m.target === "profile" && m.text.trim()).map((m) => ({ section: m.section, content: m.text.trim(), evidence_type: m.evidence_type })),
        ...interp.filter((m) => m.include && m.text.trim()).map((m) => ({ section: m.section, content: m.text.trim(), evidence_type: m.evidence_type })),
      ];
      if (prof.length) must(await supabase.from("profile_entries").insert(prof.map((p) => ({ ...p, ...base, source_label: label }))));
      const rs = recs.filter((r) => r.include && r.title.trim());
      if (rs.length) must(await supabase.from("recommendations").insert(rs.map((r) => ({
        workspace_id: wsId, source_entry_id: entry.id, title: r.title.trim(), detail: r.detail.trim() || null, timeframe: r.timeframe,
      }))));
      must(await supabase.from("entries").update({ review_status: "reviewed", reviewed_at: new Date().toISOString() }).eq("id", entry.id));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const wh = analysis.what_happened;
  return (
    <div className="space-y-4">
      <AiNote>
        AI-generated analysis for you to review. Nothing below is saved to Sammy's record until you confirm it.
        {analysis.truncated && " This document was very long, so only the first part was analysed."}
      </AiNote>

      {analysis.safety.concern && analysis.safety.guidance && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
          <p className="font-semibold">Safety first</p>
          <p className="mt-1 whitespace-pre-wrap">{analysis.safety.guidance}</p>
          <p className="mt-2 text-xs">If anyone is in immediate danger, call 999. For urgent medical advice, call NHS 111.</p>
        </div>
      )}

      <Section letter="A" title="What happened">
        <p className="text-sm leading-relaxed text-stone-800">{wh.summary}</p>
        {wh.key_facts.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">{wh.key_facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
        {wh.people.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {wh.people.map((p, i) => <span key={i} className="chip bg-sand-100 text-stone-700">{p.name} · {p.role}</span>)}
          </div>
        )}
        {analysis.related_history.length > 0 && (
          <div className="mt-4 rounded-xl bg-sage-50/70 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sage-800">Already in Sammy's record</p>
            <ul className="space-y-2">
              {analysis.related_history.map((r, i) => (
                <li key={i} className="text-sm text-stone-700">{stripRefs(r.note)}<SourceList refs={r.refs} sources={sources} /></li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section letter="B" title="What it might mean">
        {interp.length === 0 && <p className="text-sm text-stone-500">No interpretation offered.</p>}
        <ul className="space-y-3">
          {analysis.what_it_might_mean.map((m, i) => {
            const isFact = m.basis !== "possible_explanation";
            return (
              <li key={i} className={`rounded-xl border p-3 ${isFact ? "border-sand-200" : "border-dashed border-amber-300 bg-amber-50/40"}`}>
                <span className={`chip mb-1 ${isFact ? "bg-sand-100 text-stone-700" : "bg-amber-100 text-amber-800"}`}>
                  {m.basis === "stated_in_submission" ? "Fact · stated in this submission" : m.basis === "recorded_history" ? "Fact · from Sammy's record" : "Possible explanation"}
                </span>
                <p className="text-sm text-stone-800">{stripRefs(m.statement)}</p>
                <SourceList refs={m.refs} sources={sources} />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Toggle checked={interp[i].include} onChange={(v) => upd(setInterp, i, { include: v })} label="Save to Sammy's profile" />
                </div>
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

      <Section letter="C" title="What we can do">
        <ul className="space-y-3">
          {recs.map((r, i) => (
            <li key={i} className="rounded-xl border border-sand-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <input className="w-full bg-transparent text-sm font-semibold text-stone-900 focus:outline-none" value={r.title} onChange={(e) => upd(setRecs, i, { title: e.target.value })} />
                <span className={`chip shrink-0 ${r.timeframe === "immediate" ? "bg-sage-100 text-sage-800" : "bg-sky-50 text-sky-800"}`}>{r.timeframe === "immediate" ? "Now" : "Longer term"}</span>
              </div>
              <textarea className="mt-1 w-full resize-y bg-transparent text-sm text-stone-700 focus:outline-none" rows={3} value={r.detail} onChange={(e) => upd(setRecs, i, { detail: e.target.value })} />
              <SourceList refs={analysis.what_we_can_do[i]?.refs ?? []} sources={sources} />
              <div className="mt-2"><Toggle checked={r.include} onChange={(v) => upd(setRecs, i, { include: v })} label="Keep in suggested next steps" /></div>
            </li>
          ))}
        </ul>
      </Section>

      <Section letter="D" title="Follow-up actions" aside={
        <button className="btn-ghost btn-sm" onClick={() => setActs((xs) => [...xs, { include: true, origin: "suggested", quote: null, removed: false, open: true, draft: emptyAction() }])}>+ Add</button>
      }>
        {acts.length === 0 && <p className="text-sm text-stone-500">No follow-ups identified.</p>}
        <ul className="space-y-3">
          {acts.map((a, i) => (
            <li key={i} className={`rounded-xl border p-3 ${a.include ? "border-sand-200" : "border-sand-200 opacity-60"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label="Save this action" className="mt-1 h-4 w-4 rounded border-sand-400 text-sage-600" checked={a.include} onChange={(e) => upd(setActs, i, { include: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900">{a.draft.title || "New action"}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                    <span>{OWNER_LABELS[a.draft.owner]}{a.draft.owner_detail && ` · ${a.draft.owner_detail}`}</span>
                    <span>{a.draft.due_date ? `Due ${formatDate(a.draft.due_date, { withYear: true })}` : "No deadline stated"}</span>
                    <span className={a.origin === "explicit_commitment" ? "font-medium text-sage-700" : "text-amber-700"}>
                      {a.origin === "explicit_commitment" ? "Commitment stated in the source" : "Suggestion — not agreed with anyone"}
                    </span>
                  </div>
                  {a.quote && a.draft.due_date && <p className="mt-1 text-xs italic text-stone-500">Deadline from the text: "{a.quote}"</p>}
                  {a.removed && <p className="mt-1 text-xs text-stone-500">A suggested deadline was removed because it wasn't stated in the source.</p>}
                  <button className="mt-1 text-xs font-medium text-sage-700 underline" onClick={() => upd(setActs, i, { open: !a.open })}>{a.open ? "Done editing" : "Edit"}</button>
                  {a.open && <div className="mt-3"><ActionFields value={a.draft} onChange={(d) => upd(setActs, i, { draft: d })} /></div>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section letter="E" title="What to remember">
        {mem.length === 0 && <p className="text-sm text-stone-500">Nothing new to add to Sammy's record.</p>}
        <ul className="space-y-3">
          {mem.map((m, i) => (
            <li key={i} className={`rounded-xl border p-3 ${m.include ? "border-sand-200" : "border-sand-200 opacity-60"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label="Save this" className="mt-1 h-4 w-4 rounded border-sand-400 text-sage-600" checked={m.include} onChange={(e) => upd(setMem, i, { include: e.target.checked })} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select className="!w-auto !py-1.5 text-xs" value={m.target} onChange={(v) => upd(setMem, i, { target: v })}
                      options={[{ value: "timeline", label: "Add to timeline" }, { value: "profile", label: "Add to profile" }]} />
                    {m.target === "timeline"
                      ? <Select className="!w-auto !py-1.5 text-xs" value={m.category} onChange={(v) => upd(setMem, i, { category: v })} options={options(TIMELINE_LABELS)} />
                      : <Select className="!w-auto !py-1.5 text-xs" value={m.section} onChange={(v) => upd(setMem, i, { section: v })} options={options(SECTION_LABELS)} />}
                    {m.target === "timeline" && <input type="date" className="input !w-auto !py-1.5 text-xs" value={m.date} onChange={(e) => upd(setMem, i, { date: e.target.value })} />}
                  </div>
                  {m.target === "timeline" && <input className="input" value={m.title} onChange={(e) => upd(setMem, i, { title: e.target.value })} placeholder="Title" />}
                  <textarea className="input" rows={2} value={m.text} onChange={(e) => upd(setMem, i, { text: e.target.value })} />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <EvidencePicker value={m.evidence_type} onChange={(v) => upd(setMem, i, { evidence_type: v })} />
                  </div>
                  {m.target === "timeline" && <ProgressAreaPicker value={m.areas} onChange={(v) => upd(setMem, i, { areas: v })} />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <p className="px-1 text-xs text-stone-500">{analysis.evidence_note}</p>

      {error && <ErrorNote message={error} />}
      <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sand-200 bg-white/95 p-3 shadow-soft backdrop-blur md:bottom-4">
        <span className="text-sm text-stone-600">{count} item{count === 1 ? "" : "s"} selected</span>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onDone} disabled={saving}>Skip for now</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner className="h-4 w-4 text-white" />}Save confirmed items</button>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyAnalysis({ analysis, model, analysedAt, onReview, onReanalyse }: {
  analysis: Analysis; model: string | null; analysedAt: string | null; onReview: () => void; onReanalyse?: () => void;
}) {
  const sources = analysis.sources ?? [];
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
      {analysis.what_it_might_mean.length > 0 && (
        <div>
          <h3 className="label">What it might mean</h3>
          <ul className="space-y-2 text-sm">
            {analysis.what_it_might_mean.map((m, i) => (
              <li key={i}>
                <span className={`chip mr-1 ${m.basis === "possible_explanation" ? "bg-amber-100 text-amber-800" : "bg-sand-100 text-stone-700"}`}>{m.basis === "possible_explanation" ? "Possible" : "Fact"}</span>
                {stripRefs(m.statement)}
                <SourceList refs={m.refs} sources={sources} />
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

