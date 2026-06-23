import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Heartbeat called every few seconds by clients in a room so the
// participant list reflects who is actually still present.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const micOn = Boolean(body?.micOn);
  const camOn = Boolean(body?.camOn);

  await sql`
    UPDATE nexus_room_participants
    SET last_seen = now(), mic_on = ${micOn}, cam_on = ${camOn}, left_at = NULL
    WHERE room_id = ${id} AND user_id = ${user.id}
  `;

  return NextResponse.json({ ok: true });
}
