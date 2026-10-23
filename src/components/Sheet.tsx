"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Sheet.module.css";

/** A sheet over the page: from the bottom on a phone, a dialog in the middle on a wide screen. */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel = "閉じる",
  required = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel?: string;
  /** a question that needs an answer: no close button, Escape and the dimmed area do nothing */
  required?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      onClose={onClose}
      onCancel={(e) => { if (required) e.preventDefault(); }}
      onClick={(e) => {
        // A press on the dimmed area outside the sheet closes it.
        if (e.target === e.currentTarget && !required) onClose();
      }}
    >
      {open ? (
        <div className={styles.inner}>
          <header className={styles.head}>
            <div className={styles.title}>{title}</div>
            {!required ? (
              <button type="button" className={styles.close} onClick={onClose} aria-label={closeLabel}>
                <Icon name="close" size={20} />
              </button>
            ) : null}
          </header>
          <div className={styles.body}>{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
