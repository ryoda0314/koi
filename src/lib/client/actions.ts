// Making new documents: one place for their shape and their time stamp.
import type { Side } from "../avail.ts";
import type { Slot, WishKind } from "../model.ts";
import { newId, write } from "./space.ts";

const cut = (s: string | undefined, n: number) => (s || "").trim().slice(0, n);

/** A thing to do on a plan's day. `order` keeps several added at once in their order. */
export function addStep(planId: string, s: { time?: string; text: string; place?: string; wish?: string }, by: Side | null, order = 0) {
  return write("set", `plans/${planId}/steps/${newId()}`, {
    time: s.time || "", text: cut(s.text, 60), place: cut(s.place, 60), wish: s.wish || "", by: by || "", createdAt: Date.now() + order,
  });
}

/** A wish, with the ♡ of whoever added it (none for the AI's ideas). */
export function addWish(w: { title: string; kind: WishKind; area?: string; note?: string }, by: Side | null, liked: boolean, order = 0) {
  return write("set", `wishes/${newId()}`, {
    title: cut(w.title, 60), kind: w.kind, area: cut(w.area, 40), note: cut(w.note, 200), url: "",
    likes: liked && by ? { [by]: true } : {}, done: false, doneAt: "", by: by || "", createdAt: Date.now() + order,
  });
}

/** A day to meet: proposed to the other one, or already set. Resolves to its id, or null when refused. */
export async function addPlan(p: { date: string; slot: Slot; time: string; end: string; title: string; place: string }, status: "proposed" | "set", by: Side | null) {
  const id = newId();
  const ok = await write("set", `plans/${id}`, { ...p, memo: "", status, by: by || "", createdAt: Date.now() });
  return ok ? id : null;
}
