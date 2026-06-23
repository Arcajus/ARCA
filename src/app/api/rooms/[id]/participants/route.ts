import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  const rows = await sql`
    SELECT u.handle, p.role_label, p.mic_on, p.cam_on, p.joined_at
    FROM nexus_room_participants p
    JOIN nexus_users u ON u.id = p.user_id
    WHERE p.room_id = ${id}
      AND p.left_at IS NULL
      AND p.last_seen > now() - interval '20 seconds'
    ORDER BY p.joined_at ASC
  `;

  const participants = rows.map((r) => ({
    handle: r.handle,
    roleLabel: r.role_label,
    micOn: r.mic_on,
    camOn: r.cam_on,
  }));

  return NextResponse.json({ participants });
}
