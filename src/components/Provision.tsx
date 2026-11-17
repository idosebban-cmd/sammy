import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../lib/dates";
import { notifyChanged, useOnChanged } from "../lib/events";
import { CERTAINTY_HINTS, CERTAINTY_LABELS, COMMITMENT_KIND_LABELS, DELIVERY_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { Action, Certainty, Commitment, CommitmentKind, DocumentRow, Intervention } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";
import { ActionEditor } from "./actions";
import { Icon } from "./Icon";
import { Empty, ErrorNote, Field, Loading, Modal, Select, Spinner, StatusBadge } from "./ui";

const CERTAINTY_STYLE: Record<Certainty, string> = {
  confirmed: "bg-emerald-50 text-emerald-800",
  proposed: "bg-sky-50 text-sky-800",
  reported: "bg-amber-50 text-amber-800",
};

type Filter = "all" | "no_follow_up" | CommitmentKind;

export function ProvisionRegister({ focus }: { focus: string | null }) {
  const { wsId } = useWs();
  const { data, error, loading, reload } = useLoad(async () => {
    const [c, a, i, d] = await Promise.all([
      supabase.from("commitments").select("*").eq("workspace_id", wsId).order("created_at"),
      supabase.from("actions").select("id, title, status, commitment_id").eq("workspace_id", wsId).not("commitment_id", "is", null),
      supabase.from("interventions").select("id, name, status, commitment_id").eq("workspace_id", wsId),
      supabase.from("documents").select("id, title, doc_date").eq("workspace_id", wsId),
    ]);
    return {
      commitments: must(c) as Commitment[],
      actions: must(a) as Pick<Action, "id" | "title" | "status" | "commitment_id">[],
      interventions: must(i) as Pick<Intervention, "id" | "name" | "status" | "commitment_id">[],
      docs: must(d) as Pick<DocumentRow, "id" | "title" | "doc_date">[],
    };
  }, [wsId]);
  useOnChanged(useCallback(() => void reload(), [reload]));
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Commitment | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionFor, setActionFor] = useState<Commitment | null>(null);
  const [linking, setLinking] = useState<Commitment | null>(null);

  useEffect(() => {
    if (focus && data) document.getElementById(`item-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, data]);

  const followUps = useMemo(() => {
    const m = new Map<string, { actions: typeof data extends null ? never : NonNullable<typeof data>["actions"]; interventions: NonNullable<typeof data>["interventions"] }>();
    for (const c of data?.commitments ?? []) m.set(c.id, { actions: [], interventions: [] });
    for (const a of data?.actions ?? []) if (a.commitment_id) m.get(a.commitment_id)?.actions.push(a);
    for (const i of data?.interventions ?? []) if (i.commitment_id) m.get(i.commitment_id)?.interventions.push(i);
    return m;
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Couldn't load"} onRetry={reload} />;

  const docTitle = (id: string | null) => data.docs.find((d) => d.id === id)?.title;
  const hasFollowUp = (c: Commitment) => (followUps.get(c.id)?.actions.length ?? 0) + (followUps.get(c.id)?.interventions.length ?? 0) > 0;
  const list = data.commitments.filter((c) => filter === "all" || (filter === "no_follow_up" ? !hasFollowUp(c) && c.status !== "in_place" && c.status !== "ended" : c.kind === filter));
  const unfollowed = data.commitments.filter((c) => !hasFollowUp(c) && c.status !== "in_place" && c.status !== "ended").length;

  const setStatus = async (c: Commitment, status: Commitment["status"]) => {
    must(await supabase.from("commitments").update({ status }).eq("id", c.id));
    notifyChanged();
  };
  const remove = async (c: Commitment) => {
    if (!window.confirm("Remove this from the register?")) return;
    must(await supabase.from("commitments").delete().eq("id", c.id));
    notifyChanged();
  };

  return (
    <div>
      <p className="mb-3 text-sm text-stone-600">
        What the EHCP provides, what professionals have recommended and what school or others have committed to — and whether
        anything has followed. Analyses of documents and emails add to this list once you approve them.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="!w-auto !py-2 text-xs" value={filter} onChange={setFilter}
          options={[{ value: "all" as Filter, label: "Everything" }, { value: "no_follow_up" as Filter, label: `Nothing followed up yet (${unfollowed})` }, ...options(COMMITMENT_KIND_LABELS) as { value: Filter; label: string }[]]} />
        <span className="flex-1" />
        <button className="btn-secondary" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />Add</button>
      </div>
      {list.length === 0 ? (
        <Empty title={data.commitments.length ? "Nothing matches" : "Nothing recorded yet"}>
          {!data.commitments.length && "Upload Sammy's EHCP or a professional report and choose \"Save & get advice\"; the provisions and recommendations it finds can be saved here."}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {list.map((c) => {
            const f = followUps.get(c.id)!;
            const src = docTitle(c.source_document_id);
            return (
              <li key={c.id} id={`item-${c.id}`} className={`card p-4 ${focus === c.id ? "ring-2 ring-sage-400" : ""}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="chip bg-sand-100 text-stone-700">{COMMITMENT_KIND_LABELS[c.kind]}</span>
                  <span className={`chip ${CERTAINTY_STYLE[c.certainty]}`} title={CERTAINTY_HINTS[c.certainty]}>{CERTAINTY_LABELS[c.certainty]}</span>
                  {c.ehcp_section && <span className="text-xs text-stone-500">Section {c.ehcp_section}</span>}
                  <span className="flex-1" />
                  <button className="btn-ghost p-1.5" onClick={() => setEditing(c)} aria-label="Edit"><Icon name="edit" className="h-4 w-4" /></button>
                  <button className="btn-ghost p-1.5" onClick={() => remove(c)} aria-label="Delete"><Icon name="trash" className="h-4 w-4" /></button>
                </div>
                <p className="mt-2 text-sm text-stone-900">{c.description}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {[c.made_by, c.frequency, c.review_on && `review ${formatDate(c.review_on, { withYear: true })}`].filter(Boolean).join(" · ")}
                  {src && <> · <Link className="underline" to={`/documents/${c.source_document_id}`}>{src}{c.source_page ? `, p. ${c.source_page}` : ""}</Link></>}
                  {!src && c.source_entry_id && <> · <Link className="underline" to={`/entries/${c.source_entry_id}`}>{c.source_label ?? "source"}</Link></>}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 border-t border-sand-200 pt-3 sm:grid-cols-[180px_1fr]">
                  <Field label="Happening?">
                    <Select className="!py-1.5 text-xs" value={c.status} onChange={(v) => setStatus(c, v)} options={options(DELIVERY_LABELS)} />
                  </Field>
                  <div>
                    <span className="label">Followed up by</span>
                    {f.actions.length + f.interventions.length === 0 ? <p className="text-sm text-amber-700">Nothing recorded yet</p> : (
                      <ul className="space-y-1 text-sm">
                        {f.actions.map((a) => <li key={a.id} className="flex items-center gap-2"><Link className="hover:underline" to={`/actions?id=${a.id}`}>{a.title}</Link><StatusBadge status={a.status} /></li>)}
                        {f.interventions.map((i) => <li key={i.id}><Link className="hover:underline" to={`/timeline?tab=interventions&focus=${i.id}`}>Intervention: {i.name}</Link></li>)}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn-ghost btn-sm" onClick={() => setActionFor(c)}>+ Action</button>
                      <button className="btn-ghost btn-sm" onClick={() => setLinking(c)}>Link intervention</button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CommitmentEditor open={creating || !!editing} commitment={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <ActionEditor open={!!actionFor} action={null} onClose={() => setActionFor(null)}
        source={actionFor ? { commitmentId: actionFor.id, documentId: actionFor.source_document_id, label: `${COMMITMENT_KIND_LABELS[actionFor.kind]}: ${actionFor.description.slice(0, 60)}` } : undefined}
        defaults={actionFor ? { title: `Follow up: ${actionFor.description.slice(0, 80)}` } : undefined} />
      <LinkIntervention commitment={linking} interventions={data.interventions} onClose={() => setLinking(null)} />
    </div>
  );
}

function LinkIntervention({ commitment, interventions, onClose }: { commitment: Commitment | null; interventions: Pick<Intervention, "id" | "name" | "commitment_id">[]; onClose: () => void }) {
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setId(""); setError(null); }, [commitment]);
  const save = async () => {
    if (!commitment || !id) return;
    try {
      must(await supabase.from("interventions").update({ commitment_id: commitment.id }).eq("id", id));
      notifyChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal open={!!commitment} onClose={onClose} title="Link an intervention"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={!id}>Link</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <p className="mb-3 text-sm text-stone-600">{commitment?.description}</p>
      {interventions.length ? (
        <Select value={id} onChange={setId} allowEmpty emptyLabel="Choose an intervention" options={interventions.map((i) => ({ value: i.id, label: i.name }))} />
      ) : <p className="text-sm text-stone-500">No interventions yet. Add one on the Timeline → Interventions tab.</p>}
    </Modal>
  );
}

function CommitmentEditor({ open, commitment, onClose }: { open: boolean; commitment: Commitment | null; onClose: () => void }) {
  const { wsId } = useWs();
  const blank = { kind: "ehcp_provision" as CommitmentKind, certainty: "confirmed" as Certainty, description: "", made_by: "", ehcp_section: "", frequency: "", review_on: "", notes: "" };
  const [d, setD] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setD(commitment ? {
      kind: commitment.kind, certainty: commitment.certainty, description: commitment.description, made_by: commitment.made_by ?? "",
      ehcp_section: commitment.ehcp_section ?? "", frequency: commitment.frequency ?? "", review_on: commitment.review_on ?? "", notes: commitment.notes ?? "",
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, commitment]);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD({ ...d, [k]: v });
  const save = async () => {
    if (!d.description.trim()) return setError("Please describe it.");
    setBusy(true);
    try {
      const row = {
        kind: d.kind, certainty: d.certainty, description: d.description.trim(), made_by: d.made_by.trim() || null,
        ehcp_section: d.ehcp_section.trim() || null, frequency: d.frequency.trim() || null, review_on: d.review_on || null, notes: d.notes.trim() || null,
      };
      if (commitment) must(await supabase.from("commitments").update(row).eq("id", commitment.id));
      else must(await supabase.from("commitments").insert({ ...row, workspace_id: wsId }));
      notifyChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={commitment ? "Edit" : "Add provision, recommendation or commitment"} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner className="h-4 w-4" />}Save</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kind"><Select value={d.kind} onChange={(v) => set("kind", v)} options={options(COMMITMENT_KIND_LABELS)} /></Field>
          <Field label="Status" hint={CERTAINTY_HINTS[d.certainty]}><Select value={d.certainty} onChange={(v) => set("certainty", v)} options={options(CERTAINTY_LABELS)} /></Field>
        </div>
        <Field label="What it says"><textarea className="input min-h-[80px]" value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Access to a familiar adult throughout the school day, including transitions" /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="By whom"><input className="input" value={d.made_by} onChange={(e) => set("made_by", e.target.value)} placeholder="e.g. Educational Psychologist" /></Field>
          <Field label="How often"><input className="input" value={d.frequency} onChange={(e) => set("frequency", e.target.value)} placeholder="e.g. 3 x 30 min weekly" /></Field>
          <Field label="EHCP section"><input className="input" value={d.ehcp_section} onChange={(e) => set("ehcp_section", e.target.value)} placeholder="e.g. F" /></Field>
        </div>
        <Field label="Review date"><input type="date" className="input sm:!w-auto" value={d.review_on} onChange={(e) => set("review_on", e.target.value)} /></Field>
        <Field label="Notes"><textarea className="input" value={d.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
