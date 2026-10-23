// Free time: each of the two marks a day as all day, daytime, evening or not free. Pure; tested.

export type Mark = "all" | "day" | "night" | "no";
export type Side = "a" | "b";

export const MARKS: { key: Mark; label: string; short: string }[] = [
  { key: "all", label: "終日", short: "◯" },
  { key: "day", label: "昼", short: "昼" },
  { key: "night", label: "夜", short: "夜" },
  { key: "no", label: "むり", short: "✕" },
];

export const isMark = (v: unknown): v is Mark => v === "all" || v === "day" || v === "night" || v === "no";
export const markOf = (v: unknown): Mark | null => (isMark(v) ? v : null);
export const markLabel = (m: Mark | null) => MARKS.find((x) => x.key === m)?.label ?? "未定";
export const markShort = (m: Mark | null) => MARKS.find((x) => x.key === m)?.short ?? "";

/** When the two can meet that day: the part of the day both have free, or null. */
export function overlap(a: Mark | null, b: Mark | null): Exclude<Mark, "no"> | null {
  if (!a || !b || a === "no" || b === "no") return null;
  if (a === "all") return b;
  if (b === "all") return a;
  return a === b ? a : null;
}

export const meetLabel = (o: Exclude<Mark, "no">) => (o === "all" ? "終日" : o === "day" ? "昼" : "夜");

export interface AvailDoc {
  a?: Mark | "";
  b?: Mark | "";
  na?: string;
  nb?: string;
}

export interface DayFree {
  date: string;
  a: Mark | null;
  b: Mark | null;
  noteA: string;
  noteB: string;
  both: Exclude<Mark, "no"> | null;
}

export function dayFree(date: string, doc: AvailDoc | undefined): DayFree {
  const a = markOf(doc?.a), b = markOf(doc?.b);
  return { date, a, b, noteA: doc?.na || "", noteB: doc?.nb || "", both: overlap(a, b) };
}
