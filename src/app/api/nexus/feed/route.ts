import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";

export const maxDuration = 15;

export async function GET() {
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ articles: [] });
  }

  const rows = (await sql`
    SELECT id, title, hook, body, category, tag_color, sources, created_at
    FROM nexus_articles
    ORDER BY created_at DESC
    LIMIT 40
  `) as { id: number; title: string; hook: string; body: string; category: string; tag_color: string; sources: unknown; created_at: string }[];

  const articles = rows.map((r) => ({
    id: `nexus-${r.id}`,
    title: r.title,
    hook: r.hook,
    body: r.body,
    src: "NEXUS",
    tag: String(r.category).toUpperCase(),
    tagC: r.tag_color,
    time: r.created_at,
    sources: r.sources,
    isNexus: true,
  }));

  return NextResponse.json({ articles }, {
    headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=120" },
  });
}
