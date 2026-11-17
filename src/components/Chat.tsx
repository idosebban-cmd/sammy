import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, askAssistant } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { ChatMessage } from "../lib/types";
import { must } from "../lib/useLoad";
import { useWs } from "../lib/workspace";
import { Icon } from "./Icon";
import { RichText, SourcesFooter } from "./Sources";
import { ErrorNote, Spinner } from "./ui";

export const EXAMPLE_QUESTIONS = [
  "What has helped in similar situations?",
  "What actions are still outstanding?",
  "What does his EHCP say about adult support?",
  "How can we support his anxiety and self-esteem?",
];

const EVIDENCE_TEXT = {
  well_supported: "Based on your records",
  partly_supported: "Partly based on your records",
  insufficient: "Limited information in your records",
} as const;

export function AiOffNotice({ compact }: { compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900 ${compact ? "p-3" : "p-4"}`}>
      <p className="font-medium">AI features are switched off</p>
      <p className="mt-1">Nothing about Sammy is sent to an AI provider until one of you reviews and accepts the provider's terms.</p>
      <Link to="/settings" className="mt-2 inline-block font-medium underline">Review in Settings</Link>
    </div>
  );
}

export function Chat({ threadId, onThread, initialQuestion, onNavigate, compact }: {
  threadId: string | null;
  onThread: (id: string) => void;
  initialQuestion?: string | null;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const { aiEnabled } = useWs();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef<string | null>(null);
  const localThread = useRef<string | null>(threadId);

  useEffect(() => {
    // Only reload when the thread changes from outside (not when we just created it).
    if (threadId === localThread.current && messages.length) return;
    localThread.current = threadId;
    setError(null);
    if (!threadId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    supabase.from("chat_messages").select("*").eq("thread_id", threadId).order("created_at")
      .then((res) => setMessages(must(res) as ChatMessage[]))
      .then(undefined, (e: Error) => setError(e.message))
      .then(() => setLoadingThread(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    setError(null);
    setInput("");
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: "user", content: q, citations: [], meta: {}, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await askAssistant(q, localThread.current);
      if (res.thread_id !== localThread.current) {
        localThread.current = res.thread_id;
        onThread(res.thread_id);
      }
      setMessages((m) => [...m, res.message]);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(q);
    } finally {
      setSending(false);
    }
  }, [sending, onThread]);

  useEffect(() => {
    if (initialQuestion && aiEnabled && sentInitial.current !== initialQuestion) {
      sentInitial.current = initialQuestion;
      void send(initialQuestion);
    }
  }, [initialQuestion, aiEnabled, send]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex-1 space-y-4 overflow-y-auto ${compact ? "px-4 py-4" : "py-2"}`}>
        {!aiEnabled && <AiOffNotice compact={compact} />}
        {loadingThread && <Spinner />}
        {aiEnabled && !messages.length && !loadingThread && (
          <div>
            <p className="text-sm text-stone-500">Ask anything about Sammy. Answers draw on his profile, timeline, actions and documents, with links to the sources.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button key={q} className="rounded-full border border-sand-300 bg-white px-3 py-1.5 text-left text-xs text-stone-700 hover:border-sage-400" onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-sage-600 px-4 py-2.5 text-sm text-white">{m.content}</div>
          </div>
        ) : (
          <div key={m.id} className="max-w-[95%]">
            {m.meta?.safety_concern && (
              <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                If anyone is in immediate danger, call 999. For urgent advice, call NHS 111 or speak to the school's designated safeguarding lead.
              </div>
            )}
            <div className="rounded-2xl rounded-bl-md border border-sand-200 bg-white px-4 py-3">
              <RichText text={m.content} sources={m.citations} onNavigate={onNavigate} />
              <SourcesFooter sources={m.citations} onNavigate={onNavigate} />
            </div>
            {m.meta?.evidence_level && (
              <p className={`mt-1 px-1 text-[11px] ${m.meta.evidence_level === "insufficient" ? "text-amber-700" : "text-stone-400"}`}>
                {EVIDENCE_TEXT[m.meta.evidence_level]} · AI-generated, not professional advice
              </p>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-stone-500"><Spinner className="h-4 w-4" /> Looking through Sammy's records…</div>
        )}
        {error && <ErrorNote message={error} />}
        <div ref={endRef} />
      </div>
      <form
        className={`flex items-end gap-2 border-t border-sand-200 bg-white ${compact ? "p-3" : "pt-3"}`}
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <textarea
          className="input max-h-40 min-h-[44px] flex-1 resize-none"
          rows={1}
          value={input}
          disabled={!aiEnabled}
          placeholder={aiEnabled ? "Ask about Sammy…" : "AI is switched off"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
        />
        <button className="btn-primary h-11 w-11 p-0" disabled={!aiEnabled || sending || !input.trim()} aria-label="Send">
          <Icon name="send" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
