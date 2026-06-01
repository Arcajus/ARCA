import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const maxDuration = 30; // Vercel: 30s max pour le plan pro, 10s hobby

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

const OPENAI_VOICE: Record<string, string> = {
  "fr-FR-DeniseNeural": "nova",
  "fr-FR-HenriNeural": "onyx",
  "fr-FR-EloiseNeural": "shimmer",
};

function escapeSSML(t: string) {
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function azureTTS(text: string, voice: string, key: string, region: string): Promise<Buffer> {
  const ssml = `<speak version='1.0' xml:lang='fr-FR'><voice name='${voice}'>${escapeSSML(text)}</voice></speak>`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
          "User-Agent": "NexusApp",
        },
        body: ssml,
        signal: controller.signal,
      }
    );
    if (!res.ok) throw new Error(`Azure TTS HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error("empty audio");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function openaiTTS(text: string, voice: string, key: string): Promise<Buffer> {
  const oaVoice = OPENAI_VOICE[voice] ?? "nova";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", input: text, voice: oaVoice, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

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

  // 1. Azure TTS — meilleure qualité française, clé serveur
  const azKey = process.env.AZURE_TTS_KEY;
  const azRegion = process.env.AZURE_TTS_REGION || "francecentral";
  if (azKey) {
    try {
      audio = await azureTTS(text, voice, azKey, azRegion);
    } catch (e) {
      console.error("[tts/azure]", e);
    }
  }

  // 2. OpenAI TTS — fallback si Azure absent
  if (!audio) {
    const oaKey = process.env.OPENAI_API_KEY;
    if (oaKey) {
      try {
        audio = await openaiTTS(text, voice, oaKey);
      } catch (e) {
        console.error("[tts/openai]", e);
      }
    }
  }

  // 3. Edge TTS — gratuit, pas de clé requise
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
