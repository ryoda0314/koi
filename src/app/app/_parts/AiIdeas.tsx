"use client";

import { useRef, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { useCouple } from "@/lib/client/couple";
import { addStep } from "@/lib/client/actions";
import { askAi, toast, write, type Fail } from "@/lib/client/space";
import { ja } from "@/lib/i18n/ja";
import type { Plan } from "@/lib/model";
import styles from "./ai.module.css";

interface Idea { title: string; summary: string; budget: string; steps: { time: string; text: string; place: string }[] }

const errorText = (e: unknown) => ja.ai.errors[(e as Fail)?.code] || ja.ai.errors.default;

/** The shared inputs of both AI sheets: where, how much, what mood. */
export function AiOptions({ area, setArea, budget, setBudget, moods, setMoods, withBudget = true }: {
  area: string; setArea: (v: string) => void;
  budget: string; setBudget: (v: string) => void;
  moods: string[]; setMoods: (v: string[]) => void;
  withBudget?: boolean;
}) {
  const t = ja.ai;
  return (
    <>
      <div className="field">
        <label htmlFor="ai-area">{t.area}</label>
        <input id="ai-area" className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t.areaPh} maxLength={40} autoComplete="off" />
      </div>
      {withBudget ? (
        <div className="field">
          <span className="label">{t.budget}</span>
          <div className="chips" role="group" aria-label={t.budget}>
            {t.budgets.map(([v, l]) => <button key={v || "any"} type="button" className="chip" aria-pressed={budget === v} onClick={() => setBudget(v)}>{l}</button>)}
          </div>
        </div>
      ) : null}
      <div className="field">
        <span className="label">{t.mood}</span>
        <div className="chips" role="group" aria-label={t.mood}>
          {t.moods.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={moods.includes(m)}
              onClick={() => setMoods(moods.includes(m) ? moods.filter((x) => x !== m) : [...moods, m])}>{m}</button>
          ))}
        </div>
      </div>
    </>
  );
}

/** AIに案をもらう: three ways to spend this day, from GPT-5.2; one of them goes into the plan. */
export function AiIdeas({ open, onClose, plan }: { open: boolean; onClose: () => void; plan: Plan }) {
  return (
    <Sheet open={open} onClose={onClose} title={ja.ai.ideasTitle}>
      {open ? <Ideas plan={plan} onClose={onClose} /> : null}
    </Sheet>
  );
}

function Ideas({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const t = ja.ai;
  const c = useCouple();
  const [area, setArea] = useState(plan.place);
  const [budget, setBudget] = useState("");
  const [moods, setMoods] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const ctl = useRef<AbortController | null>(null);

  async function ask() {
    setBusy(true);
    setErr("");
    ctl.current = new AbortController();
    try {
      const r = await askAi<{ ideas: Idea[] }>("ideas", { planId: plan.id, options: { area, budget, moods } }, ctl.current.signal);
      if (!r?.ideas?.length) throw { code: "empty" };
      setIdeas(r.ideas.slice(0, 3));
    } catch (e) {
      if ((e as Fail).code !== "cancelled") setErr(errorText(e));
    } finally {
      setBusy(false);
      ctl.current = null;
    }
  }

  async function adopt(idea: Idea) {
    setBusy(true);
    if (!plan.title) await write("update", `plans/${plan.id}`, { title: idea.title.slice(0, 40) });
    let n = 0;
    for (const s of idea.steps.slice(0, 8)) {
      const time = /^\d{1,2}:\d{2}$/.test(s.time) ? s.time.padStart(5, "0") : "";
      await addStep(plan.id, { time, text: s.text, place: s.place }, c.me, n++);
    }
    setBusy(false);
    toast(t.used);
    onClose();
  }

  return (
    <>
      {!ideas ? (
        <>
          <AiOptions area={area} setArea={setArea} budget={budget} setBudget={setBudget} moods={moods} setMoods={setMoods} />
          <button type="button" className="btn" onClick={ask} disabled={busy}>{t.askIdeas}</button>
        </>
      ) : (
        <>
          {ideas.map((idea, i) => (
            <article key={i} className={styles.idea}>
              <h3 className={styles.ideaTitle}>{idea.title}</h3>
              <p className={styles.ideaSummary}>{idea.summary}</p>
              <ol className={styles.ideaSteps}>
                {idea.steps.map((s, j) => (
                  <li key={j}><span className={styles.time}>{s.time || "—"}</span><span>{s.text}{s.place ? <small className={styles.place}>{s.place}</small> : null}</span></li>
                ))}
              </ol>
              <div className={styles.ideaFoot}>
                {idea.budget ? <span className={styles.budget}>{idea.budget}</span> : <span />}
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => adopt(idea)}>{t.use}</button>
              </div>
            </article>
          ))}
          <button type="button" className="btn-quiet" disabled={busy} onClick={() => setIdeas(null)}>{t.again}</button>
        </>
      )}
      {busy && !ideas ? (
        <div className={styles.busy}>
          <span>{t.thinking}</span>
          <button type="button" className="link-button" onClick={() => ctl.current?.abort()}>{t.stop}</button>
        </div>
      ) : null}
      {err ? <p className="error" role="alert">{err}</p> : null}
      <p className="hint">{t.note}</p>
    </>
  );
}
