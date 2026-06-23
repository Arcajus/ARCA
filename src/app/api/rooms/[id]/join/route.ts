import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Connecte-toi pour rejoindre la salle." }, { status: 401 });
  }
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const roleLabel = typeof body?.roleLabel === "string" ? body.roleLabel.slice(0, 80) : null;

  await sql`
    INSERT INTO nexus_room_participants (room_id, user_id, role_label, joined_at, last_seen, left_at)
    VALUES (${id}, ${user.id}, ${roleLabel}, now(), now(), NULL)
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET role_label = ${roleLabel}, left_at = NULL, last_seen = now()
  `;

  return NextResponse.json({ ok: true });
}
