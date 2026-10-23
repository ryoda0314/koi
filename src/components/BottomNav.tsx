"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import styles from "./BottomNav.module.css";

type Tab = "plans" | "days" | "wishes" | "us";

/** 予定・空いてる日・したいこと・ふたり: a bar at the bottom on a phone, a column down the left on a wide screen. */
export function BottomNav({
  labels,
  brand,
  badges,
}: {
  labels: Record<Tab, string> & { label: string };
  brand?: ReactNode;
  badges?: Partial<Record<Tab, number>>;
}) {
  const pathname = usePathname();
  const items: { key: Tab; href: string; active: boolean }[] = [
    { key: "plans", href: "/app", active: pathname === "/app" || pathname.startsWith("/app/plans") },
    { key: "days", href: "/app/days", active: pathname.startsWith("/app/days") },
    { key: "wishes", href: "/app/wishes", active: pathname.startsWith("/app/wishes") },
    { key: "us", href: "/app/us", active: pathname.startsWith("/app/us") },
  ];
  return (
    <nav className={styles.nav} aria-label={labels.label}>
      {brand ? <div className={styles.brand}>{brand}</div> : null}
      {items.map((item) => {
        const n = badges?.[item.key] || 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={item.active ? `${styles.item} ${styles.active}` : styles.item}
            aria-current={item.active ? "page" : undefined}
          >
            <span className={styles.icon}>
              <Icon name={item.key} size={22} />
              {n ? <span className={styles.badge} aria-hidden="true">{n}</span> : null}
            </span>
            {labels[item.key]}
            {n ? <span className="sr-only">（{n}）</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
