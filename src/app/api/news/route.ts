import { NextResponse } from "next/server";

export const maxDuration = 30;

// Photos Unsplash curatives par catégorie — toujours cohérentes avec le sujet,
// indépendamment du site source (évite les photos aléatoires des news sites).
const TAG_IMAGES: Record<string, string> = {
  "Géopolitique":    "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=700&q=80",
  "France":          "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=700&q=80",
  "Europe":          "https://images.unsplash.com/photo-1562788366-e78de8cf6f5b?w=700&q=80",
  "Économie":        "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=700&q=80",
  "ONU":             "https://images.unsplash.com/photo-1534536281715-e28d76689b4d?w=700&q=80",
  "Sciences & IA":   "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=700&q=80",
  "Climat":          "https://images.unsplash.com/photo-1508193638397-1c4234db14d8?w=700&q=80",
  "Afrique":         "https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?w=700&q=80",
  "Conflits":        "https://images.unsplash.com/photo-1529693662653-9d480da3b7e4?w=700&q=80",
  "Droits & Justice":"https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=700&q=80",
  "Asie-Pacifique":  "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=700&q=80",
  "Culture & Sport": "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=700&q=80",
};

const FALLBACK_IMG = "https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=700&q=80";

const FEEDS = [
  {url:"https://news.google.com/rss/search?q=géopolitique+diplomatie+international+when:2d&hl=fr&gl=FR&ceid=FR:fr",     tag:"Géopolitique",   tagC:"#1A5FD4"},
  {url:"https://news.google.com/rss/search?q=france+politique+gouvernement+actualité+when:2d&hl=fr&gl=FR&ceid=FR:fr",  tag:"France",          tagC:"#E03535"},
  {url:"https://news.google.com/rss/search?q=europe+union+européenne+parlement+when:2d&hl=fr&gl=FR&ceid=FR:fr",        tag:"Europe",          tagC:"#7C3AED"},
  {url:"https://news.google.com/rss/search?q=économie+finance+bourse+inflation+when:2d&hl=fr&gl=FR&ceid=FR:fr",        tag:"Économie",        tagC:"#D97706"},
  {url:"https://news.google.com/rss/search?q=ONU+nations+unies+conseil+sécurité+when:2d&hl=fr&gl=FR&ceid=FR:fr",       tag:"ONU",             tagC:"#16A34A"},
  {url:"https://news.google.com/rss/search?q=intelligence+artificielle+technologie+innovation+when:2d&hl=fr&gl=FR&ceid=FR:fr", tag:"Sciences & IA", tagC:"#0E7490"},
  {url:"https://news.google.com/rss/search?q=climat+environnement+COP+énergie+when:2d&hl=fr&gl=FR&ceid=FR:fr",         tag:"Climat",          tagC:"#16A34A"},
  {url:"https://news.google.com/rss/search?q=afrique+sahel+développement+crise+when:2d&hl=fr&gl=FR&ceid=FR:fr",        tag:"Afrique",         tagC:"#D97706"},
  {url:"https://news.google.com/rss/search?q=guerre+conflit+ukraine+moyen-orient+when:2d&hl=fr&gl=FR&ceid=FR:fr",      tag:"Conflits",        tagC:"#E03535"},
  {url:"https://news.google.com/rss/search?q=droits+humains+justice+démocratie+when:2d&hl=fr&gl=FR&ceid=FR:fr",        tag:"Droits & Justice", tagC:"#8B4513"},
  {url:"https://news.google.com/rss/search?q=Asie+Chine+Japon+Inde+Pacifique+when:2d&hl=fr&gl=FR&ceid=FR:fr",         tag:"Asie-Pacifique",  tagC:"#1A5FD4"},
  {url:"https://news.google.com/rss/search?q=sport+culture+société+france+when:2d&hl=fr&gl=FR&ceid=FR:fr",             tag:"Culture & Sport", tagC:"#16A34A"},
];

function extractCDATA(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
}

type Article = {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  imgUrl: string;
  tag: string;
  tagC: string;
  src: string;
};

function parseRSS(xml: string, feed: (typeof FEEDS)[0]): Article[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  // Photo curative basée sur le tag : cohérente, indépendante du site source
  const img = TAG_IMAGES[feed.tag] ?? FALLBACK_IMG;

  return items.slice(0, 8).map(item => {
    const rawTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const title    = extractCDATA(rawTitle).slice(0, 160);
    const link     = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const guid     = (item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? link).trim();
    const pubDate  = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    const src      = extractCDATA(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "").trim() || feed.tag;
    if (!title || !link) return null;
    return { id: `gn-${guid}`, title, link, pubDate, imgUrl: img, tag: feed.tag, tagC: feed.tagC, src };
  }).filter(Boolean) as Article[];
}

export async function GET() {
  const results = await Promise.allSettled(
    FEEDS.map(async feed => {
      const r = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        next: { revalidate: 120 },
      });
      if (!r.ok) return [];
      const xml = await r.text();
      return parseRSS(xml, feed);
    })
  );

  const articles: Article[] = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<Article[]>).value);

  const seen = new Set<string>();
  const unique = articles.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  unique.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime();
    const tb = new Date(b.pubDate).getTime();
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });

  return NextResponse.json({ articles: unique }, {
    headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=60" },
  });
}
