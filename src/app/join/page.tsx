"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { joinSpace, type Fail } from "@/lib/client/space";
import { ja } from "@/lib/i18n/ja";
import styles from "./join.module.css";

/** The invite link, /join#<key>: this device joins the couple's space, then opens it. */
export default function Join() {
  const t = ja.join;
  const router = useRouter();
  const [err, setErr] = useState("");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const key = (/^#?([A-Za-z0-9_-]{16,64})$/.exec(window.location.hash) || [])[1];
    let alive = true;
    (async () => {
      if (!key) return setErr(t.noLink);
      try {
        await joinSpace(key);
        // replace, so the link with its key does not stay in this tab's history
        if (alive) router.replace("/app");
      } catch (e) {
        const c = (e as Fail).code;
        if (alive) setErr(c === "not_found" ? t.notFound : c === "full" ? t.full : t.failed);
      }
    })();
    return () => { alive = false; };
  }, [tries, router, t]);

  return (
    <main className={styles.page}>
      <Logo size="md" href={null} />
      {err ? (
        <>
          <p className={styles.text} role="alert">{err}</p>
          <div className={styles.actions}>
            {err === t.failed ? <button type="button" className="btn" onClick={() => { setErr(""); setTries((n) => n + 1); }}>{t.retry}</button> : null}
            <Link href="/" className="btn-quiet">{t.home}</Link>
          </div>
        </>
      ) : (
        <p className={styles.text}>{t.joining}</p>
      )}
    </main>
  );
}
