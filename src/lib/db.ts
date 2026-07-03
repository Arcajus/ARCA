import { neon, NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

// Connecté automatiquement via DATABASE_URL une fois la base Neon/Postgres
// liée au projet Vercel (Storage → Create Database → Postgres).
function getSql(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

async function createSchema(sql: Sql): Promise<void> {
  await sql`
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
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nexus_users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nexus_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES nexus_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nexus_rooms (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      topic TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled BIGINT NOT NULL,
      max_participants INTEGER NOT NULL,
      moderator_id INTEGER REFERENCES nexus_users(id) ON DELETE SET NULL,
      moderator_handle TEXT NOT NULL,
      room_number INTEGER NOT NULL,
      trial_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nexus_room_participants (
      id SERIAL PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES nexus_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES nexus_users(id) ON DELETE CASCADE,
      role_label TEXT,
      mic_on BOOLEAN NOT NULL DEFAULT false,
      cam_on BOOLEAN NOT NULL DEFAULT false,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      left_at TIMESTAMPTZ,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(room_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nexus_room_files (
      id SERIAL PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES nexus_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES nexus_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      blob_url TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nexus_signals (
      id SERIAL PRIMARY KEY,
      room_id TEXT NOT NULL,
      from_handle TEXT NOT NULL,
      to_handle TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_nexus_signals_to
    ON nexus_signals(room_id, to_handle, created_at)
  `;
}

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(): Promise<Sql | null> {
  const sql = getSql();
  if (!sql) return null;
  if (!schemaReady) {
    schemaReady = createSchema(sql);
  }
  await schemaReady;
  return sql;
}
