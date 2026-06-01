import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

// Rate limiter: 60 req/min per IP
const rl = new Map<string, { n: number; reset: number }>();
function allow(ip: string): boolean {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now > e.reset) { rl.set(ip, { n: 1, reset: now + 60_000 }); return true; }
  if (e.n >= 60) return false;
  e.n++;
  return true;
}

const ALLOWED_VOICES = new Set([
  "fr-FR-DeniseNeural",
  "fr-FR-HenriNeural",
  "fr-FR-EloiseNeural",
]);

// Map to OpenAI voice names
const OPENAI_VOICE: Record<string, string> = {
  "fr-FR-DeniseNeural": "nova",
  "fr-FR-HenriNeural": "onyx",
  "fr-FR-EloiseNeural": "shimmer",
};

async function edgeTTS(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    audioStream.on("data", (c: Buffer) => chunks.push(c));
    audioStream.on("end", resolve);
    audioStream.on("error", reject);
  });
  const buf = Buffer.concat(chunks);
  if (buf.length < 100) throw new Error("empty audio");
  return buf;
}

async function openaiTTS(text: string, voice: string, key: string): Promise<Buffer> {
  const oaVoice = OPENAI_VOICE[voice] ?? "nova";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", input: text, voice: oaVoice, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(ip)) {
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  }

  let text: string, voice: string;
  try {
    const b = await req.json();
    text = (b.text || "").trim().slice(0, 3000);
    voice = ALLOWED_VOICES.has(b.voice) ? b.voice : "fr-FR-DeniseNeural";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });

  let audio: Buffer | null = null;

  // 1. Try OpenAI TTS if key is configured (best quality, guaranteed)
  const oaKey = process.env.OPENAI_API_KEY;
  if (oaKey) {
    try {
      audio = await openaiTTS(text, voice, oaKey);
    } catch (e) {
      console.error("[tts/openai]", e);
    }
  }

  // 2. Try Edge TTS (free Microsoft neural voices, no key needed)
  if (!audio) {
    try {
      audio = await edgeTTS(text, voice);
    } catch (e) {
      console.error("[tts/edge]", e);
    }
  }

  if (!audio) {
    return NextResponse.json({ error: "TTS unavailable" }, { status: 503 });
  }

  return new NextResponse(audio as unknown as BodyInit, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.length),
      "Cache-Control": "no-store",
    },
  });
}
