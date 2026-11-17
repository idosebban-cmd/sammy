// Date helpers. Dates without times (YYYY-MM-DD) are treated as local calendar days.

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysFromToday(iso: string): number {
  const ms = parseDay(iso).getTime() - parseDay(todayIso()).getTime();
  return Math.round(ms / 86_400_000);
}

export function formatDate(iso: string | null | undefined, opts: { withYear?: boolean } = {}): string {
  if (!iso) return "";
  const d = iso.length > 10 ? new Date(iso) : parseDay(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: opts.withYear || !sameYear ? "numeric" : undefined,
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relativeDue(iso: string): string {
  const n = daysFromToday(iso);
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n === -1) return "1 day overdue";
  if (n < 0) return `${-n} days overdue`;
  if (n <= 14) return `Due in ${n} days`;
  return `Due ${formatDate(iso)}`;
}

export function monthKey(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Turns everyday phrases into a date: "today", "tomorrow", "friday",
 * "next friday", "this friday", "in 3 days", "in 2 weeks", "next week",
 * "end of the week", "end of the month", "21 nov", "21/11". Returns null if
 * it can't be sure. School-term phrases ("before half-term") return null.
 */
export function parseNaturalDate(input: string, today: string = todayIso()): string | null {
  const t = input.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === "today") return today;
  if (t === "tomorrow") return addDaysIso(today, 1);
  const base = parseDay(today);
  const dow = base.getDay();

  const wd = t.match(/^(?:(this|next|by|on)\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/);
  if (wd) {
    const target = WEEKDAYS.findIndex((d) => d.startsWith(wd[2]));
    let diff = (target - dow + 7) % 7;
    if (diff === 0) diff = 7;
    if (wd[1] === "next" && diff < 7 && target > dow) diff += 7; // "next friday" said on a monday = friday week
    return addDaysIso(today, diff);
  }
  const rel = t.match(/^in (\d{1,3}|a|one|two|three|four) (day|days|week|weeks)$/);
  if (rel) {
    const n = ({ a: 1, one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[rel[1]] ?? Number(rel[1]);
    return addDaysIso(today, rel[2].startsWith("week") ? n * 7 : n);
  }
  if (t === "next week") return addDaysIso(today, ((1 - dow + 7) % 7) || 7);
  if (t === "end of the week" || t === "end of week" || t === "this week") return addDaysIso(today, (5 - dow + 7) % 7);
  if (t === "end of the month" || t === "end of month") {
    const d = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dm = t.match(/^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]{3})[a-z]*(?:\s+(\d{4}))?$/)
    ?? t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (dm) {
    const day = Number(dm[1]);
    const month = /^\d+$/.test(dm[2]) ? Number(dm[2]) - 1 : months.indexOf(dm[2]);
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    let year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : base.getFullYear();
    let d = new Date(year, month, day);
    if (d.getMonth() !== month) return null;
    if (!dm[3] && d < base) { year += 1; d = new Date(year, month, day); }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}
