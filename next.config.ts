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
    ];
  },
};

export default nextConfig;
