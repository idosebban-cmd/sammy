import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import type { AiSettingsRow, Member, Workspace } from "./types";

interface WorkspaceState {
  session: Session | null;
  loading: boolean;
  error: string | null;
  workspace: Workspace | null;
  me: Member | null;
  members: Member[];
  ai: AiSettingsRow | null;
  aiEnabled: boolean;
  refresh: () => Promise<void>;
  memberName: (userId: string | null | undefined) => string;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [ai, setAi] = useState<AiSettingsRow | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setWorkspace(null);
      setMembers([]);
      setAi(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: mine, error: mErr } = await supabase
        .from("workspace_members").select("workspace_id, user_id, display_name")
        .eq("user_id", userId).limit(1).maybeSingle();
      if (mErr) throw mErr;
      if (!mine) {
        setWorkspace(null);
        setError("This account isn't linked to Sammy's workspace yet. Ask the account administrator to add you.");
        return;
      }
      const [ws, mem, settings] = await Promise.all([
        supabase.from("workspaces").select("id, name, child_name").eq("id", mine.workspace_id).single(),
        supabase.from("workspace_members").select("workspace_id, user_id, display_name").eq("workspace_id", mine.workspace_id),
        supabase.from("ai_settings").select("*").eq("workspace_id", mine.workspace_id).maybeSingle(),
      ]);
      if (ws.error) throw ws.error;
      if (mem.error) throw mem.error;
      if (settings.error) throw settings.error;
      setWorkspace(ws.data);
      setMembers(mem.data ?? []);
      setAi(settings.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (authReady) void refresh();
  }, [authReady, refresh]);

  const value = useMemo<WorkspaceState>(() => ({
    session,
    loading: !authReady || loading,
    error,
    workspace,
    me: members.find((m) => m.user_id === userId) ?? null,
    members,
    ai,
    aiEnabled: !!ai?.terms_accepted,
    refresh,
    memberName: (id) => members.find((m) => m.user_id === id)?.display_name ?? "",
  }), [session, authReady, loading, error, workspace, members, userId, ai, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}

/** For components that only render inside the signed-in app. */
export function useWs() {
  const v = useWorkspace();
  if (!v.workspace) throw new Error("No workspace loaded");
  return { ...v, workspace: v.workspace, wsId: v.workspace.id };
}
