"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Icon } from "@/components/Icon";
import { useCouple } from "@/lib/client/couple";
import { addStep as newStep } from "@/lib/client/actions";
import { toast, write } from "@/lib/client/space";
import { addDays, longDay, minutes, pad, shortDay, today, untilLabel } from "@/lib/dates";
import { ja } from "@/lib/i18n/ja";
import { whenLabel, type Plan } from "@/lib/model";
import { AiIdeas } from "../../_parts/AiIdeas";
import { PlanForm } from "../../_parts/PlanForm";
import { WishPicker } from "../../_parts/WishPicker";
import page from "../../_parts/page.module.css";
import styles from "./plan.module.css";

const mapUrl = (q: string) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);

/** Google Calendar's "add event" page for this day, filled in. */
function calendarUrl(p: Plan, title: string): string {
  const D = (s: string) => s.replace(/-/g, "");
  let dates = `${D(p.date)}/${D(addDays(p.date, 1))}`;
  const t0 = minutes(p.time);
  if (t0 != null) {
    let t1 = minutes(p.end) ?? t0 + 120;
    if (t1 <= t0) t1 = t0 + 120;
    const T = (m: number) => pad(Math.floor(m / 60) % 24) + pad(m % 60) + "00";
    dates = `${D(p.date)}T${T(t0)}/${D(t1 >= 1440 ? addDays(p.date, 1) : p.date)}T${T(t1)}`;
  }
  const details = [...p.steps.map((s) => `${s.time ? s.time + " " : ""}${s.text}`), p.memo].filter(Boolean).join("\n").slice(0, 1500);
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + dates +
    (details ? "&details=" + encodeURIComponent(details) : "") + (p.place ? "&location=" + encodeURIComponent(p.place) : "");
}

export default function PlanPage({ params }: PageProps<"/app/plans/[id]">) {
  const { id } = use(params);
  const t = ja.plan;
  const c = useCouple();
  const { me, them, s } = c;
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [wishes, setWishes] = useState(false);
  const [ai, setAi] = useState(false);
  const [ask, setAsk] = useState(false);
  const [text, setText] = useState("");
  const [time, setTime] = useState("");
  const plan = c.plans.find((p) => p.id === id);
  const [memo, setMemo] = useState<string | null>(null);

  if (!me || !them) return null;
  if (!plan) {
    return (
      <div className={page.page}>
        <header className={page.bar}>
          <Link href="/app" className={page.iconLink} aria-label={ja.common.back}><Icon name="back" /></Link>
          <h1 className={page.barTitle}>{ja.plans.title}</h1>
        </header>
        <div className={page.empty}>
          <p className={page.emptyBody}>{t.notFound}</p>
          <div className={page.actions}><Link href="/app" className="btn-quiet">{t.toPlans}</Link></div>
        </div>
      </div>
    );
  }

  const now = today();
  const title = plan.title || ja.plans.untitled(shortDay(plan.date));
  const path = `plans/${plan.id}`;
  const theirs = plan.by === them;

  async function status(next: "set" | "declined" | "proposed") {
    if (await write("update", path, next === "proposed" ? { status: next, by: me } : { status: next })) {
      toast(next === "set" ? ja.plans.accepted : next === "declined" ? ja.plans.declined : ja.planForm.proposed(c.name(them!)));
    }
  }
  async function remove(note: string) {
    if (await write("delete", path)) { toast(note); router.push("/app"); }
  }
  async function addStep(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText("");
    setTime("");
    await newStep(plan!.id, { time, text: v }, me);
  }
  const saveMemo = () => { if (memo !== null && memo.trim() !== plan.memo) write("update", path, { memo: memo.trim().slice(0, 1000) }); };

  return (
    <div className={page.page}>
      <header className={page.bar}>
        <Link href="/app" className={page.iconLink} aria-label={ja.common.back}><Icon name="back" /></Link>
        <h1 className={page.barTitle}>{title}</h1>
        <div className={page.barActions}>
          <button type="button" className={page.barButton} onClick={() => setEdit(true)}><Icon name="edit" size={16} />{t.edit}</button>
        </div>
      </header>

      <section className={`${page.section} ${styles.head}`}>
        {plan.date >= now ? <span className={styles.until}>{untilLabel(plan.date, now)}</span> : null}
        <p className={styles.date}>{longDay(plan.date)}</p>
        <p className={styles.when}>
          {whenLabel(plan) ? <span className={styles.meta}><Icon name="clock" size={16} />{whenLabel(plan)}</span> : null}
          {plan.place ? (
            <a className={styles.meta} href={mapUrl(plan.place)} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={16} />{plan.place}</a>
          ) : null}
        </p>

        {plan.status === "proposed" ? (
          <div className={theirs ? styles.ask : styles.wait}>
            <p className={styles.askText}>{theirs ? t.fromThem(c.name(them)) : t.waitingThem(c.name(them))}</p>
            <div className={page.actions}>
              {theirs ? (
                <>
                  <button type="button" className="btn btn-small" onClick={() => status("set")}>{ja.plans.accept}</button>
                  <button type="button" className="btn-quiet btn-small" onClick={() => status("declined")}>{ja.plans.decline}</button>
                </>
              ) : (
                <button type="button" className="btn-quiet btn-small" onClick={() => remove(t.withdrawn)}>{t.withdraw}</button>
              )}
            </div>
          </div>
        ) : plan.status === "declined" ? (
          <div className={styles.wait}>
            <p className={styles.askText}>{theirs ? ja.plans.declined : t.theyDeclined(c.name(them))}</p>
            <div className={page.actions}>
              {!theirs ? <button type="button" className="btn-quiet btn-small" onClick={() => status("proposed")}>{t.proposeAgain}</button> : null}
              <button type="button" className="btn-quiet btn-small" onClick={() => remove(t.cleared)}>{t.clear}</button>
            </div>
          </div>
        ) : (
          <div className={page.actions}>
            <span className={`${page.tag} ${page.tagAccent}`}>{ja.plans.set}</span>
            <a className="link-button" href={calendarUrl(plan, title)} target="_blank" rel="noopener noreferrer">{t.calendar}</a>
          </div>
        )}
      </section>

      <section className={page.section}>
        <h2 className={page.h2}>{t.steps}</h2>
        {plan.steps.length ? (
          <ul className={styles.steps}>
            {plan.steps.map((x) => (
              <li key={x.id} className={styles.step}>
                <span className={styles.stepTime}>{x.time || "—"}</span>
                <span className={styles.stepMain}>
                  <span>{x.text}</span>
                  {x.place ? <a className={styles.stepPlace} href={mapUrl(x.place)} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={14} />{x.place}</a> : null}
                </span>
                <button type="button" className={styles.stepRemove} aria-label={`${x.text}を消す`} onClick={() => write("delete", `${path}/steps/${x.id}`)}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={page.note}>{t.stepsEmpty}</p>
        )}
        <form className={styles.addStep} onSubmit={addStep}>
          <input className={`input ${styles.time}`} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t.timePh} />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t.stepPh} maxLength={60} aria-label={t.steps} />
          <button type="submit" className="btn btn-small" disabled={!text.trim()}>{t.add}</button>
        </form>
        <div className={page.actions}>
          <button type="button" className="btn-quiet btn-small" onClick={() => setWishes(true)}><Icon name="wishes" size={16} />{t.fromWishes}</button>
          {s.ai ? <button type="button" className="btn-quiet btn-small" onClick={() => setAi(true)}><Icon name="spark" size={16} />{t.ai}</button> : null}
        </div>
      </section>

      <section className={page.section}>
        <label className={page.h2} htmlFor="memo">{t.memo}</label>
        <textarea id="memo" className="input" rows={3} value={memo ?? plan.memo} onChange={(e) => setMemo(e.target.value)} onBlur={saveMemo} placeholder={t.memoPh} maxLength={1000} />
      </section>

      {plan.status === "set" ? (
        <section className={page.section}>
          {ask ? (
            <div className={styles.confirm}>
              <p className={page.note}>{t.clearAsk}</p>
              <div className={page.actions}>
                <button type="button" className="btn btn-small btn-danger" onClick={() => remove(t.cleared)}>{ja.common.delete}</button>
                <button type="button" className="btn-quiet btn-small" onClick={() => setAsk(false)}>{ja.common.cancel}</button>
              </div>
            </div>
          ) : (
            <button type="button" className={`link-danger ${styles.clear}`} onClick={() => setAsk(true)}>{t.clear}</button>
          )}
        </section>
      ) : null}

      <PlanForm open={edit} onClose={() => setEdit(false)} plan={plan} />
      <WishPicker open={wishes} onClose={() => setWishes(false)} plan={plan} />
      <AiIdeas open={ai} onClose={() => setAi(false)} plan={plan} />
    </div>
  );
}
