import type { NextConfig } from "next";

// Security headers on every response. The CSP is limited to directives that cannot break
// images or scripts (YouTube thumbnails, Supabase, Vercel analytics stay unaffected):
// anti-clickjacking, no <base> hijack, no plugins.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Anciennes adresses → nouvelle organisation en 3 espaces (ERGONOMIE.md).
  async redirects() {
    return [
      { source: "/today", destination: "/sujets", permanent: false },
      { source: "/topics/review", destination: "/admin/sujets", permanent: false },
      { source: "/sujets/tri", destination: "/admin/sujets", permanent: false },
      { source: "/profile", destination: "/settings", permanent: false },
      { source: "/videos", destination: "/pipeline", permanent: false },
      { source: "/veille", destination: "/activity", permanent: false },
      { source: "/waitlist", destination: "/liste-attente", permanent: true },
      { source: "/inscription", destination: "/liste-attente", permanent: true },
      { source: "/signup", destination: "/liste-attente", permanent: true },
      { source: "/rejoindre", destination: "/liste-attente", permanent: true },
    ];
  },
};

export default nextConfig;
