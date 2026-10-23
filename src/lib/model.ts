// What the documents mean: members, free days, plans with their steps, wishes. Pure; tested in tests/model.test.mjs.
import { dayFree, type AvailDoc, type DayFree, type Side } from "./avail.ts";
import { addDays, minutes } from "./dates.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Docs = Record<string, any>;

export interface Person {
  name?: string;
  /** the devices (anonymous accounts) that are this person */
  uids?: Record<string, boolean | null>;
}
export interface Members {
  a?: Person;
  b?: Person;
}

export type Slot = "all" | "day" | "night" | "";
export type PlanStatus = "proposed" | "set" | "declined";

export interface Step {
  id: string;
  time: string;
  text: string;
  place: string;
  wish: string;
  by: Side | "";
  createdAt: number;
}

export interface Plan {
  id: string;
  date: string;
  slot: Slot;
  time: string;
  end: string;
  title: string;
  place: string;
  memo: string;
  status: PlanStatus;
  by: Side | "";
  createdAt: number;
  steps: Step[];
}

export type WishKind = "eat" | "go" | "do";
export const WISH_KINDS: { key: WishKind; label: string }[] = [
  { key: "eat", label: "食べたい" },
  { key: "go", label: "行きたい" },
  { key: "do", label: "やりたい" },
];
export const wishKindLabel = (k: string) => WISH_KINDS.find((x) => x.key === k)?.label ?? "やりたい";

export interface Wish {
  id: string;
  title: string;
  kind: WishKind;
  area: string;
  note: string;
  url: string;
  likes: { a?: boolean; b?: boolean };
  done: boolean;
  doneAt: string;
  by: Side | "";
  createdAt: number;
}

export const SIDES: Side[] = ["a", "b"];
export const otherSide = (s: Side): Side => (s === "a" ? "b" : "a");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const side = (v: unknown): Side | "" => (v === "a" || v === "b" ? v : "");

export const membersOf = (docs: Docs): Members | null => (docs["app/members"] as Members) || null;

/** Which of the two this device is: the side listing its account, else what this device chose before. */
export function sideOf(members: Members | null, uid: string | null, chosen: string | null): Side | null {
  if (!members) return null;
  if (uid) for (const s of SIDES) if (members[s]?.uids?.[uid]) return s;
  return chosen === "a" || chosen === "b" ? chosen : null;
}

export const nameOf = (members: Members | null, s: Side) => members?.[s]?.name?.trim() || (s === "a" ? "ひとり目" : "ふたり目");

export function availOf(docs: Docs): Record<string, AvailDoc> {
  const out: Record<string, AvailDoc> = {};
  for (const p in docs) if (p.startsWith("avail/")) out[p.slice(6)] = docs[p];
  return out;
}

const byTime = (a: { time: string; createdAt: number }, b: { time: string; createdAt: number }) =>
  (minutes(a.time) ?? 1e4) - (minutes(b.time) ?? 1e4) || a.createdAt - b.createdAt;

export function plansOf(docs: Docs): Plan[] {
  const plans: Record<string, Plan> = {};
  const steps: Record<string, Step[]> = {};
  for (const p in docs) {
    const parts = p.split("/");
    const d = docs[p];
    if (parts[0] !== "plans" || !d) continue;
    if (parts.length === 2) {
      plans[parts[1]] = {
        id: parts[1], date: str(d.date), slot: (["all", "day", "night"].includes(d.slot) ? d.slot : "") as Slot,
        time: str(d.time), end: str(d.end), title: str(d.title), place: str(d.place), memo: str(d.memo),
        status: d.status === "set" || d.status === "declined" ? d.status : "proposed", by: side(d.by),
        createdAt: +d.createdAt || 0, steps: [],
      };
    } else if (parts.length === 4 && parts[2] === "steps") {
      (steps[parts[1]] ||= []).push({
        id: parts[3], time: str(d.time), text: str(d.text), place: str(d.place), wish: str(d.wish), by: side(d.by),
        createdAt: +d.createdAt || 0,
      });
    }
  }
  return Object.values(plans)
    .map((p) => ({ ...p, steps: (steps[p.id] || []).sort(byTime) }))
    .sort((a, b) => a.date.localeCompare(b.date) || (minutes(a.time) ?? 1e4) - (minutes(b.time) ?? 1e4) || a.createdAt - b.createdAt);
}

export function wishesOf(docs: Docs): Wish[] {
  const out: Wish[] = [];
  for (const p in docs) {
    const d = docs[p];
    if (!p.startsWith("wishes/") || !d) continue;
    out.push({
      id: p.slice(7), title: str(d.title), kind: (["eat", "go", "do"].includes(d.kind) ? d.kind : "do") as WishKind,
      area: str(d.area), note: str(d.note), url: str(d.url),
      likes: { a: !!d.likes?.a, b: !!d.likes?.b }, done: !!d.done, doneAt: str(d.doneAt), by: side(d.by),
      createdAt: +d.createdAt || 0,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export const bothLike = (w: Wish) => !!(w.likes.a && w.likes.b);

/** The days from `from` on (for `span` days) that both have free. */
export function bothFreeDays(avail: Record<string, AvailDoc>, from: string, span = 92): DayFree[] {
  const out: DayFree[] = [];
  for (let i = 0; i < span; i++) {
    const d = addDays(from, i);
    const f = dayFree(d, avail[d]);
    if (f.both) out.push(f);
  }
  return out;
}

/** Days the other one has free while this one has not said anything yet. */
export function waitingOnMe(avail: Record<string, AvailDoc>, me: Side, from: string, span = 62): DayFree[] {
  const out: DayFree[] = [];
  for (let i = 0; i < span; i++) {
    const d = addDays(from, i);
    const f = dayFree(d, avail[d]);
    const mine = me === "a" ? f.a : f.b, theirs = me === "a" ? f.b : f.a;
    if (!mine && theirs && theirs !== "no") out.push(f);
  }
  return out;
}

/** Plans still ahead (a declined proposal stays until it is cleared), soonest first. */
export const upcomingPlans = (plans: Plan[], from: string) => plans.filter((p) => p.date >= from);
export const pastPlans = (plans: Plan[], from: string) => plans.filter((p) => p.date < from && p.status === "set").reverse();
export const nextMeeting = (plans: Plan[], from: string) => plans.find((p) => p.date >= from && p.status === "set") || null;

export const slotLabel = (s: Slot) => (s === "all" ? "終日" : s === "day" ? "昼" : s === "night" ? "夜" : "");
/** 終日 / 18:00〜 / 昼 */
export function whenLabel(p: Pick<Plan, "slot" | "time" | "end">): string {
  if (p.time) return p.end ? `${p.time}〜${p.end}` : `${p.time}〜`;
  return slotLabel(p.slot);
}
