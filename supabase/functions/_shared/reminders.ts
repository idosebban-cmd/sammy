// Decides which reminders a parent should get today. Pure logic, so it can be
// unit-tested; the reminders function handles data loading and sending.

export interface ReminderSettings {
  user_id: string;
  workspace_id: string;
  email: string | null;
  owner_key: "ido" | "helen" | null;
  scope: "mine" | "all";
  due_soon_days: number;
  overdue_repeat_days: number;
  waiting_after_days: number;
  include_titles: boolean;
}

export interface ReminderAction {
  id: string;
  title: string;
  owner: string;
  kind: string;
  status: string;
  due_date: string | null;
  date_confirmed: boolean;
  status_changed_at: string;
}

export interface LogEntry { action_id: string | null; reason: string; sent_at: string }

export interface ReminderItem {
  action_id: string;
  reason: string;     // stored in reminder_log; e.g. "due_soon:2026-11-21", "overdue", "waiting"
  label: string;      // e.g. "Due tomorrow"
  title: string;      // action title (only shown in emails if include_titles)
  sort: number;
}

const PARENTS = new Set(["ido", "helen", "both_parents"]);

function days(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10) + "T00:00:00Z") - Date.parse(fromIso.slice(0, 10) + "T00:00:00Z")) / 86_400_000);
}

export function isRelevant(a: ReminderAction, s: ReminderSettings): boolean {
  if (s.scope === "all") return true;
  if (a.owner === "both_parents" || (s.owner_key && a.owner === s.owner_key)) return true;
  // Responses awaited from school, the LA or professionals concern both parents.
  return a.status === "waiting" && !PARENTS.has(a.owner);
}

export function computeReminders(actions: ReminderAction[], s: ReminderSettings, log: LogEntry[], today: string, ignoreLog = false): ReminderItem[] {
  const lastSent = (actionId: string, reason: string): string | null => {
    if (ignoreLog) return null;
    const hits = log.filter((l) => l.action_id === actionId && l.reason === reason).map((l) => l.sent_at).sort();
    return hits.at(-1) ?? null;
  };
  const items: ReminderItem[] = [];
  for (const a of actions) {
    if (a.status === "completed" || !isRelevant(a, s)) continue;

    if (a.due_date) {
      const n = days(today, a.due_date);
      if (n < 0) {
        const last = lastSent(a.id, "overdue");
        if (!last || days(last, today) >= s.overdue_repeat_days) {
          items.push({ action_id: a.id, reason: "overdue", label: `Overdue by ${-n} day${n === -1 ? "" : "s"}`, title: a.title, sort: n });
        }
        continue;
      }
      const window = a.kind === "appointment" ? Math.max(1, s.due_soon_days) : s.due_soon_days;
      if (n <= window) {
        const reason = `${a.kind === "appointment" ? "appointment" : "due_soon"}:${a.due_date}`;
        if (!lastSent(a.id, reason)) {
          const when = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
          items.push({ action_id: a.id, reason, label: a.kind === "appointment" ? `Appointment ${when}` : `Due ${when}`, title: a.title, sort: n });
        }
        continue;
      }
      if (!a.date_confirmed && n <= s.due_soon_days + 7) {
        const reason = `confirm:${a.due_date}`;
        if (!lastSent(a.id, reason)) items.push({ action_id: a.id, reason, label: "Date needs confirming", title: a.title, sort: 50 + n });
      }
    }

    if (a.status === "waiting") {
      const waited = days(a.status_changed_at, today);
      if (waited >= s.waiting_after_days) {
        const last = lastSent(a.id, "waiting");
        if (!last || days(last, today) >= s.waiting_after_days) {
          items.push({ action_id: a.id, reason: "waiting", label: `Waiting for a reply for ${waited} days`, title: a.title, sort: 100 });
        }
      }
    }
  }
  return items.sort((x, y) => x.sort - y.sort);
}

export function renderEmail(items: ReminderItem[], s: ReminderSettings, appUrl: string): { subject: string; text: string; html: string } {
  const n = items.length;
  const subject = `Reminder: ${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
  const line = (i: ReminderItem) => `${i.label}${s.include_titles ? `: ${i.title}` : ""}`;
  const link = (i: ReminderItem) => `${appUrl.replace(/\/$/, "")}/actions?id=${i.action_id}`;
  const text = [
    "Here's what needs attention:", "",
    ...items.map((i) => `- ${line(i)}\n  ${link(i)}`),
    "", `Change or turn off reminders: ${appUrl.replace(/\/$/, "")}/settings`,
  ].join("\n");
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#292524;line-height:1.5">
<p>Here's what needs attention:</p><ul style="padding-left:18px">${items.map((i) => `<li style="margin-bottom:8px"><a href="${esc(link(i))}" style="color:#416a51">${esc(line(i))}</a></li>`).join("")}</ul>
<p style="font-size:12px;color:#78716c"><a href="${esc(appUrl.replace(/\/$/, ""))}/settings" style="color:#78716c">Change or turn off reminders</a></p></div>`;
  return { subject, text, html };
}
