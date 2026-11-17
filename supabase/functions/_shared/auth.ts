import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export interface Caller {
  db: SupabaseClient;
  userId: string;
  displayName: string;
  workspaceId: string;
}

/**
 * Builds a Supabase client that acts as the signed-in parent, so every query
 * the function makes is still subject to row-level security.
 */
export async function getCaller(req: Request): Promise<Caller> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new HttpError(401, "Not signed in");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await db.auth.getUser(authHeader.slice(7));
  if (userErr || !userData.user) throw new HttpError(401, "Session expired. Please sign in again.");

  const { data: member, error } = await db
    .from("workspace_members")
    .select("workspace_id, display_name")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!member) throw new HttpError(403, "This account is not part of a workspace.");

  return {
    db,
    userId: userData.user.id,
    displayName: member.display_name,
    workspaceId: member.workspace_id,
  };
}

export interface AiSettings {
  model: string;
  redact_contact_details: boolean;
}

/** Refuses unless a parent has explicitly accepted the AI provider's terms. */
export async function requireAiConsent(caller: Caller): Promise<AiSettings> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    throw new HttpError(503, "The AI provider has not been configured on the server yet.", "ai_not_configured");
  }
  const { data, error } = await caller.db
    .from("ai_settings")
    .select("model, terms_accepted, redact_contact_details")
    .eq("workspace_id", caller.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.terms_accepted) {
    throw new HttpError(
      403,
      "AI features are switched off until a parent reviews and accepts the AI provider's terms in Settings.",
      "ai_consent_required",
    );
  }
  return { model: data.model, redact_contact_details: data.redact_contact_details };
}
