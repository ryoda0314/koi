"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSpace, hasSpace, needPasscode, type Fail } from "@/lib/client/space";
import { ja } from "@/lib/i18n/ja";
import styles from "./start.module.css";

/** はじめる: makes the couple's space (a passcode first, when the site asks for one). */
export function Start() {
  const t = ja.intro;
  const router = useRouter();
  const [joined, setJoined] = useState(false);
  const [askPass, setAskPass] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    hasSpace().then(setJoined, () => {});
    needPasscode().then(setAskPass, () => {});
  }, []);

  async function start() {
    if (askPass && !pass.trim()) return setErr(t.errors.bad_passcode);
    setBusy(true);
    setErr("");
    try {
      await createSpace(pass.trim());
      router.push("/app");
    } catch (e) {
      setBusy(false);
      setErr(t.errors[(e as Fail).code] || t.errors.default);
    }
  }

  return (
    <div className={styles.start}>
      {askPass ? (
        <div className="field">
          <label htmlFor="pass">{t.passcode}</label>
          <input id="pass" className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
          <p className="hint">{t.passcodeHint}</p>
        </div>
      ) : null}
      {err ? <p className="error" role="alert">{err}</p> : null}
      <button type="button" className={`btn ${styles.button}`} onClick={start} disabled={busy}>
        {busy ? t.starting : t.start}
      </button>
      <p className={styles.note}>{t.note}</p>
      <p className={styles.note}>{t.received}</p>
      {joined ? <Link href="/app" className={styles.link}>{t.joined}</Link> : null}
    </div>
  );
}
