"use client";
import { useState, useEffect, useRef } from "react";

// ── THEMES ──────────────────────────────────────────────────
const DARK = {
  bg:"#07090F",bg2:"#0B0F1A",surf:"#0F1420",card:"#131928",
  b1:"#1C2840",b2:"#263856",blue:"#1A5FD4",blueB:"#2B78F5",
  blueG:"rgba(43,120,245,0.10)",blueG2:"rgba(43,120,245,0.05)",
  text:"#EDF2FC",textD:"#8898BB",muted:"#384F6A",
  red:"#E03535",green:"#16A34A",amber:"#D97706",purple:"#7C3AED",mode:"dark"
};
const LIGHT = {
  bg:"#F2F5FA",bg2:"#FFF",surf:"#FFF",card:"#FFF",
  b1:"#DDE4EF",b2:"#C5D0E5",blue:"#1A5FD4",blueB:"#2B78F5",
  blueG:"rgba(43,120,245,0.07)",blueG2:"rgba(43,120,245,0.03)",
  text:"#0C1117",textD:"#4A5A72",muted:"#9BAABB",
  red:"#DC2626",green:"#15803D",amber:"#D97706",purple:"#7C3AED",mode:"light"
};
type Theme = typeof DARK;

// ── TTS ──────────────────────────────────────────────────────
let _hfAudio: HTMLAudioElement | null = null;
let _ttsActive = false;
let _keepAlive: ReturnType<typeof setInterval> | null = null;

// ElevenLabs (haute qualité — fallback auto sur Web Speech si quota épuisé)
const EL_VOICES_F = ["XB0fDUnXU5powFXDhCwa","Xb7hH8MSUJpSbSDYk0k2","21m00Tcm4TlvDq8ikWAM","EXAVITQu4vr4xnSDxMaL"];
const EL_VOICES_M = ["nPczCjzI2devNBz1zQrb","N2lVS1w4EtoT3dr4eOWO","29vD33N1CtxCmqQRPOHJ","ErXwobaYiN019PkySvjV"];
async function speakEL(text: string, gender: "M"|"F", key: string, onEnd?: ()=>void): Promise<boolean> {
  const voices = gender === "F" ? EL_VOICES_F : EL_VOICES_M;
  if (_hfAudio) { _hfAudio.pause(); _hfAudio.onended = null; }
  for (const voiceId of voices) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "Accept": "audio/mpeg", "Content-Type": "application/json", "xi-api-key": key },
        body: JSON.stringify({ text: text.slice(0, 3000), model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8 } })
      });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size < 100) continue;
      const url = URL.createObjectURL(blob);
      if (_hfAudio) { _hfAudio.pause(); _hfAudio.onended = null; }
      _hfAudio = new Audio(url);
      _hfAudio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
      _hfAudio.onerror = () => { URL.revokeObjectURL(url); onEnd?.(); };
      await _hfAudio.play();
      return true;
    } catch { continue; }
  }
  return false;
}

function cleanForSpeech(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[PRÉSIDENT\]|\[PROCUREUR\]|\[AVOCAT[^\]]*\]/gi, '')
    .replace(/═+[^═]*/g, '')
    .replace(/\[[^\]]{1,30}\]/g, '')
    .replace(/[^\x00-\x7FÀ-ɏḀ-ỿ]/g, '') // strip emoji/flags
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function chunkText(text: string, max: number): string[] {
  const sentences = text.replace(/([.!?;:])\s+/g, '$1\n').split('\n').map(s=>s.trim()).filter(s=>s.length>1);
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) { out.push(s); continue; }
    let rem = s;
    while (rem.length > max) {
      let cut = rem.lastIndexOf(', ', max);
      if (cut < 20) cut = rem.lastIndexOf(' ', max);
      if (cut < 20) cut = max;
      out.push(rem.slice(0, cut).trim());
      rem = rem.slice(cut).trim();
    }
    if (rem) out.push(rem);
  }
  return out.filter(c=>c.length>0);
}

async function speakGoogleTTS(text: string, gender: "M"|"F", onEnd?: ()=>void): Promise<boolean> {
  const chunks = chunkText(cleanForSpeech(text), 180);
  if (!chunks.length) { onEnd?.(); return true; }
  const url = (t: string) =>
    `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(t)}&tl=fr&client=tw-ob&ttsspeed=1`;
  let idx = 0;
  const playNext = () => {
    if (!_ttsActive || idx >= chunks.length) { if (_ttsActive) onEnd?.(); return; }
    const a = new Audio(url(chunks[idx++]));
    a.playbackRate = gender === "M" ? 0.88 : 1.0;
    a.onended = playNext;
    a.onerror = playNext;
    a.play().catch(playNext);
  };
  // Test first chunk — if play() rejects (CORS/permission), fallback to Web Speech
  const first = new Audio(url(chunks[0]));
  first.playbackRate = gender === "M" ? 0.88 : 1.0;
  try {
    await first.play();
    idx = 1;
    first.onended = playNext;
    first.onerror = playNext;
    return true;
  } catch { return false; }
}

function speakWeb(text: string, gender: "M"|"F", onEnd?: ()=>void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  if (_keepAlive) { clearInterval(_keepAlive); _keepAlive = null; }
  const sentences = chunkText(cleanForSpeech(text), 230);
  if (!sentences.length) { onEnd?.(); return; }
  const init = () => {
    const vs = window.speechSynthesis.getVoices();
    const pick = (c:(v:SpeechSynthesisVoice)=>boolean)=>vs.find(c)||null;
    // Priorité: Google Français > autres Google fr-FR > Microsoft Denise/Henri > Microsoft fr-FR > any fr-FR > any fr
    const fr =
      pick(v=>v.lang==="fr-FR" && /google français/i.test(v.name)) ||
      pick(v=>v.lang==="fr-FR" && /google/i.test(v.name)) ||
      (gender==="F" ? pick(v=>v.lang==="fr-FR" && /denise|hortense/i.test(v.name)) : null) ||
      (gender==="M" ? pick(v=>v.lang==="fr-FR" && /henri|paul/i.test(v.name)) : null) ||
      pick(v=>v.lang==="fr-FR" && /microsoft/i.test(v.name)) ||
      pick(v=>v.lang==="fr-FR") || pick(v=>v.lang.startsWith("fr")) || null;
    let i=0;
    // Fix Chrome: speechSynthesis se fige silencieusement après ~15s
    _keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
    const done = () => {
      if (_keepAlive) { clearInterval(_keepAlive); _keepAlive = null; }
      if (_ttsActive) onEnd?.();
    };
    const next=()=>{
      if(!_ttsActive||i>=sentences.length){done();return;}
      const u=new SpeechSynthesisUtterance(sentences[i++]);
      u.lang="fr-FR";
      u.rate = gender==="F" ? 0.92 : 0.90;
      u.pitch = gender==="F" ? 1.0 : 0.95;
      u.volume = 1.0;
      if(fr) u.voice=fr;
      u.onend=next; u.onerror=()=>{if(_ttsActive)next();};
      window.speechSynthesis.speak(u);
    };
    next();
  };
  if(window.speechSynthesis.getVoices().length>0) init();
  else {
    const fb=setTimeout(()=>{window.speechSynthesis.onvoiceschanged=null;init();},400);
    window.speechSynthesis.onvoiceschanged=()=>{clearTimeout(fb);window.speechSynthesis.onvoiceschanged=null;init();};
  }
}
function speakAny(text: string, gender: "M"|"F" = "F", onEnd?: ()=>void) {
  _ttsActive = true;
  const elKey = typeof window !== "undefined" ? localStorage.getItem("el_key") : null;
  if (elKey) {
    speakEL(cleanForSpeech(text), gender, elKey, onEnd)
      .then(ok => { if (!ok) speakWeb(text, gender, onEnd); })
      .catch(() => speakWeb(text, gender, onEnd));
  } else {
    speakWeb(text, gender, onEnd);
  }
}
function stopSpeech() {
  _ttsActive = false;
  if (_keepAlive) { clearInterval(_keepAlive); _keepAlive = null; }
  if (_hfAudio) { _hfAudio.pause(); _hfAudio.onended = null; }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
type GHist = {role:"user"|"model";parts:{text:string}[]}[];
function sanitizeHist(hist:GHist):GHist {
  const clean:GHist=[];
  for(const msg of hist){
    if(clean.length===0){if(msg.role==="user")clean.push({role:msg.role,parts:[...msg.parts]});}
    else if(msg.role!==clean[clean.length-1].role) clean.push({role:msg.role,parts:[...msg.parts]});
    else clean[clean.length-1]={role:msg.role,parts:[{text:clean[clean.length-1].parts[0].text+" "+msg.parts[0].text}]};
  }
  return clean;
}
const GEMINI_URL=(key:string,stream=false)=>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:${stream?"streamGenerateContent?alt=sse&":"generateContent?"}key=${key}`;
const GEMINI_CFG={temperature:1.0,topP:0.95};
const ANTI_REP="\n\nRÈGLE ABSOLUE : Chaque réponse est unique — angle inédit, formulation nouvelle, jamais répétée dans cette conversation.";

// Non-streaming — used when full text is needed before acting (audio TTS)
async function callGemini(sys:string, hist:GHist, key:string, maxTokens=400):Promise<string> {
  const clean=sanitizeHist(hist);
  if(!clean.length||clean[clean.length-1].role!=="user") throw new Error("invalid_hist");
  const res=await fetch(GEMINI_URL(key),{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({system_instruction:{parts:[{text:sys+ANTI_REP}]},contents:clean,generationConfig:{...GEMINI_CFG,maxOutputTokens:maxTokens}})});
  if(!res.ok){const e=await res.text().catch(()=>"");throw new Error(`HTTP_${res.status}: ${e.slice(0,120)}`);}
  const d=await res.json();
  if(d.error) throw new Error(d.error.message||"gemini_error");
  const text=(d.candidates?.[0]?.content?.parts as {text:string}[]|undefined)?.map(p=>p.text).join("")||"";
  if(!text) throw new Error(d.candidates?.[0]?.finishReason||"empty");
  return text;
}

// Streaming — text appears word by word as Gemini generates it
async function streamGemini(sys:string, hist:GHist, key:string, maxTokens:number, onChunk:(full:string)=>void):Promise<string> {
  const clean=sanitizeHist(hist);
  if(!clean.length||clean[clean.length-1].role!=="user") throw new Error("invalid_hist");
  const res=await fetch(GEMINI_URL(key,true),{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({system_instruction:{parts:[{text:sys+ANTI_REP}]},contents:clean,generationConfig:{...GEMINI_CFG,maxOutputTokens:maxTokens}})});
  if(!res.ok){const e=await res.text().catch(()=>"");throw new Error(`HTTP_${res.status}: ${e.slice(0,120)}`);}
  const reader=res.body!.getReader();
  const dec=new TextDecoder();
  let full="",buf="";
  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split("\n");buf=lines.pop()||"";
    for(const line of lines){
      if(!line.startsWith("data: ")) continue;
      const json=line.slice(6).trim();
      if(!json||json==="[DONE]") continue;
      try{
        const chunk=JSON.parse(json);
        if(chunk.error) throw new Error(chunk.error.message||"stream_error");
        const delta=(chunk.candidates?.[0]?.content?.parts as {text:string}[]|undefined)?.map(p=>p.text).join("")||"";
        if(delta){full+=delta;onChunk(full);}
      }catch(e){const m=(e as Error).message||"";if(m.includes("stream_error")||m.startsWith("HTTP_"))throw e;}
    }
  }
  if(!full) throw new Error("empty");
  return full;
}

// iOS: call during a user gesture to pre-create and unlock the Audio element
let _audioUnlocked = false;
function unlockAudio() {
  if (_audioUnlocked || typeof window === "undefined") return;
  _audioUnlocked = true;
  _hfAudio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
  _hfAudio.play().catch(() => {});
  try { const ac = new AudioContext(); ac.resume().catch(()=>{}); } catch{/* */}
}

// ── ICONS ────────────────────────────────────────────────────
function Ic({n,s=22,c="currentColor",w=1.6}:{n:string;s?:number;c?:string;w?:number}) {
  const st={width:s,height:s,display:"block" as const,flexShrink:0};
  const p={fill:"none",stroke:c,strokeWidth:w,strokeLinecap:"round" as const,strokeLinejoin:"round" as const};
  const icons: Record<string,React.ReactNode> = {
    feed:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path {...p} d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/></svg>,
    mic:<svg style={st} viewBox="0 0 24 24"><rect {...p} x="9" y="2" width="6" height="12" rx="3"/><path {...p} d="M5 10a7 7 0 0014 0M12 19v3M8 22h8"/></svg>,
    micOff:<svg style={st} viewBox="0 0 24 24"><line {...p} x1="2" y1="2" x2="22" y2="22"/><path {...p} d="M18.89 13.23A7 7 0 015 10M15 9.34V4a3 3 0 00-5.94-.6M17 16.95A7 7 0 0112 19m0 0v3m-4 0h8"/><path {...p} d="M9 9v3a3 3 0 005.12 2.12"/></svg>,
    globe:<svg style={st} viewBox="0 0 24 24"><circle {...p} cx="12" cy="12" r="10"/><path {...p} d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10A15.3 15.3 0 018 12 15.3 15.3 0 0112 2z"/></svg>,
    cal:<svg style={st} viewBox="0 0 24 24"><rect {...p} x="3" y="4" width="18" height="18" rx="2"/><line {...p} x1="16" y1="2" x2="16" y2="6"/><line {...p} x1="8" y1="2" x2="8" y2="6"/><line {...p} x1="3" y1="10" x2="21" y2="10"/></svg>,
    msg:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
    user:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle {...p} cx="12" cy="7" r="4"/></svg>,
    sun:<svg style={st} viewBox="0 0 24 24"><circle {...p} cx="12" cy="12" r="5"/><line {...p} x1="12" y1="1" x2="12" y2="3"/><line {...p} x1="12" y1="21" x2="12" y2="23"/><line {...p} x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line {...p} x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line {...p} x1="1" y1="12" x2="3" y2="12"/><line {...p} x1="21" y1="12" x2="23" y2="12"/><line {...p} x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line {...p} x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
    moon:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
    bell:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>,
    heart:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>,
    comment:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
    share:<svg style={st} viewBox="0 0 24 24"><circle {...p} cx="18" cy="5" r="3"/><circle {...p} cx="6" cy="12" r="3"/><circle {...p} cx="18" cy="19" r="3"/><line {...p} x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line {...p} x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
    play:<svg style={st} viewBox="0 0 24 24"><polygon {...p} points="5 3 19 12 5 21 5 3"/></svg>,
    send:<svg style={st} viewBox="0 0 24 24"><line {...p} x1="22" y1="2" x2="11" y2="13"/><polygon {...p} points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    check:<svg style={st} viewBox="0 0 24 24"><polyline {...p} points="20 6 9 17 4 12"/></svg>,
    x:<svg style={st} viewBox="0 0 24 24"><line {...p} x1="18" y1="6" x2="6" y2="18"/><line {...p} x1="6" y1="6" x2="18" y2="18"/></svg>,
    chevL:<svg style={st} viewBox="0 0 24 24"><polyline {...p} points="15 18 9 12 15 6"/></svg>,
    chevR:<svg style={st} viewBox="0 0 24 24"><polyline {...p} points="9 18 15 12 9 6"/></svg>,
    map:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle {...p} cx="12" cy="10" r="3"/></svg>,
    shield:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    scale:<svg style={st} viewBox="0 0 24 24"><line {...p} x1="12" y1="3" x2="12" y2="21"/><path {...p} d="M5 21h14M5 6l-2 6h4L5 6zM19 6l-2 6h4L19 6z"/></svg>,
    brief:<svg style={st} viewBox="0 0 24 24"><rect {...p} x="2" y="7" width="20" height="14" rx="2"/><path {...p} d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>,
    vote:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M18 8h1a4 4 0 010 8h-1"/><path {...p} d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line {...p} x1="6" y1="1" x2="6" y2="4"/><line {...p} x1="10" y1="1" x2="10" y2="4"/><line {...p} x1="14" y1="1" x2="14" y2="4"/></svg>,
    award:<svg style={st} viewBox="0 0 24 24"><circle {...p} cx="12" cy="8" r="7"/><polyline {...p} points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>,
    bar:<svg style={st} viewBox="0 0 24 24"><line {...p} x1="18" y1="20" x2="18" y2="10"/><line {...p} x1="12" y1="20" x2="12" y2="4"/><line {...p} x1="6" y1="20" x2="6" y2="14"/></svg>,
    zap:<svg style={st} viewBox="0 0 24 24"><polygon {...p} points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    lock:<svg style={st} viewBox="0 0 24 24"><rect {...p} x="3" y="11" width="18" height="11" rx="2"/><path {...p} d="M7 11V7a5 5 0 0110 0v4"/></svg>,
    plus:<svg style={st} viewBox="0 0 24 24"><line {...p} x1="12" y1="5" x2="12" y2="19"/><line {...p} x1="5" y1="12" x2="19" y2="12"/></svg>,
    star:<svg style={st} viewBox="0 0 24 24"><polygon {...p} points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    users:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle {...p} cx="9" cy="7" r="4"/><path {...p} d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
    settings:<svg style={st} viewBox="0 0 24 24"><circle {...p} cx="12" cy="12" r="3"/><path {...p} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
    trending:<svg style={st} viewBox="0 0 24 24"><polyline {...p} points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline {...p} points="17 6 23 6 23 12"/></svg>,
    search:<svg style={st} viewBox="0 0 24 24"><circle {...p} cx="11" cy="11" r="8"/><line {...p} x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    image:<svg style={st} viewBox="0 0 24 24"><rect {...p} x="3" y="3" width="18" height="18" rx="2"/><circle {...p} cx="8.5" cy="8.5" r="1.5"/><polyline {...p} points="21 15 16 10 5 21"/></svg>,
    video:<svg style={st} viewBox="0 0 24 24"><polygon {...p} points="23 7 16 12 23 17 23 7"/><rect {...p} x="1" y="5" width="15" height="14" rx="2"/></svg>,
    info:<svg style={st} viewBox="0 0 24 24"><circle {...p} cx="12" cy="12" r="10"/><line {...p} x1="12" y1="16" x2="12" y2="12"/><line {...p} x1="12" y1="8" x2="12.01" y2="8"/></svg>,
    flag:<svg style={st} viewBox="0 0 24 24"><path {...p} d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line {...p} x1="4" y1="22" x2="4" y2="15"/></svg>,
  };
  return <>{icons[n] ?? <svg style={st} viewBox="0 0 24 24"><circle {...p} cx="12" cy="12" r="10"/></svg>}</>;
}

// ── DATA ─────────────────────────────────────────────────────
const JOURNALISTS = [
  {id:"j1",name:"Élise Moreau",role:"Grande Reporter",spec:"Géopolitique mondiale",init:"EM",live:true,gender:"F"},
  {id:"j2",name:"Marc Fontaine",role:"Éditorialiste",spec:"Politique européenne",init:"MF",live:false,gender:"M"},
  {id:"j3",name:"Yasmine Kadi",role:"Correspondante",spec:"Moyen-Orient & conflits",init:"YK",live:true,gender:"F"},
  {id:"j4",name:"Bernard Cléry",role:"Chroniqueur senior",spec:"Histoire & diplomatie",init:"BC",live:false,gender:"M"},
  {id:"j5",name:"Aïcha Diallo",role:"Militante & Chroniqueuse",spec:"Droits LGBTQ+, féminisme intersectionnel",init:"AD",live:true,gender:"F"},
  {id:"j6",name:"Théo Marchetti",role:"Correspondant de Guerre",spec:"Conflits armés, armées, zones de crise",init:"TM",live:false,gender:"M"},
  {id:"j7",name:"Dr. Léa Fontaine",role:"Journaliste Scientifique",spec:"Médecine, bioéthique, transhumanisme",init:"LF",live:true,gender:"F"},
  {id:"j8",name:"Omar Benali",role:"Analyste Économique",spec:"Finance mondiale, cryptomonnaies, inégalités",init:"OB",live:false,gender:"M"},
  {id:"j9",name:"Camille Rousseau",role:"Philosophe & Débatteur",spec:"Philosophie politique, éthique, déontologie",init:"CR",live:true,gender:"F"},
];
const LEVELS = [
  {id:"novice",tier:1,label:"Novice",sub:"Citoyen lambda",premium:false},
  {id:"initie",tier:2,label:"Initié",sub:"Militant, conseiller municipal",premium:false},
  {id:"confirme",tier:3,label:"Confirmé",sub:"Avocat, cadre, haut fonctionnaire",premium:false},
  {id:"expert",tier:4,label:"Expert",sub:"Ancien député, banquier",premium:true},
  {id:"elite",tier:5,label:"Élite",sub:"Ancien ministre, ambassadeur",premium:true},
];
const PUBLICS = [
  {id:"r",label:"Droite",desc:"Sécurité, souveraineté, économie de marché"},
  {id:"l",label:"Gauche",desc:"Justice sociale, écologie, services publics"},
  {id:"c",label:"Centre",desc:"Pragmatisme, Europe, réforme"},
  {id:"m",label:"Mixte",desc:"Toutes tendances — surprise garantie"},
];
const UN_DEL = [
  {id:"fr",flag:"🇫🇷",country:"France",init:"FR",doctrine:"Membre permanent, droit d'ingérence humanitaire (doctrine Kouchner), autonomie stratégique européenne, dissuasion nucléaire indépendante (280 têtes), siège permanent depuis 1945. Budget défense 44Md€ (2024). Partisan d'une Europe puissance, opposé à tout unilatéralisme américain."},
  {id:"us",flag:"🇺🇸",country:"États-Unis",init:"US",doctrine:"Hégémonie libérale, chef de l'OTAN (32 membres, 2% PIB requis), sanctions SWIFT, dollar comme arme géopolitique. Budget défense 886Md$ (2024, 40% du budget mondial). Doctrine Monroe pour l'Amérique latine. Soutien inconditionnel à Israël. AUKUS avec UK et Australie."},
  {id:"ru",flag:"🇷🇺",country:"Russie",init:"RU",doctrine:"Souveraineté absolue, doctrine Gerasimov (guerre hybride), anti-OTAN, veto systématique au CSNU (17 vetos depuis 2011 sur Syrie/Ukraine), sphère d'influence ex-URSS, arsenal nucléaire 6257 têtes, partenariat stratégique Chine. Sanctions occidentales: 14000 mesures depuis 2022."},
  {id:"cn",flag:"🇨🇳",country:"Chine",init:"CN",doctrine:"Non-ingérence stricte (principe des 5 de Bandung), BRI (Routes de la Soie, 150 pays, 1000Md$), réunification Taiwan non négociable, coalition Global South, Shanghaï Cooperation Organisation. PIB 2e mondial, armée 2,1M soldats. Abstention préférentielle au CSNU."},
  {id:"uk",flag:"🇬🇧",country:"Royaume-Uni",init:"UK",doctrine:"Atlantisme post-Brexit, membre OTAN et Five Eyes (renseignement US/UK/CA/AU/NZ), puissance nucléaire (225 têtes Trident), soft power Commonwealth (54 pays, 2,7Md habitants), sanctions ciblées individuelles. Partenaire privilégié USA mais autonomie diplomatique. AUKUS."},
];
const UN_TOPICS = ["Cessez-le-feu immédiat en Ukraine","Réforme du droit de veto","Intervention humanitaire en zone de conflit","Régulation internationale de l'IA militaire","Reconnaissance d'un nouvel État indépendant"];
const DEBATE_CATEGORIES = [
  {id:"geo",label:"🌍 Géopolitique",topics:["La réforme de l'ONU est-elle inévitable ?","OTAN : pertinence à l'ère multipolaire","La Chine va-t-elle dépasser les États-Unis ?","Guerre en Ukraine : négociation ou victoire ?","Nucléaire iranien : accord à tout prix ?","Israël-Palestine : solution à deux États encore possible ?","Afrique : néocolonialisme ou partenariats équitables ?","Les BRICS vont-ils créer une alternative au dollar ?","Taïwan : l'Occident doit-il s'engager militairement ?","Sahel : la France a-t-elle perdu la guerre ?","Le Conseil de Sécurité de l'ONU est-il obsolète ?","Monde unipolaire, bipolaire ou multipolaire ?","La mondialisation est-elle en crise ?","Les sanctions économiques sont-elles efficaces ?","La Russie peut-elle redevenir un partenaire de l'Occident ?","Indo-Pacifique : nouvelle zone de tension mondiale ?","Faut-il réformer le FMI et la Banque mondiale ?","La diplomatie du carnet de chèques — danger ou pragmatisme ?","Proche-Orient : les accords d'Abraham, victoire ou compromis ?","Kosovo, Palestine, Catalogne : qui a droit à l'autodétermination ?","Diplomatie climatique : succès ou échec ?","La CPI est-elle efficace ?","L'aide humanitaire peut-elle être politisée ?","Les ONG remplacent-elles les États dans les crises ?","Médiation internationale : l'ONU ou les puissances régionales ?","Faut-il un siège permanent africain au Conseil de Sécurité ?","La Corée du Nord : isolement ou engagement ?","Le Venezuela : modèle ou désastre ?","Faut-il reconnaître l'État palestinien ?","La Turquie : partenaire fiable ou cheval de Troie ?"]},
  {id:"histoire",label:"📚 Histoire & Mémoire",topics:["Esclavage et réparations : où en est le débat ?","Décolonisation : bilan et mémoire","Histoire des peuples : les rébellions oubliées","La France peut-elle regarder son passé colonial en face ?","Colonisation : crime contre l'humanité ou mission civilisatrice ?","Génocide arménien : pourquoi ça bloque encore ?","Mai 68 : révolution ou illusion ?","Napoléon : génie ou tyran ?","La traite négrière arabe : tabou ou mémoire occultée ?","Guerre d'Algérie : peut-on réconcilier les mémoires ?","Apartheid : les héritages économiques persistent-ils ?","Hiroshima-Nagasaki : la bombe était-elle nécessaire ?","La Révolution française : universelle ou nationale ?","Les empires : pourquoi s'effondrent-ils toujours ?","Haïti : première révolution noire, premier échec du monde ?","La guerre froide : quelles leçons pour aujourd'hui ?","La Shoah : comment transmettre la mémoire ?","Le colonialisme belge au Congo : génocide oublié ?","Les révolutions du XXe siècle : bilan 100 ans après","L'esclavage en Mauritanie : pourquoi persiste-t-il ?","Les guerres napoléoniennes : conquête ou libération ?","La traite atlantique : qui était complice ?","Les grandes découvertes : exploration ou pillage ?","La chute de Rome : leçons pour l'Occident moderne ?","Les croisades : foi ou conquête ?","La Première Guerre mondiale était-elle évitable ?","La déstalinisation : Khrouchtchev a-t-il tout changé ?","La résistance française : mythe ou réalité ?","Les mouvements indépendantistes africains des années 60","La Révolution cubaine : 60 ans après, quel bilan ?"]},
  {id:"societe",label:"🏛️ Société & Politique",topics:["Immigration : politique ou humanitaire ?","Institutions françaises : réforme de la Ve République ?","La laïcité est-elle menacée en France ?","Le voile islamique : liberté ou atteinte à la laïcité ?","Faut-il légaliser le cannabis en France ?","Faut-il abaisser le droit de vote à 16 ans ?","Proportionnelle ou scrutin majoritaire ?","La démocratie participative peut-elle remplacer la représentative ?","Le féminisme a-t-il atteint ses objectifs ?","Racisme systémique : réalité française ou importation ?","La cancel culture menace-t-elle la liberté d'expression ?","Réseaux sociaux : faut-il réguler ou libérer ?","La désinformation : comment répondre sans censurer ?","Justice pénale : punir ou réhabiliter ?","Faut-il un service militaire obligatoire ?","Populisme : symptôme ou maladie de la démocratie ?","Les extrêmes : gauche et droite se valent-elles ?","La police : faut-il la réformer en profondeur ?","Faut-il rétablir la peine de mort ?","Le communautarisme menace-t-il la République ?","Parentalité et État : jusqu'où peut-on intervenir ?","Faut-il légaliser la prostitution ?","La PMA pour toutes : où en est la société ?","Faut-il encadrer les sectes ?","L'obésité : problème individuel ou de santé publique ?","Faut-il interdire les réseaux sociaux aux moins de 15 ans ?","La gratuité des transports en commun : réaliste ?","Faut-il un revenu de base pour les artistes ?","Le sans-abrisme : échec de la société ?","Faut-il sanctionner les discriminations à l'embauche ?"]},
  {id:"eco",label:"💰 Économie & Finance",topics:["IA et souveraineté numérique des États","Le capitalisme peut-il être réformé de l'intérieur ?","Cryptomonnaies : avenir ou bulle spéculative ?","Faut-il taxer les milliardaires ?","La retraite à 64 ans : réforme juste ou injuste ?","Les GAFA : faut-il les démanteler ?","La dette publique : faut-il vraiment s'en inquiéter ?","Commerce libre ou protectionnisme ?","Le revenu universel : utopie ou nécessité ?","Les inégalités mondiales se creusent — qui est responsable ?","Made in France : nationalisme économique ou pragmatisme ?","L'austérité est-elle efficace ?","Le chômage : faut-il un emploi garanti par l'État ?","Les syndicats ont-ils encore un rôle à jouer ?","La BCE : indépendance ou contrôle démocratique ?","Le travail à temps partiel : flexibilité ou précarité ?","Faut-il plafonner les loyers ?","L'économie circulaire peut-elle remplacer le modèle linéaire ?","La semaine de 4 jours : révolution du travail ?","Faut-il nationaliser les grandes banques ?","L'économie informelle : obstacle ou solution ?","Faut-il taxer les robots ?","La croissance économique est-elle compatible avec l'écologie ?","Le tourisme de masse : bénédiction ou fléau ?","Faut-il annuler la dette des pays pauvres ?","L'inflation : qui en est vraiment responsable ?","Faut-il encadrer les prix de l'alimentation ?","L'ubérisation du travail : progrès ou régression sociale ?","Le capitalisme a-t-il une date d'expiration ?","Faut-il supprimer les paradis fiscaux ?"]},
  {id:"sciences",label:"🧬 Sciences & Médecine",topics:["Euthanasie : le droit de mourir dans la dignité ?","Vaccins obligatoires : liberté ou sécurité collective ?","Avortement : où s'arrête la liberté de la femme ?","GPA : exploitation ou solidarité ?","Transidentité chez les mineurs : quand intervenir ?","Les drogues psychédéliques en thérapie : révolution médicale ?","Faut-il légaliser l'euthanasie active ?","Faut-il breveter les médicaments essentiels ?","La médecine prédictive : espoir ou menace ?","Les OGM : danger ou solution à la faim mondiale ?","Faut-il rendre les essais cliniques totalement transparents ?","L'alimentation ultra-transformée : faut-il l'interdire ?","Clonage humain : jamais, ou sous conditions ?","La thérapie génique peut-elle tout guérir ?","Faut-il financer la recherche sur le vieillissement ?","Le gluten, le lactose : intolérances réelles ou marketing ?","Médecine traditionnelle vs médecine moderne : faux débat ?","Faut-il rembourser les médecines douces ?","Le burn-out est-il une maladie professionnelle reconnue ?","Déserts médicaux : comment y remédier ?","La psychiatrie force-t-elle trop d'hospitalisations ?","Faut-il interdire la publicité pour l'alcool ?","Le sport de haut niveau et la santé : contradiction ?","Faut-il un revenu universel pour les chercheurs ?","La médecine préventive : investissement ou dépense ?","Faut-il encadrer les régimes alimentaires chez les enfants ?","L'obésité infantile : responsabilité des parents ou de l'État ?","Faut-il tester les drogues avant de les interdire ?","Les antibiotiques : crise mondiale à venir ?","Santé mentale des jeunes : la société est-elle responsable ?"]},
  {id:"philo",label:"🤔 Philosophie & Éthique",topics:["La liberté existe-t-elle vraiment ?","Le bonheur est-il le but ultime de l'existence ?","Peut-on être moral sans religion ?","L'État a-t-il le droit de mentir à ses citoyens ?","La peine de mort est-elle jamais justifiable ?","Le sacrifice d'un innocent pour sauver mille vies : acceptable ?","L'intelligence artificielle peut-elle avoir des droits ?","Faut-il obéir à une loi injuste ?","Exist-il des vérités absolues ?","L'art peut-il être immoral ?","La vie a-t-elle un sens objectif ?","La démocratie est-elle le meilleur système possible ?","Faut-il toujours dire la vérité ?","L'argent peut-il acheter le bonheur ?","La nature humaine est-elle fondamentalement bonne ou mauvaise ?","Le progrès est-il toujours un bien ?","Sommes-nous responsables du bonheur des autres ?","La vengeance est-elle une forme de justice ?","Le travail : droit ou obligation ?","La vie animale a-t-elle la même valeur que la vie humaine ?","Peut-on admirer l'œuvre sans approuver l'auteur ?","L'amour romantique est-il une construction sociale ?","La souffrance est-elle nécessaire au bonheur ?","Faut-il craindre la mort ?","L'individualisme moderne est-il un progrès ou une régression ?","Le relativisme moral est-il dangereux ?","La vérité est-elle accessible à tous ?","Le libre arbitre : illusion ou réalité ?","Peut-on justifier la guerre ?","La philosophie est-elle encore utile dans le monde moderne ?"]},
  {id:"militaire",label:"⚔️ Armée & Défense",topics:["Faut-il augmenter le budget de la défense française ?","L'OTAN est-il encore crédible ?","Guerre asymétrique : comment combattre sans frontières ?","Les drones de combat : révolution ou déshumanisation de la guerre ?","Faut-il rétablir le service militaire obligatoire ?","La dissuasion nucléaire protège-t-elle vraiment la paix ?","Cybersécurité : la prochaine guerre sera-t-elle numérique ?","Les sociétés militaires privées : nécessaires ou dangereuses ?","La guerre juste existe-t-elle encore ?","Faut-il abolir les armes à sous-munitions ?","L'armée de terre est-elle dépassée ?","Faut-il une armée européenne autonome ?","Les conflits en Afrique : ingérence ou abandon ?","Vendre des armes à des régimes autoritaires : acceptable ?","Le génocide de Srebrenica : l'ONU a-t-elle failli ?","Faut-il juger les soldats pour crimes de guerre ?","L'intelligence artificielle dans l'armée : jusqu'où ?","Les guerres proxy : jeu dangereux des grandes puissances ?","La résistance armée est-elle toujours légitime ?","Les vétérans de guerre : la société les abandonne-t-elle ?","Faut-il interdire les armes autonomes létales ?","La paix perpétuelle de Kant : utopie ou programme ?","Les sanctions économiques sont-elles une alternative à la guerre ?","Faut-il une police internationale ?","Le terrorisme peut-il être vaincu ?"]},
  {id:"tech",label:"💻 Technologie & IA",topics:["L'intelligence artificielle va-t-elle détruire l'emploi ?","Faut-il réguler l'IA générative ?","Transhumanisme : améliorer l'humain, jusqu'où ?","Surveillance numérique : sécurité ou Big Brother ?","Espace : la privatisation est-elle une bonne idée ?","Algorithmes et biais : peut-on faire confiance aux machines ?","Deepfakes : menace pour la démocratie ?","Robots dans les soins aux personnes âgées : acceptable ?","Vie privée en 2030 : sera-t-elle encore possible ?","L'humain augmenté : vers une société à deux vitesses ?","Faut-il une IA des droits humains à l'ONU ?","Réseaux 5G et 6G : dangers sanitaires ou progrès ?","L'école face au numérique : tablettes ou craie ?","Faut-il interdire la reconnaissance faciale dans l'espace public ?","Faut-il taxer les robots qui remplacent des travailleurs ?","L'open source peut-il sauver le web ?","Les réseaux sociaux rendent-ils vraiment plus bête ?","Faut-il un droit à la déconnexion numérique ?","Le métavers : avenir du web ou échec annoncé ?","Blockchain : au-delà de la crypto, quel futur ?","Faut-il encadrer les algorithmes des plateformes ?","L'automatisation bénéficiera-t-elle à tous ?","Faut-il un permis pour utiliser l'IA ?","La réalité virtuelle peut-elle remplacer le monde réel ?","L'IA peut-elle créer de l'art authentique ?"]},
  {id:"env",label:"🌱 Environnement & Énergie",topics:["Urgence climatique : les politiques sont-elles à la hauteur ?","Nucléaire : solution au changement climatique ou danger ?","Faut-il manger moins de viande pour sauver la planète ?","Voiture électrique : vraie solution ou fausse promesse ?","Décroissance économique : nécessité ou utopie ?","Les pays riches doivent-ils payer pour le climat des pays pauvres ?","Agriculture intensive : faut-il l'interdire ?","L'eau sera-t-elle au cœur des guerres futures ?","Forêts tropicales : souveraineté ou patrimoine mondial ?","Faut-il un crime d'écocide dans le droit international ?","Les activistes climatiques sont-ils trop radicaux ?","Énergies renouvelables : peut-on tout miser dessus ?","Le plastique : les réglementations actuelles suffisent-elles ?","Migration climatique : les sociétés sont-elles prêtes ?","Faut-il taxer les billets d'avion ?","La déforestation amazonienne : crime planétaire ?","Les OGM peuvent-ils nourrir la planète durablement ?","Faut-il interdire la chasse ?","La pêche industrielle détruit-elle les océans ?","Faut-il taxer les produits polluants à la production ?","La sobriété énergétique : contrainte ou mode de vie ?","Les villes de demain seront-elles vraiment vertes ?","Faut-il rendre les bâtiments publics à énergie positive ?","Le tourisme spatial est-il acceptable écologiquement ?","La géo-ingénierie peut-elle sauver le climat ?"]},
  {id:"culture",label:"🎭 Culture, Sport & Éducation",topics:["L'école française est-elle à la hauteur des défis du XXIe siècle ?","Faut-il rendre l'université gratuite pour tous ?","Le sport de haut niveau est-il encore un modèle pour la jeunesse ?","Les JO sont-ils devenus une machine commerciale ?","Faut-il réformer le baccalauréat ?","La culture populaire peut-elle être intellectuelle ?","Faut-il des quotas de diversité dans les médias ?","L'art contemporain est-il compris du grand public ?","Faut-il nationaliser les grandes salles de spectacle ?","Cinéma français : exception culturelle ou protectionnisme ?","Faut-il enseigner la philosophie dès le primaire ?","Les jeux vidéo violents influencent-ils les comportements ?","La lecture est-elle en danger ?","Faut-il imposer des quotas de chansons françaises à la radio ?","Le rap est-il de la poésie ?","Les études de lettres ont-elles encore un avenir ?","Faut-il rendre le latin obligatoire ?","Les musées doivent-ils rendre les œuvres coloniales ?","Faut-il supprimer les notes à l'école ?","Le dopage dans le sport : punir ou encadrer ?","L'éducation sexuelle à l'école : qui doit en décider ?","Faut-il interdire les téléphones dans les écoles ?","La mixité sociale à l'école : comment l'atteindre vraiment ?","Le sport féminin est-il encore sous-médiatisé ?","Faut-il enseigner les religions à l'école publique ?"]},
  {id:"europe",label:"🇪🇺 Europe & Relations Int.",topics:["Europe : fédération ou désintégration ?","Faut-il sortir de l'euro ?","L'Europe peut-elle s'affranchir de l'OTAN ?","Brexit : le Royaume-Uni a-t-il eu raison ?","Faut-il une armée européenne ?","L'Union européenne est-elle trop bureaucratique ?","Schengen : faut-il rétablir les frontières ?","L'élargissement de l'UE à l'Ukraine est-il prématuré ?","La Turquie a-t-elle encore sa place dans l'OTAN ?","L'Europe peut-elle rivaliser avec les États-Unis et la Chine ?","Faut-il un président de l'Europe élu au suffrage universel ?","La zone euro est-elle une réussite ?","L'Europe sociale existe-t-elle vraiment ?","Faut-il une politique d'immigration européenne commune ?","La souveraineté numérique européenne : possible ?","L'accord avec le Mercosur : libre-échange ou trahison écologique ?","Faut-il un impôt européen ?","La politique agricole commune est-elle dépassée ?","Les populismes menacent-ils l'UE de l'intérieur ?","L'Europe doit-elle parler d'une seule voix à l'ONU ?","Faut-il réformer le parlement européen ?","La subsidiarité : principe vivant ou mort ?","L'Afrique est-elle le partenaire naturel de l'Europe ?","La Russie sera-t-elle un jour dans l'UE ?","Faut-il un référendum sur la sortie de l'euro ?"]},
  {id:"droit",label:"⚖️ Droit, Justice & Libertés",topics:["La peine de mort est-elle jamais justifiable ?","Faut-il légaliser l'euthanasie en France ?","Le droit à l'avortement est-il menacé en Europe ?","Mariage pour tous : où en est l'Europe ?","Faut-il encadrer le port d'armes ?","La présomption d'innocence est-elle respectée ?","Faut-il abolir la détention provisoire ?","Les prisons françaises : état d'urgence ?","Faut-il dépénaliser le cannabis ?","La justice des mineurs est-elle trop laxiste ?","Faut-il élargir le droit d'asile ?","La liberté d'expression a-t-elle des limites ?","Faut-il réguler les discours de haine en ligne ?","Le droit à l'oubli numérique : réalité ou illusion ?","Faut-il une amnistie pour les gilets jaunes ?","La justice climatique est-elle une réalité ?","Faut-il créer un crime d'écocide en droit français ?","Les lanceurs d'alerte sont-ils suffisamment protégés ?","Faut-il réformer la Cour de cassation ?","Le secret professionnel des avocats est-il absolu ?","La justice prédictive par IA : acceptable ?","Faut-il indemniser les victimes d'erreurs judiciaires plus largement ?","Le droit à mourir dans la dignité : où en est la France ?","Faut-il un droit constitutionnel à l'environnement ?","Les droits des animaux : vers une personnalité juridique ?"]},
];
const DEBATE_TOPICS = DEBATE_CATEGORIES.flatMap(c=>c.topics);
const TRIAL_TOPICS = ["Corruption d'un élu local","Crime financier — blanchiment international","Atteinte à la liberté de la presse","Violation du droit international humanitaire","Discrimination systémique en entreprise","Abus de pouvoir d'un ministre"];
const JOBS = [
  {title:"Chargé de mission diplomatique",co:"Ministère des Affaires étrangères",tags:["Paris","CDI","Bac+5"]},
  {title:"Analyste géopolitique senior",co:"Institut Français des Relations Internationales",tags:["Paris","CDI","Recherche"]},
  {title:"Apprenti coordinateur administratif",co:"Métropole Aix-Marseille-Provence",tags:["Marseille","Apprentissage","Bac+3"]},
  {title:"Conseiller juridique international",co:"Cabinet Gide Loyrette Nouel",tags:["Paris","Droit int."]},
];
const NEWS = [
  {id:0,type:"article",tag:"ACTUALITÉ",tagC:"#E03535",time:"30min",title:"Frais de scolarité différenciés : les universités françaises face à la polémique pour les étudiants hors UE",hot:true,imgUrl:"https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=700&q=80",likes:1542,comments:387,src:"NEXUS Actu",verified:false},
  {id:1,type:"article",tag:"POLITIQUE",tagC:"#7C3AED",time:"1h",title:"Gabriel Attal officialise sa candidature : la nouvelle génération à l'assaut des législatives",hot:true,imgUrl:"https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=700&q=80",likes:923,comments:345,src:"NEXUS Politique",verified:false},
  {id:2,type:"article",tag:"GÉOPOLITIQUE",tagC:"#E03535",time:"2h",title:"Sommet G7 : accord fragile sur les nouvelles sanctions russo-chinoises en mer de Chine",hot:false,imgUrl:"https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=700&q=80",likes:342,comments:87,src:"NEXUS World",verified:false},
  {id:3,type:"video",tag:"DIPLOMATIE",tagC:"#2B78F5",time:"3h",title:"Macron à Washington : conférence de presse bilatérale — décryptage complet",hot:false,imgUrl:"https://images.unsplash.com/photo-1569950044272-e4ef57e0e29b?w=700&q=80",likes:891,comments:203,dur:"14:32",src:"NEXUS Live",verified:false},
  {id:4,type:"article",tag:"IMMIGRATION",tagC:"#16A34A",time:"4h",title:"Projet de loi immigration 2026 : le Sénat vote, les associations s'insurgent",hot:false,imgUrl:"https://images.unsplash.com/photo-1532375810709-75b1da00537c?w=700&q=80",likes:445,comments:156,src:"NEXUS France",verified:false},
  {id:5,type:"video",tag:"GUERRE",tagC:"#DC2626",time:"5h",title:"Conflit Moyen-Orient : les civils de Gaza face à la nouvelle offensive — témoignages",hot:false,imgUrl:"https://images.unsplash.com/photo-1582481725274-d63bdf929a90?w=700&q=80",likes:1102,comments:428,dur:"8:45",src:"NEXUS War",verified:false},
  {id:6,type:"event",tag:"ÉVÉNEMENT",tagC:"#16A34A",time:"6h",title:"Forum Méditerranée & Diplomatie · 24 mai · Marseille — inscriptions ouvertes",hot:false,imgUrl:null,likes:56,comments:12,src:"NEXUS Agenda",verified:false},
  {id:7,type:"post",tag:"ANALYSE",tagC:"#D97706",time:"8h",title:"La réforme du droit de veto : une nécessité démocratique pour le XXIe siècle ?",hot:false,imgUrl:null,likes:445,comments:156,src:"Mehdi Kara · Politologue",verified:true},
  {id:8,type:"video",tag:"ÉLECTIONS",tagC:"#E03535",time:"10h",title:"Débat présidentiel virtuel NEXUS — simulation complète 4 candidats IA",hot:false,imgUrl:"https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=700&q=80",likes:1240,comments:387,dur:"48:10",src:"NEXUS Débats",verified:false},
  {id:9,type:"article",tag:"HISTOIRE",tagC:"#7C3AED",time:"12h",title:"Esclavage et mémoire : les rébellions oubliées qui ont changé le monde",hot:false,imgUrl:"https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=700&q=80",likes:328,comments:74,src:"NEXUS Culture",verified:false},
];
const EVENTS_DATA = [
  {id:1,date:"24",month:"MAI",day:"Sam",title:"Forum Méditerranée & Diplomatie",loc:"Palais du Pharo, Marseille",type:"Conférence",lat:43.2947,lng:5.3614,attendees:284},
  {id:2,date:"1",month:"JUN",day:"Dim",title:"Débat public : Europe fédérale, utopie ou nécessité ?",loc:"MuCEM, Marseille",type:"Débat",lat:43.2977,lng:5.3617,attendees:156},
  {id:3,date:"7",month:"JUN",day:"Sam",title:"Rencontres Géopolitiques d'Aix-en-Provence",loc:"Aix-en-Provence",type:"Forum",lat:43.5297,lng:5.4474,attendees:412},
  {id:4,date:"15",month:"JUN",day:"Dim",title:"Simulation ONU — Session étudiante Sciences Po",loc:"Sciences Po Paris",type:"Simulation",lat:48.8517,lng:2.3294,attendees:89},
];
const CONVOS = [
  {id:1,name:"Communauté Géopolitique",last:"Quelqu'un a suivi le G7 ce matin ?",time:"14:23",unread:5,init:"GÉO"},
  {id:2,name:"Alumni Sciences Po",last:"Débat interne demain soir 19h",time:"12:10",unread:2,init:"SP"},
  {id:3,name:"Club Éloquence Marseille",last:"Résultats du concours disponibles",time:"Hier",unread:0,init:"ÉL"},
  {id:4,name:"Réseau Diplomatie France",last:"Forum 24 mai — inscriptions ouvertes",time:"Lun",unread:1,init:"RD"},
  {id:5,name:"Karim M.",last:"Code NEXUS-4821 — prêt pour le duel ?",time:"Lun",unread:3,init:"KM"},
];
const CANDIDATES = [
  {id:"mr",init:"MR",name:"Marie Renaud",party:"Centre progressiste · Ex-ministre",prog:"Europe fédérale, justice climatique, réforme fiscale",poll:34,color:"#2B78F5"},
  {id:"jl",init:"JL",name:"Jacques Laurent",party:"Droite nationale · Ancien député",prog:"Souveraineté nationale, contrôle migratoire, réindustrialisation",poll:28,color:"#E03535"},
  {id:"sb",init:"SB",name:"Sara Bouali",party:"Gauche sociale · Avocate",prog:"Services publics, justice sociale, écologie radicale",poll:22,color:"#16A34A"},
];
const FILTERS = ["Tout","Géopolitique","Diplomatie","Histoire","Droit","Élections","Europe","Afrique"];

// ── HELPERS ──────────────────────────────────────────────────
function Tag({label,color,small=false}:{label:string;color:string;small?:boolean}) {
  return <span style={{display:"inline-block",padding:small?"2px 7px":"3px 9px",borderRadius:5,fontSize:small?9:10,fontWeight:800,letterSpacing:1.2,color,background:`${color}18`,border:`1px solid ${color}30`}}>{label}</span>;
}
function Avatar({init,size=40,T,color}:{init:string;size?:number;T:Theme;color?:string}) {
  return <div style={{width:size,height:size,borderRadius:"50%",background:color?`${color}18`:T.blueG,border:`1.5px solid ${color||T.blueB}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.28,fontWeight:800,color:color||T.blueB,flexShrink:0}}>{init}</div>;
}
function Waveform({active,T}:{active:boolean;T:Theme}) {
  const [h,setH] = useState<number[]>(Array(28).fill(4));
  useEffect(()=>{
    if(!active){setH(Array(28).fill(4));return;}
    const id = setInterval(()=>setH(Array(28).fill(0).map((_,i)=>6+Math.abs(Math.sin(Date.now()/180+i*.65))*22)),80);
    return()=>clearInterval(id);
  },[active]);
  return <div style={{display:"flex",alignItems:"center",gap:3,height:38}}>{h.map((v,i)=><div key={i} style={{width:3,height:v,borderRadius:2,background:active?T.blueB:T.muted,opacity:active?.85:.3,transition:"height .1s ease"}}/>)}</div>;
}

// ── SCORE MODAL ───────────────────────────────────────────────
function ScoreModal({topic,T,onClose}:{topic:string;T:Theme;onClose:()=>void}) {
  const scores:{[k:string]:number} = {Clarté:78,Maîtrise:72,Fluidité:81,Persuasion:68,"Gestion du temps":76};
  const avg = Math.round(Object.values(scores).reduce((a,b)=>a+b,0)/5);
  const col = avg>=80?T.green:avg>=60?T.blueB:T.red;
  const circ = 2*Math.PI*46;
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",backdropFilter:"blur(5px)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn .3s"}}>
      <div style={{background:T.surf,borderRadius:"24px 24px 0 0",padding:"28px 24px 48px",width:"100%",maxWidth:430,border:`1px solid ${T.b1}`,animation:"slideUp .4s ease"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
          <div><p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Analyse post-débat</p><h2 style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:24,fontWeight:700,color:T.text}}>Score d&apos;éloquence</h2></div>
          <button onClick={onClose} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:9,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Ic n="x" s={16} c={T.textD}/></button>
        </div>
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:16,padding:24,textAlign:"center",marginBottom:20}}>
          <div style={{position:"relative",width:110,height:110,margin:"0 auto 16px"}}>
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle cx="55" cy="55" r="46" fill="none" stroke={T.b1} strokeWidth="8"/>
              <circle cx="55" cy="55" r="46" fill="none" stroke={col} strokeWidth="8" strokeDasharray={circ} strokeDashoffset={circ*(1-avg/100)} strokeLinecap="round" transform="rotate(-90 55 55)" style={{transition:"stroke-dashoffset 1.5s ease"}}/>
            </svg>
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:30,fontWeight:900,fontFamily:"monospace",color:col}}>{avg}</span>
              <span style={{fontSize:11,color:T.muted,fontWeight:600}}>/100</span>
            </div>
          </div>
          <p style={{color:col,fontSize:17,fontWeight:800}}>{avg>=80?"Excellent":avg>=70?"Bon niveau":avg>=55?"Moyen":"À améliorer"}</p>
          <p style={{color:T.textD,fontSize:12,marginTop:4}}>{topic.slice(0,42)}…</p>
        </div>
        {Object.entries(scores).map(([k,v])=>(
          <div key={k} style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>{k}</span>
              <span style={{fontSize:13,fontWeight:800,color:v>=75?T.green:v>=60?T.blueB:T.amber}}>{v}/100</span>
            </div>
            <div style={{height:6,background:T.b1,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${v}%`,background:v>=75?T.green:v>=60?T.blueB:T.amber,borderRadius:3,transition:"width 1.4s cubic-bezier(.4,0,.2,1)"}}/></div>
          </div>
        ))}
        <button onClick={onClose} style={{width:"100%",marginTop:20,padding:15,borderRadius:12,border:"none",background:T.blueB,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit",letterSpacing:.5}}>Nouveau débat</button>
      </div>
    </div>
  );
}

// ── AUDIO STAGE ───────────────────────────────────────────────
function AudioStage({config,T,onBack}:{config:Record<string,unknown>;T:Theme;onBack:()=>void}) {
  const j = config.journalist as typeof JOURNALISTS[0];
  const level = config.level as typeof LEVELS[0];
  const topic = config.topic as string;
  const publicSide = config.publicSide as typeof PUBLICS[0];
  const isDuel = (config.subMode as string) === "duel-ia";
  const [opponent] = useState(()=>{
    const opts=[
      {name:"Alexandre Martin",init:"AM",gender:"M" as const,role:"économiste, ex-conseiller Élysée",
       style:`Libéral pragmatique. Ton posé, data-driven comme Macron. Formules types : "En même temps...", "Les chiffres sont clairs...", "On ne peut pas à la fois...". Sources : BCE, OCDE, FMI, BPI. Défend la réforme par l'intérieur, jamais la rupture. Reconnaît les problèmes mais propose des compromis graduels.`},
      {name:"Sophie Leclerc",init:"SL",gender:"F" as const,role:"essayiste, militante gauche populaire",
       style:`Gauche populiste façon Mélenchon. Passion, indignation morale, références historiques (Jaurès, Hugo, Résistance). Formules types : "Le peuple sait ce que les élites refusent de voir...", "Ce n'est pas une question technique, c'est une question de dignité". Sources : Piketty, INSEE inégalités, rapports OXFAM. Toujours ramène au vécu des classes populaires.`},
      {name:"Pierre Dubois",init:"PD",gender:"M" as const,role:"juriste constitutionnel, ex-député",
       style:`Souverainiste pragmatique. Calme, chirurgical, références juridiques et historiques. Formules types : "La Constitution est pourtant claire...", "Regardons ce qui s'est passé dans les faits...". Sources : rapports Sénat, Cour des comptes, traités UE. Défend la nation, l'identité républicaine, la sécurité des frontières.`},
      {name:"Fatou Diallo",init:"FD",gender:"F" as const,role:"chercheuse CNRS, militante climatique",
       style:`Radicale climato-réaliste. Urgence, chiffres GIEC, bifurcation systémique. Formules types : "On a exactement X années avant le point de basculement...", "Ce débat n'a de sens que si on intègre le contexte climatique". Sources : GIEC AR6, IEA, Lancet Countdown. Lie chaque sujet aux enjeux écologiques.`}
    ];
    return opts[Math.floor(Math.random()*opts.length)];
  });

  const [phase,setPhase] = useState<"intro"|"speaking"|"listening"|"waiting"|"cut"|"ended">("intro");
  const [timer,setTimer] = useState(90);
  const [timerOn,setTimerOn] = useState(false);
  const [transcript,setTranscript] = useState<{role:string;name:string;text:string;time:string}[]>([]);
  const [showTx,setShowTx] = useState(false);
  const [loading,setLoading] = useState(false);
  const [liveText,setLiveText] = useState("");
  const [showScore,setShowScore] = useState(false);
  const [autoMic,setAutoMic] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSpeechRef = useRef<(t:string)=>void>((_t:string)=>{});
  const mountedRef = useRef(true);

  const addLine = (role:string,name:string,text:string) => {
    setTranscript(t=>[...t,{role,name,text,time:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}]);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
  };

  // Cleanup on unmount — stop mic and audio so callbacks don't fire on dead component
  useEffect(()=>{
    mountedRef.current=true;
    return()=>{
      mountedRef.current=false;
      recRef.current?.stop();
      stopSpeech();
    };
  },[]);

  // Auto-start mic after TTS ends — triggered by setAutoMic(true) from onEnd callbacks
  useEffect(()=>{
    if(!autoMic) return;
    setAutoMic(false);
    if(typeof window==="undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR) return;
    const rec=new SR();
    rec.lang="fr-FR"; rec.continuous=false; rec.interimResults=true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{
      let interim="",final="";
      for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript;}
      setLiveText(interim);
      if(final){setLiveText("");handleSpeechRef.current(final.trim());}
    };
    rec.onend=()=>setPhase(p=>p==="listening"?"speaking":p);
    try{rec.start();}catch{return;}
    recRef.current=rec;
    setPhase("listening");
    setTimerOn(false);
  },[autoMic]);// eslint-disable-line

  // Hardcoded fallback lines per opponent profile (used when Gemini is unavailable)
  const oppFallbackOpen = opponent.style.includes("ibéral")
    ? `${opponent.name} : En même temps, les données économiques parlent d'elles-mêmes. Ce débat doit rester factuel et pragmatique. Êtes-vous prêt à entendre des chiffres qui contredisent votre position ?`
    : opponent.style.includes("auche")||opponent.style.includes("ndignat")
    ? `${opponent.name} : Ce qu'on oublie de dire, c'est que les inégalités n'ont jamais été aussi criantes depuis des décennies. Le peuple mérite une vraie réponse, pas des compromis. Jusqu'où êtes-vous prêt à aller ?`
    : opponent.style.includes("ouverain")||opponent.style.includes("uristique")
    ? `${opponent.name} : La Constitution est pourtant claire, et les faits sont là, noir sur blanc. La souveraineté de la Nation n'est pas négociable. Comment justifiez-vous votre position face à nos textes fondamentaux ?`
    : `${opponent.name} : Le GIEC est formel — nous avons moins de dix ans avant les points de basculement. Ce débat n'a de sens que si on intègre l'urgence climatique. Pourquoi l'ignorer ?`;

  const oppFallbackReaction = (userText: string) => opponent.style.includes("ibéral")
    ? `${opponent.name} : En même temps, "${userText.slice(0,40)}…" — mais les chiffres de l'OCDE montrent exactement l'inverse. La vraie question est : peut-on se permettre ce que vous proposez ?`
    : opponent.style.includes("auche")
    ? `${opponent.name} : Ce que dit mon contradicteur, c'est exactement ce que les élites veulent nous faire croire. La réalité pour des millions de Français, c'est tout autre chose. Assumez-vous ce choix de classe ?`
    : opponent.style.includes("ouverain")
    ? `${opponent.name} : Les traités sont clairs. Dans ces conditions, l'argument que vous avancez est juridiquement fragile. Connaissez-vous seulement les textes en vigueur ?`
    : `${opponent.name} : On parle de tout ça sans mentionner l'urgence écologique. Dans moins de dix ans, cette décision sera jugée par l'histoire. L'assumez-vous vraiment ?`;

  // speakTimed: plays speech AND always calls onDone after estimated duration
  // Fixes Android Chrome bug where speechSynthesis onend never fires
  function speakTimed(text: string, gender: "M"|"F", onDone: ()=>void, delayMs=0) {
    const estMs = Math.max(2500, text.split(/\s+/).length * 400 + 800);
    setTimeout(()=>{
      if(!mountedRef.current) return;
      let fired = false;
      const done = ()=>{ if(fired||!mountedRef.current) return; fired=true; onDone(); };
      speakAny(text, gender, done);
      setTimeout(done, estMs); // safety: proceed even if onEnd never fires
    }, delayMs);
  }

  // Intro — in duel mode, opponent speaks first before user's mic opens
  useEffect(()=>{
    const introText = isDuel
      ? `Bonsoir. Je suis ${j?.name||"votre journaliste"}. Sujet du soir : « ${topic} ». ${publicSide?`Public ${publicSide.label} en salle. `:""}Ce soir vous affrontez ${opponent.name}, ${opponent.role}. Je lui donne d'abord la parole.`
      : `Bonsoir. Je suis ${j?.name||"votre journaliste"}. Sujet du soir : « ${topic} ». ${publicSide?`Public ${publicSide.label} en salle. `:""}À vous la parole.`;
    setTimeout(async()=>{
      addLine("journalist",j?.name||"Journaliste",introText);
      setPhase("speaking"); setTimerOn(true);
      if(isDuel){
        speakAny(introText,(j?.gender||"F") as "M"|"F", async()=>{
          if(!mountedRef.current) return;
          let oppOpen = "";
          try{
            const oppKey=typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
            if(oppKey){
              const oppOpenSys=`Tu es ${opponent.name}, ${opponent.role}, invité contradicteur sur le plateau du Grand Débat NEXUS TV.
TON PROFIL RHÉTORIQUE COMPLET : ${opponent.style}
Sujet du débat : "${topic}".

MISSION : Tu prends la parole EN PREMIER pour exposer ta position d'ouverture. Développe vraiment — 5 à 7 phrases minimum.
1. Commence OBLIGATOIREMENT par ton prénom
2. Expose ton angle idéologique complet avec conviction — pourquoi cette position est la seule défendable
3. Cite 2-3 données réelles précises (statistiques, rapports officiels, faits historiques, chiffres sourcés)
4. Développe le raisonnement jusqu'à sa conclusion logique — montre où mène l'argument adverse
5. Termine par une provocation rhétorique percutante qui défie directement ton adversaire

Style : ${opponent.style.split(".")[0]}`;
              oppOpen=await callGemini(oppOpenSys,[{role:"user" as const,parts:[{text:`${opponent.name}, ouvrez le débat et défendez votre position sur : "${topic}".`}]}],oppKey,400);
            }
          }catch{/*use fallback*/}
          if(!mountedRef.current) return;
          // Always speak — use Gemini reply or fallback
          const textToSpeak = oppOpen || oppFallbackOpen;
          addLine("opponent",opponent.name,textToSpeak);
          speakTimed(textToSpeak, opponent.gender as "M"|"F", ()=>{
            if(!mountedRef.current) return;
            const handover=`Merci ${opponent.name}. À vous de répondre.`;
            addLine("journalist",j?.name||"Journaliste",handover);
            speakTimed(handover,(j?.gender||"F") as "M"|"F",()=>{if(mountedRef.current)setAutoMic(true);}, 200);
          }, 300);
        });
      } else {
        speakTimed(introText,(j?.gender||"F") as "M"|"F",()=>setAutoMic(true));
      }
    },600);
  },[]);// eslint-disable-line

  useEffect(()=>{
    if(timerOn&&timer>0){timerRef.current=setTimeout(()=>setTimer(t=>t-1),1000);}
    else if(timer===0&&timerOn){setTimerOn(false);setPhase("cut");addLine("journalist",j?.name||"Journaliste","Temps écoulé. Je reprends la main.");}
    return()=>{if(timerRef.current)clearTimeout(timerRef.current);};
  },[timerOn,timer]);// eslint-disable-line

  // Manual mic — continuous=true so user can speak multiple sentences
  const startMic = ()=>{
    unlockAudio();
    if(typeof window==="undefined")return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR){alert("Utilisez Chrome pour la reconnaissance vocale.");return;}
    const rec=new SR();
    rec.lang="fr-FR"; rec.continuous=true; rec.interimResults=true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{
      let interim="",final="";
      for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript;}
      setLiveText(interim);
      if(final){setLiveText("");handleSpeechRef.current(final.trim());}
    };
    rec.onend=()=>setPhase(p=>p==="listening"?"speaking":p);
    rec.start(); recRef.current=rec; setPhase("listening"); setTimerOn(false);
  };

  const stopMic = ()=>{recRef.current?.stop();setPhase("speaking");setLiveText("");};

  const handleUserSpeech = async(text:string)=>{
    if(!text)return;
    addLine("user","Vous",text);
    setPhase("waiting"); setLoading(true); setTimerOn(false);
    try{
      // Exclude opponent lines — journalist should only see journalist/user turns
      const rawHist=transcript.filter(m=>m.role!=="opponent").map(m=>({role:(m.role==="user"?"user":"model") as "user"|"model",parts:[{text:m.text}]}));
      const firstUserIdx=rawHist.findIndex(m=>m.role==="user");
      const hist=firstUserIdx>=0?rawHist.slice(firstUserIdx):[];
      const exchangeN=Math.ceil(transcript.filter(m=>m.role==="user").length/1)+1;
      const angles=["personnel/expérience directe","économique (emplois, PIB, budgets, dette)","social (inégalités, pauvreté, santé, éducation)","institutionnel (lois, Constitution, pouvoirs)","international (UE, USA, Afrique, pays émergents)","éthique/valeurs (justice, liberté, dignité)","historique (précédents, leçons du passé)"];
      const angleActuel=angles[(exchangeN-1)%angles.length];
      const recentCtx=transcript.slice(-4).map(m=>`[${m.name}]: ${m.text.slice(0,120)}`).join("\n");
      const tier=level?.tier||3;

      const sysPrompt=`Tu es ${j?.name||"Élise Moreau"}, ${j?.role||"grand reporter"} spécialisé en ${j?.spec||"politique"}. Tu présentes le Grand Débat du soir sur NEXUS TV. Sujet : "${topic}".

PROFIL JOURNALISTE RÉEL — tu t'inspires de ces styles :
• Jean-Pierre Elkabbach : "Permettez, je vous coupe. Vous n'avez pas répondu à ma question." Insistance méthodique, jamais agressif mais implacable.
• Léa Salamé : Empathie + "Mais concrètement, qu'est-ce que ça change pour Monsieur Tout-le-monde ?" Humanise les données froides.
• Ruth Elkrief : "Vous avez dit exactement le contraire en [date]. Pourquoi ce changement ?" Fact-check en direct.
• David Pujadas : Structuration rigoureuse, synthèse des contradictions, "Donc si je comprends bien votre position…"

HISTORIQUE RÉCENT (angles DÉJÀ traités — NE PAS répéter) :
${recentCtx||"Aucun échange encore."}

ANGLE OBLIGATOIRE pour cette réponse (n°${exchangeN}) : ${angleActuel}
— Construis ta question/réaction autour de cet angle précis. Si l'invité t'a donné une ouverture dessus, exploite-la.

NIVEAU DE L'INVITÉ : ${level?.label||"Intermédiaire"} (tier ${tier}/5)
${tier<=2?"→ Questions ouvertes, bienveillantes, définitions, contexte explicatif.":tier===3?"→ Contradictions avec statistiques réelles, comparaisons internationales, reformulations pièges.":"→ Attaque les failles logiques, cite des sources primaires (rapports officiels, études), paradoxes profonds, questions rhétoriques de haut niveau."}

TECHNIQUES OBLIGATOIRES — utilise-en UNE DIFFÉRENTE à chaque réponse :
① CITATION-PIÈGE : "Vous venez de dire '${text.split(" ").slice(0,6).join(" ")}…' — mais [donnée qui contredit]."
② TÉMOIN CITOYEN : "Karim, 34 ans, ouvrier à Metz, nous a écrit : [question très concrète et personnelle liée à l'angle]."
③ CHIFFRE-CHOC : "[Stat précise et surprenante] — est-ce que ça modifie votre position ?"
④ COMPARAISON INTERNATIONALE : "En Allemagne/Suède/Corée du Sud, ils ont fait l'opposé — résultat : [fait concret]. Pourquoi la France serait différente ?"
⑤ RETOURNEMENT : "Mais votre argument se retourne contre vous : si [prémisse], alors logiquement [conclusion inverse]. Comment sortez-vous de ça ?"
⑥ MONTÉE EN GÉNÉRALITÉ : "Au fond, ce que vous dites, c'est que [principe général]. Jusqu'où assumez-vous ce principe ?"

RÈGLES ABSOLUES :
• Cite les mots exacts de l'invité, jamais une reformulation approximative
• 1-2 chiffres/faits NOUVEAUX par réponse, jamais déjà utilisés dans cette conversation
• 5 à 7 phrases minimum — développe vraiment l'argument, creuse en profondeur, analyse les conséquences, donne plusieurs angles
• Rythme TV maîtrisé : phrases courtes alternées avec des phrases d'analyse plus longues
• Si la réponse est vague ou hors sujet : "Je vous coupe — [reformulation précise et directe, puis creuser la question]"
• JAMAIS deux fois la même structure de phrase dans tout le débat
• Chaque intervention doit faire avancer réellement le débat : une contradiction, une ouverture, une mise en perspective historique ou internationale`;

      const key=typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
      if(!key) throw new Error("no_key");
      const reply=await callGemini(sysPrompt,[...hist,{role:"user",parts:[{text}]}],key,700);
      if(!mountedRef.current){return;}
      addLine("journalist",j?.name||"Journaliste",reply);
      if(reply.toLowerCase().includes("je vous coupe")){setPhase("cut");}
      else{setTimer(90);setTimerOn(true);setPhase("speaking");}

      if(isDuel){
        speakTimed(reply,(j?.gender||"F") as "M"|"F", async()=>{
          if(!mountedRef.current) return;
          let oppReply = "";
          try{
            const oppKey=typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
            if(oppKey){
              const oppSys=`Tu es ${opponent.name}, ${opponent.role}, invité contradicteur sur le plateau du Grand Débat NEXUS TV.
TON PROFIL RHÉTORIQUE COMPLET : ${opponent.style}
Sujet du débat : "${topic}".
L'invité principal vient de dire : "${text.slice(0,300)}"
Le journaliste a répondu : "${reply.slice(0,200)}"

MISSION : Répondre avec force et conviction — 5 à 7 phrases minimum.
1. Commence OBLIGATOIREMENT par ton prénom
2. Cite PRÉCISÉMENT ce que l'invité principal vient de dire — identifie la faille principale de son argumentation
3. Contre-argumente avec 2 données réelles sourcées (INSEE, OCDE, GIEC, Sénat, rapports officiels selon ton profil)
4. Développe le contre-argument jusqu'à sa conclusion logique — où mène vraiment la position adverse ?
5. Élargis la perspective : conséquences concrètes pour les citoyens, précédents historiques, comparaisons internationales
6. Termine par une question rhétorique percutante qui met l'adversaire en difficulté

Style authentique : ${opponent.style.split(".")[0]}`;
              oppReply=await callGemini(oppSys,[{role:"user" as const,parts:[{text:`${opponent.name}, répondez à l'invité principal qui vient de dire : "${text.slice(0,200)}"`}]}],oppKey,400);
            }
          }catch{/*use fallback*/}
          if(!mountedRef.current) return;
          const textToSpeak = oppReply || oppFallbackReaction(text);
          addLine("opponent",opponent.name,textToSpeak);
          speakTimed(textToSpeak, opponent.gender as "M"|"F", ()=>{if(mountedRef.current)setAutoMic(true);}, 300);
        });
      } else {
        speakTimed(reply,(j?.gender||"F") as "M"|"F",()=>{if(mountedRef.current)setAutoMic(true);});
      }
    }catch{
      const words=text.split(" ").slice(0,5).join(" ");
      const fbs=[
        `Vous dites "${words}"… mais le dernier baromètre Ipsos montre que 68% des Français pensent le contraire. Pourquoi cet écart avec l'opinion publique ?`,
        `Je vous coupe — vous n'avez pas répondu à ma question. Concrètement : quel mécanisme précis, quel délai, quel budget ?`,
        `Votre contradicteur dirait exactement l'inverse avec les mêmes chiffres. Qu'est-ce qui vous donne raison plutôt qu'à lui ?`,
        `Permettez — le rapport de la Cour des comptes de 2023 contredit ce point précisément. Vous avez lu ce rapport ?`,
        `Koffi, 28 ans, étudiant à Lyon, nous écrit : "Tout ça c'est bien, mais demain matin, qu'est-ce qui change dans ma vie ?" Qu'est-ce que vous lui répondez ?`,
        `En Allemagne, ils ont fait exactement l'inverse il y a 10 ans. Résultat : [données positives]. Pourquoi la France ne peut pas faire pareil ?`,
      ];
      const reply=fbs[Math.floor(Math.random()*fbs.length)];
      if(!mountedRef.current){setLoading(false);return;}
      addLine("journalist",j?.name||"Journaliste",reply);
      speakTimed(reply,(j?.gender||"F") as "M"|"F",()=>{if(mountedRef.current)setAutoMic(true);});
      if(reply.includes("coupe")){setPhase("cut");}else{setTimer(90);setTimerOn(true);setPhase("speaking");}
    }
    if(mountedRef.current)setLoading(false);
  };

  // Keep ref pointing to latest handleUserSpeech (avoids stale closures in auto-mic callbacks)
  handleSpeechRef.current = handleUserSpeech;

  const timerPct=timer/90;
  const timerCol=timer<=15?T.red:timer<=30?T.amber:T.green;
  const r=40; const circ=2*Math.PI*r;

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:T.bg}}>
      {showScore&&<ScoreModal topic={topic} T={T} onClose={()=>{setShowScore(false);onBack();}}/>}
      <div style={{padding:"12px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,background:T.surf,flexShrink:0}}>
        <button onClick={()=>{recRef.current?.stop();stopSpeech();onBack();}} style={{background:"none",border:"none",cursor:"pointer",padding:4}}><Ic n="chevL" s={22} c={T.textD}/></button>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:T.red,animation:"pulse 1s infinite"}}/>
            <span style={{color:T.red,fontSize:11,fontWeight:800,letterSpacing:2}}>EN DIRECT</span>
            {isDuel&&<span style={{background:`${T.purple}20`,color:T.purple,fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:700}}>DUEL IA</span>}
            {level&&<span style={{background:T.blueG,color:T.blueB,fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:700}}>{level.label}</span>}
          </div>
          <p style={{color:T.textD,fontSize:12,marginTop:2}}>{topic.slice(0,38)}…</p>
        </div>
        <button onClick={()=>setShowTx(s=>!s)} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>
          <span style={{color:T.textD,fontSize:11,fontWeight:700}}>CC</span>
        </button>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20,gap:16}}>
        {/* Avatars */}
        <div style={{display:"flex",gap:isDuel?32:0,alignItems:"flex-end",justifyContent:"center"}}>
          <div style={{textAlign:"center"}}>
            <div style={{position:"relative",width:96,height:96,margin:"0 auto 10px"}}>
              {phase==="speaking"&&(
                <svg style={{position:"absolute",inset:"-10px",width:116,height:116}} viewBox="0 0 116 116">
                  <circle cx="58" cy="58" r={r+8} fill="none" stroke={T.b1} strokeWidth="4"/>
                  <circle cx="58" cy="58" r={r+8} fill="none" stroke={timerCol} strokeWidth="4" strokeDasharray={circ+50} strokeDashoffset={(circ+50)*(1-timerPct)} strokeLinecap="round" transform="rotate(-90 58 58)" style={{transition:"stroke-dashoffset .9s linear,stroke .3s"}}/>
                </svg>
              )}
              <div style={{width:96,height:96,borderRadius:"50%",background:phase==="waiting"?T.blueG:T.card,border:`2px solid ${T.blueB}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,color:T.blueB,boxShadow:phase==="waiting"?`0 0 30px ${T.blueG}`:"none",transition:"all .3s"}}>{j?.init||"EM"}</div>
            </div>
            <p style={{color:T.text,fontSize:13,fontWeight:700}}>{j?.name||"Journaliste"}</p>
            <p style={{color:T.textD,fontSize:10,marginTop:1}}>{j?.role||"NEXUS Studio"}</p>
          </div>
          {isDuel&&(
            <div style={{textAlign:"center"}}>
              <div style={{width:72,height:72,borderRadius:"50%",background:T.card,border:`2px solid ${T.purple}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:800,color:T.purple,margin:"0 auto 10px"}}>{opponent.init}</div>
              <p style={{color:T.text,fontSize:12,fontWeight:700}}>{opponent.name}</p>
              <p style={{color:T.textD,fontSize:10,marginTop:1}}>{opponent.role}</p>
            </div>
          )}
        </div>
        <Waveform active={phase==="waiting"||loading} T={T}/>
        {phase==="listening"&&(
          <div style={{background:`${T.blueB}15`,border:`1px solid ${T.blueB}40`,borderRadius:12,padding:"10px 20px",textAlign:"center"}}>
            <p style={{color:T.blueB,fontWeight:800,fontSize:12,marginBottom:2}}>🎙 Micro activé — parlez</p>
            {liveText&&<p style={{color:T.textD,fontSize:11,fontStyle:"italic"}}>{liveText}…</p>}
          </div>
        )}
        {phase==="speaking"&&(
          <div style={{textAlign:"center"}}>
            <span style={{fontSize:36,fontWeight:900,fontFamily:"monospace",color:timerCol}}>{String(Math.floor(timer/60)).padStart(2,"0")}:{String(timer%60).padStart(2,"0")}</span>
            <p style={{color:T.muted,fontSize:11,marginTop:4}}>Temps de parole</p>
          </div>
        )}
        {phase==="cut"&&(
          <div style={{background:`${T.red}15`,border:`1px solid ${T.red}40`,borderRadius:12,padding:"12px 20px",textAlign:"center"}}>
            <p style={{color:T.red,fontWeight:800,fontSize:13}}>MICRO COUPÉ</p>
            <p style={{color:T.textD,fontSize:12,marginTop:4}}>Le journaliste reprend la main</p>
          </div>
        )}
        {showTx&&transcript.length>0&&(
          <div ref={chatRef} style={{width:"100%",maxHeight:200,overflowY:"auto",background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:12,display:"flex",flexDirection:"column",gap:8}}>
            {transcript.map((m,i)=>{
              const isUser=m.role==="user";
              const isOpp=m.role==="opponent";
              const bgC=isUser?T.blueG:isOpp?`${T.purple}15`:T.bg2;
              const brC=isUser?T.blueB+"40":isOpp?T.purple+"40":T.b1;
              const nameC=isUser?T.blueB:isOpp?T.purple:T.textD;
              const avatInit=isUser?"Vous":isOpp?opponent.init:j?.init||"EM";
              return(
                <div key={i} style={{display:"flex",gap:8,flexDirection:isUser?"row-reverse":"row",alignItems:"flex-start"}}>
                  <Avatar init={avatInit} size={28} T={T} color={isOpp?T.purple:undefined}/>
                  <div style={{maxWidth:"80%",background:bgC,border:`1px solid ${brC}`,borderRadius:10,padding:"6px 10px"}}>
                    <p style={{fontSize:11,fontWeight:700,color:nameC,marginBottom:2}}>{m.name}</p>
                    <p style={{fontSize:12,color:T.text,lineHeight:1.5}}>{m.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{padding:"12px 20px 24px",borderTop:`1px solid ${T.b1}`,background:T.surf,flexShrink:0}}>
        <div style={{display:"flex",gap:10,marginBottom:10}}>
          <button onClick={()=>setShowTx(s=>!s)} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${T.b1}`,background:showTx?T.blueG:T.card,color:showTx?T.blueB:T.textD,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Sous-titres</button>
          <button onClick={()=>{setPhase("ended");setShowScore(true);}} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${T.b1}`,background:T.card,color:T.textD,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Terminer</button>
        </div>
        {phase==="cut"?(
          <button onClick={()=>{setPhase("speaking");setTimer(90);setTimerOn(true);addLine("journalist",j?.name||"Journaliste","Je vous redonne la parole.");speakTimed("Je vous redonne la parole.",(j?.gender||"F") as "M"|"F",()=>setAutoMic(true));}} style={{width:"100%",padding:14,borderRadius:12,border:"none",background:T.blueB,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Reprendre la parole</button>
        ):phase==="listening"?(
          <button onClick={stopMic} style={{width:"100%",padding:14,borderRadius:12,border:`2px solid ${T.red}`,background:`${T.red}15`,color:T.red,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,animation:"ripple 1.5s infinite"}}>
            <Ic n="micOff" s={18} c={T.red}/>Couper le micro
          </button>
        ):(
          <button onClick={startMic} disabled={phase==="waiting"||loading} style={{width:"100%",padding:14,borderRadius:12,border:"none",background:phase==="waiting"||loading?T.muted:T.blueB,color:"#fff",fontSize:14,fontWeight:800,cursor:phase==="waiting"||loading?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,opacity:loading?0.7:1}}>
            <Ic n="mic" s={18} c="#fff"/>{loading?"En attente…":"Prendre la parole"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── TOPIC PICKER ─────────────────────────────────────────────
function TopicPicker({topic,setTopic,T}:{topic:string;setTopic:(t:string)=>void;T:Theme}) {
  const [catId,setCatId] = useState<string|null>(null);
  const cat = DEBATE_CATEGORIES.find(c=>c.id===catId);
  return (
    <div>
      <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Sujet du débat</p>
      {topic&&<p style={{color:T.blueB,fontSize:12,fontWeight:600,marginBottom:8,padding:"6px 10px",background:T.blueG,borderRadius:8}}>✓ {topic.slice(0,50)}{topic.length>50?"…":""}</p>}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
        {DEBATE_CATEGORIES.map(c=>(
          <button key={c.id} onClick={()=>setCatId(catId===c.id?null:c.id)} style={{padding:"6px 12px",borderRadius:20,border:`1.5px solid ${catId===c.id?T.blueB:T.b1}`,background:catId===c.id?T.blueG:T.card,color:catId===c.id?T.blueB:T.textD,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}}>{c.label}</button>
        ))}
      </div>
      {cat&&(
        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:240,overflowY:"auto",border:`1px solid ${T.b1}`,borderRadius:10,padding:8}}>
          {cat.topics.map(t=>(
            <button key={t} onClick={()=>{setTopic(t);setCatId(null);}} style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${topic===t?T.blueB:T.b1}`,background:topic===t?T.blueG:"transparent",cursor:"pointer",textAlign:"left",color:topic===t?T.blueB:T.text,fontSize:12,fontWeight:topic===t?700:400,transition:"all .15s",fontFamily:"inherit"}}>{t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BRIEFING SCREEN ───────────────────────────────────────────
function BriefingScreen({topic,T,onStart,onSkip}:{topic:string;T:Theme;onStart:()=>void;onSkip:()=>void}) {
  const [speaking,setSpeaking] = useState(false);
  const briefText = `"${topic}" est un sujet complexe qui soulève des enjeux majeurs dans notre société. Pour débattre efficacement, il est utile de connaître les principaux arguments des deux camps, le contexte historique et les acteurs clés du débat. Prenez le temps de structurer votre position avec des faits concrets, des exemples réels et une argumentation logique. Votre journaliste testera la solidité de votre raisonnement.`;
  const speakBriefing = () => {
    if(!("speechSynthesis" in window)) return;
    if(speaking){window.speechSynthesis.cancel();setSpeaking(false);return;}
    const u = new SpeechSynthesisUtterance(briefText);
    u.lang="fr-FR";u.rate=0.95;
    const voices=window.speechSynthesis.getVoices();
    const fr=voices.find(v=>v.lang.startsWith("fr"));
    if(fr)u.voice=fr;
    u.onend=()=>setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  return(
    <div style={{padding:"24px 20px",display:"flex",flexDirection:"column",gap:20,height:"100%"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:44,height:44,borderRadius:12,background:T.blueG,border:`1px solid ${T.blueB}30`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="info" s={22} c={T.blueB}/></div>
        <div>
          <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase"}}>Avant le débat</p>
          <h2 style={{color:T.text,fontSize:18,fontWeight:800,marginTop:2}}>Comprendre le sujet</h2>
        </div>
      </div>
      <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:20}}>
        <p style={{color:T.text,fontSize:14,lineHeight:1.7,fontWeight:500}}>{briefText}</p>
      </div>
      <button onClick={speakBriefing} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:14,borderRadius:12,border:`1.5px solid ${speaking?T.red:T.blueB}`,background:speaking?`${T.red}15`:T.blueG,color:speaking?T.red:T.blueB,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}}>
        <Ic n={speaking?"x":"play"} s={18} c={speaking?T.red:T.blueB}/>{speaking?"Arrêter la lecture":"🔊 Écouter"}
      </button>
      <div style={{display:"flex",gap:10,marginTop:"auto"}}>
        <button onClick={onSkip} style={{flex:1,padding:14,borderRadius:12,border:`1px solid ${T.b1}`,background:"transparent",color:T.textD,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Ignorer</button>
        <button onClick={onStart} style={{flex:2,padding:14,borderRadius:12,border:"none",background:T.blueB,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Lancer le débat →</button>
      </div>
    </div>
  );
}

// ── STUDIO SCREEN ─────────────────────────────────────────────
function StudioScreen({T}:{T:Theme}) {
  const [step,setStep] = useState<"home"|"journalist"|"level"|"topic"|"public"|"brief"|"stage">("home");
  const [journalist,setJournalist] = useState<typeof JOURNALISTS[0]|null>(null);
  const [level,setLevel] = useState<typeof LEVELS[0]|null>(null);
  const [topic,setTopic] = useState("");
  const [publicSide,setPublicSide] = useState<typeof PUBLICS[0]|null>(null);
  const [subMode,setSubMode] = useState<"solo"|"duel-ia"|"duel-ami"|null>(null);
  const [inviteCode,setInviteCode] = useState("");

  if(step==="stage"&&journalist&&level&&topic){
    return <AudioStage config={{journalist,level,topic,publicSide,subMode}} T={T} onBack={()=>setStep("home")}/>;
  }
  if(step==="brief"&&topic){
    return <BriefingScreen topic={topic} T={T} onStart={()=>setStep("stage")} onSkip={()=>setStep("stage")}/>;
  }

  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
      <div style={{paddingBottom:4}}>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Studio Audio</p>
        <h1 style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:28,fontWeight:800,color:T.text,lineHeight:1.1}}>Débat en direct</h1>
      </div>
      {/* Mode selector */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[{id:"solo",label:"Solo",sub:"Journaliste IA",icon:"mic"},{id:"duel-ia",label:"Duel IA",sub:"Face à l'IA",icon:"zap"},{id:"duel-ami",label:"Duel ami",sub:"Code invitation",icon:"users"}].map(m=>(
          <button key={m.id} onClick={()=>setSubMode(m.id as "solo"|"duel-ia"|"duel-ami")} style={{padding:"14px 8px",borderRadius:12,border:`1.5px solid ${subMode===m.id?T.blueB:T.b1}`,background:subMode===m.id?T.blueG:T.card,cursor:"pointer",textAlign:"center",transition:"all .2s"}}>
            <Ic n={m.icon} s={20} c={subMode===m.id?T.blueB:T.textD}/>
            <p style={{color:subMode===m.id?T.blueB:T.text,fontSize:12,fontWeight:700,marginTop:6}}>{m.label}</p>
            <p style={{color:T.muted,fontSize:10,marginTop:2}}>{m.sub}</p>
          </button>
        ))}
      </div>
      {subMode==="duel-ami"&&(
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:16}}>
          <p style={{color:T.text,fontSize:13,fontWeight:700,marginBottom:10}}>Code d&apos;invitation ami</p>
          <div style={{display:"flex",gap:8}}>
            <input value={inviteCode} onChange={e=>setInviteCode(e.target.value)} placeholder="NEXUS-XXXX" style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:13,outline:"none"}}/>
            <button style={{padding:"10px 16px",borderRadius:8,border:"none",background:T.blueB,color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Rejoindre</button>
          </div>
          <p style={{color:T.muted,fontSize:11,marginTop:8}}>Ton code : <span style={{color:T.blueB,fontWeight:800}}>NEXUS-{Math.random().toString(36).slice(2,6).toUpperCase()}</span></p>
        </div>
      )}
      {/* Journalist */}
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Journaliste</p>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {JOURNALISTS.map(j=>(
            <button key={j.id} onClick={()=>setJournalist(j)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:12,border:`1.5px solid ${journalist?.id===j.id?T.blueB:T.b1}`,background:journalist?.id===j.id?T.blueG:T.card,cursor:"pointer",textAlign:"left",transition:"all .2s"}}>
              <Avatar init={j.init} size={42} T={T}/>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{color:T.text,fontWeight:700,fontSize:14}}>{j.name}</span>
                  {j.live&&<span style={{background:`${T.red}15`,color:T.red,fontSize:9,padding:"2px 6px",borderRadius:4,fontWeight:800}}>EN DIRECT</span>}
                </div>
                <p style={{color:T.textD,fontSize:12,marginTop:2}}>{j.role} · {j.spec}</p>
              </div>
              {journalist?.id===j.id&&<Ic n="check" s={18} c={T.blueB}/>}
            </button>
          ))}
        </div>
      </div>
      {/* Level */}
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Niveau adversaire IA</p>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {LEVELS.map(l=>(
            <button key={l.id} onClick={()=>!l.premium&&setLevel(l)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:10,border:`1.5px solid ${level?.id===l.id?T.blueB:T.b1}`,background:level?.id===l.id?T.blueG:T.card,cursor:l.premium?"not-allowed":"pointer",opacity:l.premium?.6:1,textAlign:"left",transition:"all .2s"}}>
              <div style={{display:"flex",gap:3}}>{Array(5).fill(0).map((_,i)=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:i<l.tier?T.blueB:T.b1}}/>)}</div>
              <div style={{flex:1}}>
                <span style={{color:T.text,fontWeight:700,fontSize:13}}>{l.label}</span>
                <span style={{color:T.muted,fontSize:11,marginLeft:8}}>{l.sub}</span>
              </div>
              {l.premium?<Ic n="lock" s={14} c={T.muted}/>:level?.id===l.id?<Ic n="check" s={16} c={T.blueB}/>:null}
            </button>
          ))}
        </div>
      </div>
      {/* Topic — catégories */}
      <TopicPicker topic={topic} setTopic={setTopic} T={T}/>
      {/* Public */}
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Public en salle</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {PUBLICS.map(p=>(
            <button key={p.id} onClick={()=>setPublicSide(p)} style={{padding:"12px",borderRadius:10,border:`1.5px solid ${publicSide?.id===p.id?T.blueB:T.b1}`,background:publicSide?.id===p.id?T.blueG:T.card,cursor:"pointer",textAlign:"left",transition:"all .2s"}}>
              <p style={{color:publicSide?.id===p.id?T.blueB:T.text,fontWeight:700,fontSize:13}}>{p.label}</p>
              <p style={{color:T.muted,fontSize:11,marginTop:3}}>{p.desc}</p>
            </button>
          ))}
        </div>
      </div>
      <button onClick={()=>{if(journalist&&level&&topic)setStep("brief");}} disabled={!journalist||!level||!topic} style={{padding:16,borderRadius:14,border:"none",background:journalist&&level&&topic?T.blueB:T.b1,color:journalist&&level&&topic?"#fff":T.muted,fontSize:15,fontWeight:800,cursor:journalist&&level&&topic?"pointer":"not-allowed",fontFamily:"inherit",letterSpacing:.5,marginBottom:8}}>
        Continuer
      </button>
    </div>
  );
}

// ── LIVE NEWS ─────────────────────────────────────────────────
const RSS_SOURCES = [
  // Presse française
  {name:"Le Monde",       url:"https://www.lemonde.fr/rss/une.xml",                                           tag:"LE MONDE",        tagC:"#E03535"},
  {name:"Le Figaro",      url:"https://www.lefigaro.fr/rss/figaro_actualites.xml",                            tag:"LE FIGARO",       tagC:"#C0392B"},
  {name:"L'Express",      url:"https://www.lexpress.fr/rss/alaune.xml",                                       tag:"L'EXPRESS",       tagC:"#E67E22"},
  {name:"Libération",     url:"https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml",               tag:"LIBÉRATION",      tagC:"#8E44AD"},
  {name:"20 Minutes",     url:"https://www.20minutes.fr/feeds/rss/actu",                                      tag:"20 MINUTES",      tagC:"#2980B9"},
  {name:"Courrier Int.",  url:"https://www.courrierinternational.com/feed/all/rss.xml",                        tag:"COURRIER INT.",   tagC:"#16A085"},
  // Médias internationaux francophones
  {name:"France 24",      url:"https://www.france24.com/fr/rss",                                              tag:"FRANCE 24",       tagC:"#2B78F5"},
  {name:"RFI",            url:"https://www.rfi.fr/fr/podcasts/rss",                                           tag:"RFI",             tagC:"#27AE60"},
  {name:"BBC Afrique",    url:"https://feeds.bbci.co.uk/afrique/rss.xml",                                     tag:"BBC",             tagC:"#7C3AED"},
  {name:"TV5 Monde",      url:"https://information.tv5monde.com/rss",                                         tag:"TV5MONDE",        tagC:"#1ABC9C"},
  {name:"Jeune Afrique",  url:"https://www.jeuneafrique.com/feed/",                                           tag:"JEUNE AFRIQUE",   tagC:"#F39C12"},
  {name:"Africanews",     url:"https://www.africanews.com/feed/",                                             tag:"AFRICANEWS",      tagC:"#E74C3C"},
  {name:"DW Français",    url:"https://rss.dw.com/rdf/rss-fr-tout",                                           tag:"DW",              tagC:"#2C3E50"},
  // Flux Google News par thème
  {name:"Actualités FR",  url:"https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr",                           tag:"GOOGLE NEWS",     tagC:"#3498DB"},
  {name:"Géopolitique",   url:"https://news.google.com/rss/search?q=géopolitique&hl=fr&gl=FR&ceid=FR:fr",     tag:"GÉOPOLITIQUE",    tagC:"#D35400"},
  {name:"Afrique",        url:"https://news.google.com/rss/search?q=afrique+actualité&hl=fr&gl=FR&ceid=FR:fr",tag:"AFRIQUE",         tagC:"#F1C40F"},
  {name:"Technologie",    url:"https://news.google.com/rss/search?q=technologie+innovation&hl=fr&gl=FR&ceid=FR:fr",tag:"TECH",        tagC:"#1ABC9C"},
  {name:"Diplomatie",     url:"https://news.google.com/rss/search?q=diplomatie+relations+internationales&hl=fr&gl=FR&ceid=FR:fr",tag:"DIPLOMATIE",tagC:"#9B59B6"},
];
type LiveArticle = {id:string;title:string;src:string;tag:string;tagC:string;time:string;imgUrl:string|null;link:string;verif?:{label:string;color:string}};

function parseRawRSS(xml:string):{title:string;link:string;pubDate:string;guid:string;thumbnail:string|undefined}[]{
  try{
    if(typeof DOMParser==="undefined") return [];
    const doc=new DOMParser().parseFromString(xml,"text/xml");
    return Array.from(doc.querySelectorAll("item,entry")).slice(0,8).map(el=>{
      const txt=(sel:string)=>el.querySelector(sel)?.textContent?.replace(/<!\[CDATA\[|\]\]>/g,"").trim()||"";
      const linkEl=el.querySelector("link");
      const link=linkEl?.getAttribute("href")||linkEl?.textContent?.trim()||"";
      const thumb=el.getElementsByTagNameNS("http://search.yahoo.com/mrss/","thumbnail")[0]?.getAttribute("url")
        ||el.getElementsByTagNameNS("http://search.yahoo.com/mrss/","content")[0]?.getAttribute("url")
        ||el.querySelector("enclosure[type^='image']")?.getAttribute("url")||undefined;
      return{title:txt("title"),link,pubDate:txt("pubDate")||txt("published"),guid:txt("guid")||link,thumbnail:thumb};
    });
  }catch{return [];}
}

function makeTimeStr(pubStr:string):string{
  const pub=new Date(pubStr);
  const diff=Date.now()-pub.getTime();
  if(isNaN(diff)) return "";
  if(diff<3600000) return `${Math.floor(diff/60000)}min`;
  if(diff<86400000) return `${Math.floor(diff/3600000)}h`;
  return `${Math.floor(diff/86400000)}j`;
}

async function fetchLiveNews(): Promise<LiveArticle[]> {
  const results: LiveArticle[] = [];
  const rssKey = typeof window!=="undefined"?localStorage.getItem("rss2json_key")||"":"";
  await Promise.allSettled(RSS_SOURCES.map(async(src)=>{
    try{
      let items:Array<{title:string;link:string;pubDate?:string;published?:string;guid?:string;thumbnail?:string|null;enclosure?:{link?:string}}> | null = null;
      // Primary: rss2json (good JSON + images)
      try{
        const apiParam=rssKey?`&api_key=${rssKey}`:"";
        const r=await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(src.url)}&count=8${apiParam}`,{signal:AbortSignal.timeout(7000)});
        if(r.ok){const d=await r.json();if(d.status==="ok"&&d.items?.length) items=d.items;}
      }catch{/*try fallback*/}
      // Fallback: corsproxy.io + DOMParser
      if(!items){
        try{
          const r=await fetch(`https://corsproxy.io/?${encodeURIComponent(src.url)}`,{signal:AbortSignal.timeout(7000)});
          if(r.ok){const t=await r.text();const parsed=parseRawRSS(t);if(parsed.length) items=parsed;}
        }catch{/*source unavailable*/}
      }
      if(!items) return;
      for(const item of items.slice(0,8)){
        const title=(item.title||"").replace(/<[^>]+>/g,"").replace(/<!\[CDATA\[|\]\]>/g,"").trim().slice(0,160);
        if(!title) continue;
        results.push({
          id:`${src.name}-${item.guid||item.link}`,
          title,src:src.name,tag:src.tag,tagC:src.tagC,
          time:makeTimeStr(item.pubDate||item.published||""),
          imgUrl:item.thumbnail||item.enclosure?.link||null,
          link:item.link||"",
        });
      }
    }catch{/*source unavailable*/}
  }));
  return results.sort(()=>Math.random()-0.5);
}

// ── FEED SCREEN ───────────────────────────────────────────────
function FeedScreen({T,onDebate,onNewPosts}:{T:Theme;onDebate:()=>void;onNewPosts:(n:number)=>void}) {
  const [filter,setFilter] = useState("Tout");
  const [liked,setLiked] = useState<Set<number>>(new Set());
  const [flagged,setFlagged] = useState<Set<number>>(new Set());
  const [showCompose,setShowCompose] = useState(false);
  const [composed,setComposed] = useState("");
  const [liveNews,setLiveNews] = useState<LiveArticle[]>([]);
  const [liveLoading,setLiveLoading] = useState(false);
  const [lastRefresh,setLastRefresh] = useState<Date|null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [search,setSearch] = useState("");
  const [composeSrc,setComposeSrc] = useState("");
  const [verifying,setVerifying] = useState(false);
  type UserPost = {id:number;text:string;time:string;src:string;verif:{label:string;color:string;comment:string}|null};
  const [userPosts,setUserPosts] = useState<UserPost[]>(()=>{
    if(typeof window==="undefined") return [];
    try{return JSON.parse(localStorage.getItem("nexus_posts")||"[]");}catch{return [];}
  });
  type NexusOfficialPost = LiveArticle & {publishedAt:number};
  const [nexusPosts,setNexusPosts] = useState<NexusOfficialPost[]>(()=>{
    if(typeof window==="undefined") return [];
    try{return JSON.parse(localStorage.getItem("nexus_official_posts")||"[]");}catch{return [];}
  });

  const refresh = async(withGemini=false)=>{
    setLiveLoading(true);
    const articles = await fetchLiveNews();
    if(withGemini){
      const key = typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
      if(key){
        await Promise.allSettled(articles.slice(0,6).map(async(a)=>{
          try{
            const raw=await callGemini(
              `Tu es fact-checker. Évalue la crédibilité de ce titre d'actualité en JSON une ligne : {"label":"<FIABLE|PROBABLE|DOUTEUX>","color":"<#16A34A|#2B78F5|#D97706>"}`,
              [{role:"user" as const,parts:[{text:`Source: ${a.src}. Titre: ${a.title}`}]}],
              key,50
            );
            const m=raw.match(/\{[^}]+\}/);
            if(m){const p=JSON.parse(m[0]);a.verif={label:p.label||"PROBABLE",color:p.color||"#2B78F5"};}
          }catch{/*skip*/}
        }));
      }
    }
    setLiveNews(articles);
    setLastRefresh(new Date());
    setLiveLoading(false);

    // Always merge fresh articles into nexusPosts (dedup by id)
    if(articles.length>0){
      const existing: NexusOfficialPost[] = JSON.parse(localStorage.getItem("nexus_official_posts")||"[]");
      const existingIds=new Set(existing.map(p=>p.id));
      const brandNew=articles.filter(a=>!existingIds.has(a.id)).map(a=>({...a,publishedAt:Date.now()}));
      const all=[...brandNew,...existing].slice(0,300);
      setNexusPosts(all);
      localStorage.setItem("nexus_official_posts",JSON.stringify(all));
      // Badge: only count articles never seen before
      if(brandNew.length>0){
        const seenIds: string[] = JSON.parse(localStorage.getItem("nexus_seen_ids")||"[]");
        const unnotified=brandNew.filter(a=>!seenIds.includes(a.id));
        const newSeen=[...seenIds,...brandNew.map(a=>a.id)].slice(-300);
        localStorage.setItem("nexus_seen_ids",JSON.stringify(newSeen));
        if(unnotified.length>0) onNewPosts(unnotified.length);
      }
    }
  };

  useEffect(()=>{
    refresh();
    // Auto-refresh every 30 minutes
    refreshTimerRef.current=setInterval(()=>refresh(),15*60*1000);
    return()=>{if(refreshTimerRef.current)clearInterval(refreshTimerRef.current);};
  },[]);// eslint-disable-line

  const publishPost = async()=>{
    if(!composed.trim()) return;
    const key = typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
    let verif: {label:string;color:string;comment:string}|null = null;
    if(key){
      setVerifying(true);
      try{
        const raw = await callGemini(
          `Tu es un fact-checker pour un réseau social civique. Analyse ce texte et réponds UNIQUEMENT en JSON valide sur une ligne.
Format strict: {"score": <0-100>, "label": "<VÉRIFIÉ|PROBABLE|DOUTEUX|NON VÉRIFIÉ>", "comment": "<1 phrase max 80 chars>"}
VÉRIFIÉ (80-100): faits exacts et vérifiables. PROBABLE (60-79): cohérent mais non prouvé. DOUTEUX (30-59): contradictions ou manque de preuves. NON VÉRIFIÉ (0-29): sans source ou invérifiable.`,
          [{role:"user" as const,parts:[{text:composed}]}],
          key,
          80
        );
        const match=raw.match(/\{[^}]+\}/);
        if(match){
          const parsed=JSON.parse(match[0]);
          const col=parsed.score>=80?"#16A34A":parsed.score>=60?"#2B78F5":parsed.score>=30?"#D97706":"#E03535";
          verif={label:parsed.label||"NON VÉRIFIÉ",color:col,comment:parsed.comment||""};
        }
      }catch{/*publish without verif*/}
      setVerifying(false);
    }
    const post:UserPost={id:Date.now(),text:composed,src:composeSrc||"Moi",time:"À l'instant",verif};
    const next=[post,...userPosts];
    setUserPosts(next);
    localStorage.setItem("nexus_posts",JSON.stringify(next));
    setComposed("");setComposeSrc("");setShowCompose(false);
  };

  return(
    <div>
      {/* Compose modal */}
      {showCompose&&(
        <div onClick={e=>e.target===e.currentTarget&&setShowCompose(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div style={{background:T.surf,borderRadius:"20px 20px 0 0",width:"100%",maxWidth:430,padding:"20px 20px 40px",display:"flex",flexDirection:"column",gap:12,animation:"slideUp .3s ease"}}>
            <div style={{width:40,height:4,borderRadius:2,background:T.b2,margin:"0 auto 8px"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <p style={{color:T.text,fontWeight:800,fontSize:16}}>Publier une analyse</p>
              <button onClick={()=>setShowCompose(false)} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="x" s={20} c={T.textD}/></button>
            </div>
            <textarea value={composed} onChange={e=>setComposed(e.target.value)} placeholder="Partagez votre analyse, opinion ou information…" rows={4} style={{background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:12,padding:"12px 14px",color:T.text,fontSize:14,fontFamily:"inherit",outline:"none",resize:"none",lineHeight:1.6}}/>
            <input value={composeSrc} onChange={e=>setComposeSrc(e.target.value)} placeholder="Source (ex: Le Monde, Reuters…) — optionnel" style={{background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"9px 12px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none"}}/>
            {typeof window!=="undefined"&&!localStorage.getItem("gemini_key")&&(
              <div style={{background:`${T.amber}15`,border:`1px solid ${T.amber}30`,borderRadius:8,padding:"8px 12px"}}>
                <p style={{color:T.amber,fontSize:11,fontWeight:600}}>💡 Configurez votre clé Gemini dans Profil → Réglages pour activer la vérification IA automatique</p>
              </div>
            )}
            <button onClick={publishPost} disabled={!composed.trim()||verifying} style={{padding:15,borderRadius:12,border:"none",background:composed.trim()&&!verifying?T.blueB:T.b1,color:composed.trim()&&!verifying?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:composed.trim()&&!verifying?"pointer":"not-allowed",fontFamily:"inherit",transition:"background .2s"}}>
              {verifying?"🔍 Vérification IA en cours…":"Publier"}
            </button>
          </div>
        </div>
      )}
      {/* Live news header */}
      <div style={{padding:"10px 20px",borderBottom:`1px solid ${T.b1}`,display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:T.red,animation:"pulse 1s infinite",flexShrink:0}}/>
        <span style={{color:T.red,fontSize:10,fontWeight:800,letterSpacing:1.5}}>ACTUALITÉS EN DIRECT</span>
        {lastRefresh&&<span style={{color:T.muted,fontSize:10}}>· {lastRefresh.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</span>}
      </div>
      {liveLoading&&liveNews.length===0&&(
        <div style={{padding:"20px",textAlign:"center"}}>
          <div style={{display:"inline-flex",gap:5,alignItems:"center"}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:T.blueB,animation:`pulse 1.2s ${i*0.2}s infinite`}}/>)}</div>
          <p style={{color:T.muted,fontSize:12,marginTop:8}}>Chargement des actualités…</p>
        </div>
      )}
      {/* Compose */}
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${T.b1}`,display:"flex",gap:10,alignItems:"center"}}>
        <Avatar init="A" size={36} T={T}/>
        <div style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:20,padding:"9px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"text"}} onClick={()=>setShowCompose(true)}>
          <span style={{color:T.muted,fontSize:13}}>Partagez votre analyse…</span>
          <div style={{display:"flex",gap:10}}>
            <Ic n="image" s={16} c={T.muted}/><Ic n="video" s={16} c={T.muted}/>
          </div>
        </div>
      </div>
      {/* Stories */}
      <div style={{padding:"10px 20px",borderBottom:`1px solid ${T.b1}`,display:"flex",gap:12,overflowX:"auto"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flexShrink:0}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:T.blueG,border:`1.5px dashed ${T.blueB}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="plus" s={18} c={T.blueB}/></div>
          <span style={{fontSize:10,color:T.muted,fontWeight:600}}>Ma story</span>
        </div>
        {["EM","MK","SB","JL","YK","BC"].map((init,i)=>(
          <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flexShrink:0}}>
            <div style={{width:52,height:52,borderRadius:"50%",padding:2,background:"linear-gradient(135deg,#2B78F5,#7C3AED)"}}>
              <div style={{width:"100%",height:"100%",borderRadius:"50%",background:T.card,border:`2px solid ${T.bg}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:T.blueB}}>{init}</div>
            </div>
            <span style={{fontSize:10,color:T.textD,fontWeight:600}}>{init}</span>
          </div>
        ))}
      </div>
      {/* Search + Filters */}
      <div style={{padding:"10px 20px 0",borderBottom:`1px solid ${T.b1}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:10,padding:"7px 12px"}}>
          <Ic n="search" s={15} c={T.muted}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une actualité…" style={{flex:1,background:"transparent",border:"none",outline:"none",color:T.text,fontSize:13,fontFamily:"inherit"}}/>
          {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="x" s={14} c={T.muted}/></button>}
        </div>
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:10}}>
          {FILTERS.map(f=>(
            <button key={f} onClick={()=>setFilter(f)} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${filter===f?T.blueB:T.b1}`,background:filter===f?T.blueB:"transparent",color:filter===f?"#fff":T.textD,fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit",transition:"all .2s"}}>{f}</button>
          ))}
        </div>
      </div>
      {/* User posts */}
      {userPosts.length>0&&(
        <div style={{padding:"12px 20px 0",display:"flex",flexDirection:"column",gap:12}}>
          {userPosts.map(p=>(
            <div key={p.id} style={{background:T.card,border:`1px solid ${T.blueB}30`,borderRadius:14,overflow:"hidden",animation:"fadeUp .4s ease"}}>
              <div style={{padding:"12px 14px 8px",display:"flex",alignItems:"center",gap:10}}>
                <Avatar init="A" size={36} T={T}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{color:T.text,fontWeight:700,fontSize:13}}>{p.src}</span>
                    {p.verif&&<span style={{background:`${p.verif.color}20`,color:p.verif.color,fontSize:9,padding:"2px 7px",borderRadius:4,fontWeight:800}}>✦ {p.verif.label}</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2}}>
                    <Tag label="MON ANALYSE" color={T.blueB} small/>
                    <span style={{color:T.muted,fontSize:11}}>· {p.time}</span>
                  </div>
                </div>
              </div>
              <div style={{padding:"4px 14px 10px"}}>
                <p style={{color:T.text,fontSize:14,lineHeight:1.6}}>{p.text}</p>
                {p.verif&&<p style={{color:p.verif.color,fontSize:11,marginTop:6,fontWeight:600}}>🤖 Analyse IA : {p.verif.comment}</p>}
              </div>
              <div style={{padding:"8px 14px 12px",display:"flex",alignItems:"center",borderTop:`1px solid ${T.b1}`}}>
                <button style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"0 8px 0 0"}}>
                  <Ic n="heart" s={16} c={T.textD}/><span style={{fontSize:12,fontWeight:600}}>0</span>
                </button>
                <button style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"0 8px"}}>
                  <Ic n="comment" s={16} c={T.textD}/><span style={{fontSize:12,fontWeight:600}}>0</span>
                </button>
                <div style={{marginLeft:"auto"}}>
                  <button onClick={()=>{const next=userPosts.filter(x=>x.id!==p.id);setUserPosts(next);localStorage.setItem("nexus_posts",JSON.stringify(next));}} style={{background:`${T.red}15`,border:`1px solid ${T.red}30`,borderRadius:8,padding:"5px 10px",color:T.red,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Supprimer</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* NEXUS Official auto-published posts */}
      <div style={{display:"flex",flexDirection:"column"}}>
      {nexusPosts.filter(p=>{
        const searchMatch = !search || p.title.toLowerCase().includes(search.toLowerCase())||p.src.toLowerCase().includes(search.toLowerCase());
        const FILTER_MAP: Record<string,string[]> = {"Géopolitique":["GÉOPOLITIQUE","GUERRE","DIPLOMATIE","INTERNATIONAL"],"Diplomatie":["DIPLOMATIE"],"Histoire":["HISTOIRE"],"Droit":["DROIT","IMMIGRATION"],"Élections":["ÉLECTIONS","POLITIQUE"],"Europe":["EUROPE","DIPLOMATIE"],"Afrique":["AFRIQUE"]};
        const kws = filter!=="Tout"?FILTER_MAP[filter]||[]:null;
        const tagMatch = !kws || kws.some(k=>p.tag.toUpperCase().includes(k)||p.title.toUpperCase().includes(k));
        return searchMatch && tagMatch;
      }).slice(0,100).map(p=>(
        <div key={p.id} style={{background:T.card,borderBottom:`1px solid ${T.b1}`,animation:"fadeUp .4s ease"}}>
          <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:40,height:40,borderRadius:"50%",background:"#000",border:`2px solid ${T.blueB}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"#fff",flexShrink:0}}>N</div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{color:T.text,fontWeight:800,fontSize:14}}>NEXUS Intelligence</span>
                <span style={{background:`${T.blueB}20`,color:T.blueB,fontSize:10,padding:"2px 7px",borderRadius:4,fontWeight:800,letterSpacing:.5}}>✓ OFFICIEL</span>
                {p.verif&&<span style={{background:`${p.verif.color}15`,color:p.verif.color,fontSize:10,padding:"2px 7px",borderRadius:4,fontWeight:800}}>✦ {p.verif.label}</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3,flexWrap:"wrap"}}>
                <Tag label={p.tag} color={p.tagC} small/>
                {p.time&&<span style={{color:T.muted,fontSize:11}}>· {p.time}</span>}
                <span style={{color:T.muted,fontSize:11}}>· {p.src}</span>
              </div>
            </div>
          </div>
          {p.imgUrl&&<div style={{width:"100%",height:220,overflow:"hidden"}}><img src={p.imgUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).parentElement!.style.display="none"}}/></div>}
          <a href={p.link} target="_blank" rel="noopener noreferrer" style={{display:"block",padding:"12px 16px 8px",textDecoration:"none"}}>
            <p style={{color:T.text,fontSize:16,fontWeight:700,lineHeight:1.5,margin:0}}>{p.title}</p>
            <p style={{color:T.blueB,fontSize:12,marginTop:6,fontWeight:600}}>Lire l&apos;article complet →</p>
          </a>
          <div style={{padding:"10px 16px 14px",display:"flex",alignItems:"center"}}>
            <button style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"0 14px 0 0"}}>
              <Ic n="heart" s={17} c={T.textD}/><span style={{fontSize:13,fontWeight:600}}>0</span>
            </button>
            <button style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"0 14px"}}>
              <Ic n="share" s={17} c={T.textD}/>
            </button>
            <button onClick={onDebate} style={{marginLeft:"auto",background:T.blueG,border:`1px solid ${T.blueB}40`,borderRadius:8,padding:"6px 14px",color:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Débattre</button>
          </div>
        </div>
      ))}
      </div>
      {/* Empty state — only shown when no live news yet and not loading */}
      {nexusPosts.length===0&&!liveLoading&&(
        <div style={{padding:"32px 20px",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:T.blueG,border:`1px solid ${T.blueB}30`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Ic n="trending" s={26} c={T.blueB}/>
          </div>
          <p style={{color:T.text,fontSize:14,fontWeight:700}}>Aucune actualité chargée</p>
          <p style={{color:T.muted,fontSize:12,lineHeight:1.5}}>Vérifiez votre connexion internet et appuyez sur Actualiser pour charger les dernières infos.</p>
          <button onClick={()=>refresh(false)} style={{padding:"10px 24px",borderRadius:10,border:"none",background:T.blueB,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Actualiser maintenant</button>
        </div>
      )}
    </div>
  );
}

// ── EVENTS SCREEN ─────────────────────────────────────────────
function EventsScreen({T}:{T:Theme}) {
  type EventItem = {id:number;date:string;month:string;day:string;title:string;loc:string;type:string;lat:number;lng:number;attendees:number;isUser?:boolean;desc?:string};
  const [reg,setReg] = useState<Set<number>>(new Set());
  const [filter,setFilter] = useState("Tout");
  const [userLoc,setUserLoc] = useState<{lat:number;lng:number}|null>(null);
  const [locLoading,setLocLoading] = useState(false);
  const [showAdd,setShowAdd] = useState(false);
  const [userEvents,setUserEvents] = useState<EventItem[]>(()=>{
    if(typeof window==="undefined") return [];
    try{return JSON.parse(localStorage.getItem("nexus_events")||"[]");}catch{return [];}
  });
  const [newTitle,setNewTitle] = useState("");
  const [newType,setNewType] = useState("Conférence");
  const [newLoc,setNewLoc] = useState("");
  const [newDate,setNewDate] = useState("");
  const [newDesc,setNewDesc] = useState("");

  const requestLoc=()=>{
    if(typeof navigator==="undefined"||!navigator.geolocation) return;
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos=>{setUserLoc({lat:pos.coords.latitude,lng:pos.coords.longitude});setLocLoading(false);},
      ()=>setLocLoading(false),
      {timeout:8000}
    );
  };

  useEffect(()=>{requestLoc();},[]);// eslint-disable-line

  const haversine=(lat1:number,lng1:number,lat2:number,lng2:number):number=>{
    const R=6371;
    const dLat=(lat2-lat1)*Math.PI/180;
    const dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  };

  const fmtDist=(km:number):string=>km<1?`${Math.round(km*1000)} m`:km<10?`${km.toFixed(1)} km`:`${Math.round(km)} km`;

  const addEvent=()=>{
    if(!newTitle||!newLoc||!newDate) return;
    const d=new Date(newDate);
    const months=["JAN","FÉV","MAR","AVR","MAI","JUN","JUL","AOÛ","SEP","OCT","NOV","DÉC"];
    const days=["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
    const ev:EventItem={
      id:Date.now(),date:String(d.getDate()),month:months[d.getMonth()],day:days[d.getDay()],
      title:newTitle,loc:newLoc,type:newType,lat:userLoc?.lat||48.8566,lng:userLoc?.lng||2.3522,
      attendees:1,isUser:true,desc:newDesc||undefined,
    };
    const next=[...userEvents,ev];
    setUserEvents(next);
    localStorage.setItem("nexus_events",JSON.stringify(next));
    setShowAdd(false);setNewTitle("");setNewLoc("");setNewDate("");setNewDesc("");
  };

  const deleteEvent=(id:number)=>{
    const next=userEvents.filter(e=>e.id!==id);
    setUserEvents(next);localStorage.setItem("nexus_events",JSON.stringify(next));
  };

  const allEvents:EventItem[]=[...EVENTS_DATA,...userEvents];
  const filtered=filter==="Tout"?allEvents:allEvents.filter(e=>e.type===filter);
  const sorted=userLoc?[...filtered].sort((a,b)=>haversine(userLoc.lat,userLoc.lng,a.lat,a.lng)-haversine(userLoc.lat,userLoc.lng,b.lat,b.lng)):filtered;

  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div>
          <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Agenda</p>
          <h1 style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:28,fontWeight:800,color:T.text}}>Événements</h1>
        </div>
        <button onClick={()=>setShowAdd(s=>!s)} style={{width:42,height:42,borderRadius:12,border:`1.5px solid ${showAdd?T.blueB:T.b1}`,background:showAdd?T.blueG:T.card,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .2s"}}>
          <Ic n="plus" s={20} c={showAdd?T.blueB:T.textD}/>
        </button>
      </div>
      {!userLoc&&(
        <button onClick={requestLoc} disabled={locLoading} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:12,border:`1px solid ${T.blueB}40`,background:T.blueG,cursor:"pointer",width:"100%",textAlign:"left"}}>
          <Ic n="map" s={16} c={T.blueB}/>
          <span style={{color:T.blueB,fontSize:12,fontWeight:700}}>{locLoading?"Localisation en cours…":"Activer la géolocalisation pour trier par distance"}</span>
        </button>
      )}
      {userLoc&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:10,background:`${T.green}15`,border:`1px solid ${T.green}30`}}>
          <Ic n="map" s={14} c={T.green}/>
          <span style={{color:T.green,fontSize:12,fontWeight:700}}>Géolocalisation active — triés par distance</span>
        </div>
      )}
      {showAdd&&(
        <div style={{background:T.card,border:`1px solid ${T.blueB}40`,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:10,animation:"fadeUp .3s ease"}}>
          <p style={{color:T.blueB,fontSize:13,fontWeight:800}}>Ajouter un événement</p>
          <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Titre *" style={{background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"9px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none"}}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <select value={newType} onChange={e=>setNewType(e.target.value)} style={{background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"9px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none"}}>
              {["Conférence","Débat","Forum","Simulation","Atelier","Autre"].map(t=><option key={t}>{t}</option>)}
            </select>
            <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} style={{background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"9px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none"}}/>
          </div>
          <input value={newLoc} onChange={e=>setNewLoc(e.target.value)} placeholder="Lieu (ville, salle…) *" style={{background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"9px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none"}}/>
          <textarea value={newDesc} onChange={e=>setNewDesc(e.target.value)} placeholder="Description (optionnel)" rows={2} style={{background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"9px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",resize:"none"}}/>
          {!userLoc&&<p style={{color:T.muted,fontSize:11}}>💡 Activez la géolocalisation pour que l&apos;événement soit localisé correctement</p>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setShowAdd(false)} style={{flex:1,padding:10,borderRadius:8,border:`1px solid ${T.b1}`,background:"transparent",color:T.textD,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Annuler</button>
            <button onClick={addEvent} disabled={!newTitle||!newLoc||!newDate} style={{flex:2,padding:10,borderRadius:8,border:"none",background:newTitle&&newLoc&&newDate?T.blueB:T.b1,color:newTitle&&newLoc&&newDate?"#fff":T.muted,fontSize:12,fontWeight:800,cursor:newTitle&&newLoc&&newDate?"pointer":"not-allowed",fontFamily:"inherit"}}>Publier l&apos;événement</button>
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:8,overflowX:"auto"}}>
        {["Tout","Conférence","Débat","Forum","Simulation","Atelier"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${filter===f?T.blueB:T.b1}`,background:filter===f?T.blueB:"transparent",color:filter===f?"#fff":T.textD,fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit",transition:"all .2s"}}>{f}</button>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {sorted.length===0&&<div style={{textAlign:"center",padding:40}}><p style={{color:T.muted,fontSize:14}}>Aucun événement dans cette catégorie</p></div>}
        {sorted.map(ev=>{
          const dist=userLoc?haversine(userLoc.lat,userLoc.lng,ev.lat,ev.lng):null;
          const isUser=ev.isUser;
          return(
            <div key={ev.id} style={{background:T.card,border:`1px solid ${isUser?T.blueB+"40":T.b1}`,borderRadius:14,padding:16,display:"flex",gap:14,animation:"fadeUp .4s ease"}}>
              <div style={{width:52,flexShrink:0,textAlign:"center",background:T.blueG,border:`1px solid ${T.blueB}30`,borderRadius:10,padding:"8px 4px"}}>
                <p style={{color:T.blueB,fontSize:20,fontWeight:900,lineHeight:1}}>{ev.date}</p>
                <p style={{color:T.blueB,fontSize:10,fontWeight:800,letterSpacing:1}}>{ev.month}</p>
                <p style={{color:T.muted,fontSize:9,marginTop:2}}>{ev.day}</p>
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:4}}>
                  <div style={{flex:1}}>
                    <p style={{color:T.text,fontSize:14,fontWeight:700,lineHeight:1.4}}>{ev.title}</p>
                    {isUser&&<span style={{fontSize:9,color:T.blueB,fontWeight:800,background:T.blueG,padding:"1px 6px",borderRadius:4,display:"inline-block",marginTop:2}}>MON ÉVÉNEMENT</span>}
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                    <Tag label={ev.type} color={T.blueB} small/>
                    {isUser&&<button onClick={()=>deleteEvent(ev.id)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><Ic n="x" s={14} c={T.muted}/></button>}
                  </div>
                </div>
                {ev.desc&&<p style={{color:T.textD,fontSize:11,marginBottom:6,lineHeight:1.4}}>{ev.desc}</p>}
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                  <Ic n="map" s={12} c={T.muted}/><span style={{color:T.textD,fontSize:12}}>{ev.loc}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{color:T.muted,fontSize:11}}>
                    {dist!==null?`📍 ${fmtDist(dist)} · `:""}{ev.attendees} inscrit{ev.attendees>1?"s":""}
                  </span>
                  <button onClick={()=>setReg(s=>{const ns=new Set(s);ns.has(ev.id)?ns.delete(ev.id):ns.add(ev.id);return ns;})} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${reg.has(ev.id)?T.green:T.blueB}`,background:reg.has(ev.id)?`${T.green}15`:T.blueG,color:reg.has(ev.id)?T.green:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    {reg.has(ev.id)?"✓ Inscrit":"S'inscrire"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MESSAGES SCREEN ───────────────────────────────────────────
function MessagesScreen({T}:{T:Theme}) {
  const [active,setActive] = useState<typeof CONVOS[0]|null>(null);
  const [msg,setMsg] = useState("");
  const [messages,setMessages] = useState<{from:string;text:string;time:string}[]>([
    {from:"other",text:"Quelqu'un a suivi le G7 ce matin ? La déclaration finale sur les sanctions est ambiguë.",time:"14:18"},
    {from:"other",text:"Je pense que l'Allemagne a bloqué la formulation forte.",time:"14:19"},
    {from:"me",text:"Exactement — Scholz ne voulait pas fermer le robinet du commerce Chine-EU.",time:"14:21"},
  ]);

  if(active){
    return(
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <div style={{padding:"12px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,background:T.surf,flexShrink:0}}>
          <button onClick={()=>setActive(null)} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={22} c={T.textD}/></button>
          <Avatar init={active.init} size={36} T={T}/>
          <div style={{flex:1}}>
            <p style={{color:T.text,fontWeight:700,fontSize:14}}>{active.name}</p>
            <p style={{color:T.green,fontSize:11}}>En ligne</p>
          </div>
          <Ic n="info" s={20} c={T.textD}/>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
          {messages.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:m.from==="me"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"75%",background:m.from==="me"?T.blueB:T.card,border:m.from==="me"?"none":`1px solid ${T.b1}`,borderRadius:m.from==="me"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 14px"}}>
                <p style={{color:m.from==="me"?"#fff":T.text,fontSize:13,lineHeight:1.5}}>{m.text}</p>
                <p style={{color:m.from==="me"?"rgba(255,255,255,.6)":T.muted,fontSize:10,marginTop:4,textAlign:"right"}}>{m.time}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:"12px 20px 24px",borderTop:`1px solid ${T.b1}`,background:T.surf,display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
          <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&msg.trim()){setMessages(ms=>[...ms,{from:"me",text:msg,time:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}]);setMsg("");}}} placeholder="Message…" style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:22,padding:"10px 16px",color:T.text,fontSize:13,outline:"none"}}/>
          <button onClick={()=>{if(msg.trim()){setMessages(ms=>[...ms,{from:"me",text:msg,time:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}]);setMsg("");}}} style={{width:40,height:40,borderRadius:"50%",background:T.blueB,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
            <Ic n="send" s={16} c="#fff"/>
          </button>
        </div>
      </div>
    );
  }

  const [msgTab,setMsgTab] = useState<"principal"|"groupes"|"demandes">("principal");
  const groupConvos = CONVOS.filter(c=>c.init.length>2);
  const dmConvos = CONVOS.filter(c=>c.init.length<=2);
  const requests = [{id:99,name:"Youssef T.",last:"Salut, je voulais débattre avec toi !",time:"Mar",unread:1,init:"YT"},{id:100,name:"Priya N.",last:"Tu veux faire un duel NEXUS ?",time:"Dim",unread:1,init:"PN"}];
  const listConvos = msgTab==="principal"?dmConvos:msgTab==="groupes"?groupConvos:requests;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px 0",flexShrink:0}}>
        <h1 style={{fontSize:26,fontWeight:800,color:T.text,marginBottom:12}}>Messages</h1>
        <div style={{display:"flex",borderBottom:`1px solid ${T.b1}`,marginBottom:4}}>
          {(["principal","groupes","demandes"] as const).map(t=>(
            <button key={t} onClick={()=>setMsgTab(t)} style={{flex:1,padding:"10px 0",border:"none",background:"transparent",borderBottom:`2px solid ${msgTab===t?T.blueB:"transparent"}`,color:msgTab===t?T.blueB:T.textD,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textTransform:"capitalize",transition:"all .2s"}}>
              {t==="principal"?"Principal":t==="groupes"?"Groupes":"Demandes"}{t==="demandes"&&<span style={{marginLeft:5,background:T.red,color:"#fff",borderRadius:10,fontSize:10,padding:"1px 5px"}}>2</span>}
            </button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"8px 20px"}}>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {listConvos.map(c=>(
            <button key={c.id} onClick={()=>setActive(c as typeof CONVOS[0])} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:12,border:"none",background:"transparent",cursor:"pointer",textAlign:"left",transition:"background .2s"}}
              onMouseEnter={e=>(e.currentTarget.style.background=T.card)}
              onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
              <Avatar init={c.init} size={46} T={T}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{color:T.text,fontWeight:700,fontSize:14}}>{c.name}</span>
                  <span style={{color:T.muted,fontSize:11}}>{c.time}</span>
                </div>
                <p style={{color:T.textD,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.last}</p>
              </div>
              {c.unread>0&&<div style={{width:20,height:20,borderRadius:"50%",background:T.blueB,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",flexShrink:0}}>{c.unread}</div>}
            </button>
          ))}
        </div>
        <button style={{width:"100%",marginTop:8,padding:"14px",borderRadius:12,border:`1.5px dashed ${T.b1}`,background:"transparent",color:T.textD,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <Ic n="plus" s={16} c={T.textD}/>{msgTab==="groupes"?"Nouveau groupe":"Nouveau message"}
        </button>
      </div>
    </div>
  );
}

// ── SIMULATION HUB ────────────────────────────────────────────
// ── API KEY SETUP MODAL ───────────────────────────────────────
function ApiKeySetupModal({T,onDone}:{T:Theme;onDone:()=>void}) {
  const [ck,setCk] = useState(typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"");
  const [ek,setEk] = useState(typeof window!=="undefined"?localStorage.getItem("el_key")||"":"");
  const save=(k:string,v:string)=>{if(typeof window!=="undefined")localStorage.setItem(k,v);};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:999,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn .2s"}}>
      <div style={{background:T.surf,borderRadius:"20px 20px 0 0",width:"100%",maxWidth:430,padding:"20px 20px 36px",display:"flex",flexDirection:"column",gap:16,animation:"slideUp .3s ease",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{width:40,height:4,borderRadius:2,background:T.b2,margin:"0 auto 4px"}}/>
        <div>
          <h2 style={{color:T.text,fontWeight:800,fontSize:20}}>Configurer la clé API</h2>
          <p style={{color:T.textD,fontSize:13,marginTop:4}}>Une seule clé suffit — voix et IA incluses</p>
        </div>
        {/* Gemini */}
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <div style={{width:28,height:28,borderRadius:7,background:"#E8854020",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:14}}>🤖</span></div>
            <div>
              <p style={{color:T.text,fontSize:13,fontWeight:800}}>Clé Gemini (Google) — GRATUIT</p>
              <p style={{color:T.muted,fontSize:10}}>aistudio.google.com → Get API key</p>
            </div>
            {ck&&<div style={{marginLeft:"auto",width:8,height:8,borderRadius:"50%",background:T.green}}/>}
          </div>
          <input type="password" value={ck} onChange={e=>{setCk(e.target.value);save("gemini_key",e.target.value);}} placeholder="AIza…" style={{width:"100%",background:T.bg2,border:`1px solid ${ck?T.green:T.b1}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box",transition:"border .2s"}}/>
        </div>
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <div style={{width:28,height:28,borderRadius:7,background:"#7C3AED20",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:14}}>🎙️</span></div>
            <div style={{flex:1}}>
              <p style={{color:T.text,fontSize:13,fontWeight:800}}>Clé ElevenLabs <span style={{color:T.muted,fontSize:10,fontWeight:400}}>(optionnel — voix premium)</span></p>
              <p style={{color:T.muted,fontSize:10}}>elevenlabs.io → Profile → API Keys · 10 000 chars/mois gratuit</p>
            </div>
            {ek&&<div style={{width:8,height:8,borderRadius:"50%",background:T.green,flexShrink:0}}/>}
          </div>
          <input type="password" value={ek} onChange={e=>{setEk(e.target.value);save("el_key",e.target.value);}} placeholder="sk_…" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
          <p style={{color:T.muted,fontSize:10,marginTop:6}}>Sans clé : voix navigateur (Google/Microsoft/Apple). Avec clé : voix naturelles ElevenLabs.</p>
        </div>
        <button onClick={()=>{if(ck)onDone();}} disabled={!ck} style={{padding:15,borderRadius:14,border:"none",background:ck?T.blueB:T.b1,color:ck?"#fff":T.muted,fontSize:15,fontWeight:800,cursor:ck?"pointer":"not-allowed",fontFamily:"inherit",transition:"background .2s"}}>
          {ck?"Démarrer la simulation →":"Entrez votre clé Gemini pour continuer"}
        </button>
        <p style={{color:T.muted,fontSize:11,textAlign:"center",lineHeight:1.5}}>Vos clés restent sur votre téléphone uniquement — elles ne sont jamais envoyées à NEXUS.</p>
      </div>
    </div>
  );
}

function AdminPinModal({T,onClose,onSuccess}:{T:Theme;onClose:()=>void;onSuccess:()=>void}) {
  const [pin,setPin] = useState("");
  const [err,setErr] = useState(false);
  const ADMIN_PIN = process.env.NEXT_PUBLIC_ADMIN_PIN||"";
  const check=()=>{
    if(ADMIN_PIN && pin===ADMIN_PIN){onSuccess();}
    else{setErr(true);setPin("");setTimeout(()=>setErr(false),1200);}
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.surf,border:`1px solid ${T.b1}`,borderRadius:20,padding:24,width:"100%",maxWidth:320}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Accès propriétaire</p>
        <p style={{color:T.muted,fontSize:12,marginBottom:20}}>Code secret pour accéder aux paramètres</p>
        <input type="password" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&check()} placeholder="••••••" autoFocus
          style={{width:"100%",background:T.bg2,border:`1px solid ${err?T.red:T.b1}`,borderRadius:10,padding:"12px",color:T.text,fontSize:20,textAlign:"center",letterSpacing:6,outline:"none",boxSizing:"border-box",fontFamily:"monospace",transition:"border .2s"}}/>
        {err&&<p style={{color:T.red,fontSize:12,textAlign:"center",marginTop:8}}>Code incorrect</p>}
        <div style={{display:"flex",gap:10,marginTop:14}}>
          <button onClick={onClose} style={{flex:1,padding:"12px",borderRadius:10,border:`1px solid ${T.b1}`,background:"transparent",color:T.textD,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Annuler</button>
          <button onClick={check} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:T.blueB,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Entrer</button>
        </div>
      </div>
    </div>
  );
}

// ── GAMIFICATION HELPERS ─────────────────────────────────────
function updateStreak(){
  if(typeof window==="undefined")return 0;
  const today=new Date().toDateString();
  const last=localStorage.getItem("nx_last_day");
  let count=parseInt(localStorage.getItem("nx_streak")||"0");
  if(!last){count=1;}
  else if(last===today){return count;}
  else{const diff=Math.round((new Date(today).getTime()-new Date(last).getTime())/86400000);count=diff===1?count+1:1;}
  localStorage.setItem("nx_streak",String(count));
  localStorage.setItem("nx_last_day",today);
  return count;
}
function getStreak(){if(typeof window==="undefined")return 0;return parseInt(localStorage.getItem("nx_streak")||"0");}
function addXP(n:number){if(typeof window==="undefined")return;localStorage.setItem("nx_xp",String(parseInt(localStorage.getItem("nx_xp")||"0")+n));}
function getXP(){if(typeof window==="undefined")return 0;return parseInt(localStorage.getItem("nx_xp")||"0");}
function levelInfo(xp:number){
  const tiers=[{l:1,t:"Apprenti",max:150},{l:2,t:"Orateur",max:400},{l:3,t:"Débatteur",max:800},{l:4,t:"Diplomate",max:1400},{l:5,t:"Expert",max:2200},{l:6,t:"Maître",max:99999}];
  return tiers.find((_,i)=>xp<tiers[i].max)||tiers[tiers.length-1];
}

// ── APPRENDRE — DATA ─────────────────────────────────────────
const DISCOURS_DATA=[
  {id:1,title:"Appel du 18 juin",speaker:"Charles de Gaulle",year:"1940",country:"🇫🇷",theme:"Résistance",excerpt:"Quoi qu'il arrive, la flamme de la résistance française ne doit pas s'éteindre et ne s'éteindra pas.",techniques:["Pathos","Urgence","Autorité morale"]},
  {id:2,title:"I Have a Dream",speaker:"Martin Luther King",year:"1963",country:"🇺🇸",theme:"Droits civiques",excerpt:"J'ai le rêve qu'un jour cette nation se lèvera et vivra selon la vraie signification de ses croyances.",techniques:["Anaphore","Métaphore","Vision"]},
  {id:3,title:"Discours de libération",speaker:"Nelson Mandela",year:"1990",country:"🇿🇦",theme:"Liberté",excerpt:"Je me tiens devant vous non pas comme prophète, mais comme serviteur humble de vous tous.",techniques:["Humilité","Éthos","Rassemblement"]},
  {id:4,title:"Yes We Can",speaker:"Barack Obama",year:"2008",country:"🇺🇸",theme:"Politique",excerpt:"C'est la réponse de l'Amérique à ceux qui ont dit que nous ne pouvions pas.",techniques:["Anaphore","Espoir","Logos"]},
  {id:5,title:"Le Rideau de fer",speaker:"Winston Churchill",year:"1946",country:"🇬🇧",theme:"Géopolitique",excerpt:"Un rideau de fer est descendu à travers le Continent européen.",techniques:["Métaphore marquante","Gravitas","Avertissement"]},
];
const RHETORIC_DATA=[
  {id:1,icon:"🏛️",title:"Éthos, Pathos, Logos",desc:"La triade d'Aristote",content:"ÉTHOS — Crédibilité\nVotre audience doit vous faire confiance avant de vous écouter. Soignez votre posture, vos références, votre légitimité.\n\nPATHOS — Émotion\nTouchez le cœur avant de convaincre l'esprit. Une histoire personnelle vaut mille statistiques.\n\nLOGOS — Logique\nDes faits, des chiffres, des preuves concrètes. Sans logos, le discours est creux."},
  {id:2,icon:"✍️",title:"Figures de style",desc:"Les outils du discours fort",content:"ANAPHORE — Répétition en début de phrase\n→ «Je refuse. Je refuse. Je refuse.»\n\nMÉTAPHORE — Image percutante\n→ «Le chômage est une cicatrice sociale»\n\nCHIASME — Inversion élégante\n→ «Il ne faut pas vivre pour manger, mais manger pour vivre»\n\nHYPERBOLE — Amplification\n→ «C'est le scandale du siècle»"},
  {id:3,icon:"📐",title:"Structure en 5 actes",desc:"Le plan du discours parfait",content:"1. ACCROCHE — Captez l'attention dès la première phrase. Question choc, chiffre, anecdote.\n\n2. PROBLÈME — Exposez clairement le problème. L'audience doit ressentir l'urgence.\n\n3. DÉVELOPPEMENT — 3 arguments maximum. Un par un, avec preuve + exemple.\n\n4. RÉFUTATION — Anticipez les objections et répondez avant qu'elles soient posées.\n\n5. APPEL — Terminez par un appel à l'action clair et mémorable."},
  {id:4,icon:"🎯",title:"Persuasion & Influence",desc:"Convaincre sans manipuler",content:"PREUVE SOCIALE — «80% des experts s'accordent à dire...»\n\nAUTORITÉ — «Selon l'ONU, l'OCDE, le rapport X...»\n\nRÉCIPROCITÉ — Concéder un point pour mieux avancer le vôtre.\n\nCOHÉRENCE — Reliez vos arguments aux valeurs de votre audience.\n\nRARETÉ — «C'est peut-être notre dernière chance de...»"},
];
const DICT_DATA=[
  {term:"Veto",def:"Droit des 5 membres permanents du Conseil de sécurité ONU (USA, Russie, Chine, France, UK) de bloquer toute résolution."},
  {term:"Soft Power",def:"Influence d'un État par la culture, les valeurs et la diplomatie plutôt que par la force. Concept de Joseph Nye (1990)."},
  {term:"Souveraineté",def:"Autorité suprême et exclusive d'un État sur son territoire. Principe fondamental depuis le Traité de Westphalie (1648)."},
  {term:"Multilatéralisme",def:"Approche impliquant plusieurs États dans la résolution de problèmes communs. Opposé au bilatéralisme ou à l'unilatéralisme."},
  {term:"Résolution Ch. VII",def:"Décision du Conseil de sécurité autorisant le recours à la force militaire. Contraignante pour tous les membres de l'ONU."},
  {term:"DIH",def:"Droit International Humanitaire. Ensemble de règles limitant les effets des conflits armés. Conventions de Genève (1949)."},
  {term:"Non-alignement",def:"Politique étrangère refusant l'alignement sur les grandes puissances. Mouvement fondé en 1961 à Belgrade."},
  {term:"Realpolitik",def:"Approche pragmatique de la politique étrangère basée sur les intérêts nationaux, indépendamment des idéaux moraux."},
  {term:"Sanctions",def:"Mesures de pression économiques (gel d'avoirs, embargo) utilisées comme alternative ou complément à l'action militaire."},
  {term:"G7 / G20",def:"G7 : 7 pays industrialisés. G20 : 20 économies majeures représentant 85% du PIB mondial. Forums de coordination économique."},
];
const FICHES_DATA=[
  {id:1,title:"Organisation des Nations Unies",icon:"🌐",color:"#2B78F5",items:["193 États membres, fondée en 1945","Conseil de sécurité : 5 permanents (veto) + 10 rotatifs","Assemblée générale : 1 État = 1 voix","Secrétaire général : António Guterres","CIJ (Cour internationale de Justice) siège à La Haye"]},
  {id:2,title:"Union Européenne",icon:"🇪🇺",color:"#E03535",items:["27 États membres (Brexit en 2020)","Parlement européen : élu au suffrage universel direct","Commission : pouvoir exécutif, 27 commissaires","BCE (Francfort) : politique monétaire zone euro","Traité de Lisbonne (2009) : cadre institutionnel actuel"]},
  {id:3,title:"OTAN",icon:"🛡️",color:"#7C3AED",items:["32 membres (Suède intégrée en 2024)","Article 5 : clause de défense collective","Siège à Bruxelles","Secrétaire général : Mark Rutte (depuis oct. 2024)","Objectif : 2% du PIB par membre"]},
  {id:4,title:"Géopolitique 2025",icon:"🗺️",color:"#D97706",items:["Guerre Ukraine-Russie (depuis fév. 2022)","Tensions Taïwan : Chine vs USA","Conflit Gaza — instabilité Proche-Orient","Sahel : recomposition des influences (Russie/Wagner)","Indo-Pacifique : nouveau centre stratégique mondial"]},
  {id:5,title:"Institutions françaises",icon:"🏛️",color:"#16A34A",items:["Ve République : Constitution du 4 oct. 1958","Président : élu au suffrage universel, mandat 5 ans","Premier ministre : nommé par le président","Parlement : Assemblée nationale + Sénat","Conseil constitutionnel : contrôle la constitutionnalité"]},
];

// ── APPRENDRE SCREEN ──────────────────────────────────────────
function ApprendreScreen({T,onBack}:{T:Theme;onBack:()=>void}){
  const [sub,setSub]=useState<"menu"|"discours"|"rhetori"|"dict"|"fiches">("menu");
  const [selSpeech,setSelSpeech]=useState<typeof DISCOURS_DATA[0]|null>(null);
  const [selLesson,setSelLesson]=useState<typeof RHETORIC_DATA[0]|null>(null);
  const [dictQ,setDictQ]=useState("");
  const [selFiche,setSelFiche]=useState<typeof FICHES_DATA[0]|null>(null);

  if(sub==="discours")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>{if(selSpeech)setSelSpeech(null);else setSub("menu");}} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>{selSpeech?selSpeech.title:"Bibliothèque de discours"}</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        {!selSpeech?(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {DISCOURS_DATA.map(d=>(
              <button key={d.id} onClick={()=>setSelSpeech(d)} style={{padding:16,borderRadius:14,border:`1px solid ${T.b1}`,background:T.card,cursor:"pointer",textAlign:"left",display:"flex",gap:14,alignItems:"flex-start"}}>
                <span style={{fontSize:28}}>{d.country}</span>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <p style={{color:T.text,fontWeight:800,fontSize:15}}>{d.title}</p>
                    <span style={{color:T.muted,fontSize:11}}>{d.year}</span>
                  </div>
                  <p style={{color:T.textD,fontSize:12,marginTop:2}}>{d.speaker} · {d.theme}</p>
                  <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                    {d.techniques.map(t=><span key={t} style={{background:`${T.blueB}20`,color:T.blueB,fontSize:10,padding:"2px 8px",borderRadius:10,fontWeight:700}}>{t}</span>)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16}}>
              <p style={{color:T.muted,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>{selSpeech.speaker} · {selSpeech.year}</p>
              <p style={{color:T.text,fontSize:15,fontStyle:"italic",lineHeight:1.7,marginTop:8}}>&ldquo;{selSpeech.excerpt}&rdquo;</p>
            </div>
            <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16}}>
              <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,marginBottom:10}}>TECHNIQUES UTILISÉES</p>
              {selSpeech.techniques.map(t=>(
                <div key={t} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.b1}`}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:T.blueB,flexShrink:0}}/>
                  <p style={{color:T.text,fontSize:13,fontWeight:600}}>{t}</p>
                </div>
              ))}
            </div>
            <div style={{background:`${T.blueB}10`,border:`1px solid ${T.blueB}30`,borderRadius:14,padding:16}}>
              <p style={{color:T.blueB,fontSize:12,fontWeight:800,marginBottom:6}}>POURQUOI CE DISCOURS EST MARQUANT</p>
              <p style={{color:T.textD,fontSize:13,lineHeight:1.6}}>Thème : <strong style={{color:T.text}}>{selSpeech.theme}</strong>. Ce discours incarne les 3 piliers : crédibilité de l&apos;orateur (éthos), émotion transmise (pathos) et logique des arguments (logos).</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if(sub==="rhetori")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>{if(selLesson)setSelLesson(null);else setSub("menu");}} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>{selLesson?selLesson.title:"Cours de rhétorique"}</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        {!selLesson?(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {RHETORIC_DATA.map(r=>(
              <button key={r.id} onClick={()=>setSelLesson(r)} style={{padding:16,borderRadius:14,border:`1px solid ${T.b1}`,background:T.card,cursor:"pointer",textAlign:"left",display:"flex",gap:14,alignItems:"center"}}>
                <span style={{fontSize:32,flexShrink:0}}>{r.icon}</span>
                <div style={{flex:1}}>
                  <p style={{color:T.text,fontWeight:800,fontSize:15}}>{r.title}</p>
                  <p style={{color:T.textD,fontSize:12,marginTop:2}}>{r.desc}</p>
                </div>
                <Ic n="chevR" s={18} c={T.muted}/>
              </button>
            ))}
          </div>
        ):(
          <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:20}}>
            {selLesson.content.split('\n').map((line,i)=>{
              if(!line)return <div key={i} style={{height:10}}/>;
              if(/^[A-ZÀÉÈÊËÎÏÔÙÛ].*—/.test(line))return <p key={i} style={{color:T.blueB,fontWeight:800,fontSize:14,marginTop:12}}>{line}</p>;
              if(line.startsWith('→'))return <p key={i} style={{color:T.textD,fontSize:13,fontStyle:"italic",marginLeft:12,marginTop:4}}>{line}</p>;
              if(/^\d\./.test(line))return <p key={i} style={{color:T.text,fontSize:13,lineHeight:1.6,marginTop:8}}>{line}</p>;
              return <p key={i} style={{color:T.text,fontSize:13,lineHeight:1.6}}>{line}</p>;
            })}
          </div>
        )}
      </div>
    </div>
  );

  if(sub==="dict")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>setSub("menu")} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Dictionnaire diplomatique</h2>
      </div>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <input value={dictQ} onChange={e=>setDictQ(e.target.value)} placeholder="Rechercher un terme…" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:10,padding:"10px 14px",color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 20px",display:"flex",flexDirection:"column",gap:10}}>
        {DICT_DATA.filter(d=>!dictQ||d.term.toLowerCase().includes(dictQ.toLowerCase())||d.def.toLowerCase().includes(dictQ.toLowerCase())).map(d=>(
          <div key={d.term} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
            <p style={{color:T.blueB,fontWeight:800,fontSize:14}}>{d.term}</p>
            <p style={{color:T.textD,fontSize:13,marginTop:6,lineHeight:1.5}}>{d.def}</p>
          </div>
        ))}
      </div>
    </div>
  );

  if(sub==="fiches")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>{if(selFiche)setSelFiche(null);else setSub("menu");}} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>{selFiche?selFiche.title:"Fiches de révision"}</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        {!selFiche?(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {FICHES_DATA.map(f=>(
              <button key={f.id} onClick={()=>setSelFiche(f)} style={{padding:16,borderRadius:14,border:`1.5px solid ${f.color}30`,background:`${f.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14}}>
                <span style={{fontSize:30,flexShrink:0}}>{f.icon}</span>
                <div style={{flex:1}}>
                  <p style={{color:T.text,fontWeight:800,fontSize:15}}>{f.title}</p>
                  <p style={{color:T.textD,fontSize:12,marginTop:2}}>{f.items.length} points clés</p>
                </div>
                <Ic n="chevR" s={18} c={T.muted}/>
              </button>
            ))}
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {selFiche.items.map((item,i)=>(
              <div key={i} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14,display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{width:24,height:24,borderRadius:"50%",background:`${selFiche.color}20`,border:`1px solid ${selFiche.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:11,fontWeight:800,color:selFiche.color}}>{i+1}</div>
                <p style={{color:T.text,fontSize:13,lineHeight:1.5,flex:1}}>{item}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <div><h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Apprendre</h2><p style={{color:T.muted,fontSize:11}}>Rhétorique · Diplomatie · Géopolitique</p></div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
        {([{id:"discours",icon:"📜",label:"Discours",desc:"Grands discours historiques analysés",color:"#2B78F5"},{id:"rhetori",icon:"🏛️",label:"Rhétorique",desc:"Techniques d'argumentation",color:"#7C3AED"},{id:"dict",icon:"📖",label:"Dictionnaire",desc:"Termes diplomatiques expliqués",color:"#16A34A"},{id:"fiches",icon:"📋",label:"Fiches de révision",desc:"ONU · UE · OTAN · Géopolitique",color:"#D97706"}] as const).map(s=>(
          <button key={s.id} onClick={()=>setSub(s.id)} style={{padding:18,borderRadius:16,border:`1.5px solid ${s.color}30`,background:`${s.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16,transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${s.color}15`} onMouseLeave={e=>e.currentTarget.style.background=`${s.color}08`}>
            <div style={{width:52,height:52,borderRadius:14,background:`${s.color}20`,border:`1px solid ${s.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}>{s.icon}</div>
            <div style={{flex:1}}><p style={{color:T.text,fontWeight:800,fontSize:16}}>{s.label}</p><p style={{color:T.textD,fontSize:12,marginTop:3}}>{s.desc}</p></div>
            <Ic n="chevR" s={18} c={T.muted}/>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── CARRIÈRE & CONCOURS SCREEN ────────────────────────────────
function CarriereScreen({T,onBack}:{T:Theme;onBack:()=>void}){
  const [sub,setSub]=useState<"menu"|"generateur"|"builder"|"concours"|"lettre">("menu");
  const [genSubject,setGenSubject]=useState("");
  const [genResult,setGenResult]=useState("");
  const [genLoading,setGenLoading]=useState(false);
  const [buildPos,setBuildPos]=useState("");
  const [buildResult,setBuildResult]=useState("");
  const [buildLoading,setBuildLoading]=useState(false);
  const [lettrePoste,setLettrePoste]=useState("");
  const [lettreExp,setLettreExp]=useState("");
  const [lettreResult,setLettreResult]=useState("");
  const [lettreLoading,setLettreLoading]=useState(false);
  const getKey=()=>typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";

  const genDiscours=async()=>{
    const key=getKey();if(!key){setGenResult("⚠️ Clé Gemini requise dans les paramètres.");return;}
    setGenLoading(true);setGenResult("");
    try{const r=await callGemini(`Tu es un expert en rhétorique. Génère un discours de 3 minutes (400 mots) sur : "${genSubject}". Structure : accroche percutante, problème, 3 arguments avec exemples concrets, conclusion mémorable. Utilise des figures de style (anaphore, métaphore).`,[{role:"user",parts:[{text:genSubject}]}],key,600);setGenResult(r);addXP(20);}
    catch{setGenResult("Erreur. Réessaie.");}
    setGenLoading(false);
  };

  const buildArgs=async()=>{
    const key=getKey();if(!key){setBuildResult("⚠️ Clé Gemini requise.");return;}
    setBuildLoading(true);setBuildResult("");
    try{const r=await callGemini(`Expert en argumentation. Pour la position : "${buildPos}", génère : 3 arguments POUR avec exemple et chiffre, 3 arguments CONTRE avec exemple et chiffre, 3 réfutations. Format clair et structuré.`,[{role:"user",parts:[{text:buildPos}]}],key,500);setBuildResult(r);addXP(15);}
    catch{setBuildResult("Erreur. Réessaie.");}
    setBuildLoading(false);
  };

  const genLettre=async()=>{
    const key=getKey();if(!key){setLettreResult("⚠️ Clé Gemini requise.");return;}
    setLettreLoading(true);setLettreResult("");
    try{const r=await callGemini(`Expert recruteur. Génère une lettre de motivation professionnelle et percutante. Poste : "${lettrePoste}". Expériences : "${lettreExp||"non précisées"}". 3 paragraphes, directe, valorise les compétences, finit par une demande d'entretien.`,[{role:"user",parts:[{text:`${lettrePoste} — ${lettreExp}`}]}],key,400);setLettreResult(r);addXP(15);}
    catch{setLettreResult("Erreur. Réessaie.");}
    setLettreLoading(false);
  };

  if(sub==="generateur")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>{setSub("menu");setGenResult("");setGenSubject("");}} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Générateur de discours</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px",display:"flex",flexDirection:"column",gap:12}}>
        <p style={{color:T.textD,fontSize:13}}>Entre un sujet — l&apos;IA génère un discours structuré prêt à prononcer.</p>
        <input value={genSubject} onChange={e=>setGenSubject(e.target.value)} onKeyDown={e=>e.key==="Enter"&&genDiscours()} placeholder="Ex: L'IA va-t-elle détruire l'emploi ?" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:10,padding:"12px",color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
        <button onClick={genDiscours} disabled={genLoading||!genSubject.trim()} style={{padding:"13px",borderRadius:12,border:"none",background:genSubject.trim()?T.blueB:T.b1,color:genSubject.trim()?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:genSubject.trim()?"pointer":"default",fontFamily:"inherit"}}>{genLoading?"Génération…":"Générer le discours · +20 XP"}</button>
        {genResult&&<div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16}}><p style={{color:T.text,fontSize:13,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{genResult}</p></div>}
      </div>
    </div>
  );

  if(sub==="builder")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>{setSub("menu");setBuildResult("");setBuildPos("");}} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Builder d&apos;arguments</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px",display:"flex",flexDirection:"column",gap:12}}>
        <p style={{color:T.textD,fontSize:13}}>Entre une position — l&apos;IA structure tes arguments pour et contre.</p>
        <input value={buildPos} onChange={e=>setBuildPos(e.target.value)} onKeyDown={e=>e.key==="Enter"&&buildArgs()} placeholder="Ex: La peine de mort doit être rétablie" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:10,padding:"12px",color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
        <button onClick={buildArgs} disabled={buildLoading||!buildPos.trim()} style={{padding:"13px",borderRadius:12,border:"none",background:buildPos.trim()?T.purple:T.b1,color:buildPos.trim()?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:buildPos.trim()?"pointer":"default",fontFamily:"inherit"}}>{buildLoading?"Analyse…":"Structurer les arguments · +15 XP"}</button>
        {buildResult&&<div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16}}><p style={{color:T.text,fontSize:13,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{buildResult}</p></div>}
      </div>
    </div>
  );

  if(sub==="lettre")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>{setSub("menu");setLettreResult("");}} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Lettre de motivation</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px",display:"flex",flexDirection:"column",gap:12}}>
        <input value={lettrePoste} onChange={e=>setLettrePoste(e.target.value)} placeholder="Poste visé (ex: Chargé de mission politique)" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:10,padding:"12px",color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
        <textarea value={lettreExp} onChange={e=>setLettreExp(e.target.value)} placeholder="Tes expériences clés (optionnel)" rows={3} style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:10,padding:"12px",color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",resize:"none"}}/>
        <button onClick={genLettre} disabled={lettreLoading||!lettrePoste.trim()} style={{padding:"13px",borderRadius:12,border:"none",background:lettrePoste.trim()?T.green:T.b1,color:lettrePoste.trim()?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:lettrePoste.trim()?"pointer":"default",fontFamily:"inherit"}}>{lettreLoading?"Rédaction…":"Générer la lettre · +15 XP"}</button>
        {lettreResult&&<div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16}}><p style={{color:T.text,fontSize:13,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{lettreResult}</p></div>}
      </div>
    </div>
  );

  if(sub==="concours")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={()=>setSub("menu")} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Préparation concours</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
        <p style={{color:T.textD,fontSize:13,marginBottom:4}}>Simulations d&apos;entretien dédiées à chaque concours — bientôt disponibles.</p>
        {([{name:"Sciences Po",desc:"Entretien de personnalité + culture générale",color:"#2B78F5"},{name:"ENS / Grandes Écoles",desc:"Oral de culture générale, dissertation",color:"#7C3AED"},{name:"Fonction publique",desc:"Entretien devant jury, note de synthèse",color:"#16A34A"},{name:"Barreau / CRFPA",desc:"Plaidoirie, procédure pénale et civile",color:"#E03535"}]).map(c=>(
          <div key={c.name} style={{padding:16,borderRadius:14,border:`1.5px solid ${c.color}30`,background:`${c.color}08`,display:"flex",alignItems:"center",gap:14}}>
            <div style={{flex:1}}><p style={{color:T.text,fontWeight:800,fontSize:15}}>{c.name}</p><p style={{color:T.textD,fontSize:12,marginTop:2}}>{c.desc}</p></div>
            <span style={{background:`${c.color}20`,color:c.color,fontSize:10,padding:"3px 8px",borderRadius:8,fontWeight:700}}>Bientôt</span>
          </div>
        ))}
      </div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <div><h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Carrière & Concours</h2><p style={{color:T.muted,fontSize:11}}>Outils IA pour ta progression</p></div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
        {([{id:"generateur",icon:"✍️",label:"Générateur de discours",desc:"Discours IA structuré sur n'importe quel sujet",color:"#2B78F5"},{id:"builder",icon:"🧱",label:"Builder d'arguments",desc:"Structure tes pour/contre instantanément",color:"#7C3AED"},{id:"concours",icon:"🎓",label:"Prépa concours",desc:"Sciences Po, ENS, Barreau, Fonction publique",color:"#D97706"},{id:"lettre",icon:"📝",label:"Lettre de motivation",desc:"Génère une lettre pro en 30 secondes",color:"#16A34A"}] as const).map(s=>(
          <button key={s.id} onClick={()=>setSub(s.id)} style={{padding:18,borderRadius:16,border:`1.5px solid ${s.color}30`,background:`${s.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16,transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${s.color}15`} onMouseLeave={e=>e.currentTarget.style.background=`${s.color}08`}>
            <div style={{width:52,height:52,borderRadius:14,background:`${s.color}20`,border:`1px solid ${s.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}>{s.icon}</div>
            <div style={{flex:1}}><p style={{color:T.text,fontWeight:800,fontSize:16}}>{s.label}</p><p style={{color:T.textD,fontSize:12,marginTop:3}}>{s.desc}</p></div>
            <Ic n="chevR" s={18} c={T.muted}/>
          </button>
        ))}
      </div>
    </div>
  );
}

function SimulationHub({T}:{T:Theme}) {
  const [view,setView] = useState<"hub"|"studio"|"sims"|"apprendre"|"carriere">("hub");
  const [showKeySetup,setShowKeySetup] = useState(false);
  const [pendingView,setPendingView] = useState<"studio"|"sims"|null>(null);

  const launch=(id:"studio"|"sims")=>{
    haptic();
    const key = typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
    if(!key){setPendingView(id);setShowKeySetup(true);return;}
    setView(id);
  };

  if(view==="studio") return <StudioScreen T={T}/>;
  if(view==="sims") return <SimulationScreen T={T}/>;
  if(view==="apprendre") return <ApprendreScreen T={T} onBack={()=>setView("hub")}/>;
  if(view==="carriere") return <CarriereScreen T={T} onBack={()=>setView("hub")}/>;

  return(
    <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:20,overflowY:"auto",height:"100%",boxSizing:"border-box"}}>
      {showKeySetup&&<ApiKeySetupModal T={T} onDone={()=>{setShowKeySetup(false);if(pendingView)setView(pendingView);setPendingView(null);}}/>}
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>NEXUS</p>
        <h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Simulation</h1>
        <p style={{color:T.textD,fontSize:13,marginTop:4}}>Entraîne-toi à l&apos;oral dans des situations réelles</p>
      </div>

      {/* APPRENDRE & CARRIÈRE — en haut */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase"}}>RESSOURCES</p>
        {([{id:"apprendre",icon:"📚",label:"Apprendre",desc:"Discours · Rhétorique · Fiches · Dictionnaire",color:"#2B78F5"},{id:"carriere",icon:"💼",label:"Carrière & Concours",desc:"Générateur de discours · Arguments · Lettre",color:"#16A34A"}] as const).map(c=>(
          <button key={c.id} onClick={()=>{haptic();setView(c.id);}} style={{padding:18,borderRadius:16,border:`1.5px solid ${c.color}30`,background:`${c.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16,transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${c.color}15`} onMouseLeave={e=>e.currentTarget.style.background=`${c.color}08`}>
            <div style={{width:52,height:52,borderRadius:14,background:`${c.color}20`,border:`1px solid ${c.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}>{c.icon}</div>
            <div style={{flex:1}}><p style={{color:T.text,fontWeight:800,fontSize:16}}>{c.label}</p><p style={{color:T.textD,fontSize:12,marginTop:3}}>{c.desc}</p></div>
            <Ic n="chevR" s={18} c={T.muted}/>
          </button>
        ))}
      </div>

      {/* DÉBAT & SIMULATIONS — en bas */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase"}}>ENTRAÎNEMENT</p>
        {([{id:"studio",icon:"mic",label:"Studio Débat",desc:"Débat audio face à un journaliste IA",color:"#7C3AED"},{id:"sims",icon:"globe",label:"Simulations",desc:"ONU, Procès, Soutenance, Commercial…",color:"#E03535"}] as const).map(c=>(
          <button key={c.id} onClick={()=>launch(c.id)} style={{padding:20,borderRadius:16,border:`1.5px solid ${c.color}30`,background:`${c.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16,transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${c.color}15`} onMouseLeave={e=>e.currentTarget.style.background=`${c.color}08`}>
            <div style={{width:52,height:52,borderRadius:14,background:`${c.color}20`,border:`1px solid ${c.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <Ic n={c.icon} s={26} c={c.color}/>
            </div>
            <div style={{flex:1}}><p style={{color:T.text,fontWeight:800,fontSize:16}}>{c.label}</p><p style={{color:T.textD,fontSize:12,marginTop:3}}>{c.desc}</p></div>
            <Ic n="chevR" s={18} c={T.muted}/>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── API KEY SETTINGS ──────────────────────────────────────────
function ApiKeySettings({T}:{T:Theme}) {
  const [ck,setCk] = useState(typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"");
  const [ek,setEk] = useState(typeof window!=="undefined"?localStorage.getItem("el_key")||"":"");
  const save = (key:string,val:string)=>{ if(typeof window!=="undefined") localStorage.setItem(key,val); };
  return(
    <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Clé Gemini AI (GRATUIT)</p>
        <input type="password" value={ck} onChange={e=>{setCk(e.target.value);save("gemini_key",e.target.value);}} placeholder="AIza…" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>aistudio.google.com → Get API key · Nécessaire pour les simulations IA</p>
      </div>
      <div style={{background:T.card,border:`1px solid ${ek?T.purple:T.b1}`,borderRadius:12,padding:14,transition:"border .2s"}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>🎙️ Clé ElevenLabs <span style={{color:T.muted,fontWeight:400,textTransform:"none",letterSpacing:0}}>(optionnel — voix naturelles)</span></p>
        <input type="password" value={ek} onChange={e=>{setEk(e.target.value);save("el_key",e.target.value);}} placeholder="sk_…" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>elevenlabs.io → Profile → API Keys · 10 000 chars/mois gratuit · Sans clé : voix navigateur</p>
      </div>
    </div>
  );
}

// ── GENERIC SIMULATION SCREEN ─────────────────────────────────
function GenericSimScreen({title,emoji,color,systemPrompt,welcome,voiceGender,T,onBack}:{title:string;emoji:string;color:string;systemPrompt:string;welcome:string;voiceGender:"M"|"F";T:Theme;onBack:()=>void}) {
  const [msgs,setMsgs] = useState<{role:"user"|"ai";text:string}[]>([]);
  const [input,setInput] = useState("");
  const [loading,setLoading] = useState(false);
  const [audioOn,setAudioOn] = useState(true);
  const [listening,setListening] = useState(false);
  const [autoMic,setAutoMic] = useState(false);
  const [exchangeN,setExchangeN] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSpeechRef = useRef<(t:string)=>void>((_t:string)=>{});

  useEffect(()=>{
    mountedRef.current=true;
    return()=>{mountedRef.current=false;recRef.current?.stop();stopSpeech();};
  },[]);

  // speakTimed: plays speech + safety timer so auto-mic always fires (fixes Android Chrome onend bug)
  function speakTimed(text:string, gender:"M"|"F", onDone:()=>void, delayMs=0) {
    const estMs = Math.max(2500, text.split(/\s+/).length * 400 + 800);
    setTimeout(()=>{
      if(!mountedRef.current) return;
      let fired = false;
      const done = ()=>{ if(fired||!mountedRef.current) return; fired=true; onDone(); };
      speakAny(text, gender, done);
      setTimeout(done, estMs);
    }, delayMs);
  }

  // Auto-open mic after AI finishes speaking
  useEffect(()=>{
    if(!autoMic) return;
    setAutoMic(false);
    if(typeof window==="undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR) return;
    const rec=new SR();
    rec.lang="fr-FR"; rec.continuous=false; rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{handleSpeechRef.current(e.results[0][0].transcript);setListening(false);};
    rec.onend=()=>setListening(false);
    try{rec.start();}catch{return;}
    recRef.current=rec;
    setListening(true);
  },[autoMic]);// eslint-disable-line

  useEffect(()=>{
    const w = {role:"ai" as const, text:welcome};
    setMsgs([w]);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),200);
    if(audioOn) speakTimed(welcome,voiceGender,()=>{if(mountedRef.current)setAutoMic(true);},400);
  },[]);// eslint-disable-line

  const send = async(text:string)=>{
    if(!text.trim()||loading)return;
    unlockAudio();
    setInput("");
    const userMsg={role:"user" as const,text};
    const newMsgs=[...msgs,userMsg];
    setMsgs(newMsgs);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
    setLoading(true);
    try{
      const rawHist=newMsgs.map(m=>({role:(m.role==="user"?"user":"model") as "user"|"model",parts:[{text:m.text}]}));
      const firstUserIdx=rawHist.findIndex(m=>m.role==="user");
      const hist=firstUserIdx>=0?rawHist.slice(firstUserIdx):rawHist;
      const key=typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
      if(!key) throw new Error("no_key");
      const n=exchangeN+1; setExchangeN(n);
      const dynSys=`${systemPrompt}

═══ TOUR N°${n} — INSTRUCTION IMPÉRATIVE ═══
L'interlocuteur vient de dire exactement : "${text}"

RÈGLES ABSOLUES pour cette réponse :
1. Cite MOT POUR MOT une partie de ce qu'il a dit (entre guillemets)
2. Réponds DIRECTEMENT à cet argument — aucune réponse générique
3. Apporte un ANGLE NOUVEAU pas encore utilisé dans cette conversation
4. Développe avec 5 à 7 phrases, des faits réels, des chiffres si pertinents`;
      let firstChunk=true;
      let fullReply="";
      await streamGemini(dynSys,hist,key,700,(full)=>{
        if(!mountedRef.current) return;
        fullReply=full;
        if(firstChunk){firstChunk=false;setLoading(false);setMsgs(m=>[...m,{role:"ai" as const,text:full}]);}
        else setMsgs(m=>{const u=[...m];u[u.length-1]={role:"ai" as const,text:full};return u;});
        setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),30);
      });
      if(mountedRef.current&&audioOn) speakTimed(fullReply,voiceGender,()=>{if(mountedRef.current)setAutoMic(true);});
    }catch(err){
      if(!mountedRef.current) return;
      setLoading(false);
      const isNoKey=err instanceof Error&&err.message==="no_key";
      if(isNoKey){
        setMsgs(m=>[...m,{role:"ai" as const,text:"Clé Gemini API manquante — allez dans Profil → Réglages pour la configurer."}]);
      } else {
        const words=text.split(" ").filter(Boolean).slice(0,5).join(" ");
        const fallbacks=[
          `Vous dites "${words}" — développez en profondeur. Quels faits concrets soutiennent votre position ? Citez des chiffres précis, des exemples réels, des sources vérifiables. Un argument sans preuve reste une affirmation.`,
          `Point intéressant, mais insuffisant. L'argument adverse serait que vous avez tort sur ce point précis — et ils auraient des données pour le prouver. Comment les réfutez-vous point par point ? Soyez méthodique.`,
          `"${words}" — c'est affirmer beaucoup sans démontrer. Quel mécanisme concret défendez-vous ? Quel délai réaliste proposez-vous ? Quels acteurs sont impliqués, et quels obstacles anticipez-vous ?`,
          `Je vous relance : au-delà des mots, qu'est-ce qui change concrètement dans la vie des gens ? Donnez un exemple précis, mesurable, avec un chiffre et une date. C'est ça, argumenter.`,
          `Bien. Maintenant construisez l'argument complet : thèse principale, preuve empirique numéro 1, preuve numéro 2, réfutation de la critique principale, et conclusion logique. Pas de généralités — du concret.`,
        ];
        const reply=fallbacks[Math.floor(Math.random()*fallbacks.length)];
        setMsgs(m=>[...m,{role:"ai" as const,text:reply}]);
        if(audioOn) speakTimed(reply,voiceGender,()=>{if(mountedRef.current)setAutoMic(true);});
      }
    }
  };
  handleSpeechRef.current = send;

  const toggleMic=()=>{
    unlockAudio();
    if(listening){recRef.current?.stop();setListening(false);return;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR){alert("Utilisez Chrome pour la reconnaissance vocale.");return;}
    const rec=new SR();rec.lang="fr-FR";rec.continuous=false;rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{send(e.results[0][0].transcript);setListening(false);};
    rec.onend=()=>setListening(false);
    rec.start();recRef.current=rec;setListening(true);
  };

  const toggleAudio=()=>{
    const next=!audioOn;
    setAudioOn(next);
    if(!next) stopSpeech();
  };

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.b1}`,display:"flex",alignItems:"center",gap:10,background:T.surf,flexShrink:0}}>
        <button onClick={()=>{stopSpeech();onBack();}} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={22} c={T.textD}/></button>
        <span style={{fontSize:22}}>{emoji}</span>
        <p style={{color:T.text,fontWeight:800,fontSize:15,flex:1}}>{title}</p>
        <button onClick={toggleAudio} style={{background:audioOn?`${color}15`:"transparent",border:`1px solid ${audioOn?color:T.b1}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
          <Ic n="mic" s={14} c={audioOn?color:T.textD}/>
          <span style={{color:audioOn?color:T.textD,fontSize:11,fontWeight:700}}>{audioOn?"AUDIO":"TEXTE"}</span>
        </button>
      </div>
      <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",flexDirection:m.role==="user"?"row-reverse":"row",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:m.role==="user"?T.blueG:`${color}15`,border:`1.5px solid ${m.role==="user"?T.blueB:color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{m.role==="user"?"A":emoji}</div>
            <div style={{maxWidth:"80%",background:m.role==="user"?T.blueG:T.card,border:`1px solid ${m.role==="user"?`${T.blueB}40`:T.b1}`,borderRadius:14,padding:"10px 13px"}}>
              <p style={{color:T.text,fontSize:13,lineHeight:1.6}}>{m.text}</p>
            </div>
          </div>
        ))}
        {loading&&(
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:`${color}15`,border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{emoji}</div>
            <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:"12px 16px"}}>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:color,animation:`pulse 1.2s ${i*0.2}s infinite`}}/>)}</div>
            </div>
          </div>
        )}
      </div>
      <div style={{padding:"10px 14px",borderTop:`1px solid ${T.b1}`,background:T.surf,flexShrink:0,display:"flex",gap:8,alignItems:"center"}}>
        <button onClick={toggleMic} style={{width:44,height:44,borderRadius:12,border:`1px solid ${listening?T.red:T.b1}`,background:listening?`${T.red}15`:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
          <Ic n={listening?"micOff":"mic"} s={20} c={listening?T.red:T.textD}/>
        </button>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send(input)} placeholder="Votre réponse…" style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:12,padding:"10px 14px",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
        <button onClick={()=>send(input)} disabled={!input.trim()||loading} style={{width:44,height:44,borderRadius:12,border:"none",background:input.trim()&&!loading?color:T.b1,display:"flex",alignItems:"center",justifyContent:"center",cursor:input.trim()&&!loading?"pointer":"not-allowed",flexShrink:0,transition:"background .2s"}}>
          <Ic n="send" s={18} c={input.trim()&&!loading?"#fff":T.muted}/>
        </button>
      </div>
    </div>
  );
}

// ── TRIAL SIMULATION SCREEN ───────────────────────────────────
// Multi-character court sim: Président + Procureur speak in sequence after each user turn
function TrialSimScreen({trialRole,trialTopic,T,onBack}:{trialRole:"defense"|"prosecutor";trialTopic:string;T:Theme;onBack:()=>void}) {
  type TMsg = {role:"user"|"ai";charName:string;charInit:string;charColor:string;gender:"M"|"F";text:string};
  const [msgs,setMsgs] = useState<TMsg[]>([]);
  const [input,setInput] = useState("");
  const [loading,setLoading] = useState(false);
  const [audioOn,setAudioOn] = useState(true);
  const [listening,setListening] = useState(false);
  const [autoMic,setAutoMic] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSpeechRef = useRef<(t:string)=>void>((_t:string)=>{});

  const PRES = {name:"Président du Tribunal", init:"PT", gender:"M" as const, color:"#7C3AED"};
  const PROC = {name:"Procureur de la République", init:"PR", gender:"F" as const, color:"#E03535"};
  const AVOC = {name:"Avocat Adverse", init:"AA", gender:"M" as const, color:"#D97706"};

  useEffect(()=>{ mountedRef.current=true; return()=>{mountedRef.current=false;recRef.current?.stop();stopSpeech();}; },[]);

  function speakTimed(text:string, gender:"M"|"F", onDone:()=>void, delayMs=0) {
    const estMs = Math.max(2500, text.split(/\s+/).length * 400 + 800);
    setTimeout(()=>{
      if(!mountedRef.current) return;
      let fired = false;
      const done = ()=>{ if(fired||!mountedRef.current) return; fired=true; onDone(); };
      speakAny(text, gender, done);
      setTimeout(done, estMs);
    }, delayMs);
  }

  function speakSequence(chars:{text:string;gender:"M"|"F"}[], idx:number, onAllDone:()=>void) {
    if(!mountedRef.current||idx>=chars.length){onAllDone();return;}
    speakTimed(chars[idx].text, chars[idx].gender, ()=>speakSequence(chars,idx+1,onAllDone), idx===0?0:500);
  }

  useEffect(()=>{
    if(!autoMic) return;
    setAutoMic(false);
    if(typeof window==="undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR) return;
    const rec=new SR();
    rec.lang="fr-FR"; rec.continuous=false; rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{handleSpeechRef.current(e.results[0][0].transcript);setListening(false);};
    rec.onend=()=>setListening(false);
    try{rec.start();}catch{return;}
    recRef.current=rec; setListening(true);
  },[autoMic]);// eslint-disable-line

  useEffect(()=>{
    const presText = trialRole==="defense"
      ? `Audience ouverte. Tribunal correctionnel de Paris. Affaire : "${trialTopic}". La Cour est constituée. Maître de la Défense, vous avez la parole pour exposer votre ligne de défense, vos moyens principaux, et la qualification des faits que vous contestez. Soyez précis sur le droit applicable et les éléments de preuve que vous entendez soumettre.`
      : `Audience ouverte. Tribunal correctionnel de Paris. Affaire : "${trialTopic}". Monsieur le Procureur, énoncer les chefs d'inculpation retenus, les éléments constitutifs de l'infraction telle que qualifiée par le parquet, et votre premier élément de preuve matérielle.`;
    const procText = trialRole==="defense"
      ? `Votre Honneur, le ministère public a réuni des preuves matérielles solides dans cette affaire. Les faits sont établis, les témoignages convergent, et les expertises techniques confirment notre thèse. La défense devra nous expliquer comment elle entend contester des éléments aussi clairement documentés au dossier.`
      : `Votre Honneur, au nom de la défense, je m'inscris en faux contre les affirmations du parquet. La présomption d'innocence est un droit fondamental garanti par l'article 9 de la Déclaration des droits de l'homme et par l'article 6 de la Convention européenne des droits de l'homme. Aucune condamnation ne saurait intervenir sans preuve au-delà du doute raisonnable.`;
    const introMsgs:TMsg[] = [
      {role:"ai",charName:PRES.name,charInit:PRES.init,charColor:PRES.color,gender:PRES.gender,text:presText},
      {role:"ai",charName:PROC.name,charInit:PROC.init,charColor:PROC.color,gender:PROC.gender,text:procText},
    ];
    setMsgs(introMsgs);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),200);
    if(audioOn){
      speakSequence([{text:presText,gender:PRES.gender},{text:procText,gender:PROC.gender}], 0, ()=>{if(mountedRef.current)setAutoMic(true);});
    }
  },[]);// eslint-disable-line

  const addMsg = (m:TMsg)=>{ setMsgs(prev=>[...prev,m]); setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100); };

  const send = async(text:string)=>{
    if(!text.trim()||loading) return;
    unlockAudio();
    setInput("");
    const userMsg:TMsg = {role:"user",charName:trialRole==="defense"?"Maître (Défense)":"Procureur",charInit:trialRole==="defense"?"MD":"MP",charColor:"#2B78F5",gender:"M",text};
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
    setLoading(true);
    const key = typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
    const trialSys = `Tu gères l'audience du Tribunal correctionnel de Paris. L'affaire : "${trialTopic}". L'utilisateur est ${trialRole==="defense"?"Maître de la Défense":"Monsieur le Procureur"}.

CADRE JURIDIQUE RÉEL QUE TU MAÎTRISES PARFAITEMENT :
- Code pénal français (qualifications précises : art. 313-1 escroquerie, 432-11 corruption, 441-1 faux...), Code de procédure pénale
- Présomption d'innocence (art. 9 DDHC 1789), droits de la défense (art. 6 CEDH), égalité des armes
- Jurisprudence Cour de cassation Ch. criminelle, Conseil constitutionnel, CEDH
- Principes : intime conviction (art. 353 CPP), charge de la preuve sur l'accusation, au-delà du doute raisonnable
- Nullités de procédure, irrecevabilité de preuves, vices de forme, expertises contradictoires
- Circonstances aggravantes, atténuantes, récidive, complicité, co-auteurs
- Peine : sursis, travaux d'intérêt général, interdiction professionnelle, confiscation

FORMAT OBLIGATOIRE — génère DEUX personnages distincts :

[PRÉSIDENT] Réaction du Président du Tribunal : cite EXACTEMENT l'argument de l'avocat/procureur, puis soit valide avec une nuance juridique précise (article de loi, arrêt de jurisprudence), soit soulève une objection (irrecevabilité, contradiction avec les pièces du dossier, vice de procédure), soit interpelle un témoin ou expert. 4 à 6 phrases solennelles avec références juridiques réelles.

[PROCUREUR] Réaction du ${trialRole==="defense"?"Procureur (qui s'oppose à la défense)":"Avocat de la défense (qui s'oppose au procureur)"} : contre-argumente avec des éléments factuels précis du dossier, des expertises techniques, des témoignages, ou la qualification pénale exacte. 4 à 5 phrases percutantes. Commence par "Votre Honneur,".

RÈGLES ABSOLUES :
- Chaque personnage cite EXACTEMENT ce que vient de dire l'avocat/procureur
- Références juridiques précises et authentiques (articles, arrêts si pertinent)
- Chaque personnage développe UN argument principal avec preuves à l'appui
- Vocabulaire juridique français authentique (le ministère public, la juridiction, les pièces versées au dossier, le mis en examen...)
- Le Président maintient l'équilibre et l'ordre des débats`;
    try {
      const rawHist=newMsgs.map(m=>({role:(m.role==="user"?"user":"model") as "user"|"model",parts:[{text:`[${m.charName}] ${m.text}`}]}));
      const firstUserIdx=rawHist.findIndex(m=>m.role==="user");
      const hist=firstUserIdx>=0?rawHist.slice(firstUserIdx):rawHist;
      if(!key) throw new Error("no_key");
      const dynTrialSys = `${trialSys}

═══ PLAIDOIRIE DE CE TOUR ═══
L'avocat/procureur vient de dire : "${text}"
CHAQUE personnage doit citer ces mots EXACTS entre guillemets et y répondre directement.`;
      const reply = await callGemini(dynTrialSys, hist, key, 900);
      if(!mountedRef.current){setLoading(false);return;}
      const presMatch = reply.match(/\[PRÉSIDENT\]\s*([\s\S]*?)(?=\[PROCUREUR\]|$)/);
      const procMatch = reply.match(/\[PROCUREUR\]\s*([\s\S]*?)(?=\[PRÉSIDENT\]|$)/);
      const charMsgs:TMsg[] = [];
      if(presMatch?.[1]?.trim()) charMsgs.push({role:"ai",charName:PRES.name,charInit:PRES.init,charColor:PRES.color,gender:PRES.gender,text:presMatch[1].trim()});
      if(procMatch?.[1]?.trim()) charMsgs.push({role:"ai",charName:trialRole==="defense"?PROC.name:AVOC.name,charInit:trialRole==="defense"?PROC.init:AVOC.init,charColor:trialRole==="defense"?PROC.color:AVOC.color,gender:trialRole==="defense"?PROC.gender:AVOC.gender,text:procMatch[1].trim()});
      if(charMsgs.length===0) charMsgs.push({role:"ai",charName:PRES.name,charInit:PRES.init,charColor:PRES.color,gender:PRES.gender,text:reply});
      charMsgs.forEach(m=>addMsg(m));
      setLoading(false);
      if(audioOn) speakSequence(charMsgs.map(m=>({text:m.text,gender:m.gender})), 0, ()=>{if(mountedRef.current)setAutoMic(true);});
    }catch(err){
      if(!mountedRef.current){setLoading(false);return;}
      setLoading(false);
      const isNoKey=err instanceof Error&&err.message==="no_key";
      if(isNoKey){addMsg({role:"ai",charName:PRES.name,charInit:PRES.init,charColor:PRES.color,gender:PRES.gender,text:"Clé Gemini API manquante — allez dans Profil → Réglages."});return;}
      const presFb=["Maître, votre argumentation nécessite d'être précisée. Sur quel fondement juridique exact repose ce moyen de défense ? La Cour a besoin d'une référence textuelle ou jurisprudentielle précise avant de pouvoir statuer sur cette demande.","L'objection est notée au procès-verbal. Cependant, les éléments présentés ne semblent pas constitutifs d'une nullité au sens de l'article 170 du Code de procédure pénale. La Cour demande une reformulation plus précise de votre demande.","La Cour prend note de cet argument. Avant de se prononcer, elle souhaite entendre la partie adverse sur ce point précis. Le débat contradictoire est une exigence fondamentale de notre procédure."];
      const procFb = trialRole==="defense"
        ? ["Votre Honneur, la défense tente de détourner l'attention des faits établis par le dossier d'instruction. Les preuves matérielles réunies par le parquet — expertises forensiques, témoignages concordants, relevés bancaires — sont incontestables. Nous maintenons l'ensemble de nos réquisitions.","La réponse de la défense est habile mais insuffisante en droit. L'article 427 du Code de procédure pénale est clair : les juges apprécient les preuves selon leur intime conviction. Nous avons fourni suffisamment d'éléments pour emporter cette conviction."]
        : ["Votre Honneur, nous contestons formellement cette interprétation des faits. Notre client bénéficie de la présomption d'innocence, et les preuves avancées par le parquet restent insuffisantes pour écarter tout doute raisonnable sur sa culpabilité.","La charge de la preuve incombe au ministère public. Les éléments présentés ce jour sont soit inadmissibles au regard de leur mode d'obtention, soit insuffisamment corroborés. Nous demandons à la Cour d'en tirer les conséquences."];
      const fallbackMsgs:TMsg[] = [
        {role:"ai",charName:PRES.name,charInit:PRES.init,charColor:PRES.color,gender:PRES.gender,text:presFb[Math.floor(Math.random()*presFb.length)]},
        {role:"ai",charName:trialRole==="defense"?PROC.name:AVOC.name,charInit:trialRole==="defense"?PROC.init:AVOC.init,charColor:trialRole==="defense"?PROC.color:AVOC.color,gender:trialRole==="defense"?PROC.gender:AVOC.gender,text:procFb[Math.floor(Math.random()*procFb.length)]},
      ];
      fallbackMsgs.forEach(m=>addMsg(m));
      if(audioOn) speakSequence(fallbackMsgs.map(m=>({text:m.text,gender:m.gender})), 0, ()=>{if(mountedRef.current)setAutoMic(true);});
    }
  };
  handleSpeechRef.current = send;

  const toggleMic=()=>{
    unlockAudio();
    if(listening){recRef.current?.stop();setListening(false);return;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR){alert("Utilisez Chrome pour la reconnaissance vocale.");return;}
    const rec=new SR();rec.lang="fr-FR";rec.continuous=false;rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{send(e.results[0][0].transcript);setListening(false);};
    rec.onend=()=>setListening(false);
    rec.start();recRef.current=rec;setListening(true);
  };

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.b1}`,display:"flex",alignItems:"center",gap:10,background:T.surf,flexShrink:0}}>
        <button onClick={()=>{stopSpeech();onBack();}} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={22} c={T.textD}/></button>
        <span style={{fontSize:20}}>⚖️</span>
        <div style={{flex:1}}>
          <p style={{color:T.text,fontWeight:800,fontSize:14}}>{trialRole==="defense"?"Avocat de la Défense":"Procureur de la République"}</p>
          <p style={{color:T.textD,fontSize:11,marginTop:1}}>{trialTopic.slice(0,42)}{trialTopic.length>42?"…":""}</p>
        </div>
        <div style={{display:"flex",gap:5,alignItems:"center"}}>
          {[PRES,PROC].map(c=>(
            <div key={c.init} style={{width:26,height:26,borderRadius:"50%",background:`${c.color}15`,border:`1.5px solid ${c.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:800,color:c.color}}>{c.init}</div>
          ))}
        </div>
        <button onClick={()=>{const n=!audioOn;setAudioOn(n);if(!n)stopSpeech();}} style={{background:audioOn?`${T.purple}15`:"transparent",border:`1px solid ${audioOn?T.purple:T.b1}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
          <Ic n="mic" s={14} c={audioOn?T.purple:T.textD}/><span style={{color:audioOn?T.purple:T.textD,fontSize:11,fontWeight:700}}>{audioOn?"AUDIO":"TEXTE"}</span>
        </button>
      </div>
      <div style={{padding:"8px 14px",background:`${T.purple}08`,borderBottom:`1px solid ${T.b1}`,display:"flex",gap:12,flexShrink:0}}>
        {[{...PRES,label:"Président"},{...PROC,label:trialRole==="defense"?"Procureur":"Avocat adv."}].map(c=>(
          <div key={c.init} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:16,height:16,borderRadius:"50%",background:c.color,opacity:.8}}/>
            <span style={{color:T.textD,fontSize:10,fontWeight:600}}>{c.init} – {c.label}</span>
          </div>
        ))}
      </div>
      <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",flexDirection:m.role==="user"?"row-reverse":"row",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:`${m.charColor}15`,border:`1.5px solid ${m.charColor}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:m.charColor,flexShrink:0}}>{m.charInit}</div>
            <div style={{maxWidth:"82%",background:m.role==="user"?T.blueG:T.card,border:`1px solid ${m.role==="user"?`${T.blueB}40`:`${m.charColor}30`}`,borderRadius:14,padding:"10px 13px"}}>
              {m.role!=="user"&&<p style={{color:m.charColor,fontSize:10,fontWeight:800,marginBottom:4,letterSpacing:.5,textTransform:"uppercase"}}>{m.charName}</p>}
              <p style={{color:T.text,fontSize:13,lineHeight:1.65}}>{m.text}</p>
            </div>
          </div>
        ))}
        {loading&&(
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:`${PRES.color}15`,border:`1.5px solid ${PRES.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:PRES.color}}>PT</div>
            <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:"12px 16px"}}>
              <div style={{display:"flex",gap:5}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:PRES.color,animation:`pulse 1.2s ${i*0.2}s infinite`}}/>)}</div>
            </div>
          </div>
        )}
      </div>
      <div style={{padding:"10px 14px",borderTop:`1px solid ${T.b1}`,background:T.surf,flexShrink:0,display:"flex",gap:8,alignItems:"center"}}>
        <button onClick={toggleMic} style={{width:44,height:44,borderRadius:12,border:`1px solid ${listening?T.red:T.b1}`,background:listening?`${T.red}15`:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
          <Ic n={listening?"micOff":"mic"} s={20} c={listening?T.red:T.textD}/>
        </button>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send(input)} placeholder={trialRole==="defense"?"Votre plaidoirie, Maître…":"Votre réquisitoire, Monsieur le Procureur…"} style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:12,padding:"10px 14px",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
        <button onClick={()=>send(input)} disabled={!input.trim()||loading} style={{width:44,height:44,borderRadius:12,border:"none",background:input.trim()&&!loading?T.purple:T.b1,display:"flex",alignItems:"center",justifyContent:"center",cursor:input.trim()&&!loading?"pointer":"not-allowed",flexShrink:0,transition:"background .2s"}}>
          <Ic n="send" s={18} c={input.trim()&&!loading?"#fff":T.muted}/>
        </button>
      </div>
    </div>
  );
}

// ── UN SECURITY COUNCIL SCREEN ────────────────────────────────
// Realistic UNSC simulation: session opening + 2 countries respond in sequence with audio
function UNSimScreen({unRole,unTopic,T,onBack}:{unRole:typeof UN_DEL[0];unTopic:string;T:Theme;onBack:()=>void}) {
  type UNMsg = {role:"user"|"ai";flag:string;country:string;gender:"M"|"F";text:string};
  // Voice gender per delegation
  const G: Record<string,("M"|"F")> = {fr:"F",us:"M",ru:"M",cn:"M",uk:"F"};
  const [msgs,setMsgs] = useState<UNMsg[]>([]);
  const [input,setInput] = useState("");
  const [loading,setLoading] = useState(false);
  const [audioOn,setAudioOn] = useState(true);
  const [listening,setListening] = useState(false);
  const [autoMic,setAutoMic] = useState(false);
  const [exchangeN,setExchangeN] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSpeechRef = useRef<(t:string)=>void>((_t:string)=>{});

  useEffect(()=>{ mountedRef.current=true; return()=>{mountedRef.current=false;recRef.current?.stop();stopSpeech();}; },[]);

  function speakTimed(text:string, gender:"M"|"F", onDone:()=>void, delayMs=0) {
    const estMs = Math.max(2500, text.split(/\s+/).length * 400 + 800);
    setTimeout(()=>{
      if(!mountedRef.current) return;
      let fired=false;
      const done=()=>{if(fired||!mountedRef.current)return;fired=true;onDone();};
      speakAny(text,gender,done);
      setTimeout(done,estMs);
    },delayMs);
  }
  function speakSequence(items:{text:string;gender:"M"|"F"}[], idx:number, onAllDone:()=>void) {
    if(!mountedRef.current||idx>=items.length){onAllDone();return;}
    speakTimed(items[idx].text,items[idx].gender,()=>speakSequence(items,idx+1,onAllDone),idx===0?0:700);
  }

  useEffect(()=>{
    if(!autoMic) return;
    setAutoMic(false);
    if(typeof window==="undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR) return;
    const rec=new SR();
    rec.lang="fr-FR"; rec.continuous=false; rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{handleSpeechRef.current(e.results[0][0].transcript);setListening(false);};
    rec.onend=()=>setListening(false);
    try{rec.start();}catch{return;}
    recRef.current=rec; setListening(true);
  },[autoMic]);// eslint-disable-line

  // Session opening: Président du Conseil ouvre la séance
  useEffect(()=>{
    const pres = UN_DEL.find(d=>d.id!==unRole.id)||UN_DEL[0];
    const presGender = G[pres.id]||"M";
    const opening = `${pres.flag} ${pres.country} (Présidence du Conseil) : Mesdames et Messieurs les délégués, je déclare ouverte cette séance du Conseil de Sécurité, convoquée conformément à l'article 28 de la Charte des Nations Unies. L'ordre du jour porte sur la question suivante : « ${unTopic} ». La délégation de ${unRole.country} a sollicité la tenue de cette réunion d'urgence. Je lui cède la parole en premier. Je rappelle à toutes les délégations que leurs déclarations seront consignées au procès-verbal et que le vote, s'il y a lieu, se tiendra à l'issue du débat. Monsieur / Madame le représentant de ${unRole.country}, vous avez la parole.`;
    const introMsgs:UNMsg[] = [{role:"ai",flag:pres.flag,country:`${pres.country} — Présidence`,gender:presGender,text:opening}];
    setMsgs(introMsgs);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),200);
    if(audioOn) speakTimed(opening,presGender,()=>{if(mountedRef.current)setAutoMic(true);},500);
  },[]);// eslint-disable-line

  const addMsg=(m:UNMsg)=>{setMsgs(p=>[...p,m]);setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);};

  const send=async(text:string)=>{
    if(!text.trim()||loading) return;
    unlockAudio();
    setInput("");
    const n=exchangeN+1; setExchangeN(n);
    const userMsg:UNMsg={role:"user",flag:unRole.flag,country:unRole.country,gender:G[unRole.id]||"M",text};
    const newMsgs=[...msgs,userMsg];
    setMsgs(newMsgs);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
    setLoading(true);
    const key=typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";

    // Rotate through 4 pairs of responders to ensure variety across turns
    const others=UN_DEL.filter(d=>d.id!==unRole.id);
    const pairs:([number,number])[]= [[0,1],[1,2],[2,3],[0,3],[1,3],[0,2]];
    const [i1,i2]=pairs[(n-1)%pairs.length];
    const respondents=[others[i1%others.length],others[i2%others.length]].filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i);

    // Angle rotation — each turn focuses on a different dimension, never repeated
    const ANGLES=[
      "droit international et Charte ONU — cite l'article précis (art. 2§4 non-recours à la force, art. 51 légitime défense, Chapitre VII mesures coercitives) et une résolution précédente (S/RES/1441, S/RES/2118, S/RES/1973...)",
      "enjeux géopolitiques régionaux — alliances en présence, sphères d'influence, risque d'escalade ou de spillover, position des organisations régionales (UA, UE, OTAN, SCO, ASEAN...)",
      "impact humanitaire — droit international humanitaire (DIH), Conventions de Genève, protection des civils, accès de l'aide, chiffres OCHA/HCR/CICR réels si disponibles",
      "implications économiques et sanctions — régime de sanctions existant, impact économique, accès aux matières premières, routes commerciales, dollar vs multipolarité",
      "précédents historiques de l'ONU — résolutions similaires passées, succès ou échecs (Bosnie 1995, Libye 2011, Syrie 2013...), leçons apprises, risque d'affaiblissement du Conseil",
      "proposition concrète — libellé exact d'un paragraphe de résolution ou d'un amendement, mécanisme de surveillance, calendrier de mise en œuvre, conditions du vote de ${G[unRole.id]==='F'?'ma':'mon'} délégation",
    ];
    const angle=ANGLES[(n-1)%ANGLES.length];

    const rawHist=newMsgs.map(m=>({role:(m.role==="user"?"user":"model") as "user"|"model",parts:[{text:`[${m.country}] ${m.text}`}]}));
    const firstUserIdx=rawHist.findIndex(m=>m.role==="user");
    const hist=firstUserIdx>=0?rawHist.slice(firstUserIdx):rawHist;

    try{
      if(!key) throw new Error("no_key");

      // Parallel Gemini calls for both responding delegations
      const makePrompt=(del:typeof UN_DEL[0])=>`Tu es ${del.flag} la délégation de ${del.country} au Conseil de Sécurité des Nations Unies.

DOCTRINE NATIONALE INTÉGRALE DE ${del.country.toUpperCase()} : ${del.doctrine}

DÉCLARATION QUE VIENT DE FAIRE ${unRole.country.toUpperCase()} (échange n°${n}) :
"${text}"

ANGLE OBLIGATOIRE POUR CET ÉCHANGE : ${angle}
→ Concentre toute ton intervention sur cet angle précis. Ne répète PAS des arguments déjà utilisés dans les échanges précédents.

PROCÉDURE ONUSIENNE AUTHENTIQUE :
- Ouvre OBLIGATOIREMENT par "Monsieur le Président," ou "Madame la Présidente,"
- Réfère-toi à des résolutions réelles et articles de la Charte avec leurs numéros exacts
- Utilise le vocabulaire diplomatique onusien : "ma délégation", "le Conseil est saisi de", "nous prenons note de", "nous appelons à", "nous opposons notre veto à", "nous nous abstenons sur"
- Cite UN précédent historique réel pertinent pour ${del.country} sur ce type de sujet
- Cite OBLIGATOIREMENT les mots exacts de ${unRole.country} entre guillemets et rebondis dessus

STRUCTURE OBLIGATOIRE :
1. Formule d'ouverture protocolaire
2. Citation DIRECTE des mots de ${unRole.country} puis contre-argument ou appui sur l'angle du jour
3. Position de ${del.country} avec référence juridique (article Charte ou résolution réelle)
4. Précédent historique ou donnée chiffrée concrète liée à ${del.country} sur ce sujet
5. Proposition ou position de vote de ${del.country} sur ce point

5 à 6 phrases minimum. Développe vraiment. Vocabulaire onusien formel.`;

      const [r1,r2]=await Promise.allSettled(respondents.map(del=>callGemini(makePrompt(del),[...hist,{role:"user" as const,parts:[{text:`La délégation de ${del.country}, vous avez la parole.`}]}],key,550)));
      if(!mountedRef.current){setLoading(false);return;}

      const speakItems:{text:string;gender:"M"|"F"}[]=[];
      respondents.forEach((del,idx)=>{
        const result=idx===0?r1:r2;
        if(result.status==="fulfilled"&&result.value){
          const m:UNMsg={role:"ai",flag:del.flag,country:del.country,gender:G[del.id]||"M",text:result.value};
          addMsg(m); speakItems.push({text:result.value,gender:G[del.id]||"M"});
        }
      });
      setLoading(false);
      if(audioOn&&speakItems.length>0) speakSequence(speakItems,0,()=>{if(mountedRef.current)setAutoMic(true);});
      else if(!audioOn) setAutoMic(false);

    }catch(err){
      if(!mountedRef.current){setLoading(false);return;}
      setLoading(false);
      if(err instanceof Error&&err.message==="no_key"){
        addMsg({role:"ai",flag:"🌐",country:"Secrétariat",gender:"F",text:"Clé Gemini API manquante — allez dans Profil → Réglages pour la configurer."});
        return;
      }
      const fb1=respondents[0]||others[0];
      const fb2=respondents[1]||others[1];
      const fallbacks:UNMsg[]=[
        {role:"ai",flag:fb1.flag,country:fb1.country,gender:G[fb1.id]||"M",text:`Monsieur le Président, ma délégation a pris note avec la plus grande attention de la déclaration de ${unRole.country}. Sans préjuger des consultations informelles qui devront nécessairement précéder tout vote, ${fb1.country} tient à rappeler que l'article 2, paragraphe 4 de la Charte interdit le recours à la force dans les relations internationales. Nous avons été confrontés à des situations similaires par le passé — les résolutions adoptées alors constituent un précédent que le Conseil ne saurait ignorer. ${fb1.country} soumet au Conseil un appel à la retenue et propose l'ouverture immédiate de consultations informelles sous l'égide du Secrétaire Général.`},
        {role:"ai",flag:fb2.flag,country:fb2.country,gender:G[fb2.id]||"M",text:`Madame la Présidente, ${fb2.country} souhaite réagir à la déclaration de ${unRole.country}. Ma délégation considère que les arguments avancés méritent un examen approfondi au regard du droit international applicable. Nous rappelons que le Conseil de Sécurité a adopté des résolutions contraignantes sur des questions similaires — résolutions que toutes les parties sont tenues de respecter en vertu de l'article 25 de la Charte. ${fb2.country} conditionnera son vote à la présentation d'un projet de texte équilibré, respectueux de la souveraineté des États et assorti de mécanismes de vérification crédibles.`},
      ];
      fallbacks.forEach(m=>addMsg(m));
      if(audioOn) speakSequence(fallbacks.map(m=>({text:m.text,gender:m.gender})),0,()=>{if(mountedRef.current)setAutoMic(true);});
    }
  };
  handleSpeechRef.current=send;

  const toggleMic=()=>{
    unlockAudio();
    if(listening){recRef.current?.stop();setListening(false);return;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;
    const SR=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!SR){alert("Utilisez Chrome pour la reconnaissance vocale.");return;}
    const rec=new SR();rec.lang="fr-FR";rec.continuous=false;rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{send(e.results[0][0].transcript);setListening(false);};
    rec.onend=()=>setListening(false);
    rec.start();recRef.current=rec;setListening(true);
  };

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"10px 16px",background:T.surf,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>{stopSpeech();onBack();}} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={20} c={T.textD}/></button>
          <span style={{fontSize:22}}>🌐</span>
          <div style={{flex:1}}>
            <p style={{color:T.text,fontSize:13,fontWeight:700}}>Conseil de Sécurité — ONU</p>
            <p style={{color:T.textD,fontSize:11}}>{unTopic.slice(0,44)}{unTopic.length>44?"…":""}</p>
          </div>
          <button onClick={()=>{const n=!audioOn;setAudioOn(n);if(!n)stopSpeech();}} style={{background:audioOn?T.blueG:"transparent",border:`1px solid ${audioOn?T.blueB:T.b1}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            <Ic n="mic" s={14} c={audioOn?T.blueB:T.textD}/><span style={{color:audioOn?T.blueB:T.textD,fontSize:10,fontWeight:700}}>{audioOn?"AUDIO":"TEXTE"}</span>
          </button>
        </div>
        <div style={{marginTop:8,display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
          {UN_DEL.map(d=><span key={d.id} style={{fontSize:15,opacity:d.id===unRole.id?1:0.4,cursor:"default"}}>{d.flag}</span>)}
          <span style={{background:T.blueG,color:T.blueB,fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:700,marginLeft:4}}>Vous : {unRole.flag} {unRole.country}</span>
          {exchangeN>0&&<span style={{background:`${T.amber}15`,color:T.amber,fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:700}}>Tour {exchangeN}</span>}
        </div>
      </div>
      <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",flexDirection:m.role==="user"?"row-reverse":"row",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:T.card,border:`1.5px solid ${T.b1}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{m.flag}</div>
            <div style={{maxWidth:"80%",background:m.role==="user"?T.blueG:T.card,border:`1px solid ${m.role==="user"?T.blueB+"40":T.b1}`,borderRadius:12,padding:"8px 12px"}}>
              <p style={{color:m.role==="user"?T.blueB:T.textD,fontSize:10,fontWeight:800,marginBottom:4}}>{m.country}</p>
              <p style={{color:T.text,fontSize:13,lineHeight:1.65}}>{m.text}</p>
            </div>
          </div>
        ))}
        {loading&&<div style={{display:"flex",gap:10,alignItems:"flex-start"}}><div style={{width:34,height:34,borderRadius:"50%",background:T.card,border:`1.5px solid ${T.b1}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🌐</div><div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:"12px 16px"}}><div style={{display:"flex",gap:5}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:T.blueB,animation:`pulse 1.2s ${i*0.2}s infinite`}}/>)}</div></div></div>}
      </div>
      <div style={{padding:"10px 14px 24px",borderTop:`1px solid ${T.b1}`,display:"flex",gap:8,flexShrink:0}}>
        <button onClick={toggleMic} style={{width:44,height:44,borderRadius:12,border:`1px solid ${listening?T.red:T.b1}`,background:listening?`${T.red}15`:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
          <Ic n={listening?"micOff":"mic"} s={20} c={listening?T.red:T.textD}/>
        </button>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(input)} placeholder={`Déclaration de ${unRole.country}…`} style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:12,padding:"10px 14px",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
        <button onClick={()=>send(input)} disabled={loading||!input.trim()} style={{width:44,height:44,borderRadius:12,background:input.trim()&&!loading?T.blueB:T.b1,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:input.trim()&&!loading?"pointer":"not-allowed",flexShrink:0}}><Ic n="send" s={16} c={input.trim()&&!loading?"#fff":T.muted}/></button>
      </div>
    </div>
  );
}

// ── SIMULATION SCREEN ─────────────────────────────────────────
function SimulationScreen({T}:{T:Theme}) {
  const [mode,setMode] = useState<"home"|"un"|"trial"|"interview"|"elections"|"soutenance"|"examen"|"pitch"|"secu"|"prise"|"tutorat">("home");
  const [unRole,setUnRole] = useState<typeof UN_DEL[0]|null>(null);
  const [unTopic,setUnTopic] = useState("");
  const [trialRole,setTrialRole] = useState<"defense"|"prosecutor"|null>(null);
  const [trialTopic,setTrialTopic] = useState("");
  const [voted,setVoted] = useState<string|null>(null);
  const SIM_CONFIGS: Record<string, {title:string;emoji:string;color:string;systemPrompt:string;welcome:string;voiceGender:"M"|"F"}> = {
    interview: {
      title:"Entretien RH",emoji:"💼",color:T.green,voiceGender:"F",
      systemPrompt:`Tu es Marie Dupont, DRH senior chez un grand groupe français du CAC 40 (Société Générale, L'Oréal, Total). Tu as 20 ans d'expérience, tu as passé des milliers d'entretiens, et tu sais exactement détecter ce qui est vrai ou fabriqué dans une réponse.

MÉTHODE STAR que tu appliques systématiquement et que tu expliques quand le candidat ne l'utilise pas :
- Situation : quel était le contexte précis ? Quelle entreprise, quelle équipe, quelle période ?
- Tâche : quelle était ta mission exacte, pas celle de l'équipe — LA TIENNE ?
- Action : qu'as-tu fait personnellement, pas "on a fait" — TOI, concrètement, étape par étape ?
- Résultat : quel impact mesurable ? Pourcentage, délai, économie, volume, satisfaction client ?

COMPÉTENCES QUE TU ÉVALUES (une par échange, en rotation progressive) :
1. Leadership : "Donnez-moi un exemple précis où vous avez pris une décision difficile seul, avec des données insuffisantes"
2. Gestion de crise : "Décrivez une situation où tout s'est effondré — comment avez-vous réagi dans les 48 premières heures ?"
3. Gestion des conflits : "Un conflit dur avec un collègue ou un supérieur — quel a été votre rôle exact ?"
4. Orientation résultats : "Quel KPI avez-vous personnellement amélioré ? De combien, sur quelle période, comment ?"
5. Adaptabilité : "Un changement radical de dernière minute — comment avez-vous pivoté, et qu'avez-vous appris ?"
6. Créativité : "Une solution que vous avez trouvée et que personne d'autre n'avait envisagée — racontez"
7. Intégrité : "Un moment où vous avez dû dire non à votre hiérarchie — pourquoi, et quelles conséquences ?"

RÈGLES ABSOLUES :
- Cite toujours UN mot-clé exact de la réponse du candidat avant ta prochaine question
- Débusque les imprécisions : "Vous dites 'on a réussi' — QUE vous avez fait VOUS, personnellement ?"
- Si réponse vague : "Soyez ultra-précis — donnez-moi une date, un chiffre, un nom de projet"
- Si réponse excellente : valide en une phrase puis monte la pression ou change d'angle
- Si hors sujet : "Je reformule ma question — [reformulation plus ciblée et directe]"
- Développe VRAIMENT tes réactions : analyse la réponse, identifie ce qui manque, donne un contexte sectoriel réel (marché, enjeux du poste, culture d'entreprise)
- 5 à 7 phrases minimum. Ton professionnel, humain, mais sans complaisance.`,
      welcome:"Bonjour, entrez. Je suis Marie Dupont, DRH. J'ai votre dossier sous les yeux — votre profil a retenu notre attention, mais je dois valider quelques points essentiels avant de pouvoir vous faire une proposition. Nous avons 45 minutes. Avant tout : présentez-vous en 90 secondes, pas le CV — ce que vous êtes vraiment, ce qui vous motive, et ce que vous cherchez dans ce poste précisément. Je vous écoute."
    },
    soutenance: {
      title:"Soutenance orale",emoji:"🎓",color:"#D97706",voiceGender:"M",
      systemPrompt:`Tu es le Professeur Bernard Leroy, Professeur des Universités en sciences sociales, directeur de thèse depuis 25 ans, président de jury de soutenance. Tu as évalué plus de 200 thèses et mémoires. Tu es exigeant, précis, et tu ne laisses rien passer — mais tu es juste.

GRILLE D'ÉVALUATION COMPLÈTE que tu appliques rigoureusement :
1. ORIGINALITÉ : La contribution est-elle vraiment nouvelle ? Que dit la littérature académique sur ce point précis (auteurs, années, conclusions) ? Y a-t-il un gap que ce travail comble vraiment ?
2. RIGUEUR MÉTHODOLOGIQUE : L'échantillon est-il représentatif ? Les biais de sélection sont-ils contrôlés ? La méthode (quantitative/qualitative/mixte) est-elle cohérente avec les hypothèses ?
3. COHÉRENCE INTERNE : La problématique, les hypothèses, la méthodologie et les conclusions forment-elles un tout logique ? Y a-t-il des contradictions internes ?
4. MAÎTRISE DES LIMITES : L'étudiant connaît-il ses angles morts ? A-t-il répondu à toutes ses hypothèses initiales ?
5. PERTINENCE : À quoi ça sert ? Qui peut utiliser ces résultats ? Quelles implications pratiques ou théoriques ?
6. MAÎTRISE DU DOMAINE : Connait-il les auteurs fondateurs, les débats en cours, les courants contradictoires ?

TECHNIQUES D'INTERROGATOIRE :
- Commence par valider un point précis, puis déstabilise IMMÉDIATEMENT ce même point
- Pose des questions que les autres membres du jury PEW pourraient poser : "Le Professeur Durand du jury me demanderait sûrement..."
- Creuse les failles : "Votre hypothèse H1 repose sur X — mais avez-vous contrôlé pour Y ?"
- Exige des preuves concrètes : "Taille de l'échantillon ? Logiciel d'analyse ? Taux de réponse ?"
- Ne valide JAMAIS sans creuser : "Intéressant — mais quelle est la limite principale de cette conclusion ?"

RÈGLES ABSOLUES :
- Cite exactement ce que l'étudiant vient d'expliquer avant de questionner
- Développe ton analyse avec des références académiques réelles si pertinent (Bourdieu, Piketty, March, etc.)
- Identifie et nomme précisément la faille méthodologique ou conceptuelle
- 5 à 7 phrases minimum, academiques et rigoureuses. Ton neutre mais exigeant.`,
      welcome:"La soutenance est ouverte. Je suis le Professeur Bernard Leroy, président de jury. Avant votre exposé, commençons par l'essentiel : en une seule phrase précise et sans jargon inutile, quelle est la contribution originale de votre travail — concrètement, ce que personne n'avait démontré avant vous ? Ensuite, précisez votre méthode principale en deux phrases. Le reste de la soutenance découlera de votre réponse."
    },
    examen: {
      title:"Examen oral",emoji:"📝",color:"#E03535",voiceGender:"F",
      systemPrompt:`Tu es Madame Lambert, professeure agrégée d'université, spécialiste reconnue dans plusieurs disciplines. Tu fais passer un examen oral sérieux. Tu connais tes matières sur le bout des doigts : dates exactes, articles de loi précis, auteurs philosophiques avec leurs thèses, chiffres économiques réels.

MÉTHODE D'ÉVALUATION PROGRESSIVE :
1. Évalue PRÉCISÉMENT la réponse : "Correct sur X, mais il manque Y et Z — voici pourquoi c'est important"
2. Approfondis : pose une question qui part EXACTEMENT de ce que l'étudiant vient de dire
3. Montée en difficulté : définition → application → cas limite → exception historique → critique théorique

DISCIPLINES MAÎTRISÉES (avec faits réels) :
- Droit : Constitution de 1958, DDHC 1789, articles du Code civil/pénal/administratif, jurisprudences importantes (Conseil d'État, Cour de cassation, CEDH)
- Histoire : chronologie précise, causes profondes et immédiates, acteurs clés, conséquences à court et long terme
- Économie : théories de Keynes, Hayek, Marx, Friedman ; chiffres INSEE/BCE/FMI ; mécanismes micro et macro
- Philosophie : thèses précises de Platon (allégorie de la caverne), Descartes (cogito ergo sum), Kant (impératif catégorique), Rousseau (contrat social), Nietzsche (volonté de puissance), Sartre (existence précède l'essence)
- Sciences politiques : systèmes électoraux comparés, partis politiques européens, institutions françaises et européennes
- Géopolitique : alliances actuelles, conflits en cours, traités internationaux avec dates et signataires

RÈGLES ABSOLUES :
- Cite la réponse de l'étudiant mot pour mot avant d'évaluer — jamais de reformulation approximative
- Si incomplet : guide sans donner la réponse → "Vous y êtes presque — quelle est l'exception à cette règle ?"
- Si juste : "Exactement. Maintenant, cas plus complexe : [question avancée qui découle logiquement]"
- Si faux : "Non, attention — reprenons. La définition exacte est [X]. Pouvez-vous me donner un exemple maintenant ?"
- Développe tes corrections avec des références précises (article de loi, auteur, date, chiffre)
- 5 à 7 phrases minimum. Ton pédagogue, exigeant mais encourageant.`,
      welcome:"Bonjour. Je suis Madame Lambert. Installez-vous — chaque matière est valable si vous la maîtrisez vraiment. Dites-moi d'abord : quelle est votre filière, quel est votre niveau actuel, et sur quel sujet souhaitez-vous être interrogé en priorité ? Si vous n'avez pas de préférence, je choisirai moi-même en fonction de ce que vous venez de me dire. Je veux aussi que vous sachiez : je serai exigeante, mais juste. Si vous faites une erreur, je vous expliquerai pourquoi et comment rectifier. C'est ça, un vrai examen oral."
    },
    pitch: {
      title:"Pitch commercial",emoji:"💡",color:"#16A34A",voiceGender:"M",
      systemPrompt:`Tu es Alexandre Martin, Partner chez un fonds de VC européen (200M€, 50+ investissements réussis dont 3 licornes). Tu as vu plus de 5 000 pitches en 12 ans. Tu sais exactement où sont les mensonges, les rêves, et les vrais business. Tu es occupé, tu n'as pas le temps pour le flou, mais tu es juste et tu reconnais quand quelque chose est vraiment solide.

FRAMEWORK D'ÉVALUATION PROGRESSIF (approfondi à chaque réplique) :
1. PROBLÈME RÉEL : Est-ce un vrai problème ou un problème imaginé ? Combien de personnes le vivent réellement, et comment le sais-tu ? As-tu fait des interviews clients ?
2. MARCHÉ (TAM/SAM/SOM) : Donne-moi des chiffres sourcés, pas inventés. Quelle est la taille du marché réellement adressable ? Quel est ton marché initial précis ?
3. SOLUTION ET DIFFÉRENCIATION : Pourquoi ta solution est-elle 10x meilleure que l'existant ? Qu'est-ce que Google, Amazon ou un concurrent avec 50M€ ne peut pas copier dans 18 mois ?
4. MODÈLE ÉCONOMIQUE : LTV, CAC, payback period, marge brute — ces chiffres existent ? Quel est ton ticket moyen ? Récurrent ou one-shot ?
5. TRACTION RÉELLE : MRR, ARR, croissance MoM, churn rate, NPS — des chiffres réels, pas des projections optimistes
6. ÉQUIPE : Pourquoi VOUS sur ce marché précis ? Quelle expertise unfair advantage avez-vous que personne d'autre n'a ?
7. MOAT (FOSSÉ CONCURRENTIEL) : Dans 3 ans, un concurrent lève 20M€ et copie tout. Qu'est-ce qui fait que vous survivez ?

TECHNIQUES D'INVESTISSEUR :
- Cite l'argument du fondateur, identifie la faille PRINCIPALE, pose la question qui dérange
- Sois sceptique mais honnête : si un point est vraiment solide → "Ça c'est bien vu — mais maintenant..."
- Pression réaliste : "J'ai 3 autres pitches cet après-midi et un board demain matin"
- Réfute les clichés startup : "Uber de X" "disruption" "on va changer le monde" → "Montrez-moi les chiffres"

RÈGLES ABSOLUES :
- Développe vraiment ton analyse : explique POURQUOI la faille est critique pour les investisseurs
- Donne des références sectorielles réelles (multiples de valorisation, comparables cotés, tendances marché)
- 5 à 7 phrases minimum. Ton direct, sans filtre, mais constructif.`,
      welcome:"Vous avez 5 minutes — je ne lis pas les decks pendant les pitches, ça distrait. Commencez directement : quel est le problème précis, pour qui exactement (persona détaillé), et pourquoi maintenant — quel changement dans le monde rend ce problème urgent et solvable aujourd'hui alors qu'il ne l'était pas il y a 3 ans ?"
    },
    secu: {
      title:"Ingénierie sociale",emoji:"🛡️",color:"#7C3AED",voiceGender:"M",
      systemPrompt:`Tu es Thomas Renaud, expert red team et ingénierie sociale pour des entreprises du CAC 40 (BNP, Airbus, LVMH). Tu formes les employés à reconnaître et résister à toutes les formes d'attaques psychologiques. Tu as une double expertise : attaquant (tu connais toutes les techniques) et défenseur (tu sais exactement quoi dire pour bloquer).

MODE 1 — ATTAQUE RÉALISTE (tu joues l'attaquant avec la psychologie exacte qu'un vrai attaquant utiliserait) :
Scénarios réels et psychologie détaillée :
- Vishing bancaire urgent : urgence artificielle + autorité (banque) + peur (fraude, argent)
- Faux IT support : autorité technique + peur de perdre accès + urgence (mise à jour critique)
- Pretexting DRH/paie : confiance (service interne) + routine administrative + sensibilité salariale
- Phishing PDG / arnaque au président : hiérarchie + confidentialité + urgence + isolement de la victime
- Faux prestataire physique : plausibilité (maintenance planifiée) + badge + tenue professionnelle
- Compromission email : mail légèrement modifié, lien malveillant, urgence documentaire

MODE 2 — DÉBRIEFING COMPLET (après chaque réponse, que l'utilisateur réussisse ou échoue) :
- Si résiste correctement : nommer la technique exacte utilisée + expliquer pourquoi 70% des gens cèdent quand même + donner 2 signaux d'alerte supplémentaires à connaître
- Si cède ou hésite : expliquer précisément quel biais psychologique a été exploité (autorité, urgence, peur, réciprocité, rareté) + ce qu'il aurait fallu répondre + comment vérifier indépendamment
- Escalade progressive : si l'utilisateur résiste, augmente la pression avec une objection réaliste

RÈGLES ABSOLUES :
- Développe vraiment les explications psychologiques et techniques — nomme les biais, cite des cas réels de cyberattaques
- Alterne attaque et coaching approfondi — l'objectif est l'apprentissage réel
- 5 à 7 phrases minimum, dont au moins 2 d'explication psychologique ou technique.`,
      welcome:"Formation cybersécurité humaine — je suis Thomas Renaud, red team. Mon travail : vous rendre imperméable aux attaques d'ingénierie sociale. On va simuler des scénarios réels utilisés contre des employés de grandes entreprises françaises. Votre mission : les identifier, les bloquer, et comprendre POURQUOI ils fonctionnent. Scénario 1 — votre téléphone sonne : « Bonjour, je suis Nicolas du service sécurité informatique de votre banque. Nous avons détecté une connexion suspecte depuis la Roumanie il y a 12 minutes sur votre compte. Pour bloquer immédiatement l'accès frauduleux, j'ai besoin de valider votre identité — confirmez-moi votre mot de passe bancaire actuel. » — Que répondez-vous, et pourquoi ?"
    },
    prise: {
      title:"Prise de parole publique",emoji:"🎤",color:T.blueB,voiceGender:"F",
      systemPrompt:`Tu es Sophie Girard, coach en éloquence et rhétorique de niveau international. Ancienne présentatrice TV, tu formes des ministres, des PDG, des candidats politiques et des avocats depuis 15 ans. Tu es reconnue comme l'une des meilleures coachs d'éloquence en France. Tu es bienveillante mais sans complaisance — tu dis la vérité, toujours.

COMPÉTENCES QUE TU TRAVAILLES EN PROFONDEUR (une par échange, développée vraiment) :

1. ACCROCHE PERCUTANTE : Les 15 premières secondes décident tout. Techniques : anecdote personnelle qui crée l'empathie, chiffre-choc qui surprend, question rhétorique qui engage, citation d'autorité bien choisie, silence calculé avant le premier mot. Analyse exactement ce que l'utilisateur propose et explique pourquoi ça marche ou pas.

2. STRUCTURE NARRATIVE : Plan 3 en 3 (intro/3 points/conclusion), pyramide inversée (conclusion d'abord pour les décideurs), structure problème/solution/bénéfice (pour le commercial). Explique quelle structure correspond le mieux au contexte de l'utilisateur.

3. RYTHME ET SILENCE : Silence de 2 secondes avant le point le plus important. Ralentissement sur les messages clés. Accélération sur les listes. Respiration abdominale avant les phrases longues. Donne des exercices concrets.

4. REGARD ET PRÉSENCE : Balayage 3 zones (gauche/centre/droite). Un visage par idée. Contact 3-4 secondes minimum. Ancrage physique (pieds à l'aplomb des épaules, gravité basse). Gestes ouverts vs fermés.

5. VOIX ET PROJECTION : Diaphragme vs poitrine. Placement de la voix. Montée sur les questions, descente sur les affirmations. Variation de volume (chuchotement = force). Travail sur les nasales et les consonnes.

6. GESTION DU TRAC : Trac = adrénaline reconvertie. Techniques : respiration 4-7-8, ancrage kinesthésique, visualisation, arrivée 30 min avant, reconnaissance de l'espace, mouvement physique juste avant.

7. RHÉTORIQUE ET PERSUASION : Ethos (crédibilité), Pathos (émotion), Logos (logique) — Aristote. Techniques modernes : AIDA, storytelling en 3 actes, répétition rhétorique (anaphore), concession stratégique.

RÈGLES ABSOLUES :
- Évalue PRÉCISÉMENT ce que l'utilisateur vient de formuler — cite ses mots exacts
- Identifie UN point fort spécifique et UN point faible précis avec explication
- Donne un exercice ACTIONNABLE : "Reformulez cette phrase en commençant par [X]" ou "Entraînez-vous à faire X pendant 2 minutes"
- Chaque feedback différent du précédent — jamais le même conseil deux fois de suite
- 5 à 7 phrases minimum. Ton dynamique, encourageant mais exigeant.`,
      welcome:"Bienvenue dans votre coaching d'éloquence. Je suis Sophie Girard. Avant de commencer, j'ai besoin de comprendre votre situation précise : quel est l'enjeu de votre prochaine prise de parole — réunion stratégique, discours public, concours d'éloquence, entretien, conférence ? Quel est votre public ? Et surtout, quel est votre PRINCIPAL blocage en ce moment — peur du regard des autres, manque de structure, voix qui tremble, blanc mémoriel, gestion du temps ? Plus vous êtes précis, plus le coaching sera ciblé et efficace."
    },
    tutorat: {
      title:"Cours magistral",emoji:"📚",color:"#D97706",voiceGender:"M",
      systemPrompt:`Tu es le Professeur Martin, enseignant-chercheur avec 25 ans d'expérience. Tu as enseigné dans plusieurs grandes universités françaises et tu es capable de vulgariser n'importe quel sujet sans le vider de sa substance. Tu t'adaptes parfaitement au niveau de l'apprenant — du lycéen au doctorant.

MÉTHODE PÉDAGOGIQUE RIGOUREUSE :
1. Réponds DIRECTEMENT à la question avec de la valeur immédiate — jamais d'introduction générique
2. Structure toujours : 1 concept clairement défini + 1 analogie concrète du quotidien + 1 exemple réel avec chiffre ou date précis + 1 implication ou application pratique
3. Fais des liens avec d'autres disciplines si pertinent (une loi économique qui s'explique par la psychologie, un fait historique qui éclaire un enjeu juridique...)
4. Termine par UNE question d'approfondissement ou de compréhension DIFFÉRENTE à chaque fois
5. Si erreur de l'apprenant : "Attention — [correction directe] — voici pourquoi cette confusion est fréquente et comment la retenir"

DOMAINES MAÎTRISÉS AVEC FAITS PRÉCIS :
- Histoire : dates exactes, noms d'acteurs, causes profondes/immédiates, conséquences à CT/MT/LT, comparaisons entre périodes
- Philosophie : thèses précises et contexte de chaque auteur, opposition entre courants, applications contemporaines
- Économie : chiffres INSEE/BCE/FMI actuels, mécanismes micro/macro avec exemples réels, théories avec critiques
- Droit : articles de loi précis, jurisprudences clés, logique du raisonnement juridique (faits → qualification → règle → conséquence)
- Sciences : principes fondamentaux + applications concrètes + découvertes récentes + implications sociétales
- Géopolitique : alliances actuelles avec dates, conflits en cours avec contexte complet, doctrines nationales, organisations internationales
- Littérature : œuvres avec contexte, thèmes, style, biographie d'auteur utile, analyse de passages
- Mathématiques : démonstrations pas à pas, intuition visuelle, applications concrètes, pièges classiques

RÈGLES ABSOLUES :
- JAMAIS "c'est une bonne question" ou "intéressant" seul — va DIRECTEMENT au contenu riche
- JAMAIS de réponse générique — toujours un fait précis, une date, un nom propre, un chiffre
- Style dynamique et oral, comme si tu expliquais à voix haute devant un tableau
- 6 à 8 phrases minimum, denses en information réelle et utile.`,
      welcome:"Bonjour ! Professeur Martin, enchanté. Je m'adapte à n'importe quel sujet et n'importe quel niveau — de la terminale au master, de la philosophie aux mathématiques. Pour bien calibrer, dites-moi deux choses : quel est le sujet ou la question qui vous résiste en ce moment, et quel est votre niveau actuel ? Je vous promets une réponse directe, dense, et utile — pas un résumé Wikipédia. On commence."
    },
  };
  if(mode==="trial"&&trialRole&&trialTopic){
    return <TrialSimScreen key="trial" trialRole={trialRole} trialTopic={trialTopic} T={T} onBack={()=>setMode("home")}/>;
  }
  if(mode in SIM_CONFIGS && mode!=="elections" && !(mode==="un"&&(!unRole||!unTopic))){
    const cfg=SIM_CONFIGS[mode];
    return <GenericSimScreen key={mode} title={cfg.title} emoji={cfg.emoji} color={cfg.color} systemPrompt={cfg.systemPrompt} welcome={cfg.welcome} voiceGender={cfg.voiceGender} T={T} onBack={()=>setMode("home")}/>;
  }

  if(mode==="elections"){
    const total=CANDIDATES.reduce((a,c)=>a+c.poll,0);
    return(
      <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{setMode("home");setVoted(null);}} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={22} c={T.textD}/></button>
          <div><p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Simulation</p><h2 style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:22,fontWeight:800,color:T.text}}>Élections virtuelles</h2></div>
        </div>
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,textAlign:"center"}}>
          <p style={{color:T.text,fontWeight:700,fontSize:14,marginBottom:4}}>Présidentielle virtuelle NEXUS 2025</p>
          <p style={{color:T.muted,fontSize:12}}>Sondage temps réel · {(total*100).toFixed(0)} votes</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {CANDIDATES.map(c=>(
            <div key={c.id} style={{background:T.card,border:`1.5px solid ${voted===c.id?c.color:T.b1}`,borderRadius:14,padding:16,transition:"all .2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <Avatar init={c.init} size={44} T={T} color={c.color}/>
                <div style={{flex:1}}>
                  <p style={{color:T.text,fontWeight:700,fontSize:14}}>{c.name}</p>
                  <p style={{color:T.textD,fontSize:12}}>{c.party}</p>
                </div>
                <span style={{color:c.color,fontSize:22,fontWeight:900,fontFamily:"monospace"}}>{c.poll}%</span>
              </div>
              <p style={{color:T.muted,fontSize:12,marginBottom:12,lineHeight:1.5}}>{c.prog}</p>
              <div style={{height:6,background:T.b1,borderRadius:3,marginBottom:12,overflow:"hidden"}}><div style={{height:"100%",width:`${c.poll}%`,background:c.color,borderRadius:3,transition:"width 1s ease"}}/></div>
              <button onClick={()=>setVoted(c.id)} disabled={!!voted} style={{width:"100%",padding:"10px",borderRadius:10,border:`1px solid ${voted===c.id?c.color:T.b1}`,background:voted===c.id?`${c.color}15`:"transparent",color:voted===c.id?c.color:T.textD,fontSize:13,fontWeight:700,cursor:voted?"not-allowed":"pointer",fontFamily:"inherit"}}>
                {voted===c.id?"✓ Vote enregistré":"Voter pour ce candidat"}
              </button>
            </div>
          ))}
        </div>
        {voted&&<div style={{background:`${T.green}15`,border:`1px solid ${T.green}40`,borderRadius:12,padding:16,textAlign:"center"}}><p style={{color:T.green,fontWeight:800,fontSize:14}}>Vote enregistré avec succès</p><p style={{color:T.textD,fontSize:12,marginTop:4}}>Résultats mis à jour en temps réel</p></div>}
      </div>
    );
  }

  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Simulations IA</p>
        <h1 style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:28,fontWeight:800,color:T.text}}>Simulateur</h1>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[
          {id:"un",icon:"globe",label:"Simulation ONU",sub:"Conseil de Sécurité",color:T.blueB},
          {id:"trial",icon:"scale",label:"Procès fictif",sub:"Avocat ou Procureur",color:T.purple},
          {id:"interview",icon:"brief",label:"Entretien RH",sub:"Coaching carrière",color:T.green},
          {id:"soutenance",icon:"award",label:"Soutenance orale",sub:"Thèse / Projet",color:"#D97706"},
          {id:"examen",icon:"star",label:"Examen oral",sub:"Jury académique",color:"#E03535"},
          {id:"pitch",icon:"zap",label:"Pitch commercial",sub:"Investisseurs / Clients",color:"#16A34A"},
          {id:"secu",icon:"shield",label:"Ingénierie sociale",sub:"Cybersécurité humaine",color:"#7C3AED"},
          {id:"prise",icon:"users",label:"Prise de parole",sub:"Discours public",color:T.blueB},
          {id:"tutorat",icon:"info",label:"Cours magistral",sub:"Enseigner un sujet",color:"#D97706"},
        ].map(sim=>(
          <button key={sim.id} onClick={()=>setMode(sim.id as typeof mode)} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,cursor:"pointer",textAlign:"left",transition:"all .2s",display:"flex",flexDirection:"column",gap:10}}
            onMouseEnter={e=>(e.currentTarget.style.border=`1px solid ${sim.color}40`)}
            onMouseLeave={e=>(e.currentTarget.style.border=`1px solid ${T.b1}`)}>
            <div style={{width:40,height:40,borderRadius:10,background:`${sim.color}15`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Ic n={sim.icon} s={20} c={sim.color}/>
            </div>
            <div>
              <p style={{color:T.text,fontWeight:700,fontSize:13}}>{sim.label}</p>
              <p style={{color:T.muted,fontSize:11,marginTop:3}}>{sim.sub}</p>
            </div>
          </button>
        ))}
      </div>
      {/* UN setup */}
      {mode==="un"&&(
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:14}}>
          <p style={{color:T.text,fontWeight:700,fontSize:15}}>🌐 Choisir votre délégation</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {UN_DEL.map(d=>(
              <button key={d.id} onClick={()=>setUnRole(d)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${unRole?.id===d.id?T.blueB:T.b1}`,background:unRole?.id===d.id?T.blueG:T.bg2,cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:22}}>{d.flag}</span>
                <div style={{flex:1}}>
                  <p style={{color:T.text,fontWeight:700,fontSize:13}}>{d.country}</p>
                  <p style={{color:T.muted,fontSize:11}}>{d.doctrine.slice(0,55)}…</p>
                </div>
                {unRole?.id===d.id&&<Ic n="check" s={16} c={T.blueB}/>}
              </button>
            ))}
          </div>
          <p style={{color:T.text,fontWeight:700,fontSize:13}}>Sujet de résolution</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {UN_TOPICS.map(t=>(
              <button key={t} onClick={()=>setUnTopic(t)} style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${unTopic===t?T.blueB:T.b1}`,background:unTopic===t?T.blueG:T.bg2,cursor:"pointer",textAlign:"left",color:unTopic===t?T.blueB:T.text,fontSize:13,fontFamily:"inherit",fontWeight:unTopic===t?700:400}}>{t}</button>
            ))}
          </div>
          <button onClick={()=>{if(unRole&&unTopic)setMode("un");}} disabled={!unRole||!unTopic} style={{padding:14,borderRadius:12,border:"none",background:unRole&&unTopic?T.blueB:T.b1,color:unRole&&unTopic?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:unRole&&unTopic?"pointer":"not-allowed",fontFamily:"inherit"}}>Ouvrir la session</button>
        </div>
      )}
      {/* Trial setup */}
      {mode==="trial"&&(
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:14}}>
          <p style={{color:T.text,fontWeight:700,fontSize:15}}>⚖️ Procès fictif</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[{id:"defense",label:"Avocat de la défense",icon:"shield"},{id:"prosecutor",label:"Procureur",icon:"flag"}].map(r=>(
              <button key={r.id} onClick={()=>setTrialRole(r.id as "defense"|"prosecutor")} style={{padding:14,borderRadius:10,border:`1.5px solid ${trialRole===r.id?T.purple:T.b1}`,background:trialRole===r.id?`${T.purple}10`:T.bg2,cursor:"pointer",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                <Ic n={r.icon} s={22} c={trialRole===r.id?T.purple:T.textD}/>
                <span style={{color:trialRole===r.id?T.purple:T.text,fontSize:12,fontWeight:700}}>{r.label}</span>
              </button>
            ))}
          </div>
          <p style={{color:T.text,fontWeight:700,fontSize:13}}>Dossier</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {TRIAL_TOPICS.map(t=>(
              <button key={t} onClick={()=>setTrialTopic(t)} style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${trialTopic===t?T.purple:T.b1}`,background:trialTopic===t?`${T.purple}10`:T.bg2,cursor:"pointer",textAlign:"left",color:trialTopic===t?T.purple:T.text,fontSize:13,fontFamily:"inherit",fontWeight:trialTopic===t?700:400}}>{t}</button>
            ))}
          </div>
          <button onClick={()=>{if(trialRole&&trialTopic)setMode("trial");}} style={{padding:14,borderRadius:12,border:"none",background:trialRole&&trialTopic?T.purple:T.b1,color:trialRole&&trialTopic?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:trialRole&&trialTopic?"pointer":"not-allowed",fontFamily:"inherit"}}>Ouvrir l&apos;audience</button>
        </div>
      )}
      {/* Interview setup */}
      {mode==="interview"&&(
        <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:14}}>
          <p style={{color:T.text,fontWeight:700,fontSize:15}}>💼 Simulation entretien</p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {JOBS.map((j,i)=>(
              <div key={i} style={{padding:"12px",borderRadius:10,background:T.bg2,border:`1px solid ${T.b1}`}}>
                <p style={{color:T.text,fontWeight:700,fontSize:13}}>{j.title}</p>
                <p style={{color:T.textD,fontSize:12,marginTop:2}}>{j.co}</p>
                <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                  {j.tags.map(tag=><Tag key={tag} label={tag} color={T.blueB} small/>)}
                </div>
                <button onClick={()=>setMode("interview")} style={{width:"100%",marginTop:10,padding:"8px",borderRadius:8,border:`1px solid ${T.blueB}`,background:T.blueG,color:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>S&apos;entraîner pour ce poste</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* One-click start for other sims */}
      {(["soutenance","examen","pitch","secu","prise","tutorat"] as const).map(s=>{
        if(mode!==s)return null;
        const info:{[k:string]:{emoji:string;color:string;desc:string}} = {
          soutenance:{emoji:"🎓",color:"#D97706",desc:"Le jury vous écoute. Présentez votre sujet et défendez vos choix."},
          examen:{emoji:"📝",color:"#E03535",desc:"L'examinateur est prêt. Choisissez votre matière et commencez."},
          pitch:{emoji:"💡",color:"#16A34A",desc:"L'investisseur vous écoute. Présentez votre projet en 5 minutes."},
          secu:{emoji:"🛡️",color:"#7C3AED",desc:"Session de sensibilisation à l'ingénierie sociale. Cadre éducatif uniquement."},
          prise:{emoji:"🎤",color:T.blueB,desc:"Coaching prise de parole. Présentez votre discours pour l'analyser."},
          tutorat:{emoji:"📚",color:"#D97706",desc:"Cours magistral personnalisé. Choisissez n'importe quel sujet."},
        };
        const cfg=info[s];
        return(
          <div key={s} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:28}}>{cfg.emoji}</span>
              <p style={{color:T.text,fontWeight:700,fontSize:14}}>{cfg.desc}</p>
            </div>
            <button onClick={()=>setMode(s)} style={{padding:13,borderRadius:12,border:"none",background:cfg.color,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Démarrer la simulation</button>
          </div>
        );
      })}
    </div>
  );
}

// ── PROFILE SCREEN ────────────────────────────────────────────
function ProfileScreen({T,onPremium,isAdmin}:{T:Theme;onPremium:()=>void;isAdmin:boolean}) {
  const [activeTab,setActiveTab] = useState<"posts"|"score"|"badges">("posts");
  const scores:{[k:string]:number} = {"Géopolitique":82,"Droit":68,"Diplomatie":75,"Histoire":88,"Institutions":61};
  type UserPost = {id:number;text:string;time:string;src:string;verif:{label:string;color:string;comment:string}|null};
  const [userPosts] = useState<UserPost[]>(()=>{
    if(typeof window==="undefined") return [];
    try{return JSON.parse(localStorage.getItem("nexus_posts")||"[]");}catch{return [];}
  });
  const postCount = userPosts.length;
  const xp = getXP();
  const lvl = levelInfo(xp);

  return(
    <div>
      <div style={{height:100,background:`linear-gradient(135deg,${T.blueB}30,${T.purple}20)`,position:"relative"}}>
        <div style={{position:"absolute",bottom:-28,left:20}}>
          <div style={{width:62,height:62,borderRadius:"50%",background:T.blueG,border:`3px solid ${T.bg}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,color:T.blueB}}>A</div>
        </div>
        <div style={{position:"absolute",top:12,right:16}}>
          <button style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:8,padding:"6px 12px",color:T.textD,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
            <Ic n="settings" s={14} c={T.textD}/>Modifier
          </button>
        </div>
      </div>
      <div style={{padding:"36px 20px 16px"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <h2 style={{color:T.text,fontSize:20,fontWeight:800}}>Arcajus Auguste</h2>
              <span style={{background:`${T.blueB}20`,color:T.blueB,fontSize:10,padding:"2px 6px",borderRadius:4,fontWeight:800}}>✓ VÉRIFIÉ</span>
            </div>
            <p style={{color:T.textD,fontSize:13,marginTop:2}}>@arcajus · Marseille, France</p>
            <p style={{color:T.textD,fontSize:13,marginTop:6,lineHeight:1.5}}>Citoyen du monde · Passionné de géopolitique et diplomatie · Fondateur NEXUS</p>
          </div>
        </div>
        <div style={{display:"flex",gap:20,marginTop:16}}>
          {[["284","Abonnés"],["1,2k","Followers"],[String(47+postCount),"Débats"],["82","Score"]].map(([v,l])=>(
            <div key={l} style={{textAlign:"center"}}>
              <p style={{color:T.text,fontWeight:800,fontSize:16}}>{v}</p>
              <p style={{color:T.muted,fontSize:11}}>{l}</p>
            </div>
          ))}
        </div>
        {isAdmin&&<ApiKeySettings T={T}/>}
        <button onClick={onPremium} style={{width:"100%",marginTop:12,padding:"12px",borderRadius:12,border:`1px solid ${T.amber}50`,background:`${T.amber}10`,color:T.amber,fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <Ic n="zap" s={16} c={T.amber}/>Passer à NEXUS+ — 5,99€/mois
        </button>
      </div>
      <div style={{borderTop:`1px solid ${T.b1}`,display:"flex"}}>
        {[{id:"posts",label:"Publications"},{id:"score",label:"Score"},{id:"badges",label:"Badges"}].map(tab=>(
          <button key={tab.id} onClick={()=>setActiveTab(tab.id as "posts"|"score"|"badges")} style={{flex:1,padding:"12px 0",border:"none",background:"transparent",borderBottom:`2px solid ${activeTab===tab.id?T.blueB:"transparent"}`,color:activeTab===tab.id?T.blueB:T.textD,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}}>{tab.label}</button>
        ))}
      </div>
      <div style={{padding:"16px 20px"}}>
        {activeTab==="posts"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {userPosts.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <p style={{color:T.muted,fontSize:14}}>Aucune publication pour l&apos;instant</p>
                <p style={{color:T.muted,fontSize:12,marginTop:4}}>Partagez votre première analyse dans le Feed</p>
              </div>
            )}
            {userPosts.map(p=>(
              <div key={p.id} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
                <p style={{color:T.text,fontSize:13,fontWeight:600,lineHeight:1.5}}>{p.text}</p>
                {p.verif&&<span style={{display:"inline-block",marginTop:6,background:`${p.verif.color}20`,color:p.verif.color,fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:800}}>✦ {p.verif.label}</span>}
                <div style={{display:"flex",gap:12,marginTop:10}}>
                  <span style={{color:T.muted,fontSize:12,display:"flex",alignItems:"center",gap:4}}><Ic n="heart" s={14} c={T.muted}/>0</span>
                  <span style={{color:T.muted,fontSize:12,display:"flex",alignItems:"center",gap:4}}><Ic n="comment" s={14} c={T.muted}/>0</span>
                  <span style={{color:T.muted,fontSize:11,marginLeft:"auto"}}>{p.time}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {activeTab==="score"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:20,textAlign:"center"}}>
              <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Score global d&apos;éloquence</p>
              <span style={{fontSize:52,fontWeight:900,color:T.blueB,fontFamily:"monospace"}}>78</span>
              <p style={{color:T.textD,fontSize:13,marginTop:4}}>/100 · Rang #127 mondial</p>
            </div>
            {Object.entries(scores).map(([k,v])=>(
              <div key={k} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{color:T.text,fontWeight:600,fontSize:13}}>{k}</span>
                  <span style={{color:v>=80?T.green:v>=65?T.blueB:T.amber,fontWeight:800,fontSize:13}}>{v}/100</span>
                </div>
                <div style={{height:6,background:T.b1,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${v}%`,background:v>=80?T.green:v>=65?T.blueB:T.amber,borderRadius:3}}/></div>
              </div>
            ))}
          </div>
        )}
        {activeTab==="badges"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {getStreak()>0&&<div style={{background:`${T.amber}10`,border:`1px solid ${T.amber}30`,borderRadius:14,padding:14,display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:26}}>🔥</span>
              <div>
                <p style={{color:T.amber,fontWeight:800,fontSize:15}}>{getStreak()} jour{getStreak()>1?"s":""} de suite</p>
                <p style={{color:T.muted,fontSize:12,marginTop:2}}>Continue comme ça !</p>
              </div>
            </div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            {[{icon:"award",label:"Top débatteur",c:T.amber},{icon:"globe",label:"Diplomate",c:T.blueB},{icon:"scale",label:"Juriste",c:T.purple},{icon:"star",label:"Contributeur",c:T.green},{icon:"trending",label:"Viral",c:T.red},{icon:"shield",label:"Modérateur",c:T.textD}].map(b=>(
              <div key={b.label} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:"16px 8px",textAlign:"center"}}>
                <div style={{width:40,height:40,borderRadius:10,background:`${b.c}15`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 8px"}}>
                  <Ic n={b.icon} s={20} c={b.c}/>
                </div>
                <p style={{color:T.text,fontSize:11,fontWeight:700}}>{b.label}</p>
              </div>
            ))}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PREMIUM SCREEN ────────────────────────────────────────────
function PremiumScreen({T,onBack}:{T:Theme;onBack:()=>void}) {
  const plans = [
    {id:"free",name:"Gratuit",price:"0€",sub:"Pour toujours",features:["3 débats / mois","Journalistes Novice & Initié","Feed d'actualité","Score de base"],highlight:false,cta:"Plan actuel"},
    {id:"plus",name:"NEXUS+",price:"5,99€",sub:"/mois",features:["Débats illimités","Tous niveaux sauf Élite","Simulation ONU & Procès","Score détaillé","Classement mondial"],highlight:true,cta:"Commencer l'essai gratuit 7j"},
    {id:"pro",name:"NEXUS Pro",price:"14,99€",sub:"/mois",features:["Tout NEXUS+","Niveau Élite (Ministre)","Coaching personnalisé IA","Replay & analyse","Certification NEXUS"],highlight:false,cta:"Choisir Pro"},
    {id:"institution",name:"Institution",price:"299€",sub:"/mois",features:["Tout NEXUS Pro","Tableau de bord profs","Licences étudiants illimitées","Parcours concours (Sciences Po, ENA…)","Support dédié"],highlight:false,cta:"Contacter les ventes"},
  ];
  return(
    <div style={{padding:"16px 20px 32px"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={22} c={T.textD}/></button>
        <div><p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Abonnement</p><h2 style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:24,fontWeight:800,color:T.text}}>Choisir votre plan</h2></div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {plans.map(p=>(
          <div key={p.id} style={{background:T.card,border:`2px solid ${p.highlight?T.blueB:T.b1}`,borderRadius:16,padding:20,position:"relative",overflow:"hidden"}}>
            {p.highlight&&<div style={{position:"absolute",top:0,right:0,background:T.blueB,padding:"4px 14px",borderRadius:"0 14px 0 12px",fontSize:10,fontWeight:800,color:"#fff",letterSpacing:1}}>POPULAIRE</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <p style={{color:T.text,fontWeight:800,fontSize:16}}>{p.name}</p>
                <div style={{display:"flex",alignItems:"baseline",gap:4,marginTop:4}}>
                  <span style={{color:p.highlight?T.blueB:T.text,fontSize:26,fontWeight:900,fontFamily:"monospace"}}>{p.price}</span>
                  <span style={{color:T.muted,fontSize:12}}>{p.sub}</span>
                </div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
              {p.features.map(f=>(
                <div key={f} style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:16,height:16,borderRadius:"50%",background:`${T.green}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <Ic n="check" s={10} c={T.green} w={2.5}/>
                  </div>
                  <span style={{color:T.textD,fontSize:13}}>{f}</span>
                </div>
              ))}
            </div>
            <button style={{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${p.highlight?T.blueB:T.b1}`,background:p.highlight?T.blueB:T.blueG,color:p.highlight?"#fff":T.blueB,fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>{p.cta}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── HAPTIC ───────────────────────────────────────────────────
function haptic(ms=8){if(typeof navigator!=="undefined"&&navigator.vibrate)navigator.vibrate(ms);}

// ── INSTALL BANNER ────────────────────────────────────────────
function InstallBanner({T,onDismiss}:{T:Theme;onDismiss:()=>void}) {
  const isIOS = typeof window!=="undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());
  return(
    <div style={{background:`linear-gradient(135deg,${T.blueB}18,${T.purple}10)`,borderBottom:`1px solid ${T.blueB}30`,padding:"10px 16px",display:"flex",alignItems:"center",gap:10,animation:"fadeUp .4s ease",flexShrink:0}}>
      <div style={{width:38,height:38,borderRadius:10,background:"#000",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:"1px solid #333"}}>
        <span style={{color:"#fff",fontWeight:900,fontSize:18,fontFamily:"'Inter',system-ui,sans-serif"}}>N</span>
      </div>
      <div style={{flex:1}}>
        <p style={{color:T.text,fontSize:13,fontWeight:800}}>Installer NEXUS</p>
        {isIOS
          ? <p style={{color:T.textD,fontSize:11,marginTop:2}}>Appuyez sur <span style={{color:T.blueB,fontWeight:700}}>⬆ Partager</span> → &quot;Sur l&apos;écran d&apos;accueil&quot;</p>
          : <p style={{color:T.textD,fontSize:11,marginTop:2}}>Menu navigateur → <span style={{color:T.blueB,fontWeight:700}}>Installer l&apos;application</span></p>
        }
      </div>
      <button onClick={onDismiss} style={{background:"none",border:"none",cursor:"pointer",padding:6,flexShrink:0,borderRadius:8}}><Ic n="x" s={16} c={T.textD}/></button>
    </div>
  );
}

// ── ROOT APP ──────────────────────────────────────────────────
export default function NexusApp() {
  const [dark,setDark] = useState(true);
  const T = dark ? DARK : LIGHT;
  const [tab,setTab] = useState<"feed"|"simulation"|"messages"|"events"|"profile">("feed");
  const [showPremium,setShowPremium] = useState(false);
  const [showInstall,setShowInstall] = useState(false);
  const [tabAnim,setTabAnim] = useState("fadeIn");
  const [feedUnread,setFeedUnread] = useState(()=>{
    if(typeof window==="undefined") return 0;
    return parseInt(localStorage.getItem("nexus_unread")||"0");
  });
  const [adminTaps,setAdminTaps] = useState(0);
  const [showAdminPin,setShowAdminPin] = useState(false);
  const [isAdmin,setIsAdmin] = useState(()=>typeof window!=="undefined"&&localStorage.getItem("nexus_admin")==="1");
  const [streak,setStreak] = useState(0);
  const [feedKey,setFeedKey] = useState(0);

  useEffect(()=>{
    if(typeof window==="undefined") return;
    const envG = process.env.NEXT_PUBLIC_GEMINI_KEY;
    const envE = process.env.NEXT_PUBLIC_EL_KEY;
    if(envG && !localStorage.getItem("gemini_key")) localStorage.setItem("gemini_key",envG);
    if(envE && !localStorage.getItem("el_key")) localStorage.setItem("el_key",envE);
    setStreak(updateStreak());
  },[]);

  useEffect(()=>{
    if(typeof window==="undefined") return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as {standalone?:boolean}).standalone===true;
    const dismissed = localStorage.getItem("install_dismissed");
    if(!standalone && !dismissed) setTimeout(()=>setShowInstall(true),2000);
  },[]);

  const handleLogoTap=()=>{
    const n=adminTaps+1;
    setAdminTaps(n);
    if(n>=5){setAdminTaps(0);setShowAdminPin(true);}
  };

  const switchTab = (id: typeof tab) => {
    haptic();
    setTabAnim("slideInRight");
    setTab(id);
    if(id==="feed"){setFeedUnread(0);setFeedKey(k=>k+1);if(typeof window!=="undefined")localStorage.setItem("nexus_unread","0");}
    setTimeout(()=>setTabAnim("fadeIn"),300);
  };

  const handleNewPosts = (n:number)=>{
    if(tab!=="feed"){
      setFeedUnread(p=>{const next=p+n;if(typeof window!=="undefined")localStorage.setItem("nexus_unread",String(next));return next;});
    }
  };

  const NAV = [
    {id:"feed",icon:"feed",label:"ACTU"},
    {id:"simulation",icon:"zap",label:"SIMUL."},
    {id:"messages",icon:"msg",label:"MSG"},
    {id:"events",icon:"cal",label:"AGENDA"},
    {id:"profile",icon:"user",label:"PROFIL"},
  ];

  return(
    <div style={{background:T.bg,maxWidth:430,margin:"0 auto",fontFamily:"'Inter',system-ui,sans-serif",display:"flex",flexDirection:"column",height:"100dvh",overflow:"hidden",position:"relative"}}>
      <style>{`
        input::placeholder,textarea::placeholder{color:${T.muted};}
        @keyframes slideInRight{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
        @keyframes wave{from{height:4px}to{height:24px}}
      `}</style>

      {showAdminPin&&<AdminPinModal T={T} onClose={()=>setShowAdminPin(false)} onSuccess={()=>{setIsAdmin(true);setShowAdminPin(false);if(typeof window!=="undefined")localStorage.setItem("nexus_admin","1");}}/>}

      {/* Install banner */}
      {showInstall&&!showPremium&&(
        <InstallBanner T={T} onDismiss={()=>{setShowInstall(false);localStorage.setItem("install_dismissed","1");}}/>
      )}

      {/* Header */}
      {!showPremium&&(
        <div style={{padding:`${showInstall?10:13}px 20px 11px`,display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${T.b1}`,background:T.surf,zIndex:100,backdropFilter:"blur(20px)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}} onClick={handleLogoTap}>
            <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="50" fill="#000"/>
              <defs>
                <linearGradient id="nlg" x1="30" y1="50" x2="70" y2="50" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#FFFFFF"/>
                  <stop offset="28%" stopColor="#FFFFFF"/>
                  <stop offset="72%" stopColor="#080C14"/>
                  <stop offset="100%" stopColor="#080C14"/>
                </linearGradient>
              </defs>
              <rect x="29" y="23" width="13" height="54" fill="#FFFFFF"/>
              <rect x="58" y="23" width="13" height="54" fill="#080C14"/>
              <polygon points="42,23 58,23 58,52 42,48" fill="url(#nlg)"/>
              <polygon points="42,52 58,48 58,77 42,77" fill="url(#nlg)"/>
            </svg>
            <span style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:20,fontWeight:800,color:T.text,letterSpacing:0.5}}>NEXUS</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>{haptic();setDark(d=>!d);}} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:9,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
              <Ic n={dark?"sun":"moon"} s={16} c={T.textD}/>
            </button>
            <button style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:9,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",position:"relative"}}>
              <Ic n="bell" s={16} c={T.textD}/>
              <div style={{position:"absolute",top:7,right:7,width:7,height:7,borderRadius:"50%",background:T.red,border:`2px solid ${T.surf}`}}/>
            </button>
            <div onClick={()=>{haptic();switchTab("profile");}} style={{width:34,height:34,borderRadius:"50%",background:T.blueG,border:`1.5px solid ${T.blueB}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:T.blueB,cursor:"pointer",flexShrink:0}}>A</div>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",overflowX:"hidden"}}>
        {showPremium ? (
          <PremiumScreen T={T} onBack={()=>setShowPremium(false)}/>
        ) : (
          <div key={tab} style={{animation:`${tabAnim} .25s ease`,height:"100%"}}>
            {tab==="feed"&&<FeedScreen key={feedKey} T={T} onDebate={()=>switchTab("simulation")} onNewPosts={handleNewPosts}/>}
            {tab==="simulation"&&<SimulationHub T={T}/>}
            {tab==="messages"&&<MessagesScreen T={T}/>}
            {tab==="events"&&<EventsScreen T={T}/>}
            {tab==="profile"&&<ProfileScreen T={T} onPremium={()=>setShowPremium(true)} isAdmin={isAdmin}/>}
          </div>
        )}
      </div>

      {/* Bottom nav — with safe area */}
      {!showPremium&&(
        <div style={{background:`${T.surf}F5`,backdropFilter:"blur(24px)",borderTop:`1px solid ${T.b1}`,display:"flex",paddingTop:8,paddingBottom:`max(20px, env(safe-area-inset-bottom))`,flexShrink:0,zIndex:100}}>
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>switchTab(n.id as typeof tab)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",padding:"4px 0",transition:"transform .1s"}}>
              <div style={{width:40,height:34,borderRadius:12,background:tab===n.id?T.blueG:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s",position:"relative"}}>
                {tab===n.id&&<div style={{position:"absolute",top:-1,left:"50%",transform:"translateX(-50%)",width:20,height:3,borderRadius:2,background:T.blueB}}/>}
                <Ic n={n.icon} s={20} c={tab===n.id?T.blueB:T.muted} w={tab===n.id?2.2:1.6}/>
                {n.id==="feed"&&feedUnread>0&&tab!=="feed"&&(
                  <div style={{position:"absolute",top:2,right:4,minWidth:16,height:16,borderRadius:8,background:T.red,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:"#fff",padding:"0 3px"}}>
                    {feedUnread>9?"9+":feedUnread}
                  </div>
                )}
              </div>
              <span style={{fontSize:9,fontWeight:tab===n.id?800:600,letterSpacing:.5,color:tab===n.id?T.blueB:T.muted,transition:"color .2s"}}>{n.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
