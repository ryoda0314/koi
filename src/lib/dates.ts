// Dates as "YYYY-MM-DD" strings in the phone's own time zone. Pure; tested in tests/dates.test.mjs.

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export const pad = (n: number) => String(n).padStart(2, "0");

export function parseDay(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const today = () => isoDay(new Date());

export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Whole days from a to b (b later: positive). */
export function daysBetween(a: string, b: string): number {
  const x = parseDay(a), y = parseDay(b);
  return x && y ? Math.round((y.getTime() - x.getTime()) / 864e5) : 0;
}

export const weekday = (s: string) => { const d = parseDay(s); return d ? WEEKDAYS[d.getDay()] : ""; };
export const isWeekend = (s: string) => { const d = parseDay(s); return !!d && (d.getDay() === 0 || d.getDay() === 6); };

/** 11月8日（土） */
export function longDay(s: string): string {
  const d = parseDay(s);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）` : "";
}

/** 11/8（土） */
export function shortDay(s: string): string {
  const d = parseDay(s);
  return d ? `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）` : "";
}

/** きょう / あした / あさって / あと12日 / 3日前 */
export function untilLabel(s: string, from = today()): string {
  const n = daysBetween(from, s);
  if (n === 0) return "きょう";
  if (n === 1) return "あした";
  if (n === 2) return "あさって";
  return n > 0 ? `あと${n}日` : `${-n}日前`;
}

/** "2026-11" */
export const monthOf = (s: string) => s.slice(0, 7);

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthTitle(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}

/** The days of a month as a grid from Sunday: whole weeks, days outside the month included. */
export function monthCells(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = addDays(isoDay(first), -first.getDay());
  const days = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((first.getDay() + days) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

/** "HH:MM" -> minutes, or null. */
export function minutes(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  return m ? +m[1] * 60 + +m[2] : null;
}
