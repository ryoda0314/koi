import type { MetadataRoute } from "next";
import { ja } from "@/lib/i18n/ja";

// A home-screen install opens straight into the couple's plans. Icons: public/icons, drawn by design/make-icons.py.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ja.name,
    short_name: ja.name,
    description: ja.intro.lead,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#fcfbf8",
    theme_color: "#fcfbf8",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
