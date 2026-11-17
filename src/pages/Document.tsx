import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ErrorNote, Field, Loading, Modal, Select, Spinner } from "../components/ui";
import { deleteDocument, openOriginal } from "../lib/data";
import { formatDate, formatDateTime } from "../lib/dates";
import { notifyChanged } from "../lib/events";
import { extractText } from "../lib/extract";
import { DOC_CATEGORY_LABELS, options } from "../lib/labels";
import { DOCUMENTS_BUCKET, supabase } from "../lib/supabase";
import type { DocCategory, DocumentChunk, DocumentRow, Entry } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const focusChunk = params.get("chunk");
  const navigate = useNavigate();
  const { wsId, aiEnabled, memberName } = useWs();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    const [doc, chunks, entries] = await Promise.all([
      supabase.from("documents").select("*").eq("id", id!).single(),
      supabase.from("document_chunks").select("id, document_id, chunk_index, page, section, content").eq("document_id", id!).order("chunk_index"),
      supabase.from("entries").select("id, analysis_status, review_status, created_at").eq("document_id", id!).order("created_at", { ascending: false }),
    ]);
    return { doc: must(doc) as DocumentRow & { created_by: string | null }, chunks: must(chunks) as DocumentChunk[], entries: must(entries) as Pick<Entry, "id" | "analysis_status" | "review_status" | "created_at">[] };
  }, [id]);

  useEffect(() => {
    if (focusChunk && data) document.getElementById(`chunk-${focusChunk}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusChunk, data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Not found"} onRetry={reload} />;
  const { doc, chunks, entries } = data;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setActionError(null);
    try { await fn(); } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const reread = () => run("Re-reading the text…", async () => {
    const { data: blob, error: dlErr } = await supabase.storage.from(DOCUMENTS_BUCKET).download(doc.storage_path);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Couldn't download the original");
    const { chunks: fresh, pageCount } = await extractText(new File([blob], doc.file_name, { type: doc.mime_type }));
    must(await supabase.from("document_chunks").delete().eq("document_id", doc.id));
    for (let i = 0; i < fresh.length; i += 200) {
      must(await supabase.from("document_chunks").insert(fresh.slice(i, i + 200).map((c) => ({ ...c, workspace_id: wsId, document_id: doc.id }))));
    }
    must(await supabase.from("documents").update({ extraction_status: fresh.length ? "done" : "empty", page_count: pageCount }).eq("id", doc.id));
    await reload();
  });

  const analyse = () => run("Preparing analysis…", async () => {
    const entry = must(await supabase.from("entries").insert({
      workspace_id: wsId, kind: "document", title: doc.title, raw_text: `Uploaded document: ${doc.title}`,
      occurred_on: doc.doc_date, document_id: doc.id, analysis_status: "pending",
    }).select("id").single()) as { id: string };
    navigate(`/entries/${entry.id}?analyse=1`);
  });

  const remove = () => {
    if (!window.confirm(`Delete "${doc.title}" and its original file permanently?`)) return;
    void run("Deleting…", async () => {
      await deleteDocument(doc);
      notifyChanged();
      navigate("/documents");
    });
  };

  let lastLoc = "";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/documents" className="text-sm text-stone-500 hover:underline">← Documents</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{DOC_CATEGORY_LABELS[doc.category]}{doc.doc_date && ` · ${formatDate(doc.doc_date, { withYear: true })}`}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">{doc.title}</h1>
          <p className="mt-1 text-xs text-stone-400">{doc.file_name} · {Math.round(doc.size_bytes / 1024)} KB · uploaded {formatDateTime(doc.created_at)}{memberName(doc.created_by) && ` by ${memberName(doc.created_by)}`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary btn-sm" onClick={() => run("Opening…", () => openOriginal(doc))}><Icon name="external" className="h-3.5 w-3.5" />Open original</button>
          <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}><Icon name="edit" className="h-3.5 w-3.5" />Details</button>
          <button className="btn-danger btn-sm" onClick={remove}><Icon name="trash" className="h-3.5 w-3.5" />Delete</button>
        </div>
      </div>
      {busy && <div className="flex items-center gap-2 text-sm text-stone-500"><Spinner className="h-4 w-4" />{busy}</div>}
      {actionError && <ErrorNote message={actionError} />}
      {doc.notes && <p className="rounded-xl bg-sand-100 p-3 text-sm text-stone-700">{doc.notes}</p>}

      <div className="flex flex-wrap gap-2">
        {aiEnabled && doc.extraction_status === "done" && <button className="btn-secondary btn-sm" onClick={analyse}><Icon name="sparkles" className="h-3.5 w-3.5" />Analyse this document</button>}
        {aiEnabled && <Link className="btn-secondary btn-sm" to={`/ask?q=${encodeURIComponent(`Summarise the key points of "${doc.title}" that matter for Sammy.`)}`}><Icon name="chat" className="h-3.5 w-3.5" />Ask about it</Link>}
        {doc.extraction_status !== "done" && <button className="btn-secondary btn-sm" onClick={reread}>Try reading the text again</button>}
        {entries.map((e) => (
          <Link key={e.id} to={`/entries/${e.id}`} className="btn-ghost btn-sm">Analysis from {formatDate(e.created_at)}{e.review_status === "unreviewed" && e.analysis_status === "done" ? " · needs review" : ""}</Link>
        ))}
      </div>

      <section className="card p-4 sm:p-5">
        <h2 className="section-title mb-1">Extracted text</h2>
        <p className="mb-4 text-xs text-stone-500">Read automatically from the original for searching. Formatting may differ; the original file is the authoritative version.</p>
        {doc.extraction_status === "failed" && <ErrorNote message="The text couldn't be read from this file. The original is still stored safely." />}
        {doc.extraction_status === "empty" && <p className="text-sm text-amber-800">No text was found. This is usually a scanned document; it can still be opened, but can't yet be searched.</p>}
        <div className="space-y-3">
          {chunks.map((c) => {
            const loc = c.page ? `Page ${c.page}` : c.section ?? "";
            const showLoc = loc && loc !== lastLoc;
            lastLoc = loc;
            return (
              <div key={c.id} id={`chunk-${c.id}`}>
                {showLoc && (
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">{loc}</span>
                    {c.page && <button className="text-xs text-sage-700 underline" onClick={() => run("Opening…", () => openOriginal(doc, c.page))}>open page</button>}
                  </div>
                )}
                <p className={`whitespace-pre-wrap rounded-lg text-sm leading-relaxed text-stone-700 ${focusChunk === c.id ? "bg-amber-50 p-2 ring-2 ring-amber-300" : ""}`}>{c.content}</p>
              </div>
            );
          })}
        </div>
      </section>
      <EditDoc open={editing} doc={doc} onClose={() => setEditing(false)} onSaved={reload} />
    </div>
  );
}

function EditDoc({ open, doc, onClose, onSaved }: { open: boolean; doc: DocumentRow; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [date, setDate] = useState(doc.doc_date ?? "");
  const [category, setCategory] = useState<DocCategory>(doc.category);
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setTitle(doc.title); setDate(doc.doc_date ?? ""); setCategory(doc.category); setNotes(doc.notes ?? ""); } }, [open, doc]);
  const save = async () => {
    try {
      must(await supabase.from("documents").update({ title: title.trim() || doc.file_name, doc_date: date || null, category, notes: notes.trim() || null }).eq("id", doc.id));
      notifyChanged();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Document details"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Type"><Select value={category} onChange={setCategory} options={options(DOC_CATEGORY_LABELS)} /></Field>
        </div>
        <Field label="Notes"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
