import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 45;

// In-memory rate limiter: 10 req/min per IP (dossier generation is heavier)
const rl = new Map<string, { n: number; reset: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now > e.reset) {
    rl.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  if (e.n >= 10) return false;
  e.n++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (!allow(ip)) {
    return NextResponse.json(
      { error: { message: "Trop de requêtes. Réessaie dans une minute." } },
      { status: 429 }
    );
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: { message: "NO_SERVER_KEY" } },
      { status: 500 }
    );
  }

  let body: { topic: string; trialType: "correctionnel" | "assises" | "civil" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const { topic, trialType = "correctionnel" } = body;

  if (!topic || typeof topic !== "string") {
    return NextResponse.json(
      { error: { message: "Le champ 'topic' est requis." } },
      { status: 400 }
    );
  }

  const typeName =
    trialType === "assises"
      ? "Cour d'Assises (crime)"
      : trialType === "civil"
      ? "Tribunal Civil (litige civil)"
      : "Tribunal Correctionnel (délit)";

  const prompt = `Tu es un juriste français expert. Génère un dossier pénal/civil réaliste et détaillé pour une simulation de procès devant le ${typeName}.

Affaire : "${topic}"

Réponds UNIQUEMENT avec un objet JSON valide respectant exactement ce schéma (sans commentaires, sans markdown, sans texte avant ou après) :

{
  "qualification": "qualification juridique précise (ex: vol avec violence, viol, escroquerie...)",
  "articleCode": "article du code pénal ou civil applicable (ex: Art. 311-4 CP, Art. 1240 C.civ.)",
  "peinesEncourues": "peines maximales encourues selon le code",
  "aggravantes": ["circonstance aggravante 1", "circonstance aggravante 2"],
  "prevenuNom": "Prénom NOM du prévenu/défendeur",
  "prevenuProfil": "3-4 phrases décrivant le prévenu : âge, profession, antécédents, personnalité, situation familiale",
  "victimeNom": "Prénom NOM de la victime (ou null si civil sans victime directe)",
  "victimeProfil": "3-4 phrases décrivant la victime : âge, profession, impact des faits",
  "chronologie": [
    "JJ/MM/AAAA HH:MM — Événement précis 1",
    "JJ/MM/AAAA HH:MM — Événement précis 2",
    "JJ/MM/AAAA HH:MM — Interpellation/saisine",
    "JJ/MM/AAAA HH:MM — Mise en examen/convocation",
    "JJ/MM/AAAA — Renvoi en jugement"
  ],
  "pieces": [
    {
      "id": "p1",
      "numero": 1,
      "titre": "Procès-verbal d'interpellation",
      "contenu": "3 à 5 phrases réalistes décrivant le contenu de cette pièce avec des détails factuels précis.",
      "type": "pv",
      "rolesAccessibles": ["president","procureur","avocat_gen","avocat_def","avocat_pc","partie_civile"]
    },
    {
      "id": "p2",
      "numero": 2,
      "titre": "Rapport d'expertise médico-légale",
      "contenu": "3 à 5 phrases réalistes.",
      "type": "expertise",
      "rolesAccessibles": ["president","procureur","avocat_gen","avocat_def","avocat_pc","partie_civile"]
    },
    {
      "id": "p3",
      "numero": 3,
      "titre": "Déclaration du prévenu en garde à vue",
      "contenu": "3 à 5 phrases reprenant les propos du prévenu lors de sa garde à vue.",
      "type": "declaration",
      "rolesAccessibles": ["prevenu","president","procureur","avocat_gen","avocat_def"]
    },
    {
      "id": "p4",
      "numero": 4,
      "titre": "Témoignage de [Prénom Témoin Principal]",
      "contenu": "3 à 5 phrases reprenant la déposition du témoin principal.",
      "type": "temoignage",
      "rolesAccessibles": ["temoin","president","procureur","avocat_gen","avocat_def","avocat_pc"]
    },
    {
      "id": "p5",
      "numero": 5,
      "titre": "Document pertinent à l'affaire",
      "contenu": "3 à 5 phrases décrivant ce document (contrat, relevé bancaire, message, etc.).",
      "type": "document",
      "rolesAccessibles": ["president","procureur","avocat_gen","avocat_def","avocat_pc","partie_civile"]
    },
    {
      "id": "p6",
      "numero": 6,
      "titre": "Second procès-verbal ou rapport",
      "contenu": "3 à 5 phrases.",
      "type": "pv",
      "rolesAccessibles": ["president","procureur","avocat_gen","avocat_def","avocat_pc","partie_civile"]
    }
  ],
  "positionProcureur": "2-3 phrases résumant la position du parquet/demandeur : faits reprochés, qualification retenue, peine requise",
  "positionDefense": "2-3 phrases résumant la position de la défense : arguments principaux, contestations",
  "positionPartieCivile": "2-3 phrases sur la position de la partie civile et ses demandes indemnitaires (ou null si pas de partie civile)",
  "objectifs": {
    "president": "Objectif du président : conduire les débats, garantir l'équité, établir la vérité",
    "procureur": "Objectif du procureur : démontrer la culpabilité et requérir la peine",
    "avocat_gen": "Objectif de l'avocat général : établir les faits criminels et requérir",
    "prevenu": "Objectif du prévenu : se défendre, contester les charges ou négocier",
    "avocat_def": "Objectif de l'avocat de la défense : disculper ou atténuer les charges",
    "partie_civile": "Objectif de la partie civile : obtenir réparation du préjudice",
    "avocat_pc": "Objectif de l'avocat de la partie civile",
    "jure": "Objectif du juré : écouter, poser des questions, délibérer en conscience",
    "temoin": "Objectif du témoin : déposer honnêtement les faits dont il a connaissance",
    "demandeur": "Objectif du demandeur : obtenir gain de cause",
    "defendeur": "Objectif du défendeur : rejeter les demandes adverses",
    "assesseur": "Objectif du juge assesseur : contribuer à la décision de la Cour",
    "public": "Objectif du public : observer l'audience"
  },
  "jurisprudence": [
    {"ref": "Cass. crim., JJ mois AAAA, n°XX-XXXXX", "titre": "Nom de l'arrêt ou de la décision", "resume": "2 phrases sur la décision et son lien direct avec cette affaire"},
    {"ref": "CEDH ou Cass. crim., JJ mois AAAA, n°XX-XXXXX", "titre": "Nom court", "resume": "2 phrases"}
  ]
}

RÈGLES IMPORTANTES :
- Adapte le contenu à "${topic}" avec des faits, noms, dates et lieux réalistes et cohérents
- Les pièces de type "pv", "expertise", "document" ont rolesAccessibles: ["president","procureur","avocat_gen","avocat_def","avocat_pc","partie_civile"] — jamais "jure", "public", "temoin"
- Les pièces de type "temoignage" incluent "temoin" (seulement pour sa propre déposition) + president, procureur, avocat_gen, avocat_def, avocat_pc
- Les pièces de type "declaration" (du prévenu) incluent "prevenu", president, procureur, avocat_gen, avocat_def
- Les rôles "jure" et "public" n'ont accès à AUCUNE pièce en avance — ils découvrent tout pendant l'audience
- Génère entre 5 et 7 pièces diversifiées selon la nature de l'affaire
- Génère exactement 2 entrées de jurisprudence (arrêts Cour de cassation chambre criminelle ou CEDH) thématiquement liées à l'affaire
- Tous les textes doivent être en français, réalistes et juridiquement cohérents
- Réponds UNIQUEMENT avec le JSON, sans aucun texte additionnel`;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;

  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }], role: "user" }],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: geminiBody,
  });

  if (!geminiRes.ok) {
    const e = await geminiRes.text().catch(() => "");
    return NextResponse.json(
      { error: { message: `HTTP_${geminiRes.status}: ${e.slice(0, 120)}` } },
      { status: geminiRes.status }
    );
  }

  const data = await geminiRes.json();

  // Extract the JSON text from Gemini response
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    return NextResponse.json(
      { error: { message: "No content in Gemini response" } },
      { status: 500 }
    );
  }

  let dossier: unknown;
  try {
    dossier = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: { message: "Failed to parse dossier JSON from Gemini" } },
      { status: 500 }
    );
  }

  return NextResponse.json({ dossier });
}
