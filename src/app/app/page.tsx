"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useCouple } from "@/lib/client/couple";
import { toast, write } from "@/lib/client/space";
import { meetLabel } from "@/lib/avail";
import { longDay, shortDay, today, untilLabel } from "@/lib/dates";
import { ja } from "@/lib/i18n/ja";
import { bothFreeDays, nextMeeting, pastPlans, upcomingPlans, whenLabel, type Plan, type Slot } from "@/lib/model";
import { PlanForm, type PlanDraft } from "./_parts/PlanForm";
import page from "./_parts/page.module.css";
import styles from "./plans.module.css";

/** 予定: what the other one proposed, the next day you meet, what is coming, and the days you could meet. */
export default function Plans() {
  const t = ja.plans;
  const c = useCouple();
  const { me, them, plans, avail, s } = c;
  const router = useRouter();
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [showPast, setShowPast] = useState(false);
  if (!me || !them) return null;

  const now = today();
  const ahead = upcomingPlans(plans, now);
  const asks = ahead.filter((p) => p.status === "proposed" && p.by === them);
  const next = nextMeeting(plans, now);
  const rest = ahead.filter((p) => p !== next && !asks.includes(p));
  const past = pastPlans(plans, now);
  const free = bothFreeDays(avail, now, 62).filter((f) => !plans.some((p) => p.date === f.date && p.status !== "declined")).slice(0, 4);
  const here = s.here.includes(them);

  async function answer(p: Plan, yes: boolean) {
    if (await write("update", `plans/${p.id}`, { status: yes ? "set" : "declined" })) toast(yes ? t.accepted : t.declined);
  }

  return (
    <div className={page.page}>
      <header className={page.bar}>
        <h1 className={page.barTitle}>{t.title}</h1>
        <div className={page.barActions}>
          {here ? <span className={page.here}>{ja.common.here(c.name(them))}</span> : null}
          <button type="button" className={page.barButton} onClick={() => setDraft({})}><Icon name="plus" size={16} />{t.add}</button>
        </div>
      </header>

      {asks.length ? (
        <section className={page.section}>
          <h2 className={page.h2}>{t.proposalsFrom(c.name(them))}</h2>
          {asks.map((p) => (
            <div key={p.id} className={styles.ask}>
              <Link href={`/app/plans/${p.id}`} className={styles.askMain}>
                <span className={styles.askDate}>{longDay(p.date)}</span>
                <span className={styles.askSub}>{[whenLabel(p), p.title, p.place].filter(Boolean).join("・")}</span>
              </Link>
              <div className={page.actions}>
                <button type="button" className="btn btn-small" onClick={() => answer(p, true)}>{t.accept}</button>
                <button type="button" className="btn-quiet btn-small" onClick={() => answer(p, false)}>{t.decline}</button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {next ? (
        <section className={page.section}>
          <h2 className={page.h2}>{t.next}</h2>
          <Link href={`/app/plans/${next.id}`} className={styles.next}>
            <span className={styles.until}>{untilLabel(next.date, now)}</span>
            <span className={styles.nextDate}>{longDay(next.date)}</span>
            <span className={styles.nextWhen}>{[whenLabel(next), next.place].filter(Boolean).join("・")}</span>
            {next.title ? <span className={styles.nextTitle}>{next.title}</span> : null}
            {next.steps.length ? (
              <ul className={styles.nextSteps}>
                {next.steps.slice(0, 4).map((x) => <li key={x.id}>{x.time ? <span className={styles.stepTime}>{x.time}</span> : null}{x.text}</li>)}
                {next.steps.length > 4 ? <li className={styles.more}>…ほか{next.steps.length - 4}つ</li> : null}
              </ul>
            ) : null}
          </Link>
        </section>
      ) : null}

      {rest.length ? (
        <section className={page.section}>
          <h2 className={page.h2}>{t.upcoming}</h2>
          <ul className={page.rows}>
            {rest.map((p) => (
              <li key={p.id}>
                <Link href={`/app/plans/${p.id}`} className={page.row}>
                  <span className={styles.rowDate}>{shortDay(p.date)}</span>
                  <span className={page.rowMain}>
                    <span className={page.rowTitle}>{p.title || [whenLabel(p), p.place].filter(Boolean).join("・") || t.untitled(shortDay(p.date))}</span>
                    {p.title ? <span className={page.rowSub}>{[whenLabel(p), p.place].filter(Boolean).join("・")}</span> : null}
                  </span>
                  {p.status === "proposed" ? <span className={page.tag}>{t.waiting}</span>
                    : p.status === "declined" ? <span className={`${page.tag} ${page.tagPartner}`}>{t.theyDeclined}</span>
                    : <span className={`${page.tag} ${page.tagAccent}`}>{untilLabel(p.date, now)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!ahead.length ? (
        <div className={page.empty}>
          <p className={page.emptyTitle}>{t.emptyTitle}</p>
          <p className={page.emptyBody}>{t.emptyBody}</p>
          {!free.length ? <div className={page.actions}><Link href="/app/days" className="btn">{t.emptyDays}</Link></div> : null}
        </div>
      ) : null}

      {free.length ? (
        <section className={page.section}>
          <h2 className={page.h2}>{t.freeTitle}</h2>
          <ul className={page.rows}>
            {free.map((f) => (
              <li key={f.date}>
                <div className={page.row}>
                  <span className={page.rowMain}>
                    <span className={page.rowTitle}>{longDay(f.date)}</span>
                    <span className={page.rowSub}>{meetLabel(f.both!)}</span>
                  </span>
                  <button type="button" className="btn-quiet btn-small" onClick={() => setDraft({ date: f.date, slot: f.both as Slot })}>{t.propose}</button>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/app/days" className={`link-button ${styles.toDays}`}>{t.seeDays}</Link>
        </section>
      ) : null}

      {past.length ? (
        <section className={page.section}>
          <button type="button" className={`link-button ${styles.pastToggle}`} onClick={() => setShowPast(!showPast)}>
            {showPast ? t.hidePast : t.past(past.length)}
          </button>
          {showPast ? (
            <ul className={page.rows}>
              {past.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/plans/${p.id}`} className={page.row}>
                    <span className={styles.rowDate}>{shortDay(p.date)}</span>
                    <span className={page.rowMain}><span className={page.rowTitle}>{p.title || t.untitled(shortDay(p.date))}</span></span>
                    <Icon name="chevron" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <PlanForm open={!!draft} onClose={() => setDraft(null)} draft={draft || undefined}
        onSaved={(id) => { if (draft && !draft.date) router.push(`/app/plans/${id}`); }} />
    </div>
  );
}
