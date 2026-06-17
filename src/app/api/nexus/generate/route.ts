import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";

export const maxDuration = 60;

// Catégories couvertes par NEXUS Originals — une synthèse par catégorie et par exécution.
const TOPICS = [
  { q: "géopolitique diplomatie international", category: "Géopolitique", color: "#1A5FD4" },
  { q: "france politique gouvernement assemblée nationale", category: "Politique", color: "#E03535" },
  { q: "europe union européenne parlement", category: "Europe", color: "#7C3AED" },
  { q: "économie finance marchés inflation", category: "Économie", color: "#D97706" },
  { q: "intelligence artificielle technologie", category: "Sciences & IA", color: "#0E7490" },
  { q: "climat environnement énergie", category: "Climat", color: "#16A34A" },
  { q: "football ligue 1 champions league transferts", category: "Football", color: "#16A34A" },
  { q: "basketball nba euroligue", category: "Basketball", color: "#EA580C" },
  { q: "handball championnat ligue lnh", category: "Handball", color: "#9333EA" },
  { q: "sport compétition olympique", category: "Sport", color: "#0EA5E9" },
];

const MIN_DISTINCT_SOURCES = 3;

type Headline = { title: string; link: string; src: string };

function extractCDATA(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
}

async function fetchHeadlines(q: string): Promise<Headline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } });
  if (!r.ok) return [];
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]).slice(0, 8);
  return items.map(item => {
    const title = extractCDATA(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const link = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const src = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() || "";
    return { title, link, src };
  }).filter(h => h.title && h.link);
}

async function writeArticle(category: string, headlines: Headline[], key: string) {
  const prompt = `Tu es le rédacteur en chef de NEXUS, un média qui synthétise l'actualité ${category} de façon factuelle et percutante (style "Brut" : phrases courtes, accrocheuses, zéro jargon).

Voici des titres de presse publiés récemment par plusieurs médias indépendants sur ce thème :
${headlines.map((h, i) => `${i + 1}. [${h.src}] ${h.title}`).join("\n")}

Rédige une synthèse de ces informations, UNIQUEMENT à partir des faits présents dans ces titres — n'invente aucun fait, aucun chiffre, aucune citation qui n'y figure pas. Si les titres sont insuffisants ou trop vagues pour écrire un article factuel, réponds avec "body": "".

Réponds UNIQUEMENT en JSON valide :
{"title":"titre court et factuel (max 90 caractères)","hook":"une phrase d'accroche percutante (max 140 caractères)","body":"3 à 5 phrases de synthèse factuelle, sans markdown"}`;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const res = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, topP: 0.9, maxOutputTokens: 500, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { title: string; hook: string; body: string };
    if (!parsed.body || !parsed.title) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Vercel Cron déclenche cette route en GET avec Authorization: Bearer ${CRON_SECRET}.
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "DATABASE_URL non configurée" }, { status: 500 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "GEMINI_API_KEY manquante" }, { status: 500 });
  }

  const results = await Promise.all(TOPICS.map(async (topic) => {
    const headlines = await fetchHeadlines(topic.q);
    const distinctSources = new Set(headlines.map(h => h.src).filter(Boolean));
    if (distinctSources.size < MIN_DISTINCT_SOURCES) {
      return { ok: false as const, label: `${topic.category} (${distinctSources.size} sources)` };
    }

    const article = await writeArticle(topic.category, headlines, key);
    if (!article) {
      return { ok: false as const, label: `${topic.category} (génération échouée)` };
    }

    await sql`
      INSERT INTO nexus_articles (title, hook, body, category, tag_color, sources)
      VALUES (${article.title}, ${article.hook}, ${article.body}, ${topic.category}, ${topic.color}, ${JSON.stringify(headlines.slice(0, 6))})
    `;
    return { ok: true as const, label: topic.category };
  }));

  const published = results.filter(r => r.ok).map(r => r.label);
  const skipped = results.filter(r => !r.ok).map(r => r.label);

  return NextResponse.json({ published, skipped });
}
