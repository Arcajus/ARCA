import type { NextConfig } from "next";

const isCapacitor = process.env.BUILD_TARGET === "capacitor";
const isGhPages = process.env.BUILD_TARGET === "ghpages";

const nextConfig: NextConfig = {
  ...(isCapacitor || isGhPages
    ? { output: "export", trailingSlash: true }
    : {}),
  ...(isGhPages ? { basePath: "/ARCA", assetPrefix: "/ARCA" } : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
