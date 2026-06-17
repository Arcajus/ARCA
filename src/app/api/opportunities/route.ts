import { NextResponse } from "next/server";

export const maxDuration = 30;

// Articles/annonces éditoriales (Gigs & Events) — pas de vraies offres d'emploi structurées disponibles via RSS
const JOB_FEEDS = [
  {q:"freelance consultant communication politique rédaction discours coaching oral",        type:"gigs",   src:"Consulting & Communication"},
  {q:"mission indépendant expert politique publique think tank analyse",                     type:"gigs",   src:"Expertise & Conseil"},
  {q:"conférence forum débat géopolitique sciences po 2026 inscription",                    type:"events", src:"Conférences & Forums"},
  {q:"MUN modèle nations unies simulation étudiants france 2026",                           type:"events", src:"MUN & Simulations"},
  {q:"tournoi éloquence concours débat compétition oratoire france 2026",                    type:"events", src:"Compétitions Oratoires"},
  {q:"salon emploi public secteur associatif recrutement forum carrières 2026",             type:"events", src:"Salons Emploi"},
];

// Vraies offres d'emploi — API Adzuna (gratuite, clé via ADZUNA_APP_ID/ADZUNA_APP_KEY sur Vercel)
const JOB_QUERIES = [
  {what:"stage alternance droit international relations",      src:"Stages & Alternances"},
  {what:"attaché parlementaire diplomate fonction publique",    src:"Fonction publique"},
  {what:"ONG association humanitaire droits humains",           src:"ONG & Humanitaire"},
  {what:"institutions européennes union européenne",            src:"Institutions UE"},
  {what:"organisation internationale ONU UNESCO",                src:"Organisations internationales"},
  {what:"analyste politique communication publique",             src:"Offres France"},
];

const TYPE_COLORS: Record<string,string> = {emploi:"#2B78F5",gigs:"#7C3AED",events:"#16A34A",deals:"#D97706"};

type Opportunity = {
  id: string; title: string; src: string; type: string; link: string;
  time: string; tag: string; tagC: string;
};

type AdzunaResult = {
  id: string;
  title: string;
  company?: { display_name?: string };
  redirect_url: string;
  created: string;
};

async function fetchAdzunaJobs(): Promise<Opportunity[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return [];

  const results = await Promise.allSettled(
    JOB_QUERIES.map(async ({ what, src }) => {
      const url = `https://api.adzuna.com/v1/api/jobs/fr/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=6&content-type=application/json&what=${encodeURIComponent(what)}`;
      const r = await fetch(url, { next: { revalidate: 3600 } });
      if (!r.ok) return [];
      const data = await r.json();
      const jobs: AdzunaResult[] = data?.results ?? [];
      return jobs.map((j): Opportunity => ({
        id: `adz-${j.id}`,
        title: `${j.title}${j.company?.display_name ? " — " + j.company.display_name : ""}`,
        src,
        type: "emploi",
        link: j.redirect_url,
        time: j.created ? new Date(j.created).toLocaleDateString("fr-FR",{day:"numeric",month:"short"}) : "Récent",
        tag: src.toUpperCase().slice(0, 20),
        tagC: TYPE_COLORS.emploi,
      }));
    })
  );

  return results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<Opportunity[]>).value);
}

function extractCDATA(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").trim();
}

function googleNewsUrl(q: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
}

function parseItems(xml: string, feed: typeof JOB_FEEDS[0]): Opportunity[] {
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
  }).filter(Boolean) as Opportunity[];
}

export async function GET() {
  const [adzunaJobs, rssResults] = await Promise.all([
    fetchAdzunaJobs(),
    Promise.allSettled(
      JOB_FEEDS.map(async feed => {
        const r = await fetch(googleNewsUrl(feed.q), {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
          next: { revalidate: 3600 }, // 1h Vercel cache
        });
        if (!r.ok) return [];
        const xml = await r.text();
        return parseItems(xml, feed);
      })
    ),
  ]);

  const rssItems = rssResults
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<Opportunity[]>).value);

  const items = [...adzunaJobs, ...rssItems];

  const seen = new Set<string>();
  const unique = items.filter(o => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });

  return NextResponse.json({ items: unique }, {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=300" },
  });
}
