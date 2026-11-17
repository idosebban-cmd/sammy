import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { ErrorNote, Field, Select, Spinner } from "../components/ui";
import { uploadDocument } from "../lib/data";
import { todayIso } from "../lib/dates";
import { notifyChanged } from "../lib/events";
import { detectMime } from "../lib/extract";
import { DOC_CATEGORY_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { DocCategory, Entry, EntryKind } from "../lib/types";
import { must } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

const TABS: { kind: EntryKind; label: string; icon: IconName; placeholder: string }[] = [
  { kind: "email", label: "Email", icon: "send", placeholder: "Paste an email or message from school, the local authority or a professional…" },
  { kind: "observation", label: "Observation", icon: "heart", placeholder: "What happened? Good moments count too — e.g. 'Sammy told me he felt worried before swimming and asked for a hug.'" },
  { kind: "document", label: "Document", icon: "file", placeholder: "" },
  { kind: "question", label: "Question", icon: "chat", placeholder: "Ask anything — e.g. 'Why might Sammy find assemblies so hard?'" },
];

export default function AddPage() {
  const { wsId, aiEnabled } = useWs();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [kind, setKind] = useState<EntryKind>((params.get("kind") as EntryKind) || "email");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [docCategory, setDocCategory] = useState<DocCategory>("other");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tab = TABS.find((t) => t.kind === kind)!;

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) return setFile(null);
    if (!detectMime(f)) return setError("Please choose a PDF or Word (.docx) file.");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.(pdf|docx)$/i, ""));
    if (kind !== "document") setKind("document");
  };

  const submit = async (analyse: boolean) => {
    setError(null);
    try {
      if (kind === "question") {
        if (!text.trim()) return setError("Type your question first.");
        navigate(`/ask?q=${encodeURIComponent(text.trim())}`);
        return;
      }
      let entry: Entry;
      if (kind === "document") {
        if (!file) return setError("Choose a file to upload.");
        setBusy("Uploading…");
        const doc = await uploadDocument(wsId, file, { title, doc_date: date || null, category: docCategory, notes: text }, setBusy);
        setBusy("Saving…");
        entry = must(await supabase.from("entries").insert({
          workspace_id: wsId, kind, title: doc.title, raw_text: text.trim() || `Uploaded document: ${doc.title}`,
          occurred_on: date || null, document_id: doc.id,
          analysis_status: analyse && doc.extraction_status === "done" ? "pending" : "none",
        }).select("*").single());
        if (doc.extraction_status !== "done") analyse = false;
      } else {
        if (!text.trim()) return setError("There's nothing to save yet.");
        setBusy("Saving…");
        entry = must(await supabase.from("entries").insert({
          workspace_id: wsId, kind, title: title.trim() || null, raw_text: text.trim(), occurred_on: date || null,
          analysis_status: analyse ? "pending" : "none",
        }).select("*").single());
      }
      notifyChanged();
      navigate(`/entries/${entry.id}${analyse ? "?analyse=1" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const isDoc = kind === "document";
  const isQuestion = kind === "question";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-semibold sm:text-3xl">What's new with Sammy?</h1>
      <p className="mt-1 text-sm text-stone-500">Paste an email, describe something that happened, upload a document or ask a question. The original is always kept exactly as you added it.</p>

      <div className="mt-6 grid grid-cols-4 gap-1 rounded-2xl bg-sand-100 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.kind} role="tab" aria-selected={kind === t.kind} onClick={() => setKind(t.kind)}
            className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium sm:flex-row sm:justify-center sm:text-sm ${kind === t.kind ? "bg-white text-sage-800 shadow-soft" : "text-stone-600 hover:text-stone-900"}`}>
            <Icon name={t.icon} className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div
        className="card mt-4 space-y-4 p-4 sm:p-6"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] ?? null); }}
      >
        {error && <ErrorNote message={error} />}

        {isDoc && (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sand-300 bg-sand-50 px-4 py-8 text-center hover:border-sage-400">
            <Icon name="upload" className="h-6 w-6 text-sage-600" />
            {file ? <span className="text-sm font-medium text-stone-800">{file.name} <span className="font-normal text-stone-500">({Math.round(file.size / 1024)} KB)</span></span>
              : <span className="text-sm text-stone-600">Choose or drop a PDF or Word document</span>}
            <span className="text-xs text-stone-400">EHCP, reports, letters, meeting notes — up to 25 MB</span>
          </button>
        )}
        <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />

        {!isQuestion && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
            <Field label={isDoc ? "Document title" : "Title (optional)"}>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isDoc ? "e.g. EHCP – final, May 2026" : "e.g. Collective worship incident"} />
            </Field>
            <Field label={kind === "email" ? "Date of email" : isDoc ? "Document date" : "When it happened"}>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        )}
        {isDoc && (
          <Field label="Type of document">
            <Select value={docCategory} onChange={setDocCategory} options={options(DOC_CATEGORY_LABELS)} />
          </Field>
        )}

        <Field label={isDoc ? "Your note (optional)" : isQuestion ? "Your question" : kind === "email" ? "Email text" : "What happened"}>
          <textarea
            className={`input resize-y ${isDoc ? "min-h-[80px]" : "min-h-[220px] sm:min-h-[280px]"} text-[15px] leading-relaxed`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isDoc ? "Anything you'd like to note about this document" : tab.placeholder}
            autoFocus
          />
        </Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {busy ? (
            <div className="flex items-center gap-2 text-sm text-stone-500"><Spinner className="h-4 w-4" />{busy}</div>
          ) : isQuestion ? (
            <button className="btn-primary" onClick={() => submit(false)}><Icon name="chat" className="h-4 w-4" />Ask</button>
          ) : (
            <>
              <button className={aiEnabled ? "btn-secondary" : "btn-primary"} onClick={() => submit(false)}>Save without analysis</button>
              {aiEnabled && <button className="btn-primary" onClick={() => submit(true)}><Icon name="sparkles" className="h-4 w-4" />Save & analyse</button>}
            </>
          )}
        </div>
        {!aiEnabled && !isQuestion && (
          <p className="text-xs text-stone-500">AI analysis is off until it's set up in Settings. You can still save this and add timeline entries and actions yourself.</p>
        )}
      </div>
    </div>
  );
}
