import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getCurrentUser, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  }
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  await sql`DELETE FROM nexus_users WHERE id = ${user.id}`;
  await clearSessionCookie();

  return NextResponse.json({ ok: true });
}
