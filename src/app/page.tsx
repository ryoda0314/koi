import { Logo } from "@/components/Logo";
import { ja } from "@/lib/i18n/ja";
import { Start } from "./Start";
import styles from "./page.module.css";

// A week as it looks once both have marked it: the days both are free come out in blue.
const WEEK = [
  { d: 7, w: "金", you: "夜", them: "夜", both: true },
  { d: 8, w: "土", you: "◯", them: "昼", both: true },
  { d: 9, w: "日", you: "◯", them: "✕", both: false },
  { d: 10, w: "月", you: "✕", them: "夜", both: false },
  { d: 11, w: "火", you: "昼", them: "夜", both: false },
  { d: 12, w: "水", you: "夜", them: "◯", both: true },
  { d: 13, w: "木", you: "", them: "昼", both: false },
];

export default function Intro() {
  const t = ja.intro;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo size="lg" href={null} />
      </header>
      <section className={styles.hero}>
        <h1 className={styles.lead}>{t.lead}</h1>
        <figure className={styles.figure} aria-label="ふたりとも空いている日が青くなる例">
          <div className={styles.week}>
            <span className={styles.who} />
            {WEEK.map((x) => (
              <span key={x.d} className={styles.day}>
                <span className={styles.wd}>{x.w}</span>
                <span className={x.both ? `${styles.num} ${styles.both}` : styles.num}>{x.d}</span>
              </span>
            ))}
            <span className={styles.who}>{t.figure.you}</span>
            {WEEK.map((x) => <span key={"y" + x.d} className={styles.mark}>{x.you}</span>)}
            <span className={`${styles.who} ${styles.them}`}>{t.figure.them}</span>
            {WEEK.map((x) => <span key={"t" + x.d} className={`${styles.mark} ${styles.them}`}>{x.them}</span>)}
          </div>
          <figcaption className={styles.caption}>
            <span className={styles.dot} aria-hidden="true" />
            {t.figure.both}
          </figcaption>
        </figure>
        {t.body.map((p) => (
          <p key={p} className={styles.body}>{p}</p>
        ))}
        <Start />
      </section>
    </main>
  );
}
