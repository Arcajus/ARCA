import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { hashPassword, createSession, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const handle = typeof body?.handle === "string" ? body.handle.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !email.includes("@") || handle.length < 3 || password.length < 8) {
    return NextResponse.json(
      { error: "Email, pseudo (3+ caractères) et mot de passe (8+ caractères) requis." },
      { status: 400 }
    );
  }

  const existing = await sql`
    SELECT id FROM nexus_users WHERE email = ${email} OR handle = ${handle}
  `;
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Cet email ou ce pseudo est déjà utilisé." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const rows = await sql`
    INSERT INTO nexus_users (email, handle, password_hash)
    VALUES (${email}, ${handle}, ${passwordHash})
    RETURNING id, email, handle
  `;
  const user = rows[0];

  const token = await createSession(sql, user.id as number);
  await setSessionCookie(token);

  return NextResponse.json({ user });
}
