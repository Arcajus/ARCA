import { NextResponse } from "next/server";

export async function GET() {
  const geminiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_TTS_KEY;
  const azureRegion = process.env.AZURE_TTS_REGION;

  // Test Gemini
  let geminiOk = false;
  let geminiError = "";
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Di bonjour en un mot." }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
          signal: AbortSignal.timeout(8000),
        }
      );
      geminiOk = res.ok;
      if (!res.ok) geminiError = `HTTP ${res.status}`;
    } catch (e) {
      geminiError = String(e).slice(0, 80);
    }
  } else {
    geminiError = "GEMINI_API_KEY manquante";
  }

  // Test Azure TTS
  let azureOk = false;
  let azureError = "";
  if (azureKey && azureRegion) {
    try {
      const ssml = `<speak version='1.0' xml:lang='fr-FR'><voice name='fr-FR-DeniseNeural'>Test</voice></speak>`;
      const res = await fetch(
        `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": azureKey,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
            "User-Agent": "NexusApp",
          },
          body: ssml,
          signal: AbortSignal.timeout(8000),
        }
      );
      azureOk = res.ok;
      if (!res.ok) azureError = `HTTP ${res.status}`;
    } catch (e) {
      azureError = String(e).slice(0, 80);
    }
  } else {
    azureError = !azureKey ? "AZURE_TTS_KEY manquante" : "AZURE_TTS_REGION manquante";
  }

  return NextResponse.json({
    gemini: { ok: geminiOk, error: geminiError },
    azure: { ok: azureOk, error: azureError },
    env: {
      hasGemini: !!geminiKey,
      hasAzureKey: !!azureKey,
      azureRegion: azureRegion || "non défini",
    },
  });
}
