import { NextResponse } from "next/server";

export const maxDuration = 30;

// Google News RSS — no API key, no rate limit, server-side only
const FEEDS = [
  {url:"https://news.google.com/rss/search?q=géopolitique+diplomatie+international&hl=fr&gl=FR&ceid=FR:fr",     tag:"Géopolitique",   tagC:"#1A5FD4"},
  {url:"https://news.google.com/rss/search?q=france+politique+gouvernement+actualité&hl=fr&gl=FR&ceid=FR:fr",  tag:"France",          tagC:"#E03535"},
  {url:"https://news.google.com/rss/search?q=europe+union+européenne+parlement&hl=fr&gl=FR&ceid=FR:fr",        tag:"Europe",          tagC:"#7C3AED"},
  {url:"https://news.google.com/rss/search?q=économie+finance+bourse+inflation&hl=fr&gl=FR&ceid=FR:fr",        tag:"Économie",        tagC:"#D97706"},
  {url:"https://news.google.com/rss/search?q=ONU+nations+unies+conseil+sécurité&hl=fr&gl=FR&ceid=FR:fr",       tag:"ONU",             tagC:"#16A34A"},
  {url:"https://news.google.com/rss/search?q=intelligence+artificielle+technologie+innovation&hl=fr&gl=FR&ceid=FR:fr", tag:"Sciences & IA", tagC:"#0E7490"},
  {url:"https://news.google.com/rss/search?q=climat+environnement+COP+énergie&hl=fr&gl=FR&ceid=FR:fr",         tag:"Climat",          tagC:"#16A34A"},
  {url:"https://news.google.com/rss/search?q=afrique+sahel+développement+crise&hl=fr&gl=FR&ceid=FR:fr",        tag:"Afrique",         tagC:"#D97706"},
  {url:"https://news.google.com/rss/search?q=guerre+conflit+ukraine+moyen-orient&hl=fr&gl=FR&ceid=FR:fr",      tag:"Conflits",        tagC:"#E03535"},
  {url:"https://news.google.com/rss/search?q=droits+humains+justice+démocratie&hl=fr&gl=FR&ceid=FR:fr",        tag:"Droits & Justice", tagC:"#8B4513"},
  {url:"https://news.google.com/rss/search?q=Asie+Chine+Japon+Inde+Pacifique&hl=fr&gl=FR&ceid=FR:fr",         tag:"Asie-Pacifique",  tagC:"#1A5FD4"},
  {url:"https://news.google.com/rss/search?q=sport+culture+société+france&hl=fr&gl=FR&ceid=FR:fr",             tag:"Culture & Sport", tagC:"#16A34A"},
];

function extractCDATA(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g,"").trim();
}

function parseRSS(xml: string, feed: typeof FEEDS[0]): {id:string;title:string;link:string;pubDate:string;imgUrl:string|null;tag:string;tagC:string;src:string}[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  return items.slice(0, 8).map(item => {
    const rawTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const title = extractCDATA(rawTitle).slice(0, 160);
    const link  = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? item.match(/<link\s*\/>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const guid  = (item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? link).trim();
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    const imgUrl  = item.match(/url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/)?.[1] ?? null;
    const src = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() || feed.tag;
    if (!title || !link) return null;
    return { id: `gn-${guid}`, title, link, pubDate, imgUrl, tag: feed.tag, tagC: feed.tagC, src };
  }).filter(Boolean) as {id:string;title:string;link:string;pubDate:string;imgUrl:string|null;tag:string;tagC:string;src:string}[];
}

export async function GET() {
  const results = await Promise.allSettled(
    FEEDS.map(async feed => {
      const r = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        next: { revalidate: 120 }, // 2 min Vercel cache
      });
      if (!r.ok) return [];
      const xml = await r.text();
      return parseRSS(xml, feed);
    })
  );

  type Article = {id:string;title:string;link:string;pubDate:string;imgUrl:string|null;tag:string;tagC:string;src:string};
  const articles: Article[] = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<Article[]>).value);

  const seen = new Set<string>();
  const unique = articles.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Google News RSS search results aren't chronological — sort by actual
  // pubDate so the "live" feed doesn't surface week/month-old reposts above
  // fresh ones. Undated items sink to the bottom instead of breaking the sort.
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
