import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  await sql`
    UPDATE nexus_room_participants
    SET left_at = now()
    WHERE room_id = ${id} AND user_id = ${user.id}
  `;

  return NextResponse.json({ ok: true });
}
