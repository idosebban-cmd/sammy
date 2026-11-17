import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Analysis, ChatMessage, ProgressReview } from "./types";

export class ApiError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let payload: { error?: string; code?: string } = {};
      try {
        payload = await error.context.json();
      } catch {
        /* not JSON */
      }
      throw new ApiError(payload.error ?? "The server returned an error.", payload.code, error.context.status);
    }
    throw new ApiError("Could not reach the server. Check your connection and try again.");
  }
  return data as T;
}

export function analyseEntry(entryId: string) {
  return invoke<{ analysis: Analysis }>("analyze", { entry_id: entryId });
}

export function askAssistant(message: string, threadId: string | null) {
  return invoke<{ thread_id: string; message: ChatMessage }>("assistant", { message, thread_id: threadId });
}

export function requestProgressReview(days = 90) {
  return invoke<{ review: ProgressReview }>("assistant", { mode: "progress_review", days });
}

export function transcribePages(documentId: string, pages: number[]) {
  return invoke<{ pages: number[]; transcribed: number[]; chunks: number; total_pages: number }>("transcribe", { document_id: documentId, pages });
}

export interface ReminderPreview {
  sent: boolean;
  to: string | null;
  items: { action_id: string; reason: string; label: string; title: string }[];
  email?: { subject: string; text: string };
  message?: string;
}

export function previewReminders() {
  return invoke<ReminderPreview>("reminders", { mode: "preview" });
}

export function sendTestReminder() {
  return invoke<ReminderPreview>("reminders", { mode: "test" });
}
