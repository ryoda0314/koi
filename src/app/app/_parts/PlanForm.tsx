"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { useCouple } from "@/lib/client/couple";
import { addPlan } from "@/lib/client/actions";
import { toast, write } from "@/lib/client/space";
import { minutes, today } from "@/lib/dates";
import { ja } from "@/lib/i18n/ja";
import type { Plan, Slot } from "@/lib/model";
import styles from "./form.module.css";

export interface PlanDraft { date?: string; slot?: Slot; time?: string; end?: string; title?: string; place?: string }

/**
 * A new day to meet (proposed to the other one, or already set), or the date, time, name and place of one.
 * Opened from a free day, from 予定's ＋, or from a plan's 編集.
 */
export function PlanForm({ open, onClose, draft, plan, onSaved }: {
  open: boolean;
  onClose: () => void;
  draft?: PlanDraft;
  plan?: Plan;
  onSaved?: (id: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={plan ? ja.planForm.editTitle : ja.planForm.newTitle}>
      {open ? <Fields onClose={onClose} draft={draft} plan={plan} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

function Fields({ onClose, draft, plan, onSaved }: { onClose: () => void; draft?: PlanDraft; plan?: Plan; onSaved?: (id: string) => void }) {
  const t = ja.planForm;
  const c = useCouple();
  const src = plan || draft || {};
  const [date, setDate] = useState(src.date || today());
  const [slot, setSlot] = useState<Slot>(src.time ? "" : src.slot ?? "all");
  const [time, setTime] = useState(src.time || "");
  const [end, setEnd] = useState(src.end || "");
  const [title, setTitle] = useState(src.title || "");
  const [place, setPlace] = useState(src.place || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const byTime = slot === "";

  async function save(status?: "proposed" | "set") {
    if (!date) return setErr(t.needDate);
    if (byTime && time && end && (minutes(end) ?? 0) <= (minutes(time) ?? 0)) return setErr(t.endAfter);
    setErr("");
    setBusy(true);
    const body = {
      date, slot: byTime ? "" : slot, time: byTime ? time : "", end: byTime && time ? end : "",
      title: title.trim().slice(0, 40), place: place.trim().slice(0, 60),
    };
    const id = plan ? ((await write("update", `plans/${plan.id}`, body)) ? plan.id : null) : await addPlan(body as Parameters<typeof addPlan>[0], status!, c.me);
    setBusy(false);
    if (!id) return;
    toast(plan ? ja.common.saved : status === "proposed" ? t.proposed(c.them ? c.name(c.them) : "相手") : t.added);
    onClose();
    onSaved?.(id);
  }

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); save(plan ? undefined : "proposed"); }}>
      <div className="field">
        <label htmlFor="pf-date">{t.date}</label>
        <input id="pf-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">{t.when}</span>
        <div className="chips" role="group" aria-label={t.when}>
          {t.slots.map(([v, l]) => (
            <button key={v || "time"} type="button" className="chip" aria-pressed={slot === v} onClick={() => setSlot(v as Slot)}>{l}</button>
          ))}
        </div>
      </div>
      {byTime ? (
        <div className={styles.two}>
          <div className="field">
            <label htmlFor="pf-time">{t.time}</label>
            <input id="pf-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-end">{t.end}</label>
            <input id="pf-end" className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!time} />
          </div>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="pf-title">{t.title}</label>
        <input id="pf-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.titlePh} maxLength={40} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="pf-place">{t.place}</label>
        <input id="pf-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t.placePh} maxLength={60} autoComplete="off" />
      </div>
      {err ? <p className="error" role="alert">{err}</p> : null}
      {plan ? (
        <button type="submit" className="btn" disabled={busy}>{t.save}</button>
      ) : (
        <div className={styles.buttons}>
          <button type="submit" className="btn" disabled={busy}>{t.propose}</button>
          <button type="button" className="btn-quiet" disabled={busy} onClick={() => save("set")}>{t.setNow}</button>
        </div>
      )}
    </form>
  );
}
