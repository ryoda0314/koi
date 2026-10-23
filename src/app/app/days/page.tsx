"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useCouple } from "@/lib/client/couple";
import { write } from "@/lib/client/space";
import { dayFree, MARKS, markLabel, markShort, meetLabel, type Mark } from "@/lib/avail";
import { longDay, monthCells, monthOf, monthTitle, shiftMonth, shortDay, today, WEEKDAYS } from "@/lib/dates";
import { ja } from "@/lib/i18n/ja";
import { bothFreeDays, waitingOnMe, whenLabel, type Plan, type Slot } from "@/lib/model";
import { PlanForm, type PlanDraft } from "../_parts/PlanForm";
import page from "../_parts/page.module.css";
import styles from "./days.module.css";

/** 空いてる日: each marks their own free days; the days both are free come out in blue, ready to propose. */
export default function Days() {
  const t = ja.days;
  const c = useCouple();
  const { me, them, avail, plans } = c;
  const now = today();
  const [ym, setYm] = useState(monthOf(now));
  const [paint, setPaint] = useState(false);
  const [brush, setBrush] = useState<Mark | "">("all");
  const [day, setDay] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);

  if (!me || !them) return null;
  const mineOf = (d: string) => dayFree(d, avail[d])[me];
  const theirsOf = (d: string) => dayFree(d, avail[d])[them];
  const plansOn = (d: string) => plans.filter((p) => p.date === d && p.status !== "declined");
  const setMine = (d: string, m: Mark | "") => write("merge", `avail/${d}`, { [me]: m });

  function tap(d: string) {
    if (!paint) return setDay(d);
    if (d < now) return;
    const cur = mineOf(d);
    setMine(d, brush === "" || cur === brush ? "" : brush);
  }

  const free = bothFreeDays(avail, now, 92);
  const waiting = waitingOnMe(avail, me, now, 62);
  const propose = (d: string, slot: Slot) => setDraft({ date: d, slot });

  return (
    <div className={page.page}>
      <header className={page.bar}>
        <h1 className={page.barTitle}>{t.title}</h1>
        <div className={page.barActions}>
          <button type="button" className={page.barButton} aria-pressed={paint} onClick={() => setPaint(!paint)}>
            {paint ? <Icon name="check" size={16} /> : <Icon name="edit" size={16} />}
            {paint ? t.done : t.paint}
          </button>
        </div>
      </header>
      <p className={page.lead}>{t.lead}</p>

      <section className={styles.calendar} aria-label={monthTitle(ym)}>
        <div className={styles.month}>
          <button type="button" className={styles.navButton} onClick={() => setYm(shiftMonth(ym, -1))} aria-label={t.prev}><Icon name="back" /></button>
          <h2 className={styles.monthTitle}>{monthTitle(ym)}</h2>
          <button type="button" className={styles.navButton} onClick={() => setYm(shiftMonth(ym, 1))} aria-label={t.next}><Icon name="next" /></button>
          {ym !== monthOf(now) ? <button type="button" className={`link-button ${styles.thisMonth}`} onClick={() => setYm(monthOf(now))}>{t.thisMonth}</button> : null}
        </div>

        {paint ? (
          <div className={styles.brush}>
            <div className="chips" role="group" aria-label={t.brushHint}>
              {MARKS.map((m) => (
                <button key={m.key} type="button" className="chip" aria-pressed={brush === m.key} onClick={() => setBrush(m.key)}>
                  {m.key === "all" || m.key === "no" ? `${m.short} ${m.label}` : m.label}
                </button>
              ))}
              <button type="button" className="chip" aria-pressed={brush === ""} onClick={() => setBrush("")}>{t.clear}</button>
            </div>
            <p className="hint">{t.brushHint}</p>
          </div>
        ) : null}

        <div className={styles.grid} role="grid">
          {WEEKDAYS.map((w, i) => (
            <span key={w} role="columnheader" className={i === 0 || i === 6 ? `${styles.wk} ${styles.wkEnd}` : styles.wk}>{w}</span>
          ))}
          {monthCells(ym).map((d) => {
            const f = dayFree(d, avail[d]);
            const mine = f[me], theirs = f[them];
            const out = monthOf(d) !== ym;
            const past = d < now;
            const hasPlan = plansOn(d).length > 0;
            const cls = [styles.cell, out && styles.out, past && styles.past, f.both && !past && styles.both, d === now && styles.today, paint && !past && styles.paintable]
              .filter(Boolean).join(" ");
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                className={cls}
                onClick={() => tap(d)}
                aria-label={`${longDay(d)} ${ja.days.you}${markLabel(mine)}、${c.name(them)}${markLabel(theirs)}${f.both ? "、ふたりとも空いています" : ""}${hasPlan ? "、予定あり" : ""}`}
              >
                <span className={styles.num}>{+d.slice(8)}</span>
                {!out ? (
                  <span className={styles.marks} aria-hidden="true">
                    <span className={mine === "no" ? styles.no : styles.mine}>{markShort(mine)}</span>
                    <span className={theirs === "no" ? styles.no : styles.theirs}>{markShort(theirs)}</span>
                  </span>
                ) : null}
                {hasPlan && !out ? <span className={styles.planBar} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        <p className={styles.legend}>
          <span><span className={styles.mine}>左</span>が{ja.days.you}、<span className={styles.theirs}>右</span>が{c.name(them)}（◯ 終日・昼・夜・✕ むり）</span>
          <span className={styles.legendBoth}><span className={styles.swatch} aria-hidden="true" />{t.legendBoth}</span>
        </p>
      </section>

      <section className={page.section}>
        <h2 className={page.h2}>{t.free}<span className="count">{free.length ? free.length : ""}</span></h2>
        {free.length ? (
          <ul className={page.rows}>
            {free.slice(0, 14).map((f) => {
              const there = plansOn(f.date);
              return (
                <li key={f.date}>
                  <div className={page.row}>
                    <button type="button" className={styles.freeMain} onClick={() => setDay(f.date)}>
                      <span className={page.rowTitle}>{longDay(f.date)}</span>
                      <span className={page.rowSub}>{meetLabel(f.both!)}{f.noteA || f.noteB ? `・${[f.noteA, f.noteB].filter(Boolean).join(" / ")}` : ""}</span>
                    </button>
                    {there.length ? (
                      <Link href={`/app/plans/${there[0].id}`} className={`${page.tag} ${page.tagAccent}`}>{t.hasPlan}</Link>
                    ) : (
                      <button type="button" className="btn-quiet btn-small" onClick={() => propose(f.date, f.both!)}>{t.propose}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={page.note}>{t.freeEmpty}</p>
        )}
      </section>

      {waiting.length ? (
        <section className={page.section}>
          <h2 className={page.h2}>{t.waitingOnMe(c.name(them))}</h2>
          <div className="chips">
            {waiting.slice(0, 16).map((f) => (
              <button key={f.date} type="button" className={`chip ${styles.waitChip}`} onClick={() => setDay(f.date)}>
                {shortDay(f.date)}<span className={styles.theirs}>{markShort(theirsOf(f.date))}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <DaySheet date={day} onClose={() => setDay(null)} onPropose={(d, s) => { setDay(null); propose(d, s); }} plansOn={plansOn} setMine={setMine} />
      <PlanForm open={!!draft} onClose={() => setDraft(null)} draft={draft || undefined} />
    </div>
  );
}

/** One day: your free time (and a note), theirs, the plans that day, and proposing it when both are free. */
function DaySheet({ date, onClose, onPropose, plansOn, setMine }: {
  date: string | null;
  onClose: () => void;
  onPropose: (d: string, s: Slot) => void;
  plansOn: (d: string) => Plan[];
  setMine: (d: string, m: Mark | "") => void;
}) {
  return (
    <Sheet open={!!date} onClose={onClose} title={date ? longDay(date) : ""}>
      {date ? <DayBody key={date} date={date} onPropose={onPropose} plansOn={plansOn} setMine={setMine} /> : null}
    </Sheet>
  );
}

function DayBody({ date, onPropose, plansOn, setMine }: {
  date: string;
  onPropose: (d: string, s: Slot) => void;
  plansOn: (d: string) => Plan[];
  setMine: (d: string, m: Mark | "") => void;
}) {
  const t = ja.days;
  const c = useCouple();
  const me = c.me!, them = c.them!;
  const f = dayFree(date, c.avail[date]);
  const mine = f[me], theirs = f[them];
  const noteMine = me === "a" ? f.noteA : f.noteB, noteTheirs = me === "a" ? f.noteB : f.noteA;
  const [note, setNote] = useState(noteMine);
  const past = date < today();
  const there = plansOn(date);
  const saveNote = () => { if (note.trim() !== noteMine) write("merge", `avail/${date}`, { [me === "a" ? "na" : "nb"]: note.trim().slice(0, 40) }); };
  return (
    <>
      <div className={styles.person}>
        <p className="label">{t.you}</p>
        <div className="chips" role="group" aria-label={t.you}>
          {MARKS.map((m) => (
            <button key={m.key} type="button" className="chip" aria-pressed={mine === m.key} disabled={past} onClick={() => setMine(date, mine === m.key ? "" : m.key)}>
              {m.key === "all" || m.key === "no" ? `${m.short} ${m.label}` : m.label}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={!mine} disabled={past} onClick={() => setMine(date, "")}>{t.unset}</button>
        </div>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder={t.notePh} maxLength={40} aria-label={t.notePh} disabled={past} />
      </div>
      <div className={styles.person}>
        <p className={`label ${styles.theirs}`}>{c.name(them)}</p>
        <p className={styles.theirLine}>{markLabel(theirs)}{noteTheirs ? `・${noteTheirs}` : ""}</p>
      </div>
      {there.length ? (
        <div className={styles.person}>
          <p className="label">{t.plansThatDay}</p>
          <ul className={page.rows}>
            {there.map((p) => (
              <li key={p.id}>
                <Link href={`/app/plans/${p.id}`} className={page.row}>
                  <span className={page.rowMain}>
                    <span className={page.rowTitle}>{p.title || ja.plans.untitled(shortDay(p.date))}</span>
                    <span className={page.rowSub}>{[whenLabel(p), p.place].filter(Boolean).join("・")}</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {f.both && !past && !there.length ? (
        <button type="button" className="btn" onClick={() => onPropose(date, f.both!)}>{t.proposeThis}（{meetLabel(f.both)}）</button>
      ) : null}
    </>
  );
}
