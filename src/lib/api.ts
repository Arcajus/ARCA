import { Capacitor } from "@capacitor/core";

// Backend Vercel — utilisé par l'APK (Capacitor) qui n'a pas de serveur Next.js intégré.
const PROD_API_BASE = "https://arca-psi-eight.vercel.app";

export function apiUrl(path: string): string {
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    return `${PROD_API_BASE}${path}`;
  }
  return path;
}
