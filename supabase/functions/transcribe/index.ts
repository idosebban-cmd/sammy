// POST /transcribe { document_id, pages: number[] }
// Reads scanned (image-only) PDF pages with Claude's vision and stores the text
// as searchable chunks, page by page. The client sends a few pages per call so
// each request stays well within function time limits. Requires AI consent.

import { PDFDocument } from "pdf-lib";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { getCaller, requireAiConsent } from "../_shared/auth.ts";
import { handle, HttpError, json } from "../_shared/http.ts";
import { callText } from "../_shared/llm.ts";

const MAX_PAGES_PER_CALL = 6;
const TARGET = 1600;

function splitText(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length > TARGET) { out.push(buf.trim()); buf = ""; }
    buf += (buf ? "\n\n" : "") + para;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

Deno.serve(handle(async (req) => {
  const { document_id, pages } = await req.json().catch(() => ({}));
  if (typeof document_id !== "string" || !Array.isArray(pages) || !pages.length) throw new HttpError(400, "document_id and pages are required");
  const wanted = [...new Set(pages.map(Number).filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b).slice(0, MAX_PAGES_PER_CALL);

  const caller = await getCaller(req);
  const settings = await requireAiConsent(caller);
  const { db, workspaceId } = caller;

  const { data: doc, error } = await db.from("documents").select("id, storage_path, mime_type, page_count").eq("id", document_id).maybeSingle();
  if (error) throw error;
  if (!doc) throw new HttpError(404, "Document not found");
  if (doc.mime_type !== "application/pdf") throw new HttpError(400, "Only PDF files can be transcribed.");

  const { data: blob, error: dlErr } = await db.storage.from("documents").download(doc.storage_path);
  if (dlErr || !blob) throw new HttpError(502, "Couldn't read the original file from storage.");

  const src = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true });
  const total = src.getPageCount();
  const valid = wanted.filter((p) => p <= total);
  if (!valid.length) throw new HttpError(400, "Those pages don't exist in this document.");
  const part = await PDFDocument.create();
  const copied = await part.copyPages(src, valid.map((p) => p - 1));
  copied.forEach((p) => part.addPage(p));
  const b64 = encodeBase64(await part.save());

  const text = await callText({
    model: settings.model,
    effort: "low",
    maxTokens: 32000,
    system: "You transcribe scanned documents accurately. Output only the transcription, nothing else.",
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
        {
          type: "text",
          text: `This PDF contains ${valid.length} page(s), which are pages ${valid.join(", ")} of the original document.
Transcribe the text of each page faithfully, keeping headings, lists and table rows (use " | " between cells).
Do not summarise, correct or add anything. Mark illegible words as [illegible].
Start each page with a line "=== PAGE n ===" where n is the ORIGINAL page number (${valid.join(", ")}).`,
        },
      ],
    }],
  });

  // Split the response back into pages.
  const byPage = new Map<number, string>();
  const parts = text.split(/^=== PAGE (\d+) ===\s*$/m);
  for (let i = 1; i < parts.length; i += 2) byPage.set(Number(parts[i]), parts[i + 1].trim());
  if (!byPage.size && valid.length === 1) byPage.set(valid[0], text.trim());

  const { data: existing } = await db.from("document_chunks").select("chunk_index").eq("document_id", doc.id)
    .order("chunk_index", { ascending: false }).limit(1);
  let next = (existing?.[0]?.chunk_index ?? -1) + 1;
  const rows: { workspace_id: string; document_id: string; chunk_index: number; page: number; section: null; content: string }[] = [];
  for (const p of valid) {
    const t = byPage.get(p);
    if (!t) continue;
    for (const piece of splitText(t)) rows.push({ workspace_id: workspaceId, document_id: doc.id, chunk_index: next++, page: p, section: null, content: piece });
  }
  // Replace any thin text previously extracted for these pages.
  const { error: delErr } = await db.from("document_chunks").delete().eq("document_id", doc.id).in("page", valid);
  if (delErr) throw delErr;
  if (rows.length) {
    const { error: insErr } = await db.from("document_chunks").insert(rows);
    if (insErr) throw insErr;
  }
  return json({ pages: valid, transcribed: [...byPage.keys()].filter((p) => valid.includes(p)), chunks: rows.length, total_pages: total });
}));
