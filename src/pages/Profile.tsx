import { useCallback, useEffect, useState } from "react";
import { Spinner } from "../components/ui";
import { Link, useSearchParams } from "react-router-dom";
import { ProfileEditor } from "../components/forms";
import { Icon } from "../components/Icon";
import { ErrorNote, EvidenceBadge, Loading, PageHeader, Select } from "../components/ui";
import { formatDate } from "../lib/dates";
import { notifyChanged, useOnChanged } from "../lib/events";
import { EVIDENCE_LABELS, SECTION_HINTS, SECTION_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { EvidenceType, ProfileEntry, ProfileSection } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

// Strengths lead, and the helpful/unhelpful pair sits side by side.
const ORDER: ProfileSection[] = [
  "strengths", "emotional_needs", "triggers", "early_signs", "helpful_strategies", "unhelpful_strategies",
  "social", "educational_needs", "professional_recommendations",
];

export default function ProfilePage() {
  const { wsId, workspace } = useWs();
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const [evidence, setEvidence] = useState<EvidenceType | "">("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProfileEntry | null>(null);
  const [adding, setAdding] = useState<ProfileSection | null>(null);

  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from("profile_entries").select("*").eq("workspace_id", wsId).order("created_at")) as ProfileEntry[], [wsId]);
  useOnChanged(useCallback(() => void reload(), [reload]));

  useEffect(() => {
    if (focus && data) document.getElementById(`item-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, data]);

  const setStatus = async (p: ProfileEntry, status: "active" | "archived") => {
    must(await supabase.from("profile_entries").update({ status }).eq("id", p.id));
    notifyChanged();
  };
  const remove = async (p: ProfileEntry) => {
    if (!window.confirm("Delete this entry permanently? (Archiving keeps it in the history instead.)")) return;
    must(await supabase.from("profile_entries").delete().eq("id", p.id));
    notifyChanged();
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Couldn't load"} onRetry={reload} />;

  const visible = data.filter((p) => (showArchived || p.status === "active") && (!evidence || p.evidence_type === evidence));
  const hypotheses = data.filter((p) => p.status === "active" && p.evidence_type === "ai_hypothesis").length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Understanding ${workspace.child_name}`}
        subtitle="A living picture of who he is and what helps, built only from entries you've approved."
        actions={<button className="btn-primary" onClick={() => setAdding("strengths")}><Icon name="plus" className="h-4 w-4" />Add</button>}
      />
      <AboutCard />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select className="!w-auto !py-1.5 text-xs" value={evidence} onChange={setEvidence} options={options(EVIDENCE_LABELS)} allowEmpty emptyLabel="All kinds of information" />
        <label className="flex items-center gap-2 text-xs text-stone-600">
          <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {hypotheses > 0 && <span className="text-xs text-amber-700">{hypotheses} entr{hypotheses === 1 ? "y is an" : "ies are"} unconfirmed AI hypothes{hypotheses === 1 ? "is" : "es"}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ORDER.map((section) => {
          const items = visible.filter((p) => p.section === section);
          const lead = section === "strengths";
          return (
            <section key={section} className={`card p-4 sm:p-5 ${lead ? "border-sage-200 bg-gradient-to-br from-sage-50 to-white md:col-span-2" : ""}`}>
              <div className="mb-1 flex items-start justify-between gap-2">
                <h2 className="section-title">{SECTION_LABELS[section]}</h2>
                <button className="btn-ghost btn-sm shrink-0" onClick={() => setAdding(section)}>+ Add</button>
              </div>
              <p className="mb-3 text-xs text-stone-500">{SECTION_HINTS[section]}</p>
              {items.length === 0 ? (
                <p className="text-sm italic text-stone-400">Nothing recorded yet.</p>
              ) : (
                <ul className={lead ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "space-y-3"}>
                  {items.map((p) => (
                    <li key={p.id} id={`item-${p.id}`}
                      className={`group rounded-xl border p-3 ${p.status === "archived" ? "opacity-50" : ""} ${p.evidence_type === "ai_hypothesis" ? "border-dashed border-amber-300 bg-amber-50/40" : "border-sand-200 bg-white"} ${focus === p.id ? "ring-2 ring-sage-400" : ""}`}>
                      <p className="whitespace-pre-wrap text-sm text-stone-800">{p.content}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <EvidenceBadge type={p.evidence_type} />
                        {p.source_entry_id ? (
                          <Link to={`/entries/${p.source_entry_id}`} className="truncate text-xs text-stone-500 underline">{p.source_label ?? "Source"}</Link>
                        ) : p.source_document_id ? (
                          <Link to={`/documents/${p.source_document_id}`} className="truncate text-xs text-stone-500 underline">{p.source_label ?? "Document"}</Link>
                        ) : p.source_label ? <span className="truncate text-xs text-stone-500">{p.source_label}</span> : null}
                        <span className="text-xs text-stone-400">{formatDate(p.created_at)}</span>
                        <span className="flex-1" />
                        <div className="flex gap-0.5 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                          <button className="btn-ghost p-1" onClick={() => setEditing(p)} aria-label="Edit"><Icon name="edit" className="h-3.5 w-3.5" /></button>
                          <button className="btn-ghost btn-sm !px-1.5 !py-1" onClick={() => setStatus(p, p.status === "active" ? "archived" : "active")}>{p.status === "active" ? "Archive" : "Restore"}</button>
                          <button className="btn-ghost p-1" onClick={() => remove(p)} aria-label="Delete"><Icon name="trash" className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <ProfileEditor open={!!adding || !!editing} entry={editing} section={adding ?? undefined} onClose={() => { setAdding(null); setEditing(null); }} />
    </div>
  );
}

/** Free-text background the AI always reads: school, class, key adults, EHCP status, family context. */
function AboutCard() {
  const { wsId, workspace, refresh } = useWs();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(workspace.about ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(workspace.about ?? ""); }, [workspace.about]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      must(await supabase.from("workspaces").update({ about: text.trim() || null }).eq("id", wsId));
      await refresh();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card mb-5 p-4 sm:p-5">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="section-title">Background</h2>
        {!editing && <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}><Icon name="edit" className="h-3.5 w-3.5" />{workspace.about ? "Edit" : "Write"}</button>}
      </div>
      <p className="mb-3 text-xs text-stone-500">The essentials the AI should always know: school and class, key adults (e.g. his 1:1), current support, EHCP status and upcoming reviews.</p>
      {error && <div className="mb-2"><ErrorNote message={error} /></div>}
      {editing ? (
        <>
          <textarea className="input min-h-[140px]" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"e.g. Year 2 at a mainstream primary in London. Class teacher: Mrs Okafor. 1:1 support from Ms Blessing since October. EHCP finalised May 2026; annual review due February."} />
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn-secondary btn-sm" onClick={() => { setEditing(false); setText(workspace.about ?? ""); }}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy && <Spinner className="h-3.5 w-3.5" />}Save</button>
          </div>
        </>
      ) : workspace.about ? (
        <p className="whitespace-pre-wrap text-sm text-stone-700">{workspace.about}</p>
      ) : (
        <p className="text-sm italic text-stone-400">Not written yet. A few lines here noticeably improves the advice.</p>
      )}
    </section>
  );
}
