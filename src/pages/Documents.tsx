import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { uploadDocument } from "../lib/data";
import { formatDate } from "../lib/dates";
import { notifyChanged, useOnChanged } from "../lib/events";
import { detectMime } from "../lib/extract";
import { DOC_CATEGORY_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { DocCategory, DocumentRow } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

interface Hit { kind: string; id: string; parent_id: string | null; title: string; snippet: string; page: number | null; section: string | null }

function highlight(snippet: string, q: string) {
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const text = snippet.replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  return (start > 0 ? "…" : "") + text.slice(start, start + 260) + (start + 260 < text.length ? "…" : "");
}

export default function DocumentsPage() {
  const { wsId } = useWs();
  const [category, setCategory] = useState<DocCategory | "">("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from("documents").select("*").eq("workspace_id", wsId)
      .order("doc_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })) as DocumentRow[], [wsId]);
  useOnChanged(useCallback(() => void reload(), [reload]));

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return setHits(null);
    setSearching(true);
    try {
      const rows = must(await supabase.rpc("search_records", { ws: wsId, q: q.trim(), max_results: 40 })) as Hit[];
      setHits(rows.filter((r) => r.kind === "document_chunk"));
    } finally {
      setSearching(false);
    }
  };

  const docs = (data ?? []).filter((d) => !category || d.category === category);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Documents" subtitle="EHCP, reports, letters and meeting notes. Originals are stored unchanged; their text is indexed so you and the assistant can search it."
        actions={<button className="btn-primary" onClick={() => setUploading(true)}><Icon name="upload" className="h-4 w-4" />Upload</button>} />

      <form onSubmit={search} className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input className="input pl-9" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setHits(null); }} placeholder="Search inside documents, e.g. 'adult support' or 'speech and language'" />
        </div>
        <button className="btn-secondary" disabled={searching}>{searching ? <Spinner className="h-4 w-4" /> : "Search"}</button>
        <Select className="!w-auto" value={category} onChange={setCategory} options={options(DOC_CATEGORY_LABELS)} allowEmpty emptyLabel="All types" />
      </form>

      {hits && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{hits.length} matching passage{hits.length === 1 ? "" : "s"}</h2>
          {hits.length === 0 ? <p className="text-sm text-stone-500">No passages matched. Try different words — search looks for the words themselves.</p> : (
            <ul className="space-y-2">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link to={`/documents/${h.parent_id}?chunk=${h.id}`} className="card block p-3 hover:border-sage-300">
                    <p className="text-sm font-medium text-stone-900">{h.title} <span className="font-normal text-stone-500">{h.page ? `· page ${h.page}` : h.section ? `· ${h.section}` : ""}</span></p>
                    <p className="mt-1 text-sm text-stone-600">{highlight(h.snippet, q)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} onRetry={reload} /> : docs.length === 0 ? (
        <Empty title="No documents yet" action={<button className="btn-secondary" onClick={() => setUploading(true)}>Upload a document</button>}>
          Start with Sammy's EHCP — then the assistant can answer questions like "what does the EHCP say about adult support?" with page references.
        </Empty>
      ) : (
        <ul className="card divide-y divide-sand-200">
          {docs.map((d) => (
            <li key={d.id}>
              <Link to={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sand-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sand-100 text-[10px] font-semibold uppercase text-stone-600">
                  {d.mime_type.includes("pdf") ? "PDF" : "DOCX"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-900">{d.title}</p>
                  <p className="text-xs text-stone-500">
                    {DOC_CATEGORY_LABELS[d.category]}{d.doc_date && ` · ${formatDate(d.doc_date, { withYear: true })}`}{d.page_count ? ` · ${d.page_count} pages` : ""}
                    {d.extraction_status === "failed" && <span className="text-rose-700"> · text couldn't be read</span>}
                    {d.extraction_status === "empty" && <span className="text-amber-700"> · no text found (scanned?)</span>}
                  </p>
                </div>
                <Icon name="chevronRight" className="h-4 w-4 text-stone-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <UploadModal open={uploading} onClose={() => setUploading(false)} />
    </div>
  );
}

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wsId, aiEnabled } = useWs();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState<DocCategory>("other");
  const [analyse, setAnalyse] = useState(true);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setError(null);
    if (f && !detectMime(f)) return setError("Please choose a PDF or Word (.docx) file.");
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.(pdf|docx)$/i, ""));
  };

  const close = () => { if (!stage) { setFile(null); setTitle(""); setDate(""); setError(null); onClose(); } };

  const upload = async () => {
    if (!file) return setError("Choose a file first.");
    setError(null);
    try {
      const doc = await uploadDocument(wsId, file, { title, doc_date: date || null, category }, setStage);
      notifyChanged();
      if (aiEnabled && analyse && doc.extraction_status === "done") {
        setStage("Preparing analysis…");
        const entry = must(await supabase.from("entries").insert({
          workspace_id: wsId, kind: "document", title: doc.title, raw_text: `Uploaded document: ${doc.title}`,
          occurred_on: doc.doc_date, document_id: doc.id, analysis_status: "pending",
        }).select("id").single()) as { id: string };
        navigate(`/entries/${entry.id}?analyse=1`);
      } else {
        navigate(`/documents/${doc.id}`);
      }
      setStage(null);
      setFile(null);
      setTitle("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage(null);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Upload a document"
      footer={stage ? <div className="flex items-center gap-2 text-sm text-stone-500"><Spinner className="h-4 w-4" />{stage}</div> : <>
        <button className="btn-secondary" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={upload} disabled={!file}>Upload</button>
      </>}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}
      <div className="space-y-3">
        <button type="button" onClick={() => ref.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] ?? null); }}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-sand-300 bg-sand-50 px-4 py-6 text-sm text-stone-600 hover:border-sage-400">
          <Icon name="upload" className="h-5 w-5 text-sage-600" />
          {file ? <span className="font-medium text-stone-800">{file.name}</span> : "Choose or drop a PDF or .docx file"}
        </button>
        <input ref={ref} type="file" className="hidden" accept=".pdf,.docx" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Document date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Type"><Select value={category} onChange={setCategory} options={options(DOC_CATEGORY_LABELS)} /></Field>
        </div>
        {aiEnabled && (
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={analyse} onChange={(e) => setAnalyse(e.target.checked)} />
            Analyse it and suggest actions and profile updates
          </label>
        )}
      </div>
    </Modal>
  );
}
