"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useCouple } from "@/lib/client/couple";
import { addStep, addWish } from "@/lib/client/actions";
import { askAi, toast, write, type Fail } from "@/lib/client/space";
import { shortDay, today } from "@/lib/dates";
import { ja } from "@/lib/i18n/ja";
import { bothLike, upcomingPlans, WISH_KINDS, wishKindLabel, type Wish, type WishKind } from "@/lib/model";
import { AiOptions } from "../_parts/AiIdeas";
import page from "../_parts/page.module.css";
import ai from "../_parts/ai.module.css";
import styles from "./wishes.module.css";

type Filter = "all" | "both" | "them" | "done";

/** したいこと: the places, food and things the two would like to do some day, each with their ♡. */
export default function Wishes() {
  const t = ja.wishes;
  const c = useCouple();
  const { me, them, wishes, plans, s } = c;
  const [text, setText] = useState("");
  const [kind, setKind] = useState<WishKind>("go");
  const [filter, setFilter] = useState<Filter>("all");
  const [edit, setEdit] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  if (!me || !them) return null;

  const open = wishes.filter((w) => !w.done);
  const done = wishes.filter((w) => w.done);
  const waitMe = open.filter((w) => w.likes[them] && !w.likes[me]);
  const shown = filter === "both" ? open.filter(bothLike) : filter === "them" ? waitMe : filter === "done" ? done : open;
  const groups: [string, Wish[]][] = filter === "all"
    ? [
        [t.groups.both, open.filter(bothLike)],
        [t.groups.one, open.filter((w) => !bothLike(w) && (w.likes.a || w.likes.b))],
        [t.groups.none, open.filter((w) => !w.likes.a && !w.likes.b)],
      ]
    : [["", shown]];
  const planned = new Map<string, string>();
  for (const p of plans) for (const x of p.steps) if (x.wish && p.date >= today()) planned.set(x.wish, p.date);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText("");
    if (await addWish({ title: v, kind }, me, true)) {
      toast(t.added);
    }
  }
  const like = (w: Wish) => write("merge", `wishes/${w.id}`, { likes: { [me]: !w.likes[me] } });

  return (
    <div className={page.page}>
      <header className={page.bar}>
        <h1 className={page.barTitle}>{t.title}</h1>
        {s.ai ? (
          <div className={page.barActions}>
            <button type="button" className={page.barButton} onClick={() => setAiOpen(true)}><Icon name="spark" size={16} />{t.ai}</button>
          </div>
        ) : null}
      </header>

      <form className={styles.add} onSubmit={add}>
        <div className={styles.addRow}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t.addPh} maxLength={60} aria-label={t.title} />
          <button type="submit" className="btn btn-small" disabled={!text.trim()}>{t.add}</button>
        </div>
        <div className={`chips ${styles.kinds}`} role="group" aria-label={t.fields.kind}>
          {WISH_KINDS.map((k) => <button key={k.key} type="button" className="chip" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>)}
        </div>
      </form>

      {wishes.length ? (
        <div className={`chips ${styles.filters}`} role="group" aria-label="しぼりこみ">
          <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t.filters.all}<span className="count">{open.length}</span></button>
          <button type="button" className="chip" aria-pressed={filter === "both"} onClick={() => setFilter("both")}>{t.filters.both}<span className="count">{open.filter(bothLike).length}</span></button>
          <button type="button" className="chip" aria-pressed={filter === "them"} onClick={() => setFilter("them")}>{t.filters.them(c.name(them))}<span className="count">{waitMe.length}</span></button>
          <button type="button" className="chip" aria-pressed={filter === "done"} onClick={() => setFilter("done")}>{t.filters.done}<span className="count">{done.length}</span></button>
        </div>
      ) : (
        <div className={page.empty}>
          <p className={page.emptyTitle}>{t.emptyTitle}</p>
          <p className={page.emptyBody}>{t.emptyBody}</p>
        </div>
      )}

      {groups.filter(([, list]) => list.length).map(([label, list]) => (
        <section key={label || filter} className={styles.group}>
          {label ? <h2 className={page.h2}>{label}<span className="count">{list.length}</span></h2> : null}
          <ul className={page.rows}>
            {list.map((w) => (
              <li key={w.id} className={styles.item}>
                <button type="button" className={styles.main} onClick={() => setEdit(w.id)}>
                  <span className={styles.kind}>{wishKindLabel(w.kind)}{w.area ? `・${w.area}` : ""}</span>
                  <span className={w.done ? `${styles.title} ${styles.doneTitle}` : styles.title}>{w.title}</span>
                  {w.note ? <span className={styles.note}>{w.note}</span> : null}
                  {planned.has(w.id) ? <span className={styles.planned}>{t.inPlan(shortDay(planned.get(w.id)!))}</span> : null}
                </button>
                <div className={styles.hearts}>
                  <button type="button" className={w.likes[me] ? `${styles.like} ${styles.on}` : styles.like} aria-pressed={!!w.likes[me]} onClick={() => like(w)}>
                    <Icon name={w.likes[me] ? "heartFull" : "heart"} size={18} />{w.likes[me] ? t.liked : t.like}
                  </button>
                  <span className={w.likes[them] ? `${styles.their} ${styles.theirOn}` : styles.their}>
                    <Icon name={w.likes[them] ? "heartFull" : "heart"} size={14} />{w.likes[them] ? t.theyLike(c.name(them)) : t.theyNot(c.name(them))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <WishSheet id={edit} onClose={() => setEdit(null)} upcoming={upcomingPlans(plans, today()).filter((p) => p.status !== "declined")} />
      <AiWishes open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

function WishSheet({ id, onClose, upcoming }: { id: string | null; onClose: () => void; upcoming: ReturnType<typeof upcomingPlans> }) {
  const c = useCouple();
  const w = id ? c.wishes.find((x) => x.id === id) : null;
  return (
    <Sheet open={!!w} onClose={onClose} title={ja.wishes.editTitle}>
      {w ? <WishForm key={w.id} w={w} onClose={onClose} upcoming={upcoming} /> : null}
    </Sheet>
  );
}

function WishForm({ w, onClose, upcoming }: { w: Wish; onClose: () => void; upcoming: ReturnType<typeof upcomingPlans> }) {
  const t = ja.wishes;
  const c = useCouple();
  const [title, setTitle] = useState(w.title);
  const [kind, setKind] = useState<WishKind>(w.kind);
  const [area, setArea] = useState(w.area);
  const [note, setNote] = useState(w.note);
  const [url, setUrl] = useState(w.url);
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErr(t.needTitle);
    if (url.trim() && !/^https?:\/\/\S+$/.test(url.trim())) return setErr(t.badUrl);
    if (await write("update", `wishes/${w.id}`, { title: title.trim().slice(0, 60), kind, area: area.trim().slice(0, 40), note: note.trim().slice(0, 200), url: url.trim().slice(0, 500) })) {
      toast(ja.common.saved);
      onClose();
    }
  }
  async function toPlan(planId: string, date: string) {
    if (await addStep(planId, { text: w.title, place: w.area, wish: w.id }, c.me)) {
      toast(t.putIn(shortDay(date)));
      onClose();
    }
  }
  return (
    <>
      <form className={styles.form} onSubmit={save}>
        <div className="field">
          <label htmlFor="w-title">{t.fields.title}</label>
          <input id="w-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </div>
        <div className="chips" role="group" aria-label={t.fields.kind}>
          {WISH_KINDS.map((k) => <button key={k.key} type="button" className="chip" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>)}
        </div>
        <div className="field">
          <label htmlFor="w-area">{t.fields.area}</label>
          <input id="w-area" className="input" value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} placeholder="例：鎌倉" />
        </div>
        <div className="field">
          <label htmlFor="w-note">{t.fields.note}</label>
          <textarea id="w-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="w-url">{t.fields.url}</label>
          <input id="w-url" className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" />
          {/^https?:\/\/\S+$/.test(w.url) ? <a className="link-button" href={w.url} target="_blank" rel="noopener noreferrer">{w.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a> : null}
        </div>
        {err ? <p className="error" role="alert">{err}</p> : null}
        <button type="submit" className="btn">{ja.common.save}</button>
      </form>

      <div className={styles.block}>
        <p className="label">{t.toPlan}</p>
        {upcoming.length ? (
          <div className="chips">
            {upcoming.slice(0, 8).map((p) => (
              <button key={p.id} type="button" className="chip" onClick={() => toPlan(p.id, p.date)}>{shortDay(p.date)}{p.title ? `・${p.title}` : ""}</button>
            ))}
          </div>
        ) : <p className="hint">{t.toPlanNone}</p>}
      </div>

      <label className={styles.doneLine}>
        <input type="checkbox" checked={w.done} onChange={(e) => write("update", `wishes/${w.id}`, { done: e.target.checked, doneAt: e.target.checked ? today() : "" })} />
        {t.doneLabel}
      </label>

      {ask ? (
        <div className={styles.block}>
          <p className="hint">{t.deleteAsk}</p>
          <div className={page.actions}>
            <button type="button" className="btn btn-small btn-danger" onClick={async () => { if (await write("delete", `wishes/${w.id}`)) onClose(); }}>{ja.common.delete}</button>
            <button type="button" className="btn-quiet btn-small" onClick={() => setAsk(false)}>{ja.common.cancel}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={`link-danger ${styles.delete}`} onClick={() => setAsk(true)}>{ja.common.delete}</button>
      )}
    </>
  );
}

interface WishIdea { title: string; kind: WishKind; area: string; note: string }

/** したいことの案をもらう: six ideas from GPT-5.2; the ticked ones join the list. */
function AiWishes({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={ja.ai.wishesTitle}>
      {open ? <AiWishesBody onClose={onClose} /> : null}
    </Sheet>
  );
}

function AiWishesBody({ onClose }: { onClose: () => void }) {
  const t = ja.ai;
  const c = useCouple();
  const [area, setArea] = useState("");
  const [moods, setMoods] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [list, setList] = useState<WishIdea[] | null>(null);
  const [pick, setPick] = useState<Record<number, boolean>>({});
  const ctl = useRef<AbortController | null>(null);

  async function ask() {
    setBusy(true);
    setErr("");
    ctl.current = new AbortController();
    try {
      const r = await askAi<{ wishes: WishIdea[] }>("wishes", { options: { area, moods } }, ctl.current.signal);
      if (!r?.wishes?.length) throw { code: "empty" };
      setList(r.wishes);
      setPick(Object.fromEntries(r.wishes.map((_, i) => [i, true])));
    } catch (e) {
      if ((e as Fail).code !== "cancelled") setErr(t.errors[(e as Fail)?.code] || t.errors.default);
    } finally {
      setBusy(false);
      ctl.current = null;
    }
  }
  async function addPicked() {
    const chosen = (list || []).filter((_, i) => pick[i]);
    setBusy(true);
    let n = 0;
    for (const w of chosen) {
      if (await addWish(w, c.me, false, n)) n++;
    }
    setBusy(false);
    toast(t.addedWishes(n));
    onClose();
  }
  const count = Object.values(pick).filter(Boolean).length;
  return (
    <>
      {!list ? (
        <>
          <AiOptions area={area} setArea={setArea} budget="" setBudget={() => {}} moods={moods} setMoods={setMoods} withBudget={false} />
          <button type="button" className="btn" onClick={ask} disabled={busy}>{t.askWishes}</button>
        </>
      ) : (
        <>
          <ul className={ai.pick}>
            {list.map((w, i) => (
              <li key={i}>
                <label className={ai.pickRow}>
                  <input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick({ ...pick, [i]: e.target.checked })} />
                  <span className={ai.pickMain}>
                    <span className={ai.pickTitle}>{w.title}</span>
                    <span className={ai.pickSub}>{[wishKindLabel(w.kind), w.area, w.note].filter(Boolean).join("・")}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className={page.actions}>
            <button type="button" className="btn" disabled={busy || !count} onClick={addPicked}>{t.pickAdd(count)}</button>
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => setList(null)}>{t.again}</button>
          </div>
        </>
      )}
      {busy && !list ? (
        <div className={ai.busy}><span>{t.thinking}</span><button type="button" className="link-button" onClick={() => ctl.current?.abort()}>{t.stop}</button></div>
      ) : null}
      {err ? <p className="error" role="alert">{err}</p> : null}
      <p className="hint">{t.note}</p>
    </>
  );
}
