import { NextRequest, NextResponse } from "next/server";

// In-memory rate limiter: 30 req/min per IP
// Note: resets per container instance on Vercel — sufficient for a small user base
const rl = new Map<string, { n: number; reset: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now > e.reset) {
    rl.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  if (e.n >= 30) return false;
  e.n++;
  return true;
}

const ANTI_REP =
  "\n\nRÈGLE ABSOLUE : Chaque réponse est unique — angle inédit, formulation nouvelle, jamais répétée dans cette conversation.";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (!allow(ip)) {
    return NextResponse.json(
      { error: { message: "Trop de requêtes. Réessaie dans une minute." } },
      { status: 429 }
    );
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: { message: "NO_SERVER_KEY" } },
      { status: 500 }
    );
  }

  let body: {
    sys: string;
    hist: unknown[];
    maxTokens: number;
    stream: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const { sys, hist, maxTokens = 400, stream = false } = body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:${
    stream ? "streamGenerateContent?alt=sse&" : "generateContent?"
  }key=${key}`;

  const geminiBody = JSON.stringify({
    system_instruction: { parts: [{ text: sys + ANTI_REP }] },
    contents: hist,
    generationConfig: { temperature: 1.0, topP: 0.95, maxOutputTokens: maxTokens },
  });

  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: geminiBody,
  });

  if (!geminiRes.ok) {
    const e = await geminiRes.text().catch(() => "");
    return NextResponse.json(
      { error: { message: `HTTP_${geminiRes.status}: ${e.slice(0, 120)}` } },
      { status: geminiRes.status }
    );
  }

  if (stream) {
    const { readable, writable } = new TransformStream();
    geminiRes.body!.pipeTo(writable);
    return new NextResponse(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const data = await geminiRes.json();
  return NextResponse.json(data);
}
