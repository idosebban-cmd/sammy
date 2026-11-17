import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { addDaysIso, todayIso } from "../lib/dates";
import { useOnChanged } from "../lib/events";
import { supabase } from "../lib/supabase";
import { useWs } from "../lib/workspace";
import { Chat } from "./Chat";
import { Icon, type IconName } from "./Icon";

const NAV: { to: string; label: string; icon: IconName; mobile: boolean }[] = [
  { to: "/", label: "Home", icon: "home", mobile: true },
  { to: "/add", label: "Add", icon: "plus", mobile: true },
  { to: "/timeline", label: "Timeline", icon: "timeline", mobile: true },
  { to: "/actions", label: "Actions", icon: "checkSquare", mobile: true },
  { to: "/sammy", label: "Sammy", icon: "heart", mobile: true },
  { to: "/documents", label: "Documents", icon: "file", mobile: false },
  { to: "/ask", label: "Ask AI", icon: "chat", mobile: false },
];

function useAttentionCount() {
  const { wsId } = useWs();
  const [count, setCount] = useState(0);
  const load = useCallback(async () => {
    const { count: c } = await supabase.from("actions").select("id", { count: "exact", head: true })
      .eq("workspace_id", wsId).neq("status", "completed").lte("due_date", addDaysIso(todayIso(), 3));
    setCount(c ?? 0);
  }, [wsId]);
  useEffect(() => { void load(); }, [load]);
  useOnChanged(load);
  return count;
}

export function Layout() {
  const { workspace, me } = useWs();
  const [drawer, setDrawer] = useState(false);
  const [drawerThread, setDrawerThread] = useState<string | null>(null);
  const attention = useAttentionCount();
  const location = useLocation();
  // Hidden on the assistant page itself, and on review pages where it would cover the Save bar.
  const onAsk = location.pathname.startsWith("/ask") || location.pathname.startsWith("/entries/");

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  const badge = (to: string) => to === "/actions" && attention > 0 && (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white" aria-label={`${attention} actions need attention`}>
      {attention}
    </span>
  );

  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header className="sticky top-0 z-30 border-b border-sand-200 bg-sand-50/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="font-display text-lg font-semibold text-stone-900">{workspace.child_name}</span>
          </Link>
          <nav className="ml-4 hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"}
                className={({ isActive }) => `relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive ? "bg-white text-sage-800 shadow-soft" : "text-stone-600 hover:text-stone-900"}`}>
                {n.label}{badge(n.to)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <NavLink to="/documents" className="btn-ghost p-2 md:hidden" aria-label="Documents"><Icon name="file" /></NavLink>
            <NavLink to="/settings" className="btn-ghost p-2" aria-label="Settings" title={me ? `Signed in as ${me.display_name}` : "Settings"}><Icon name="settings" /></NavLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6">
        <Outlet />
      </main>

      {!onAsk && (
        <button
          onClick={() => setDrawer(true)}
          className="fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-stone-900 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-stone-800 md:bottom-6"
          aria-label="Ask the assistant"
        >
          <Icon name="chat" className="h-4 w-4" /> Ask
        </button>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-stone-900/20" onMouseDown={() => setDrawer(false)}>
          <aside
            className="flex h-full w-full flex-col bg-sand-50 shadow-2xl sm:max-w-md"
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Assistant"
          >
            <div className="flex items-center justify-between border-b border-sand-200 px-4 py-3">
              <h2 className="font-display text-lg font-semibold">Ask about {workspace.child_name}</h2>
              <div className="flex items-center gap-1">
                <button className="btn-ghost btn-sm" onClick={() => setDrawerThread(null)}>New</button>
                <Link className="btn-ghost btn-sm" to={drawerThread ? `/ask?thread=${drawerThread}` : "/ask"}>Full page</Link>
                <button className="btn-ghost p-2" onClick={() => setDrawer(false)} aria-label="Close"><Icon name="x" /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Chat compact threadId={drawerThread} onThread={setDrawerThread} onNavigate={() => setDrawer(false)} />
            </div>
          </aside>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          {NAV.filter((n) => n.mobile).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? "text-sage-700" : "text-stone-500"}`}>
              {n.to === "/add" ? (
                <span className="-mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-sage-600 text-white shadow"><Icon name="plus" /></span>
              ) : (
                <span className="relative"><Icon name={n.icon} />{badge(n.to)}</span>
              )}
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
