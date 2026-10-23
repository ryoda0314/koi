"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/Icon";
import { inviteToken, toast } from "@/lib/client/space";
import { ja } from "@/lib/i18n/ja";
import styles from "./invite.module.css";

const linkFor = (token: string) => `${window.location.origin}/join#${token}`;

/** The invite link: copy, send, or show as a QR code for the phone next to you. */
export function InviteBox({ qrOpen = false, renewable = false }: { qrOpen?: boolean; renewable?: boolean }) {
  const t = ja.invite;
  const [token, setToken] = useState("");
  const [qr, setQr] = useState(qrOpen);
  const [svg, setSvg] = useState("");
  const [ask, setAsk] = useState(false);
  const canShare = useSyncExternalStore(() => () => {}, () => typeof navigator.share === "function", () => false);

  useEffect(() => {
    inviteToken().then(setToken, () => toast(ja.common.offline));
  }, []);

  useEffect(() => {
    if (!qr || !token) return;
    let alive = true;
    import("qrcode-generator").then(({ default: qrcode }) => {
      const q = qrcode(0, "M");
      q.addData(linkFor(token));
      q.make();
      if (alive) setSvg(q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    });
    return () => { alive = false; };
  }, [qr, token]);

  const url = token ? linkFor(token) : "";
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast(ja.common.copied); } catch { toast(ja.common.copied); }
  }
  async function renew() {
    try { setToken(await inviteToken(true)); setAsk(false); toast(t.renewed); } catch { toast(ja.common.offline); }
  }

  return (
    <div className={styles.box}>
      <input className={`input ${styles.url}`} readOnly value={url} aria-label={t.title} onFocus={(e) => e.target.select()} />
      <div className={styles.row}>
        {canShare ? (
          <button type="button" className="btn btn-small" disabled={!url} onClick={() => navigator.share({ title: ja.name, text: t.text, url }).catch(() => {})}>
            <Icon name="share" size={18} />{ja.common.share}
          </button>
        ) : null}
        <button type="button" className={canShare ? "btn-quiet btn-small" : "btn btn-small"} disabled={!url} onClick={copy}>
          <Icon name="copy" size={18} />{ja.common.copy}
        </button>
        <button type="button" className="btn-quiet btn-small" aria-pressed={qr} onClick={() => setQr(!qr)}>
          <Icon name="qr" size={18} />{t.qr}
        </button>
      </div>
      {qr && svg ? <div className={styles.qr} role="img" aria-label={t.qr} dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      <p className="hint">{t.note}</p>
      {renewable ? (
        ask ? (
          <div className={styles.ask}>
            <p className="hint">{t.renewAsk}</p>
            <div className={styles.row}>
              <button type="button" className="btn-quiet btn-small" onClick={renew}>{t.renewDo}</button>
              <button type="button" className="btn-quiet btn-small" onClick={() => setAsk(false)}>{ja.common.cancel}</button>
            </div>
          </div>
        ) : (
          <button type="button" className={`link-button ${styles.renew}`} onClick={() => setAsk(true)}>{t.renew}</button>
        )
      ) : null}
    </div>
  );
}
