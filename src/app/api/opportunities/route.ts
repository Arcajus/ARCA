import { NextResponse } from "next/server";

export const maxDuration = 30;

type LiveOpp = {
  id: string;
  title: string;
  src: string;
  type: "emploi" | "gigs";
  link: string;
  time: string;
  tag: string;
  tagC: string;
  country?: string;
  domain?: string;
  deadlineIso?: string;
};

// ── ReliefWeb : offres mondiales ONU / ONG / humanitaire (gratuit, sans clé) ─
const DOMAIN_FR: Record<string, string> = {
  "Program/Project Management":          "Gestion de projet",
  "Information and Communications Technology": "IT & Numérique",
  "Donor Relations/Grants Management":   "Relations bailleurs",
  "Human Resources":                     "Ressources humaines",
  "Logistics and Procurement":           "Logistique",
  "Monitoring and Evaluation":           "Suivi-Évaluation",
  "Coordination":                        "Coordination",
  "Communication and Advocacy":          "Communication",
  "Health":                              "Santé",
  "Education":                           "Éducation",
  "Legal":                               "Droit",
  "Finance":                             "Finance",
  "Food and Nutrition":                  "Alimentation",
  "Protection and Human Rights":         "Droits de l'Homme",
  "Safety and Security":                 "Sécurité",
  "Water Sanitation Hygiene":            "Eau & Assainissement",
  "Administration":                      "Administration",
  "Agriculture":                         "Agriculture",
};

async function fetchReliefWebJobs(): Promise<LiveOpp[]> {
  const today = new Date().toISOString().slice(0, 10);

  const body = {
    limit: 50,
    sort: ["date.created:desc"],
    filter: { field: "status", value: "open" },
    fields: {
      include: ["title", "url_alias", "url", "date", "country", "source", "type", "career_categories"],
    },
  };

  const r = await fetch("https://api.reliefweb.int/v1/jobs?appname=nexus", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 3600 },
  });

  if (!r.ok) return [];
  const data = await r.json();

  return ((data.data ?? []) as Record<string, unknown>[]).flatMap((item) => {
    const f = (item.fields ?? {}) as Record<string, unknown>;
    const countries = f.country as Array<{ name?: string }> | undefined;
    const sources   = f.source  as Array<{ name?: string }> | undefined;
    const types     = f.type    as Array<{ name?: string }> | undefined;
    const cats      = f.career_categories as Array<{ name?: string }> | undefined;
    const dateObj   = f.date    as { closing?: string } | undefined;

    const country   = countries?.[0]?.name ?? "International";
    const org       = sources?.[0]?.name   ?? "Organisation internationale";
    const closingRaw = dateObj?.closing;
    const deadline  = closingRaw ? closingRaw.slice(0, 10) : undefined;

    if (deadline && deadline < today) return [];

    const cat    = cats?.[0]?.name ?? "";
    const domain = DOMAIN_FR[cat] ?? "Relations internationales";
    const jobType = (types?.[0]?.name ?? "Job").toLowerCase();
    const isInternship = jobType.includes("intern") || jobType.includes("volunteer");

    const link = (f.url as string | undefined)
      ?? (f.url_alias as string | undefined)
      ?? `https://reliefweb.int/job/${item.id as string}`;

    return [{
      id:          `rw-${item.id as string}`,
      title:       (f.title as string | undefined) ?? "Offre sans titre",
      src:         org,
      type:        "emploi" as const,
      link,
      time:        deadline
        ? `Clôture : ${new Date(deadline + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}`
        : "Ouvert",
      tag:         isInternship ? "STAGE" : "EMPLOI",
      tagC:        isInternship ? "#2B78F5" : "#16A34A",
      country,
      domain,
      deadlineIso: deadline,
    } satisfies LiveOpp];
  });
}

// ── Adzuna : offres françaises (optionnel — nécessite env ADZUNA_APP_ID / _KEY) ─
type AdzunaResult = {
  id: string;
  title: string;
  company?: { display_name?: string };
  redirect_url: string;
  created: string;
};

const JOB_QUERIES: Array<{ what: string; domain: string }> = [
  { what: "stage alternance droit international relations", domain: "Droit international" },
  { what: "attaché parlementaire diplomate fonction publique", domain: "Diplomatie" },
  { what: "ONG humanitaire droits humains", domain: "Humanitaire" },
  { what: "institutions européennes union européenne", domain: "Institutions UE" },
  { what: "organisation internationale ONU UNESCO", domain: "Organisations int." },
];

async function fetchAdzunaJobs(): Promise<LiveOpp[]> {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return [];

  const results = await Promise.allSettled(
    JOB_QUERIES.map(async ({ what, domain }) => {
      const url = `https://api.adzuna.com/v1/api/jobs/fr/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=8&content-type=application/json&what=${encodeURIComponent(what)}`;
      const r = await fetch(url, { next: { revalidate: 3600 } });
      if (!r.ok) return [];
      const d = await r.json() as { results?: AdzunaResult[] };
      return (d.results ?? []).map((j): LiveOpp => ({
        id:      `adz-${j.id}`,
        title:   `${j.title}${j.company?.display_name ? " — " + j.company.display_name : ""}`,
        src:     j.company?.display_name ?? "Employeur",
        type:    "emploi",
        link:    j.redirect_url,
        time:    j.created
          ? new Date(j.created).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
          : "Récent",
        tag:     "EMPLOI",
        tagC:    "#16A34A",
        country: "France",
        domain,
      }));
    })
  );

  return results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<LiveOpp[]>).value);
}

// ── GET ────────────────────────────────────────────────────────────────────
export async function GET() {
  const [rwRes, adzRes] = await Promise.allSettled([
    fetchReliefWebJobs(),
    fetchAdzunaJobs(),
  ]);

  const items: LiveOpp[] = [
    ...(rwRes.status  === "fulfilled" ? rwRes.value  : []),
    ...(adzRes.status === "fulfilled" ? adzRes.value : []),
  ];

  const seen  = new Set<string>();
  const unique = items.filter(o => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });

  return NextResponse.json({ items: unique }, {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=300" },
  });
}
