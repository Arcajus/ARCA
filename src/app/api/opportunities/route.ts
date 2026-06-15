import { NextResponse } from "next/server";

export const maxDuration = 30;

const JOB_FEEDS = [
  {q:"offre emploi stage CDI CDD analyste politique diplomatie droit international france",  type:"emploi", src:"Offres France"},
  {q:"recrutement ONG association humanitaire droits humains solidarité france",             type:"emploi", src:"ONG & Humanitaire"},
  {q:"emploi fonctionnaire attaché parlementaire diplomate concours ministère france",       type:"emploi", src:"Fonction publique"},
  {q:"stage alternance sciences po droit international relations bruxelles paris 2026",     type:"emploi", src:"Stages & Alternances"},
  {q:"offre emploi institutions européennes UE parlement commission bruxelles",              type:"emploi", src:"Institutions UE"},
  {q:"offre emploi ONU UNICEF PNUD UNESCO agences internationales 2026",                   type:"emploi", src:"Organisations internationales"},
  {q:"freelance consultant communication politique rédaction discours coaching oral",        type:"gigs",   src:"Consulting & Communication"},
  {q:"mission indépendant expert politique publique think tank analyse",                     type:"gigs",   src:"Expertise & Conseil"},
  {q:"conférence forum débat géopolitique sciences po 2026 inscription",                    type:"events", src:"Conférences & Forums"},
  {q:"MUN modèle nations unies simulation étudiants france 2026",                           type:"events", src:"MUN & Simulations"},
  {q:"tournoi éloquence concours débat compétition oratoire france 2026",                   type:"events", src:"Compétitions Oratoires"},
  {q:"salon emploi public secteur associatif recrutement forum carrières 2026",             type:"events", src:"Salons Emploi"},
];

const TYPE_COLORS: Record<string,string> = {emploi:"#2B78F5",gigs:"#7C3AED",events:"#16A34A",deals:"#D97706"};

function extractCDATA(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").trim();
}

function googleNewsUrl(q: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
}

function parseItems(xml: string, feed: typeof JOB_FEEDS[0]) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  return items.slice(0, 5).map(item => {
    const title   = extractCDATA(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").slice(0, 160);
    const link    = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const guid    = (item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? link).trim();
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    if (!title || !link) return null;
    return {
      id: `opp-${guid}`,
      title,
      src: feed.src,
      type: feed.type,
      link,
      time: pubDate ? new Date(pubDate).toLocaleDateString("fr-FR",{day:"numeric",month:"short"}) : "Récent",
      tag: feed.src.toUpperCase().slice(0, 20),
      tagC: TYPE_COLORS[feed.type] ?? "#2B78F5",
    };
  }).filter(Boolean);
}

export async function GET() {
  const results = await Promise.allSettled(
    JOB_FEEDS.map(async feed => {
      const r = await fetch(googleNewsUrl(feed.q), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        next: { revalidate: 3600 }, // 1h Vercel cache
      });
      if (!r.ok) return [];
      const xml = await r.text();
      return parseItems(xml, feed);
    })
  );

  const items = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<unknown[]>).value);

  const seen = new Set<string>();
  const unique = items.filter(o => {
    if (!o || seen.has((o as {id:string}).id)) return false;
    seen.add((o as {id:string}).id);
    return true;
  });

  return NextResponse.json({ items: unique }, {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=300" },
  });
}
