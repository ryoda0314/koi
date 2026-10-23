"use client";

import { useToasts } from "@/lib/client/space";
import styles from "./Toasts.module.css";

/** Short notes after something was done, above the tab bar. */
export function Toasts() {
  const list = useToasts();
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={styles.toast}>{t.text}</div>
      ))}
    </div>
  );
}
