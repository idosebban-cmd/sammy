import { computeReminders, type ReminderAction, type ReminderSettings, renderEmail } from "../reminders.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const S: ReminderSettings = {
  user_id: "u1", workspace_id: "w", email: "ido@example.com", owner_key: "ido", scope: "mine",
  due_soon_days: 2, overdue_repeat_days: 3, waiting_after_days: 7, include_titles: false,
};
const TODAY = "2026-11-17";
const act = (p: Partial<ReminderAction>): ReminderAction => ({
  id: p.id ?? "a", title: p.title ?? "Send OT report", owner: "ido", kind: "task", status: "todo", due_date: null,
  date_confirmed: true, status_changed_at: "2026-11-01T10:00:00Z", ...p,
});

Deno.test("due soon, overdue, appointment, waiting and confirm reminders", () => {
  const items = computeReminders([
    act({ id: "soon", due_date: "2026-11-18" }),
    act({ id: "later", due_date: "2026-11-30" }),
    act({ id: "late", due_date: "2026-11-14" }),
    act({ id: "appt", kind: "appointment", due_date: "2026-11-18", owner: "both_parents" }),
    act({ id: "wait", status: "waiting", owner: "school", status_changed_at: "2026-11-05T09:00:00Z" }),
    act({ id: "confirm", due_date: "2026-11-24", date_confirmed: false }),
    act({ id: "helens", owner: "helen", due_date: "2026-11-18" }),
    act({ id: "done", status: "completed", due_date: "2026-11-10" }),
  ], S, [], TODAY);
  const ids = items.map((i) => i.action_id);
  assert(ids.join() === "late,soon,appt,confirm,wait", ids.join());
  assert(items[0].label === "Overdue by 3 days", items[0].label);
  assert(items[1].label === "Due tomorrow", items[1].label);
  assert(items[2].label === "Appointment tomorrow", items[2].label);
  assert(items[4].label === "Waiting for a reply for 12 days", items[4].label);
});

Deno.test("no repeat reminders before their interval", () => {
  const actions = [act({ id: "soon", due_date: "2026-11-18" }), act({ id: "late", due_date: "2026-11-14" })];
  const log = [
    { action_id: "soon", reason: "due_soon:2026-11-18", sent_at: "2026-11-16T07:00:00Z" },
    { action_id: "late", reason: "overdue", sent_at: "2026-11-15T07:00:00Z" },
  ];
  assert(computeReminders(actions, S, log, TODAY).length === 0, "both suppressed");
  assert(computeReminders(actions, S, log, "2026-11-18").map((i) => i.action_id).join() === "late", "overdue repeats after 3 days");
  // a changed due date is a new reminder
  assert(computeReminders([act({ id: "soon", due_date: "2026-11-19" })], S, log, TODAY).length === 1, "new date → new reminder");
});

Deno.test("scope 'all' includes the other parent's actions", () => {
  const items = computeReminders([act({ id: "helens", owner: "helen", due_date: "2026-11-18" })], { ...S, scope: "all" }, [], TODAY);
  assert(items.length === 1, "included");
});

Deno.test("emails contain no action titles unless opted in", () => {
  const items = computeReminders([act({ id: "x1", title: "Send Sammy's OT report", due_date: "2026-11-18" })], S, [], TODAY);
  const plain = renderEmail(items, S, "https://app.example");
  assert(!plain.text.includes("OT report") && !plain.html.includes("Sammy"), "no titles by default");
  assert(plain.text.includes("https://app.example/actions?id=x1"), "links to the action");
  assert(plain.subject === "Reminder: 1 item needs attention", plain.subject);
  const withTitles = renderEmail(items, { ...S, include_titles: true }, "https://app.example");
  assert(withTitles.text.includes("OT report"), "titles when opted in");
  assert(withTitles.html.includes("Sammy&#39;s") || withTitles.html.includes("Sammy's"), "escaped html");
});
