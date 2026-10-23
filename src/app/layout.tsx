import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_JP, IBM_Plex_Sans_KR, Shippori_Mincho } from "next/font/google";
import { ja } from "@/lib/i18n/ja";
import "./globals.css";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex" });
const plexJp = IBM_Plex_Sans_JP({ weight: ["400", "500", "600"], variable: "--font-plex-jp", preload: false });
// Hangul, for a name like 난경.
const plexKr = IBM_Plex_Sans_KR({ weight: ["400", "500", "600"], variable: "--font-plex-kr", preload: false });
// Only the wordmark uses it.
const shippori = Shippori_Mincho({ weight: ["700"], variable: "--font-shippori", preload: false });

export const metadata: Metadata = {
  title: { default: ja.name, template: `%s | ${ja.name}` },
  description: ja.description,
  applicationName: ja.name,
  appleWebApp: { capable: true, title: ja.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#fcfbf8",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${plex.variable} ${plexJp.variable} ${plexKr.variable} ${shippori.variable}`}>
      <body>
        <div className="status-fill" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
