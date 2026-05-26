import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXUS — Intelligence Citoyenne",
  description: "Débattez, simulez, progressez. Studio débat audio IA, simulation ONU, Score d'éloquence.",
  keywords: "débat, géopolitique, diplomatie, intelligence citoyenne, éloquence, simulation ONU",
  authors: [{ name: "Arcajus Auguste GBAGUIDI" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NEXUS",
    startupImage: [
      {
        url: "/icons/apple-touch-icon.png",
        media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)",
      },
    ],
  },
  openGraph: {
    title: "NEXUS — Intelligence Citoyenne",
    description: "Réseau Social d'Intelligence Citoyenne",
    type: "website",
    images: [{ url: "/icons/icon-512.png" }],
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/icons/favicon-32.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#07090F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" style={{ background: "#07090F" }}>
      <head>
        {/* iOS PWA */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="NEXUS" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />
        {/* Android PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#07090F" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Service Worker — force cache clear on version bump */}
        <script dangerouslySetInnerHTML={{__html: `
          var APP_VER = "8";
          if ('serviceWorker' in navigator) {
            if (localStorage.getItem('app_ver') !== APP_VER) {
              navigator.serviceWorker.getRegistrations().then(function(regs) {
                var p = regs.map(function(r){ return r.unregister(); });
                return Promise.all(p);
              }).then(function() {
                if ('caches' in window) {
                  return caches.keys().then(function(keys) {
                    return Promise.all(keys.map(function(k){ return caches.delete(k); }));
                  });
                }
              }).then(function() {
                localStorage.setItem('app_ver', APP_VER);
                window.location.reload();
              });
            } else {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/ARCA/sw.js');
              });
            }
          }
        `}} />
      </head>
      <body style={{ minHeight: "100vh", background: "#07090F", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
