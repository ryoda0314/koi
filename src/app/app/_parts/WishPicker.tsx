"use client";

import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useCouple } from "@/lib/client/couple";
import { addStep } from "@/lib/client/actions";
import { toast } from "@/lib/client/space";
import { shortDay } from "@/lib/dates";
import { ja } from "@/lib/i18n/ja";
import { bothLike, wishKindLabel, type Plan } from "@/lib/model";
import page from "./page.module.css";

/** したいことから: put a wish into this day's plan (the ones both ♡ first). */
export function WishPicker({ open, onClose, plan }: { open: boolean; onClose: () => void; plan: Plan }) {
  const c = useCouple();
  const inPlan = new Set(plan.steps.map((s) => s.wish).filter(Boolean));
  const list = c.wishes.filter((w) => !w.done);
  const ranked = [...list.filter(bothLike), ...list.filter((w) => !bothLike(w))];
  async function add(id: string) {
    const w = c.wishes.find((x) => x.id === id);
    if (!w) return;
    if (await addStep(plan.id, { text: w.title, place: w.area, wish: w.id }, c.me)) {
      toast(ja.wishes.putIn(shortDay(plan.date)));
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={ja.plan.fromWishes}>
      {ranked.length ? (
        <ul className={page.rows}>
          {ranked.map((w) => (
            <li key={w.id}>
              <button type="button" className={page.row} disabled={inPlan.has(w.id)} onClick={() => add(w.id)}>
                <span className={page.rowMain}>
                  <span className={page.rowTitle}>{w.title}</span>
                  <span className={page.rowSub}>{[wishKindLabel(w.kind), w.area, bothLike(w) ? ja.wishes.groups.both : ""].filter(Boolean).join("・")}</span>
                </span>
                {inPlan.has(w.id) ? <Icon name="check" size={18} /> : <Icon name="plus" size={18} />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={page.note}>{ja.wishes.emptyBody}</p>
      )}
    </Sheet>
  );
}
