import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const url = new URL(req.url);
  const after = url.searchParams.get("after") || new Date(Date.now() - 30000).toISOString();
  const sql = await ensureSchema();
  if (!sql) return NextResponse.json([]);
  const rows = await sql`
    SELECT id, from_handle, type, payload, created_at
    FROM nexus_signals
    WHERE room_id = ${id}
      AND to_handle = ${user.handle}
      AND created_at > ${after}
    ORDER BY created_at ASC
    LIMIT 20
  `;
  return NextResponse.json(rows);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { toHandle, type, payload } = await req.json();
  if (!toHandle || !type || payload === undefined)
    return NextResponse.json({ error: "missing" }, { status: 400 });
  const sql = await ensureSchema();
  if (!sql) return NextResponse.json({ error: "db" }, { status: 500 });
  await sql`
    INSERT INTO nexus_signals (room_id, from_handle, to_handle, type, payload)
    VALUES (${id}, ${user.handle}, ${toHandle}, ${type}, ${payload})
  `;
  await sql`
    DELETE FROM nexus_signals
    WHERE room_id = ${id} AND created_at < now() - INTERVAL '2 minutes'
  `;
  return NextResponse.json({ ok: true });
}
