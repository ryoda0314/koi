import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // a second dev server (tests) can keep its own output and lock
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // the dev badge sits bottom-left, right on top of the tab bar
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // The invite link carries its key after "#", which never reaches the server; keep the page itself out of indexes.
      { source: "/join", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/app/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
