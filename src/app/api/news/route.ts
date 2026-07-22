import { NextResponse } from "next/server";

export const maxDuration = 45;

// ── Sources de confiance : médias dont les og:image sont pertinentes ──────
// On récupère leur vraie photo éditoriale. Pour les autres (Vietnam.vn, Invezz…)
// on utilise une photo de secours par catégorie — jamais de vache ni de morse.
const TRUSTED_SOURCE_NAMES = [
  "franceinfo","france info","le monde","figaro","libération","liberation",
  "parisien","l'express","lexpress","le point","nouvel obs","l'obs",
  "bfm","france 24","france24","rfi","france inter","france culture",
  "ouest-france","télégramme","telegramme","20 minutes","la tribune",
  "les echos","lesechos","challenges","humanité","europe 1","europe1",
  "rtl","tf1","euronews","reuters","bbc","al jazeera","aljazeera","afp","dw",
  "la 1ère","la 1ere","outre-mer","1ère","france antilles","antilles",
  "cnews","rmc","france télévisions","france televisions","lci","i24",
  "midi libre","sud ouest","la dépêche","la depeche","nice-matin",
  "la voix du nord","le dauphiné","le dauphine","l'union",
];

function isTrustedSource(src: string): boolean {
  const s = src.toLowerCase();
  return TRUSTED_SOURCE_NAMES.some(n => s.includes(n));
}

// Photo déterministe unique par article : seed = ID de l'article → jamais la même photo
// pour deux articles différents, sans dépendance à des IDs Unsplash invérifiables.
function picsumFallback(articleId: string): string {
  const seed = articleId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50) || "news";
  return `https://picsum.photos/seed/${seed}/700/400`;
}

// ── Flux RSS Google News ───────────────────────────────────────────────────
const FEEDS = [
  {url:"https://news.google.com/rss/search?q=géopolitique+diplomatie+international+when:2d&hl=fr&gl=FR&ceid=FR:fr",            tag:"Géopolitique",   tagC:"#1A5FD4"},
  {url:"https://news.google.com/rss/search?q=france+politique+gouvernement+ministre+when:2d&hl=fr&gl=FR&ceid=FR:fr",           tag:"France",          tagC:"#E03535"},
  {url:"https://news.google.com/rss/search?q=europe+union+européenne+parlement+when:2d&hl=fr&gl=FR&ceid=FR:fr",               tag:"Europe",          tagC:"#7C3AED"},
  {url:"https://news.google.com/rss/search?q=économie+finance+bourse+inflation+when:2d&hl=fr&gl=FR&ceid=FR:fr",               tag:"Économie",        tagC:"#D97706"},
  {url:"https://news.google.com/rss/search?q=ONU+nations+unies+conseil+sécurité+when:2d&hl=fr&gl=FR&ceid=FR:fr",              tag:"ONU",             tagC:"#16A34A"},
  {url:"https://news.google.com/rss/search?q=intelligence+artificielle+technologie+innovation+when:2d&hl=fr&gl=FR&ceid=FR:fr", tag:"Sciences & IA",  tagC:"#0E7490"},
  {url:"https://news.google.com/rss/search?q=climat+changement+climatique+COP+énergie+when:2d&hl=fr&gl=FR&ceid=FR:fr",        tag:"Climat",          tagC:"#16A34A"},
  {url:"https://news.google.com/rss/search?q=afrique+sahel+développement+crise+when:2d&hl=fr&gl=FR&ceid=FR:fr",               tag:"Afrique",         tagC:"#D97706"},
  {url:"https://news.google.com/rss/search?q=guerre+conflit+ukraine+moyen-orient+when:2d&hl=fr&gl=FR&ceid=FR:fr",             tag:"Conflits",        tagC:"#E03535"},
  {url:"https://news.google.com/rss/search?q=droits+humains+justice+démocratie+when:2d&hl=fr&gl=FR&ceid=FR:fr",               tag:"Droits & Justice", tagC:"#8B4513"},
  {url:"https://news.google.com/rss/search?q=Asie+Chine+Japon+Inde+Pacifique+when:2d&hl=fr&gl=FR&ceid=FR:fr",                tag:"Asie-Pacifique",  tagC:"#1A5FD4"},
  // Requête plus précise pour Culture & Sport — "société" retiré (trop large)
  {url:"https://news.google.com/rss/search?q=sport+tournoi+compétition+festival+arts+spectacle+france+when:2d&hl=fr&gl=FR&ceid=FR:fr", tag:"Culture & Sport", tagC:"#16A34A"},
];

function extractCDATA(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
}

type Article = {
  id: string; title: string; link: string; pubDate: string;
  imgUrl: string | null; tag: string; tagC: string; src: string;
  trusted: boolean;
};

function parseRSS(xml: string, feed: (typeof FEEDS)[0]): Article[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  return items.slice(0, 8).map(item => {
    const rawTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const title    = extractCDATA(rawTitle).slice(0, 160);
    const link     = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const guid     = (item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? link).trim();
    const pubDate  = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    const rawSrc   = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "";
    const src      = extractCDATA(rawSrc).trim() || feed.tag;
    if (!title || !link) return null;
    return {
      id: `gn-${guid}`, title, link, pubDate,
      imgUrl: null,
      tag: feed.tag, tagC: feed.tagC, src,
      trusted: isTrustedSource(src),
    };
  }).filter(Boolean) as Article[];
}

// Récupère og:image depuis la page de l'article (pour sources de confiance uniquement)
async function fetchOgImage(url: string, timeoutMs = 3500): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), timeoutMs);
    const r    = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", "Cookie": "CONSENT=YES+1" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const html  = await r.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
      ?? html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    const img = match?.[1] ?? null;
    // Rejeter les images Google (pages de consentement) et les SVG
    if (!img || /google|gstatic|googleusercontent|ggpht/i.test(img) || img.endsWith(".svg")) return null;
    return img;
  } catch { return null; }
}

export async function GET() {
  // 1. Récupérer tous les flux RSS
  const feedResults = await Promise.allSettled(
    FEEDS.map(async feed => {
      const r = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        next: { revalidate: 120 },
      });
      if (!r.ok) return [];
      return parseRSS(await r.text(), feed);
    })
  );

  const all: Article[] = feedResults
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<Article[]>).value);

  // Dédoublonner
  const seen = new Set<string>();
  const unique = all.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });

  // Trier par date décroissante
  unique.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime(), tb = new Date(b.pubDate).getTime();
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1; if (isNaN(tb)) return -1;
    return tb - ta;
  });

  // 2. Attribuer les images
  // Sources de confiance → og:image réelle (photo éditoriale propre)
  // Sources inconnues   → photo de secours par catégorie (5 IDs vérifiés)
  const trusted   = unique.filter(a => a.trusted).slice(0, 28);
  const untrusted = unique.filter(a => !a.trusted);

  // Sources de confiance → og:image éditorial ; si échec → picsum unique par article
  const BATCH = 8;
  for (let i = 0; i < trusted.length; i += BATCH) {
    await Promise.all(trusted.slice(i, i + BATCH).map(async a => {
      const img = await fetchOgImage(a.link);
      a.imgUrl  = img ?? picsumFallback(a.id);
    }));
  }
  // Sources inconnues → picsum unique par ID d'article (pas de og:image de mauvaise qualité)
  untrusted.forEach(a => { a.imgUrl = picsumFallback(a.id); });

  return NextResponse.json({ articles: unique }, {
    headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=60" },
  });
}
