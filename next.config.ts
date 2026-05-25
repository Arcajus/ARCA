import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const repoName = "arca"; // nom du repo GitHub en minuscules

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Nécessaire pour GitHub Pages si le repo n'est pas à la racine
  // Commenté par défaut — décommenter si l'URL est arcajus.github.io/arca/
  // basePath: isProd ? `/${repoName}` : "",
  // assetPrefix: isProd ? `/${repoName}/` : "",
};

export default nextConfig;
