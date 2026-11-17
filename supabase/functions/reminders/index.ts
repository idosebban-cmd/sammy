// Email reminders for approaching deadlines, overdue actions and replies
// still awaited. One short digest per parent, only when something is due.
//
// POST /reminders  with header x-cron-secret: CRON_SECRET  → daily run for everyone (schedule it daily)
// POST /reminders  { mode: "preview" }  with a parent's session → what that parent would get today
// POST /reminders  { mode: "test" }     with a parent's session → send that preview to their own email now
//
// Emails contain no details about Sammy by default: just "Due tomorrow" with a
// link into the app (action titles only if the parent opts in).

import { createClient } from "@supabase/supabase-js";
import { getCaller } from "../_shared/auth.ts";
import { handle, HttpError, json } from "../_shared/http.ts";
import { computeReminders, type LogEntry, type ReminderAction, type ReminderItem, type ReminderSettings, renderEmail } from "../_shared/reminders.ts";

const APP_URL = Deno.env.get("APP_URL") ?? Deno.env.get("APP_ORIGIN") ?? "http://localhost:5173";
const ACTION_COLUMNS = "id, title, owner, kind, status, due_date, date_confirmed, status_changed_at";
const today = () => new Date().toISOString().slice(0, 10);

async function sendEmail(to: string, email: { subject: string; text: string; html: string }) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("REMINDER_FROM");
  if (!key || !from) throw new HttpError(503, "Email sending isn't configured on the server yet (RESEND_API_KEY and REMINDER_FROM).", "email_not_configured");
  const res = await fetch(Deno.env.get("RESEND_API_URL") ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: email.subject, text: email.text, html: email.html }),
  });
  if (!res.ok) {
    console.error("Email provider error", res.status, await res.text().catch(() => ""));
    throw new HttpError(502, "The email service rejected the message.");
  }
}

Deno.serve(handle(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return json(await dailyRun());

  const body = await req.json().catch(() => ({}));
  const caller = await getCaller(req);
  const { data: s, error } = await caller.db.from("reminder_settings").select("*").eq("user_id", caller.userId).maybeSingle();
  if (error) throw error;
  const { data: userData } = await caller.db.auth.getUser();
  const settings: ReminderSettings = s ?? {
    user_id: caller.userId, workspace_id: caller.workspaceId, email: null, owner_key: null, scope: "mine",
    due_soon_days: 2, overdue_repeat_days: 3, waiting_after_days: 7, include_titles: false,
  };
  const { data: actions, error: aErr } = await caller.db.from("actions").select(ACTION_COLUMNS).eq("workspace_id", caller.workspaceId).neq("status", "completed");
  if (aErr) throw aErr;
  const items = computeReminders((actions ?? []) as ReminderAction[], settings, [], today(), true);
  const email = renderEmail(items, settings, APP_URL);
  const to = settings.email || userData.user?.email || null;

  if (body.mode === "test") {
    if (!to) throw new HttpError(400, "Add an email address in reminder settings first.");
    if (!items.length) return json({ sent: false, items, message: "Nothing needs a reminder today, so no email was sent." });
    await sendEmail(to, email);
    return json({ sent: true, to, items });
  }
  return json({ sent: false, to, items, email });
}));

async function dailyRun() {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: all, error } = await admin.from("reminder_settings").select("*").eq("enabled", true);
  if (error) throw error;
  const date = today();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const results: { user_id: string; items: number; sent: boolean; error?: string }[] = [];

  for (const s of (all ?? []) as (ReminderSettings & { enabled: boolean })[]) {
    try {
      let to = s.email;
      if (!to) to = (await admin.auth.admin.getUserById(s.user_id)).data.user?.email ?? null;
      if (!to) { results.push({ user_id: s.user_id, items: 0, sent: false, error: "no email" }); continue; }
      const [{ data: actions }, { data: log }] = await Promise.all([
        admin.from("actions").select(ACTION_COLUMNS).eq("workspace_id", s.workspace_id).neq("status", "completed"),
        admin.from("reminder_log").select("action_id, reason, sent_at").eq("user_id", s.user_id).gte("sent_at", since),
      ]);
      const items: ReminderItem[] = computeReminders((actions ?? []) as ReminderAction[], s, (log ?? []) as LogEntry[], date);
      if (!items.length) { results.push({ user_id: s.user_id, items: 0, sent: false }); continue; }
      await sendEmail(to, renderEmail(items, s, APP_URL));
      await admin.from("reminder_log").insert(items.map((i) => ({ workspace_id: s.workspace_id, user_id: s.user_id, action_id: i.action_id, reason: i.reason })));
      results.push({ user_id: s.user_id, items: items.length, sent: true });
    } catch (e) {
      results.push({ user_id: s.user_id, items: 0, sent: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { date, results };
}
