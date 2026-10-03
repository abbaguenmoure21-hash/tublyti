import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
