import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { ErrorNote, Field, Select, Spinner } from "../components/ui";
import { uploadDocument } from "../lib/data";
import { todayIso } from "../lib/dates";
import { detectKind } from "../lib/detect";
import { clearDraft, loadDraft, saveDraft } from "../lib/draft";
import { notifyChanged } from "../lib/events";
import { detectMime } from "../lib/extract";
import { DOC_CATEGORY_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { DocCategory, Entry, EntryKind } from "../lib/types";
import { must } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

const KINDS: { kind: EntryKind; label: string; icon: IconName }[] = [
  { kind: "email", label: "Email", icon: "send" },
  { kind: "observation", label: "Something that happened", icon: "heart" },
  { kind: "question", label: "Question", icon: "chat" },
  { kind: "document", label: "Document", icon: "file" },
];

/** Creates an entry and, if AI is on, sends the parent to its analysis. Shared with the dashboard's quick capture. */
export async function saveEntry(wsId: string, fields: { kind: EntryKind; text: string; title?: string; date?: string | null }, analyse: boolean): Promise<Entry> {
  return must(await supabase.from("entries").insert({
    workspace_id: wsId, kind: fields.kind, title: fields.title?.trim() || null, raw_text: fields.text.trim(),
    occurred_on: fields.date || null, analysis_status: analyse ? "pending" : "none",
  }).select("*").single()) as Entry;
}

export default function AddPage() {
  const { wsId, aiEnabled } = useWs();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const draft = useRef(loadDraft()).current;
  const [text, setText] = useState(draft?.text ?? "");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [date, setDate] = useState(draft?.date ?? todayIso());
  const [picked, setPicked] = useState<EntryKind | null>((params.get("kind") as EntryKind) || null);
  const [file, setFile] = useState<File | null>(null);
  const [docCategory, setDocCategory] = useState<DocCategory>("other");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const kind: EntryKind = file ? "document" : picked ?? detectKind(text);
  const isDoc = kind === "document";
  const isQuestion = kind === "question";

  useEffect(() => { saveDraft({ text, title, date }); }, [text, title, date]);

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) return setFile(null);
    if (!detectMime(f)) return setError("Please choose a PDF or Word (.docx) file.");
    setFile(f);
    setPicked("document");
    if (!title) setTitle(f.name.replace(/\.(pdf|docx)$/i, ""));
    const lower = f.name.toLowerCase();
    if (/ehcp|ehc plan/.test(lower)) setDocCategory("ehcp");
    else if (/minutes|meeting|notes/.test(lower)) setDocCategory("meeting_notes");
    else if (/report/.test(lower)) setDocCategory("professional_report");
  };

  const choose = (k: EntryKind) => {
    if (k === "document") { setPicked("document"); if (!file) fileRef.current?.click(); return; }
    setFile(null);
    setPicked(k);
  };

  const submit = async (analyse: boolean) => {
    setError(null);
    try {
      if (isQuestion) {
        if (!text.trim()) return setError("Type your question first.");
        clearDraft();
        navigate(`/ask?q=${encodeURIComponent(text.trim())}`);
        return;
      }
      let entry: Entry;
      if (isDoc) {
        if (!file) return setError("Choose a file to upload.");
        setBusy("Uploading…");
        const doc = await uploadDocument(wsId, file, { title, doc_date: date || null, category: docCategory, notes: text }, setBusy);
        const readable = doc.extraction_status === "done" || doc.extraction_status === "partial";
        setBusy("Saving…");
        entry = must(await supabase.from("entries").insert({
          workspace_id: wsId, kind: "document", title: doc.title, raw_text: text.trim() || `Uploaded document: ${doc.title}`,
          occurred_on: date || null, document_id: doc.id, analysis_status: analyse && readable ? "pending" : "none",
        }).select("*").single()) as Entry;
        if (!readable) {
          clearDraft();
          notifyChanged();
          navigate(`/documents/${doc.id}`);
          return;
        }
      } else {
        if (!text.trim()) return setError("There's nothing to save yet.");
        setBusy("Saving…");
        entry = await saveEntry(wsId, { kind, text, title, date }, analyse);
      }
      clearDraft();
      notifyChanged();
      navigate(`/entries/${entry.id}${analyse ? "?analyse=1" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-semibold sm:text-3xl">What's new with Sammy?</h1>
      <p className="mt-1 text-sm text-stone-500">Paste an email, jot down what happened, ask a question or drop in a document. The original is always kept as you added it.</p>

      <div
        className="card mt-5 space-y-4 p-4 sm:p-6"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] ?? null); }}
      >
        {error && <ErrorNote message={error} />}

        {isDoc ? (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sand-300 bg-sand-50 px-4 py-8 text-center hover:border-sage-400">
            <Icon name="upload" className="h-6 w-6 text-sage-600" />
            {file ? <span className="text-sm font-medium text-stone-800">{file.name} <span className="font-normal text-stone-500">({Math.round(file.size / 1024)} KB)</span></span>
              : <span className="text-sm text-stone-600">Choose or drop a PDF or Word document</span>}
            <span className="text-xs text-stone-400">EHCP, reports, letters, meeting notes — scanned PDFs too</span>
          </button>
        ) : (
          <textarea
            className="input min-h-[200px] resize-y text-[15px] leading-relaxed sm:min-h-[260px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Paste an email from school, or write a sentence or two about what happened — good moments too.\n\nOr ask a question, e.g. \"How can we help him with assemblies?\""}
            aria-label="What's new"
            autoFocus
          />
        )}
        <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />

        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="This is">
          <span className="mr-1 text-xs text-stone-500">{picked ? "This is:" : text.trim() ? "Looks like:" : "Or choose:"}</span>
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => choose(k.kind)}
              className={`chip border px-3 py-1 ${kind === k.kind ? "border-sage-500 bg-sage-500 text-white" : "border-sand-300 bg-white text-stone-600 hover:border-sage-400"}`}>
              <Icon name={k.icon} className="h-3.5 w-3.5" />{k.label}
            </button>
          ))}
        </div>

        {!isQuestion && (
          <details className="group" open={isDoc || !!title}>
            <summary className="cursor-pointer list-none text-xs font-medium text-stone-500 hover:text-stone-700">
              <span className="group-open:hidden">+ Title, date{isDoc ? ", type" : ""}</span>
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
              <Field label={isDoc ? "Document title" : "Title (optional)"}>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isDoc ? "e.g. EHCP – final, May 2026" : "e.g. Collective worship incident"} />
              </Field>
              <Field label={kind === "email" ? "Date of email" : isDoc ? "Document date" : "When it happened"}>
                <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              {isDoc && (
                <Field label="Type of document">
                  <Select value={docCategory} onChange={setDocCategory} options={options(DOC_CATEGORY_LABELS)} />
                </Field>
              )}
              {isDoc && (
                <Field label="Your note (optional)">
                  <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
              )}
            </div>
          </details>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {busy ? (
            <div className="flex items-center gap-2 text-sm text-stone-500"><Spinner className="h-4 w-4" />{busy}</div>
          ) : isQuestion ? (
            <button className="btn-primary" onClick={() => submit(false)}><Icon name="chat" className="h-4 w-4" />Ask</button>
          ) : (
            <>
              <button className={aiEnabled ? "btn-ghost" : "btn-primary"} onClick={() => submit(false)}>{aiEnabled ? "Just save it" : "Save"}</button>
              {aiEnabled && <button className="btn-primary" onClick={() => submit(true)}><Icon name="sparkles" className="h-4 w-4" />Save & get advice</button>}
            </>
          )}
        </div>
        {!aiEnabled && !isQuestion && (
          <p className="text-xs text-stone-500">AI advice is off until it's set up in Settings. You can still save this and add timeline entries and actions yourself.</p>
        )}
      </div>
    </div>
  );
}
