"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { Sheet } from "@/components/Sheet";
import { Toasts } from "@/components/Toasts";
import { chosenKey, useCouple } from "@/lib/client/couple";
import { announce, boot, retryBoot, write } from "@/lib/client/space";
import { today } from "@/lib/dates";
import { ja } from "@/lib/i18n/ja";
import { bothLike, waitingOnMe } from "@/lib/model";
import type { Side } from "@/lib/avail";
import { InviteBox } from "./Invite";
import page from "./page.module.css";
import styles from "./shell.module.css";

/** The app around every tab: opens the couple's space, asks the two names once, and which of the two this device is. */
export function Shell({ children }: { children: ReactNode }) {
  const c = useCouple();
  const { s, members, me, them } = c;
  const [invite, setInvite] = useState(false);

  useEffect(() => { boot(); }, []);
  useEffect(() => { if (s.phase === "ready") announce(me); }, [s.phase, me]);

  if (s.phase !== "ready" || !s.loaded) return <Frame><Status phase={s.phase} /></Frame>;
  if (!members) return <Frame><Onboarding onDone={() => setInvite(true)} uid={s.uid} /></Frame>;

  const now = today();
  const badges = me && them ? {
    plans: c.plans.filter((p) => p.status === "proposed" && p.by === them && p.date >= now).length,
    days: Math.min(9, waitingOnMe(c.avail, me, now, 31).length),
    wishes: c.wishes.filter((w) => !w.done && w.likes[them] && !w.likes[me] && !bothLike(w)).length,
  } : {};

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        {s.conn === "offline" ? <p className={`${page.banner} ${styles.offline}`} role="status">{ja.common.offline}</p> : null}
        {children}
      </main>
      <BottomNav labels={ja.nav} brand={<Logo size="sm" href="/" />} badges={badges} />
      {!me ? <WhoSheet /> : null}
      <Sheet open={invite} onClose={() => setInvite(false)} title={ja.invite.firstTitle}>
        <p className={page.note}>{ja.invite.first(them ? c.name(them) : "相手")}</p>
        <InviteBox qrOpen />
      </Sheet>
      <Toasts />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={`${styles.main} ${styles.alone}`}>
        <div className={styles.frameLogo}><Logo size="sm" href="/" /></div>
        {children}
      </main>
      <Toasts />
    </div>
  );
}

function Status({ phase }: { phase: string }) {
  const t = ja.shell;
  if (phase === "boot" || phase === "ready") return <p className={page.skeleton}>{ja.common.loading}</p>;
  const [title, body] = phase === "none" ? [t.none, t.noneBody] : phase === "config" ? [t.config, t.configBody] : [t.error, t.errorBody];
  return (
    <div className={page.empty}>
      <p className={page.emptyTitle}>{title}</p>
      <p className={page.emptyBody}>{body}</p>
      <div className={page.actions}>
        {phase === "error" ? <button type="button" className="btn" onClick={() => retryBoot()}>{t.retry}</button> : null}
        <Link href="/" className="btn-quiet">{t.toStart}</Link>
      </div>
    </div>
  );
}

/** The first time in a new space: the two names. */
function Onboarding({ onDone, uid }: { onDone: () => void; uid: string | null }) {
  const t = ja.onboarding;
  const [mine, setMine] = useState("");
  const [theirs, setTheirs] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    const a = mine.trim().slice(0, 12), b = theirs.trim().slice(0, 12);
    if (!a || !b) return setErr(t.need);
    setBusy(true);
    const ok = await write("merge", "app/members", { a: { name: a, uids: uid ? { [uid]: true } : {} }, b: { name: b, uids: {} } });
    setBusy(false);
    if (ok) onDone();
  }
  return (
    <form className={styles.onboarding} onSubmit={start}>
      <h1 className={styles.h1}>{t.title}</h1>
      <p className={page.note}>{t.lead}</p>
      <div className="field">
        <label htmlFor="me">{t.me}</label>
        <input id="me" className="input" value={mine} onChange={(e) => setMine(e.target.value)} placeholder={t.mePh} maxLength={12} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="them">{t.them}</label>
        <input id="them" className="input" value={theirs} onChange={(e) => setTheirs(e.target.value)} placeholder={t.themPh} maxLength={12} autoComplete="off" />
      </div>
      {err ? <p className="error" role="alert">{err}</p> : null}
      <button type="submit" className="btn" disabled={busy}>{t.start}</button>
    </form>
  );
}

/** A device the space does not know yet (the partner's, or a second phone): which of the two is this? */
export function WhoSheet({ onClose }: { onClose?: () => void }) {
  const t = ja.who;
  const c = useCouple();
  const { s, members } = c;
  async function pick(k: Side) {
    const o: Side = k === "a" ? "b" : "a";
    try { localStorage.setItem(chosenKey(s.spaceId!), k); } catch { /* private mode */ }
    if (s.uid) await write("merge", "app/members", { [k]: { uids: { [s.uid]: true } }, [o]: { uids: { [s.uid]: null } } });
    onClose?.();
  }
  const used = (k: Side) => Object.entries(members?.[k]?.uids || {}).some(([u, on]) => on && u !== s.uid);
  return (
    <Sheet open onClose={onClose || (() => {})} title={t.title} required={!onClose}>
      <p className={page.note}>{t.lead(c.name("a"), c.name("b"))}</p>
      <div className={styles.who}>
        {(["a", "b"] as Side[]).map((k) => (
          <button key={k} type="button" className={styles.whoButton} onClick={() => pick(k)}>
            <span className={k === "a" ? styles.avatar : `${styles.avatar} ${styles.avatarB}`}>{Array.from(c.name(k))[0]}</span>
            <span className={styles.whoName}>{t.pick(c.name(k))}</span>
            {used(k) ? <small className={styles.whoUsed}>{t.other}</small> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
