import { neon, NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

// Connecté automatiquement via DATABASE_URL une fois la base Neon/Postgres
// liée au projet Vercel (Storage → Create Database → Postgres).
function getSql(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(): Promise<Sql | null> {
  const sql = getSql();
  if (!sql) return null;
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS nexus_articles (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        hook TEXT NOT NULL,
        body TEXT NOT NULL,
        category TEXT NOT NULL,
        tag_color TEXT NOT NULL,
        sources JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.then(() => undefined);
  }
  await schemaReady;
  return sql;
}
