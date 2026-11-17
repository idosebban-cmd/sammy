import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Chat } from "../components/Chat";
import { Icon } from "../components/Icon";
import { formatDate } from "../lib/dates";
import { supabase } from "../lib/supabase";
import type { ChatThread } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

export default function AskPage() {
  const { wsId, workspace } = useWs();
  const [params, setParams] = useSearchParams();
  const threadId = params.get("thread");
  const q = params.get("q");

  const threads = useLoad(async () => must(await supabase.from("chat_threads").select("*").eq("workspace_id", wsId)
    .order("updated_at", { ascending: false }).limit(50)) as ChatThread[], [wsId]);

  const onThread = useCallback((id: string) => {
    setParams({ thread: id }, { replace: true });
    void threads.reload();
  }, [setParams, threads]);

  const remove = async (t: ChatThread) => {
    if (!window.confirm(`Delete the conversation "${t.title}"?`)) return;
    must(await supabase.from("chat_threads").delete().eq("id", t.id));
    if (t.id === threadId) setParams({});
    void threads.reload();
  };

  return (
    <div className="grid h-[calc(100vh-9.5rem)] grid-cols-1 gap-5 md:h-[calc(100vh-7rem)] md:grid-cols-[240px_1fr]">
      <aside className="hidden min-h-0 flex-col md:flex">
        <button className="btn-secondary mb-3 w-full" onClick={() => setParams({})}><Icon name="plus" className="h-4 w-4" />New conversation</button>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {threads.data?.map((t) => (
            <li key={t.id} className="group flex items-center">
              <button onClick={() => setParams({ thread: t.id })}
                className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm ${t.id === threadId ? "bg-white shadow-soft" : "hover:bg-sand-100"}`}>
                <span className="block truncate text-stone-800">{t.title}</span>
                <span className="text-xs text-stone-400">{formatDate(t.updated_at)}</span>
              </button>
              <button className="p-1 opacity-0 group-hover:opacity-100" onClick={() => remove(t)} aria-label="Delete conversation"><Icon name="trash" className="h-3.5 w-3.5 text-stone-400" /></button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold">Ask about {workspace.child_name}</h1>
          <button className="btn-ghost btn-sm md:hidden" onClick={() => setParams({})}>New</button>
        </div>
        <p className="mb-3 text-xs text-stone-500">Answers are AI-generated from your records, with sources. They aren't a diagnosis or a substitute for professional advice.</p>
        <div className="min-h-0 flex-1">
          <Chat key={threadId ?? "new"} threadId={threadId} onThread={onThread} initialQuestion={threadId ? null : q} />
        </div>
      </div>
    </div>
  );
}
