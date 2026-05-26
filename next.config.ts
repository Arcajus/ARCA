import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export uniquement pour le build Capacitor (Android/iOS)
  // Pour Vercel : commenter output et trailingSlash
  ...(process.env.BUILD_TARGET === "capacitor"
    ? { output: "export", trailingSlash: true }
    : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
