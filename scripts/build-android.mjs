// Build de l'app pour Capacitor (export statique) : les routes /api/* ne peuvent pas
// être exportées statiquement (clés secrètes, rate-limit, streaming) — l'APK appelle
// le backend Vercel en production via apiUrl() (voir src/lib/api.ts), donc on les
// retire temporairement du build pour l'export.
import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const apiDir = join(process.cwd(), "src", "app", "api");
const apiBak = join(process.cwd(), "src", "app", "_api_disabled_for_export");

if (!existsSync(apiDir)) {
  console.error("src/app/api introuvable, abandon.");
  process.exit(1);
}

renameSync(apiDir, apiBak);

try {
  execSync("npx next build", {
    stdio: "inherit",
    env: { ...process.env, BUILD_TARGET: "capacitor" },
  });
} finally {
  renameSync(apiBak, apiDir);
}

console.log("\n✔ Export statique généré dans out/. Lance `npx cap sync android` puis ouvre Android Studio.");
