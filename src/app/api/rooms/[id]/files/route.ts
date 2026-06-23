import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const maxDuration = 30;

const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  const rows = await sql`
    SELECT f.id, f.name, f.doc_type, f.blob_url, f.size, f.mime_type, f.created_at, u.handle
    FROM nexus_room_files f
    JOIN nexus_users u ON u.id = f.user_id
    WHERE f.room_id = ${id}
    ORDER BY f.created_at ASC
  `;

  const files = rows.map((r) => ({
    id: r.id,
    name: r.name,
    docType: r.doc_type,
    url: r.blob_url,
    size: r.size,
    mimeType: r.mime_type,
    by: r.handle,
    time: new Date(r.created_at as string).getTime(),
  }));

  return NextResponse.json({ files });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Connecte-toi pour verser une pièce." }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Le stockage de fichiers (Vercel Blob) n'est pas encore configuré sur ce projet." },
      { status: 500 }
    );
  }

  const sql = await ensureSchema();
  if (!sql) {
    return NextResponse.json({ error: "NO_DATABASE" }, { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const docType = (form?.get("docType") as string) || "Document";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 20 Mo)." }, { status: 413 });
  }

  const blob = await put(`rooms/${id}/${Date.now()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  const rows = await sql`
    INSERT INTO nexus_room_files (room_id, user_id, name, doc_type, blob_url, size, mime_type)
    VALUES (${id}, ${user.id}, ${file.name}, ${docType}, ${blob.url}, ${file.size}, ${file.type || "application/octet-stream"})
    RETURNING id, created_at
  `;

  return NextResponse.json({
    file: {
      id: rows[0].id,
      name: file.name,
      docType,
      url: blob.url,
      size: file.size,
      mimeType: file.type,
      by: user.handle,
      time: new Date(rows[0].created_at as string).getTime(),
    },
  });
}
