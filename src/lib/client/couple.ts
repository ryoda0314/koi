// What every screen reads: the two, which one this device is, and the documents as plans, wishes and free days.
import { useMemo } from "react";
import type { Side } from "../avail.ts";
import { availOf, membersOf, nameOf, otherSide, plansOf, sideOf, wishesOf } from "../model.ts";
import { useSpace } from "./space.ts";

export const chosenKey = (spaceId: string) => `koyomi:me:${spaceId}`;

export function useCouple() {
  const s = useSpace();
  return useMemo(() => {
    const members = membersOf(s.docs);
    let chosen: string | null = null;
    try { chosen = s.spaceId ? localStorage.getItem(chosenKey(s.spaceId)) : null; } catch { /* private mode */ }
    const me = sideOf(members, s.uid, chosen);
    const them: Side | null = me ? otherSide(me) : null;
    return {
      s,
      members,
      me,
      them,
      name: (side: Side) => nameOf(members, side),
      plans: plansOf(s.docs),
      wishes: wishesOf(s.docs),
      avail: availOf(s.docs),
    };
  }, [s]);
}
export type Couple = ReturnType<typeof useCouple>;
