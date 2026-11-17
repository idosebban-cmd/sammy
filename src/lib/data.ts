import { must } from "./useLoad";
import { DOCUMENTS_BUCKET, supabase } from "./supabase";
import { detectMime, extractText, MAX_FILE_BYTES } from "./extract";
import type { DocCategory, DocumentRow } from "./types";

export interface UploadMeta {
  title: string;
  doc_date: string | null;
  category: DocCategory;
  notes?: string | null;
}

/**
 * Stores the original file in private storage, then extracts and indexes its
 * text. If extraction fails, the original is still kept and marked as such.
 */
export async function uploadDocument(
  wsId: string,
  file: File,
  meta: UploadMeta,
  onStage?: (stage: string) => void,
): Promise<DocumentRow> {
  const mime = detectMime(file);
  if (!mime) throw new Error("Only PDF and Word (.docx) files are supported.");
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is larger than 25 MB.");

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
  const path = `${wsId}/${id}/${safeName}`;

  onStage?.("Uploading the original file…");
  const up = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

  let doc: DocumentRow;
  try {
    doc = must(await supabase.from("documents").insert({
      id,
      workspace_id: wsId,
      title: meta.title.trim() || file.name,
      doc_date: meta.doc_date || null,
      category: meta.category,
      notes: meta.notes || null,
      storage_path: path,
      file_name: file.name,
      mime_type: mime,
      size_bytes: file.size,
      extraction_status: "pending",
    }).select("*").single());
  } catch (e) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw e;
  }

  onStage?.("Reading the text so it can be searched…");
  try {
    const { chunks, pageCount } = await extractText(file);
    for (let i = 0; i < chunks.length; i += 200) {
      must(await supabase.from("document_chunks").insert(
        chunks.slice(i, i + 200).map((c) => ({ ...c, workspace_id: wsId, document_id: id })),
      ));
    }
    doc = must(await supabase.from("documents")
      .update({ extraction_status: chunks.length ? "done" : "empty", page_count: pageCount })
      .eq("id", id).select("*").single());
  } catch (e) {
    console.error(e);
    doc = must(await supabase.from("documents").update({ extraction_status: "failed" }).eq("id", id).select("*").single());
  }
  return doc;
}

export async function deleteDocument(doc: DocumentRow) {
  must(await supabase.from("documents").delete().eq("id", doc.id));
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
}

export async function openOriginal(doc: Pick<DocumentRow, "storage_path">, page?: number | null) {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.storage_path, 120);
  if (error || !data) throw new Error(error?.message ?? "Could not open the file");
  window.open(data.signedUrl + (page ? `#page=${page}` : ""), "_blank", "noopener");
}

const EXPORT_TABLES = [
  "workspaces", "workspace_members", "ai_settings", "redaction_terms", "entries", "timeline_events",
  "actions", "action_updates", "profile_entries", "interventions", "intervention_observations",
  "recommendations", "commitments", "evidence_links", "documents", "document_chunks",
  "chat_threads", "chat_messages", "audit_log",
] as const;

/** Exports every record in the workspace as one JSON file. */
export async function exportAll(wsId: string): Promise<Blob> {
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    note: "Complete export of Sammy's workspace. Original document files are in private storage and can be downloaded from the Documents page.",
  };
  for (const t of EXPORT_TABLES) {
    const rows: unknown[] = [];
    const col = t === "workspaces" ? "id" : "workspace_id";
    for (let from = 0; ; from += 1000) {
      let q = supabase.from(t).select("*").eq(col, wsId).range(from, from + 999);
      if (t === "audit_log") q = q.order("id");
      const page = must(await q) as unknown[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    out[t] = rows;
  }
  return new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
