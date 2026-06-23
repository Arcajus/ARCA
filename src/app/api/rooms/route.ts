import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { seedRoomsIfEmpty } from "@/lib/seedRooms";

export async function GET() {
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }
  await seedRoomsIfEmpty(sql);

  const rows = await sql`
    SELECT
      r.id, r.type, r.topic, r.status, r.scheduled, r.max_participants,
      r.moderator_handle, r.room_number, r.trial_type,
      COUNT(p.id) FILTER (WHERE p.left_at IS NULL AND p.last_seen > now() - interval '20 seconds') AS live_count
    FROM nexus_rooms r
    LEFT JOIN nexus_room_participants p ON p.room_id = r.id
    GROUP BY r.id, r.type, r.topic, r.status, r.scheduled, r.max_participants,
      r.moderator_handle, r.room_number, r.trial_type
    ORDER BY r.created_at DESC
  `;

  const sims = rows.map((r) => ({
    id: r.id,
    type: r.type,
    topic: r.topic,
    status: r.status,
    scheduled: Number(r.scheduled),
    participants: Number(r.live_count),
    maxParticipants: r.max_participants,
    moderator: r.moderator_handle,
    room: r.room_number,
    trialType: r.trial_type ?? undefined,
  }));

  return NextResponse.json({ sims });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Connecte-toi pour créer une salle." }, { status: 401 });
  }
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : "";
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  const maxParticipants = Number(body?.maxParticipants) || 20;
  const trialType = typeof body?.trialType === "string" ? body.trialType : null;
  const scheduled = Number(body?.scheduled) || Date.now();
  const validTypes = ["onu", "proces", "debat", "assemblee", "conseil", "presse", "eloquence"];

  if (!validTypes.includes(type) || !topic) {
    return NextResponse.json({ error: "Type et sujet requis." }, { status: 400 });
  }

  const id = `r${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const status = scheduled > Date.now() ? "upcoming" : "open";

  await sql`
    INSERT INTO nexus_rooms (id, type, topic, status, scheduled, max_participants, moderator_id, moderator_handle, room_number, trial_type)
    VALUES (${id}, ${type}, ${topic}, ${status}, ${scheduled}, ${maxParticipants}, ${user.id}, ${user.handle}, 1, ${trialType})
  `;

  return NextResponse.json({
    sim: {
      id, type, topic, status, scheduled, participants: 0,
      maxParticipants, moderator: user.handle, room: 1, trialType: trialType ?? undefined,
    },
  });
}
