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
