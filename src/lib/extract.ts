// Extracts text from PDF and DOCX files in the browser, keeping page numbers
// (PDF) or section headings (DOCX) so the assistant can cite exact locations.
// The original file is stored untouched; only the extracted text is indexed.

export interface ExtractedChunk {
  chunk_index: number;
  page: number | null;
  section: string | null;
  content: string;
}

export interface ExtractionResult {
  chunks: ExtractedChunk[];
  pageCount: number | null;
}

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const TARGET = 1600;

function splitLong(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length > TARGET) {
      out.push(buf.trim());
      buf = "";
    }
    if (para.length > TARGET * 1.5) {
      // Very long paragraph: split on sentence boundaries.
      for (const sentence of para.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [para]) {
        if (buf.length + sentence.length > TARGET && buf) {
          out.push(buf.trim());
          buf = "";
        }
        buf += sentence;
      }
    } else {
      buf += (buf ? "\n\n" : "") + para;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function detectMime(file: File): string | null {
  if (file.type === PDF_MIME || file.name.toLowerCase().endsWith(".pdf")) return PDF_MIME;
  if (file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx")) return DOCX_MIME;
  return null;
}

export async function extractText(file: File): Promise<ExtractionResult> {
  const mime = detectMime(file);
  if (mime === PDF_MIME) return extractPdf(file);
  if (mime === DOCX_MIME) return extractDocx(file);
  throw new Error("Only PDF and Word (.docx) files are supported.");
}

async function extractPdf(file: File): Promise<ExtractionResult> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const chunks: ExtractedChunk[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2) text += item.hasEOL ? "\n" : "\n";
      else if (text && !text.endsWith(" ") && !text.endsWith("\n")) text += " ";
      text += item.str;
      lastY = y;
    }
    // Rebuild paragraphs: blank lines where line gaps were.
    const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    // Pages with almost no text are usually scanned images; leave them for transcription.
    if (cleaned.replace(/\s/g, "").length < 40) continue;
    for (const piece of splitLong(cleaned)) {
      chunks.push({ chunk_index: chunks.length, page: p, section: null, content: piece });
    }
  }
  return { chunks, pageCount: doc.numPages };
}

async function extractDocx(file: File): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const dom = new DOMParser().parseFromString(html, "text/html");

  const chunks: ExtractedChunk[] = [];
  let section: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n\n").trim();
    if (text) for (const piece of splitLong(text)) chunks.push({ chunk_index: chunks.length, page: null, section, content: piece });
    buf = [];
  };

  for (const el of Array.from(dom.body.children)) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/^H[1-6]$/.test(el.tagName)) {
      flush();
      section = text.slice(0, 200);
    } else if (el.tagName === "TABLE") {
      const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td,th")).map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()).join(" | "),
      );
      buf.push(rows.join("\n"));
    } else if (el.tagName === "UL" || el.tagName === "OL") {
      buf.push(Array.from(el.querySelectorAll("li")).map((li) => `• ${(li.textContent ?? "").trim()}`).join("\n"));
    } else {
      buf.push(text);
    }
    if (buf.join("").length > TARGET * 2) flush();
  }
  flush();
  return { chunks, pageCount: null };
}
