import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXUS — Réseau Social d'Intelligence Citoyenne",
  description: "Débattez, simulez, progressez. Studio débat audio IA, simulation ONU, Score d'éloquence, réseau social géopolitique.",
  keywords: "débat, géopolitique, diplomatie, intelligence citoyenne, éloquence, simulation ONU",
  authors: [{ name: "Arcajus Auguste GBAGUIDI" }],
  openGraph: {
    title: "NEXUS",
    description: "Réseau Social d'Intelligence Citoyenne",
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" style={{ background: "#07090F" }}>
      <body style={{ minHeight: "100vh", background: "#07090F" }}>
        {children}
      </body>
    </html>
  );
}
