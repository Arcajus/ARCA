import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 45;

const rl = new Map<string, { n: number; reset: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now > e.reset) { rl.set(ip, { n: 1, reset: now + 60_000 }); return true; }
  if (e.n >= 10) return false;
  e.n++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(ip)) return NextResponse.json({ error: { message: "Trop de requêtes. Réessaie dans une minute." } }, { status: 429 });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: { message: "NO_SERVER_KEY" } }, { status: 500 });

  let body: { topic: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 }); }

  const { topic } = body;
  if (!topic) return NextResponse.json({ error: { message: "Le champ 'topic' est requis." } }, { status: 400 });

  const prompt = `Tu es un juriste constitutionnaliste français expert. Génère un dossier législatif réaliste pour une simulation de séance à l'Assemblée nationale.

Projet de loi : "${topic}"

Réponds UNIQUEMENT avec un objet JSON valide (sans commentaires, sans markdown, sans texte avant/après) :

{
  "titre": "Intitulé officiel du projet de loi (ex: Projet de loi n°XXXX relatif à...)",
  "exposeMotifs": "3-4 phrases d'exposé des motifs : contexte, objectifs, urgence de la mesure",
  "articles": [
    {"numero": 1, "titre": "Titre court de l'article", "texte": "Texte de l'article en 2-3 phrases juridiques précises"},
    {"numero": 2, "titre": "Titre court", "texte": "Texte juridique précis"},
    {"numero": 3, "titre": "Titre court", "texte": "Texte juridique précis"}
  ],
  "amendements": [
    {"numero": 1, "auteur": "Groupe d'opposition [nom]", "article": 1, "objet": "Amendement de suppression — [raison]"},
    {"numero": 2, "auteur": "Groupe majoritaire [nom]", "article": 2, "objet": "Amendement de précision technique — [objet]"},
    {"numero": 3, "auteur": "Gouvernement", "article": 3, "objet": "Sous-amendement de coordination — [objet]"}
  ],
  "positionGouvernement": "2 phrases résumant la position du Gouvernement et ses arguments en faveur du texte",
  "positionMajoritaire": "2 phrases résumant la position du groupe majoritaire — pourquoi il soutient le texte",
  "positionOpposition": "2 phrases résumant la position du groupe d'opposition — critique principale et vote annoncé",
  "jurisprudenceCC": [
    {"ref": "Décision n°XXXX-XXX DC du JJ mois AAAA", "titre": "Nom court de la décision", "resume": "2 phrases sur la jurisprudence et son lien avec ce texte"},
    {"ref": "Décision n°XXXX-XXX DC du JJ mois AAAA", "titre": "Nom court", "resume": "2 phrases"}
  ],
  "objectifs": {
    "president_an": "Conduire les débats, garantir le respect du règlement et l'expression de tous les groupes",
    "ministre": "Défendre le texte, répondre aux critiques, convaincre les indécis",
    "rapporteur": "Expliquer le texte techniquement, porter les amendements de la commission",
    "depute_maj": "Soutenir le texte, valoriser ses bénéfices, voter pour",
    "depute_opp": "Critiquer le texte, proposer des alternatives, déposer des amendements de suppression"
  }
}

RÈGLES :
- Adapte tout le contenu à "${topic}" avec des détails réalistes, des numéros plausibles, des noms de groupes parlementaires français (Renaissance, RN, LFI, PS, LR, MoDem...)
- La jurisprudenceCC doit citer 2 décisions du Conseil constitutionnel thématiquement proches
- Les articles doivent être en langage législatif français authentique
- Tous les textes en français
- Réponds UNIQUEMENT avec le JSON`;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }], role: "user" }],
    generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 3000, responseMimeType: "application/json" },
  });

  const geminiRes = await fetch(geminiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody });
  if (!geminiRes.ok) {
    const e = await geminiRes.text().catch(() => "");
    return NextResponse.json({ error: { message: `HTTP_${geminiRes.status}: ${e.slice(0, 120)}` } }, { status: geminiRes.status });
  }

  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return NextResponse.json({ error: { message: "No content in Gemini response" } }, { status: 500 });

  let dossier: unknown;
  try { dossier = JSON.parse(text); }
  catch { return NextResponse.json({ error: { message: "Failed to parse dossier JSON" } }, { status: 500 }); }

  return NextResponse.json({ dossier });
}
