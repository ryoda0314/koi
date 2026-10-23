import Image from "next/image";
import Link from "next/link";
import { ja } from "@/lib/i18n/ja";
import styles from "./Logo.module.css";

const ICON_PX = { sm: 28, md: 34, lg: 72 } as const;

/** The app icon and ふたりごよみ in mincho. `lg` stacks them, for the first screen. */
export function Logo({ size = "md", href = "/" }: { size?: keyof typeof ICON_PX; href?: string | null }) {
  const px = ICON_PX[size];
  const content = (
    <>
      {/* a small fixed PNG: served as it is, without the image optimizer */}
      <Image src="/icons/icon-192.png" alt="" width={px} height={px} className={styles.icon} unoptimized loading="eager" fetchPriority={size === "lg" ? "high" : "auto"} />
      <span className={`wordmark-kana ${styles.word}`}>{ja.name}</span>
    </>
  );
  const className = `${styles.logo} ${styles[size]}`;
  return href ? (
    <Link href={href} className={className} aria-label={ja.name}>
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  );
}
