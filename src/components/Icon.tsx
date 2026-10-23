// Line icons, drawn like ことのは's: a 24 px box, a 1.8 px round stroke, no fill.
type IconName =
  | "plans" | "days" | "wishes" | "us"
  | "plus" | "close" | "back" | "next" | "chevron" | "check" | "copy" | "share" | "qr"
  | "pin" | "clock" | "spark" | "edit" | "heart" | "heartFull";

const PATHS: Record<IconName, React.ReactNode> = {
  // 予定: a page of the calendar with the day marked.
  plans: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="2" />
    </>
  ),
  // 空いてる日: days in a grid.
  days: (
    <>
      <rect x="3.5" y="4" width="17" height="16.5" rx="2.5" />
      <path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" strokeWidth="2.6" />
    </>
  ),
  wishes: <path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  heartFull: <path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" fill="currentColor" />,
  // ふたり: two people.
  us: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.9-3.4 3.2-5.2 6-5.2s5.1 1.8 6 5.2" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.8 14.6c1.5.7 2.6 2.4 3.2 4.9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 18l-6-6 6-6" />,
  next: <path d="M9 18l6-6-6-6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  // AI: a small spark.
  spark: (
    <>
      <path d="M11 3.5c.7 4.6 2.6 6.6 7.2 7.3-4.6.7-6.5 2.7-7.2 7.3-.7-4.6-2.6-6.6-7.2-7.3 4.6-.7 6.5-2.7 7.2-7.3z" />
      <path d="M18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5h4l10-10-4-4-10 10z" />
      <path d="m13 7 4 4" />
    </>
  ),
};

export type { IconName };

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
