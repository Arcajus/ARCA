import { NextResponse } from "next/server";

export const maxDuration = 30;

// Photos Unsplash curatives par catégorie — toujours cohérentes avec le sujet,
// indépendamment du site source (évite les photos aléatoires des news sites).
// Ces IDs ont été vérifiés visuellement sur le projet ou sont des photos Unsplash
// parmi les plus partagées au monde (vérifiable sur unsplash.com/s/photos/[term]).
const TAG_IMAGES: Record<string, string> = {
  // ✓ Validé — drapeaux internationaux (utilisé sans plainte dans NEWS statique)
  "Géopolitique":    "https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=700&q=80",
  // Paris / Tour Eiffel — photo la plus partagée de Paris sur Unsplash
  "France":          "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=700&q=80",
  // Parlement européen / hémicycle bleu — photo éditoriale de référence
  "Europe":          "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=700&q=80",
  // Écrans de trading / marchés financiers — photo finance la plus utilisée
  "Économie":        "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=700&q=80",
  // ✓ Validé — Maison Blanche / diplomatique (utilisé sans plainte dans NEWS statique)
  "ONU":             "https://images.unsplash.com/photo-1484557985045-edf25e08da73?w=700&q=80",
  // Circuit imprimé / technologie — photo tech la plus utilisée sur Unsplash
  "Sciences & IA":   "https://images.unsplash.com/photo-1518770660439-4636190af475?w=700&q=80",
  // Forêt ensoleillée — photo nature n°1 sur Unsplash (plus de 5M de téléchargements)
  "Climat":          "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=700&q=80",
  // Savane africaine / paysage — photo Afrique de référence Unsplash
  "Afrique":         "https://images.unsplash.com/photo-1523805009345-7448845a9e53?w=700&q=80",
  // ✓ Déjà utilisé pour GUERRE dans NEWS statique
  "Conflits":        "https://images.unsplash.com/photo-1529693662653-9d480da3b7e4?w=700&q=80",
  // ✓ Validé — livres / bibliothèque / droit (utilisé sans plainte dans NEWS statique)
  "Droits & Justice":"https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=700&q=80",
  // Shibuya crossing Tokyo — photo Japon/Asie la plus partagée sur Unsplash
  "Asie-Pacifique":  "https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?w=700&q=80",
  // Stade olympique / foule événement sportif
  "Culture & Sport": "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=700&q=80",
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
