"use client";

import { useState } from "react";
import { useCouple } from "@/lib/client/couple";
import { toast, write } from "@/lib/client/space";
import { ja } from "@/lib/i18n/ja";
import { InviteBox } from "../_parts/Invite";
import { WhoSheet } from "../_parts/Shell";
import page from "../_parts/page.module.css";
import styles from "./us.module.css";

/** ふたり: the two names, which one this device is, and the invite link. */
export default function Us() {
  const t = ja.us;
  const c = useCouple();
  const { me } = c;
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [who, setWho] = useState(false);
  if (!me) return null;

  async function saveNames(e: React.FormEvent) {
    e.preventDefault();
    const na = (a ?? c.name("a")).trim().slice(0, 12), nb = (b ?? c.name("b")).trim().slice(0, 12);
    if (!na || !nb) return toast(ja.onboarding.need);
    if (await write("merge", "app/members", { a: { name: na }, b: { name: nb } })) toast(t.namesSaved);
  }

  return (
    <div className={page.page}>
      <header className={page.bar}>
        <h1 className={page.barTitle}>{t.title}</h1>
      </header>

      <form className={page.section} onSubmit={saveNames}>
        <h2 className={page.h2}>{t.names}</h2>
        <div className={styles.names}>
          <div className="field">
            <label htmlFor="n-a">{me === "a" ? ja.onboarding.me : ja.onboarding.them}</label>
            <input id="n-a" className="input" value={a ?? c.name("a")} onChange={(e) => setA(e.target.value)} maxLength={12} />
          </div>
          <div className="field">
            <label htmlFor="n-b">{me === "b" ? ja.onboarding.me : ja.onboarding.them}</label>
            <input id="n-b" className="input" value={b ?? c.name("b")} onChange={(e) => setB(e.target.value)} maxLength={12} />
          </div>
        </div>
        <div className={page.actions}><button type="submit" className="btn-quiet btn-small">{ja.common.save}</button></div>
      </form>

      <section className={page.section}>
        <p className={styles.you}>{t.youAre(c.name(me))}</p>
        <div className={page.actions}><button type="button" className="btn-quiet btn-small" onClick={() => setWho(true)}>{t.switch}</button></div>
      </section>

      <section className={page.section}>
        <h2 className={page.h2}>{ja.invite.title}</h2>
        <InviteBox renewable />
        <p className={page.note}>{t.install}</p>
      </section>

      <section className={page.section}>
        <h2 className={page.h2}>{t.aboutAi}</h2>
        <p className={page.note}>{t.aboutAiBody}</p>
      </section>

      <section className={page.section}>
        <h2 className={page.h2}>{t.aboutData}</h2>
        <p className={page.note}>{t.aboutDataBody}</p>
      </section>

      {who ? <WhoSheet onClose={() => setWho(false)} /> : null}
    </div>
  );
}
