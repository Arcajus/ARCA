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
    const isEnhanced=(v:SpeechSynthesisVoice)=>/enhanced|améliorée|amelioree|premium|neural/i.test(v.name);
    // Priorité: Apple Enhanced/Améliorée (iOS) > Google Français > Microsoft > any fr-FR
    const fr =
      (gender==="F" ? pick(v=>v.lang.startsWith("fr") && isEnhanced(v) && /marie|amelie|amélie|juliette|zoé|zoe/i.test(v.name)) : null) ||
      (gender==="M" ? pick(v=>v.lang.startsWith("fr") && isEnhanced(v) && /thomas|pierre|nicolas/i.test(v.name)) : null) ||
      pick(v=>v.lang.startsWith("fr") && isEnhanced(v)) ||
      (gender==="F" ? pick(v=>v.lang==="fr-FR" && /marie|amelie|amélie/i.test(v.name)) : null) ||
      (gender==="M" ? pick(v=>v.lang==="fr-FR" && /thomas|pierre/i.test(v.name)) : null) ||
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
// HuggingFace TTS — gratuit, sans carte bancaire, voix française (facebook/mms-tts-fra)
async function speakHF(text:string,onEnd?:()=>void):Promise<boolean>{
  if(typeof window==="undefined") return false;
  const key=localStorage.getItem("hf_token")||"";
  if(!key) return false;
  try{
    const res=await fetch("https://api-inference.huggingface.co/models/facebook/mms-tts-fra",{
      method:"POST",
      headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},
      body:JSON.stringify({inputs:cleanForSpeech(text.slice(0,400))})
    });
    if(!res.ok) return false;
    const blob=await res.blob();
    if(blob.size<100) return false;
    const url=URL.createObjectURL(blob);
    if(_hfAudio){_hfAudio.pause();_hfAudio.onended=null;}
    _hfAudio=new Audio(url);
    _hfAudio.onended=()=>{URL.revokeObjectURL(url);onEnd?.();};
    _hfAudio.onerror=()=>{URL.revokeObjectURL(url);onEnd?.();};
    await _hfAudio.play();
    return true;
  }catch{return false;}
}
async function speakAzure(text:string,gender:"M"|"F",onEnd?:()=>void):Promise<boolean>{
  if(typeof window==="undefined") return false;
  const key=localStorage.getItem("azure_tts_key")||"";
  const region=localStorage.getItem("azure_tts_region")||"eastus";
  if(!key) return false;
  try{
    const voice=gender==="F"?"fr-FR-DeniseNeural":"fr-FR-HenriNeural";
    const ssml=`<speak version='1.0' xml:lang='fr-FR'><voice name='${voice}'>${cleanForSpeech(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</voice></speak>`;
    const res=await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,{
      method:"POST",
      headers:{"Ocp-Apim-Subscription-Key":key,"Content-Type":"application/ssml+xml","X-Microsoft-OutputFormat":"audio-24khz-48kbitrate-mono-mp3"},
      body:ssml
    });
    if(!res.ok) return false;
    const blob=await res.blob();
    if(blob.size<100) return false;
    const url=URL.createObjectURL(blob);
    if(_hfAudio){_hfAudio.pause();_hfAudio.onended=null;}
    _hfAudio=new Audio(url);
    _hfAudio.onended=()=>{URL.revokeObjectURL(url);onEnd?.();};
    _hfAudio.onerror=()=>{URL.revokeObjectURL(url);onEnd?.();};
    await _hfAudio.play();
    return true;
  }catch{return false;}
}
function speakAny(text: string, gender: "M"|"F" = "F", onEnd?: ()=>void) {
  _ttsActive = true;
  const w=typeof window!=="undefined";
  const elKey = w ? localStorage.getItem("el_key") : null;
  const azureKey = w ? localStorage.getItem("azure_tts_key") : null;
  const hfKey = w ? localStorage.getItem("hf_token") : null;
  if (elKey) {
    speakEL(cleanForSpeech(text), gender, elKey, onEnd)
      .then(ok => ok || speakAzure(text, gender, onEnd))
      .then(ok => ok || speakHF(text, onEnd))
      .then(ok => { if(!ok) speakWeb(text, gender, onEnd); })
      .catch(() => speakWeb(text, gender, onEnd));
  } else if(azureKey) {
    speakAzure(text, gender, onEnd)
      .then(ok => ok || speakHF(text, onEnd))
      .then(ok => { if(!ok) speakWeb(text, gender, onEnd); })
      .catch(() => speakWeb(text, gender, onEnd));
  } else if(hfKey) {
    speakHF(text, onEnd)
      .then(ok => { if(!ok) speakWeb(text, gender, onEnd); })
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
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:${stream?"streamGenerateContent?alt=sse&":"generateContent?"}key=${key}`;
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
type EventItem2={id:number;date:string;month:string;day:string;title:string;loc:string;type:string;lat:number;lng:number;attendees:number;isUser?:boolean;desc?:string;mode?:string;link?:string};
const EVENTS_DATA:EventItem2[] = [
  // ── JUIN 2026
  {id:1,date:"2",month:"JUN",day:"Mar",title:"Forum Méditerranée & Diplomatie",loc:"Palais du Pharo, Marseille",type:"Forum",lat:43.2947,lng:5.3614,attendees:284,mode:"🏛️ Présentiel",desc:"Forum annuel sur la diplomatie méditerranéenne et les relations euro-africaines."},
  {id:2,date:"3",month:"JUN",day:"Mer",title:"Webinaire ONU : Objectifs de Développement Durable 2030",loc:"Nations Unies, New York",type:"Conférence",lat:40.7489,lng:-73.9680,attendees:4200,mode:"💻 En ligne",link:"https://www.un.org",desc:"Bilan à mi-parcours des ODD. Intervenants : experts ONU, représentants gouvernements."},
  {id:3,date:"5",month:"JUN",day:"Ven",title:"Journée mondiale de l'environnement — Conférence PNUE",loc:"Nairobi, Kenya",type:"Conférence",lat:-1.2921,lng:36.8219,attendees:1800,mode:"🔄 Hybride",link:"https://www.unep.org",desc:"Conférence internationale sur la biodiversité et le climat."},
  {id:4,date:"7",month:"JUN",day:"Dim",title:"Rencontres Géopolitiques d'Aix-en-Provence",loc:"Sciences Po Aix, Aix-en-Provence",type:"Forum",lat:43.5297,lng:5.4474,attendees:412,mode:"🏛️ Présentiel",desc:"3 jours de conférences sur les grands enjeux géopolitiques mondiaux."},
  {id:5,date:"9",month:"JUN",day:"Mar",title:"Model United Nations — Sciences Po Paris",loc:"Sciences Po Paris",type:"Simulation",lat:48.8517,lng:2.3294,attendees:320,mode:"🏛️ Présentiel",desc:"Simulation du Conseil de sécurité et de l'Assemblée générale de l'ONU."},
  {id:6,date:"10",month:"JUN",day:"Mer",title:"Sommet virtuel : Droits des femmes & ONU Femmes",loc:"Genève / En ligne",type:"Sommet",lat:46.2044,lng:6.1432,attendees:2100,mode:"🔄 Hybride",link:"https://www.unwomen.org",desc:"Conférence sur l'égalité de genre et les droits des femmes dans le monde."},
  {id:7,date:"12",month:"JUN",day:"Ven",title:"Forum Économique : L'Euro à l'heure des tensions géopolitiques",loc:"Palais Brongniart, Paris",type:"Forum",lat:48.8649,lng:2.3424,attendees:580,mode:"🏛️ Présentiel"},
  {id:8,date:"14",month:"JUN",day:"Dim",title:"Concours d'éloquence Sciences Po Bordeaux",loc:"Sciences Po Bordeaux",type:"Concours",lat:44.8378,lng:-0.5792,attendees:140,mode:"🏛️ Présentiel"},
  {id:9,date:"15",month:"JUN",day:"Lun",title:"Conférence : L'Afrique et le nouvel ordre mondial",loc:"Institut Monde Arabe, Paris",type:"Conférence",lat:48.8520,lng:2.3553,attendees:230,mode:"🔄 Hybride",link:"https://www.imarabe.org"},
  {id:10,date:"16",month:"JUN",day:"Mar",title:"Webinaire UNICEF : Nutrition et malnutrition infantile",loc:"UNICEF, Genève",type:"Webinaire",lat:46.2044,lng:6.1432,attendees:1500,mode:"💻 En ligne",link:"https://www.unicef.org"},
  {id:11,date:"17",month:"JUN",day:"Mer",title:"Forum Mondial sur les Réfugiés — HCR",loc:"Genève, Suisse",type:"Forum",lat:46.2044,lng:6.1432,attendees:3400,mode:"🔄 Hybride",link:"https://www.unhcr.org"},
  {id:12,date:"18",month:"JUN",day:"Jeu",title:"Conférence : 80 ans de la ONU — Bilan et perspectives",loc:"Palais des Nations, Genève",type:"Conférence",lat:46.2267,lng:6.1414,attendees:900,mode:"🔄 Hybride",link:"https://www.un.org"},
  {id:13,date:"19",month:"JUN",day:"Ven",title:"Journée mondiale des réfugiés — événement mondial",loc:"Monde entier / En ligne",type:"Commémoration",lat:48.8566,lng:2.3522,attendees:50000,mode:"💻 En ligne",link:"https://www.unhcr.org"},
  {id:14,date:"20",month:"JUN",day:"Sam",title:"Hackathon IA & Diplomatie — Sciences Po Paris",loc:"Sciences Po Paris",type:"Hackathon",lat:48.8517,lng:2.3294,attendees:200,mode:"🏛️ Présentiel"},
  {id:15,date:"21",month:"JUN",day:"Dim",title:"Forum Jeunesse ONU — Voix pour le futur",loc:"New York / En ligne",type:"Forum",lat:40.7489,lng:-73.9680,attendees:5000,mode:"💻 En ligne",link:"https://www.un.org/youth"},
  {id:16,date:"23",month:"JUN",day:"Mar",title:"Conférence sur la sécurité alimentaire mondiale — FAO",loc:"Rome, Italie",type:"Conférence",lat:41.9028,lng:12.4964,attendees:1200,mode:"🔄 Hybride",link:"https://www.fao.org"},
  {id:17,date:"24",month:"JUN",day:"Mer",title:"Sommet franco-allemand — Relations bilatérales",loc:"Élysée, Paris",type:"Sommet",lat:48.8698,lng:2.3160,attendees:150,mode:"🏛️ Présentiel"},
  {id:18,date:"25",month:"JUN",day:"Jeu",title:"Webinaire : Intelligence Artificielle et droit international",loc:"Institut de droit international, En ligne",type:"Webinaire",lat:48.8566,lng:2.3522,attendees:800,mode:"💻 En ligne",link:"https://www.iil.be"},
  {id:19,date:"26",month:"JUN",day:"Ven",title:"Journée internationale contre la torture — Conférence ONU",loc:"Genève / En ligne",type:"Conférence",lat:46.2044,lng:6.1432,attendees:600,mode:"💻 En ligne",link:"https://www.un.org"},
  {id:20,date:"27",month:"JUN",day:"Sam",title:"Forum des Droits de l'Homme — Amnesty International France",loc:"Paris",type:"Forum",lat:48.8566,lng:2.3522,attendees:350,mode:"🔄 Hybride",link:"https://www.amnesty.fr"},
  {id:21,date:"28",month:"JUN",day:"Dim",title:"Conférence internationale sur le droit humanitaire — CICR",loc:"Genève, Suisse",type:"Conférence",lat:46.2044,lng:6.1432,attendees:700,mode:"🔄 Hybride",link:"https://www.icrc.org"},
  {id:22,date:"30",month:"JUN",day:"Mar",title:"Assemblée annuelle FMI & Banque Mondiale",loc:"Washington DC, USA",type:"Sommet",lat:38.8951,lng:-77.0364,attendees:5000,mode:"🔄 Hybride",link:"https://www.imf.org"},
  // ── JUILLET 2026
  {id:23,date:"1",month:"JUL",day:"Mer",title:"Conférence Internationale sur le Changement Climatique",loc:"Bonn, Allemagne",type:"Conférence",lat:50.7374,lng:7.0982,attendees:2800,mode:"🔄 Hybride",link:"https://unfccc.int"},
  {id:24,date:"3",month:"JUL",day:"Ven",title:"Forum de Paris sur la Paix — Session d'été",loc:"Grande Halle de la Villette, Paris",type:"Forum",lat:48.8929,lng:2.3920,attendees:1400,mode:"🏛️ Présentiel"},
  {id:25,date:"6",month:"JUL",day:"Lun",title:"Simulation ONU mondiale — NMUN New York",loc:"New York, USA",type:"Simulation",lat:40.7489,lng:-73.9680,attendees:5000,mode:"🏛️ Présentiel"},
  {id:26,date:"7",month:"JUL",day:"Mar",title:"Conférence : Le Sahel en crise — Solutions diplomatiques",loc:"Institut Montaigne, Paris",type:"Conférence",lat:48.8750,lng:2.3118,attendees:180,mode:"🔄 Hybride",link:"https://www.institutmontaigne.org"},
  {id:27,date:"9",month:"JUL",day:"Jeu",title:"Webinaire UNESCO : Patrimoine mondial en péril",loc:"UNESCO, Paris / En ligne",type:"Webinaire",lat:48.8500,lng:2.3055,attendees:2000,mode:"💻 En ligne",link:"https://www.unesco.org"},
  {id:28,date:"11",month:"JUL",day:"Sam",title:"Anniversaire ONU : 80 ans — Événements mondiaux",loc:"Monde entier",type:"Commémoration",lat:48.8566,lng:2.3522,attendees:100000,mode:"🔄 Hybride",link:"https://www.un.org"},
  {id:29,date:"13",month:"JUL",day:"Lun",title:"Sommet de l'OTAN — Réunion des chefs d'État",loc:"Bruxelles, Belgique",type:"Sommet",lat:50.8503,lng:4.3517,attendees:400,mode:"🏛️ Présentiel"},
  {id:30,date:"14",month:"JUL",day:"Mar",title:"Défilé du 14 juillet — Fête Nationale française",loc:"Champs-Élysées, Paris",type:"Commémoration",lat:48.8698,lng:2.3078,attendees:400000,mode:"🏛️ Présentiel"},
  {id:31,date:"15",month:"JUL",day:"Mer",title:"Forum Étudiant : Géopolitique et nouvelles puissances",loc:"Sciences Po Lyon",type:"Forum",lat:45.7640,lng:4.8357,attendees:160,mode:"🔄 Hybride"},
  {id:32,date:"17",month:"JUL",day:"Ven",title:"Journée internationale de la justice — CPI",loc:"La Haye, Pays-Bas / En ligne",type:"Conférence",lat:52.0705,lng:4.3007,attendees:800,mode:"💻 En ligne",link:"https://www.icc-cpi.int"},
  {id:33,date:"18",month:"JUL",day:"Sam",title:"Journée mondiale Nelson Mandela — Ubuntu Global",loc:"Johannesburg / En ligne",type:"Commémoration",lat:-26.2041,lng:28.0473,attendees:25000,mode:"🔄 Hybride"},
  {id:34,date:"20",month:"JUL",day:"Lun",title:"Conférence sur la dette des pays en développement",loc:"CNUCED, Genève",type:"Conférence",lat:46.2044,lng:6.1432,attendees:500,mode:"🔄 Hybride",link:"https://unctad.org"},
  {id:35,date:"22",month:"JUL",day:"Mer",title:"Forum Asie-Europe (ASEM) — Dialogue politique",loc:"Bruxelles / En ligne",type:"Forum",lat:50.8503,lng:4.3517,attendees:1200,mode:"🔄 Hybride"},
  {id:36,date:"24",month:"JUL",day:"Ven",title:"Conférence internationale : Sécurité en Méditerranée",loc:"Rome, Italie",type:"Conférence",lat:41.9028,lng:12.4964,attendees:600,mode:"🏛️ Présentiel"},
  {id:37,date:"26",month:"JUL",day:"Dim",title:"Webinaire : L'Inde, nouvelle superpuissance ?",loc:"En ligne",type:"Webinaire",lat:28.6139,lng:77.2090,attendees:1800,mode:"💻 En ligne"},
  {id:38,date:"28",month:"JUL",day:"Mar",title:"Conférence sur la prolifération nucléaire — AIEA",loc:"Vienne, Autriche",type:"Conférence",lat:48.2082,lng:16.3738,attendees:900,mode:"🔄 Hybride",link:"https://www.iaea.org"},
  {id:39,date:"30",month:"JUL",day:"Jeu",title:"Forum Mondial sur la Migration — OIM",loc:"Genève / En ligne",type:"Forum",lat:46.2044,lng:6.1432,attendees:2400,mode:"🔄 Hybride",link:"https://www.iom.int"},
  // ── AOÛT 2026
  {id:40,date:"3",month:"AOÛ",day:"Lun",title:"Conférence d'été de l'Institut des Relations Internationales",loc:"Grenoble",type:"Conférence",lat:45.1885,lng:5.7245,attendees:220,mode:"🏛️ Présentiel"},
  {id:41,date:"6",month:"AOÛ",day:"Jeu",title:"Anniversaire Hiroshima — Cérémonie internationale",loc:"Hiroshima, Japon / En ligne",type:"Commémoration",lat:34.3853,lng:132.4553,attendees:50000,mode:"🔄 Hybride"},
  {id:42,date:"9",month:"AOÛ",day:"Dim",title:"Anniversaire Nagasaki — Conférence contre les armes nucléaires",loc:"Nagasaki, Japon / En ligne",type:"Commémoration",lat:32.7503,lng:129.8779,attendees:30000,mode:"🔄 Hybride"},
  {id:43,date:"10",month:"AOÛ",day:"Lun",title:"Forum Africain du Développement Durable",loc:"Dakar, Sénégal",type:"Forum",lat:14.7167,lng:-17.4677,attendees:800,mode:"🔄 Hybride"},
  {id:44,date:"12",month:"AOÛ",day:"Mer",title:"Journée internationale de la jeunesse — ONU Live",loc:"En ligne mondial",type:"Conférence",lat:48.8566,lng:2.3522,attendees:20000,mode:"💻 En ligne",link:"https://www.un.org/youth"},
  {id:45,date:"15",month:"AOÛ",day:"Sam",title:"Commémorations du 15 août 1945 — Fin de la Seconde Guerre",loc:"Paris & Monde / En ligne",type:"Commémoration",lat:48.8566,lng:2.3522,attendees:40000,mode:"🔄 Hybride"},
  {id:46,date:"18",month:"AOÛ",day:"Mar",title:"Forum Économique d'été : Avenir de l'Euro",loc:"Frankfurt, Allemagne",type:"Forum",lat:50.1109,lng:8.6821,attendees:700,mode:"🔄 Hybride"},
  {id:47,date:"20",month:"AOÛ",day:"Jeu",title:"Conférence sur la déforestation amazonienne",loc:"Brasília, Brésil / En ligne",type:"Conférence",lat:-15.7942,lng:-47.8822,attendees:1500,mode:"🔄 Hybride"},
  {id:48,date:"23",month:"AOÛ",day:"Dim",title:"Forum de la Francophonie — Jeunesse & Avenir",loc:"Paris / En ligne",type:"Forum",lat:48.8566,lng:2.3522,attendees:1100,mode:"🔄 Hybride",link:"https://www.francophonie.org"},
  {id:49,date:"25",month:"AOÛ",day:"Mar",title:"Webinaire OCDE : Inégalités mondiales et politiques publiques",loc:"Paris / En ligne",type:"Webinaire",lat:48.8483,lng:2.2940,attendees:3000,mode:"💻 En ligne",link:"https://www.oecd.org"},
  {id:50,date:"27",month:"AOÛ",day:"Jeu",title:"Conférence internationale : Cybersécurité & Géopolitique",loc:"Tallinn, Estonie",type:"Conférence",lat:59.4370,lng:24.7536,attendees:600,mode:"🔄 Hybride"},
  {id:51,date:"29",month:"AOÛ",day:"Sam",title:"Forum Mondial sur l'Eau — Solutions pour 2030",loc:"Marrakech, Maroc",type:"Forum",lat:31.6295,lng:-7.9811,attendees:2000,mode:"🔄 Hybride"},
  {id:52,date:"31",month:"AOÛ",day:"Lun",title:"Conférence : Mémoire de la Résistance — 80 ans de la Libération",loc:"Musée de l'Armée, Paris",type:"Commémoration",lat:48.8549,lng:2.3124,attendees:300,mode:"🏛️ Présentiel"},
  // ── SEPTEMBRE 2026
  {id:53,date:"1",month:"SEP",day:"Mar",title:"Rentrée académique ONU — Assemblée Générale",loc:"New York, USA",type:"Sommet",lat:40.7489,lng:-73.9680,attendees:8000,mode:"🔄 Hybride",link:"https://www.un.org/ga"},
  {id:54,date:"2",month:"SEP",day:"Mer",title:"Forum de la Paix — Dialogue inter-religieux mondial",loc:"Rome, Italie / En ligne",type:"Forum",lat:41.9028,lng:12.4964,attendees:1200,mode:"🔄 Hybride"},
  {id:55,date:"5",month:"SEP",day:"Sam",title:"Concours d'éloquence inter-universitaire — Île-de-France",loc:"Sorbonne, Paris",type:"Concours",lat:48.8488,lng:2.3426,attendees:280,mode:"🏛️ Présentiel"},
  {id:56,date:"7",month:"SEP",day:"Lun",title:"Sommet Afrique-Europe — Partenariat stratégique",loc:"Bruxelles, Belgique",type:"Sommet",lat:50.8503,lng:4.3517,attendees:600,mode:"🔄 Hybride"},
  {id:57,date:"8",month:"SEP",day:"Mar",title:"Journée mondiale de l'alphabétisation — UNESCO",loc:"Monde / En ligne",type:"Conférence",lat:48.8500,lng:2.3055,attendees:10000,mode:"💻 En ligne",link:"https://www.unesco.org"},
  {id:58,date:"10",month:"SEP",day:"Jeu",title:"Forum Mondial : Avenir du Travail — OIT",loc:"Genève / En ligne",type:"Forum",lat:46.2044,lng:6.1432,attendees:2500,mode:"🔄 Hybride",link:"https://www.ilo.org"},
  {id:59,date:"13",month:"SEP",day:"Dim",title:"Conférence : Intelligence artificielle & démocratie",loc:"Sciences Po Paris / En ligne",type:"Conférence",lat:48.8517,lng:2.3294,attendees:400,mode:"🔄 Hybride"},
  {id:60,date:"15",month:"SEP",day:"Mar",title:"Journée internationale de la démocratie — ONU",loc:"En ligne mondial",type:"Conférence",lat:48.8566,lng:2.3522,attendees:15000,mode:"💻 En ligne",link:"https://www.un.org"},
  {id:61,date:"17",month:"SEP",day:"Jeu",title:"Forum Mondial sur l'Éducation — UNESCO",loc:"Paris / En ligne",type:"Forum",lat:48.8500,lng:2.3055,attendees:3000,mode:"🔄 Hybride",link:"https://www.unesco.org"},
  {id:62,date:"18",month:"SEP",day:"Ven",title:"Conférence sur la Méditerranée et le Maghreb",loc:"Tunis, Tunisie",type:"Conférence",lat:36.8190,lng:10.1658,attendees:450,mode:"🔄 Hybride"},
  {id:63,date:"20",month:"SEP",day:"Dim",title:"Sommet Mondial Climat — Leaders de 195 pays",loc:"New York / En ligne",type:"Sommet",lat:40.7489,lng:-73.9680,attendees:10000,mode:"🔄 Hybride",link:"https://unfccc.int"},
  {id:64,date:"21",month:"SEP",day:"Lun",title:"Journée internationale de la Paix — ONU",loc:"New York & Monde / En ligne",type:"Commémoration",lat:40.7489,lng:-73.9680,attendees:100000,mode:"💻 En ligne",link:"https://www.un.org/peace"},
  {id:65,date:"23",month:"SEP",day:"Mer",title:"Débat général Assemblée Générale ONU",loc:"New York, USA",type:"Sommet",lat:40.7489,lng:-73.9680,attendees:5000,mode:"🔄 Hybride",link:"https://www.un.org/ga"},
  {id:66,date:"25",month:"SEP",day:"Ven",title:"Forum Économique : Afrique émergente",loc:"Abidjan, Côte d'Ivoire",type:"Forum",lat:5.3600,lng:-4.0083,attendees:900,mode:"🔄 Hybride"},
  {id:67,date:"26",month:"SEP",day:"Sam",title:"Journée mondiale des langues — Conférence multilingue",loc:"Strasbourg / En ligne",type:"Conférence",lat:48.5734,lng:7.7521,attendees:600,mode:"💻 En ligne"},
  {id:68,date:"28",month:"SEP",day:"Lun",title:"Conférence sur les armes chimiques — OIAC",loc:"La Haye, Pays-Bas",type:"Conférence",lat:52.0705,lng:4.3007,attendees:700,mode:"🏛️ Présentiel"},
  {id:69,date:"30",month:"SEP",day:"Mer",title:"Forum Paris sur la Paix — Édition annuelle",loc:"Paris / En ligne",type:"Forum",lat:48.8798,lng:2.3478,attendees:4000,mode:"🔄 Hybride",link:"https://parispeaceforum.org"},
  // ── OCTOBRE 2026
  {id:70,date:"1",month:"OCT",day:"Jeu",title:"Journée mondiale des personnes âgées — ONU",loc:"En ligne mondial",type:"Conférence",lat:48.8566,lng:2.3522,attendees:8000,mode:"💻 En ligne",link:"https://www.un.org"},
  {id:71,date:"3",month:"OCT",day:"Sam",title:"Conférence franco-africaine sur l'aide au développement",loc:"Institut Monde Arabe, Paris",type:"Conférence",lat:48.8520,lng:2.3553,attendees:350,mode:"🔄 Hybride"},
  {id:72,date:"5",month:"OCT",day:"Lun",title:"Journée mondiale des enseignants — UNESCO",loc:"Paris / En ligne",type:"Conférence",lat:48.8500,lng:2.3055,attendees:5000,mode:"💻 En ligne",link:"https://www.unesco.org"},
  {id:73,date:"7",month:"OCT",day:"Mer",title:"Commémoration : 3 ans depuis le 7 octobre — Conférence paix",loc:"Paris / En ligne",type:"Commémoration",lat:48.8566,lng:2.3522,attendees:800,mode:"🔄 Hybride"},
  {id:74,date:"9",month:"OCT",day:"Ven",title:"Journée mondiale de la Poste — UPU Forum",loc:"Berne, Suisse",type:"Conférence",lat:46.9480,lng:7.4474,attendees:400,mode:"🔄 Hybride"},
  {id:75,date:"10",month:"OCT",day:"Sam",title:"Journée mondiale de la santé mentale — OMS",loc:"Monde / En ligne",type:"Conférence",lat:46.2044,lng:6.1432,attendees:20000,mode:"💻 En ligne",link:"https://www.who.int"},
  {id:76,date:"13",month:"OCT",day:"Mar",title:"Forum Mondial sur la Réduction des Risques de Catastrophes",loc:"Genève / En ligne",type:"Forum",lat:46.2044,lng:6.1432,attendees:2000,mode:"🔄 Hybride"},
  {id:77,date:"15",month:"OCT",day:"Jeu",title:"Conférence : Relations Chine-Occident, nouveau paradigme",loc:"Chatham House, Londres / En ligne",type:"Conférence",lat:51.5074,lng:-0.1278,attendees:700,mode:"🔄 Hybride",link:"https://www.chathamhouse.org"},
  {id:78,date:"16",month:"OCT",day:"Ven",title:"Journée mondiale de l'alimentation — FAO",loc:"Rome / En ligne",type:"Conférence",lat:41.9028,lng:12.4964,attendees:15000,mode:"💻 En ligne",link:"https://www.fao.org"},
  {id:79,date:"17",month:"OCT",day:"Sam",title:"Journée mondiale du refus de la misère",loc:"Paris & Monde / En ligne",type:"Commémoration",lat:48.8566,lng:2.3522,attendees:30000,mode:"🔄 Hybride"},
  {id:80,date:"19",month:"OCT",day:"Lun",title:"G20 — Session extraordinaire économie mondiale",loc:"Johannesburg, Afrique du Sud",type:"Sommet",lat:-26.2041,lng:28.0473,attendees:2000,mode:"🔄 Hybride"},
  {id:81,date:"21",month:"OCT",day:"Mer",title:"Conférence européenne sur la cybersécurité — ENISA",loc:"Barcelone, Espagne / En ligne",type:"Conférence",lat:41.3874,lng:2.1686,attendees:1200,mode:"🔄 Hybride"},
  {id:82,date:"23",month:"OCT",day:"Ven",title:"Forum sur la liberté de la presse — RSF",loc:"Paris",type:"Forum",lat:48.8566,lng:2.3522,attendees:400,mode:"🏛️ Présentiel",link:"https://rsf.org"},
  {id:83,date:"24",month:"OCT",day:"Sam",title:"Journée des Nations Unies — 81 ans de l'ONU",loc:"New York & Monde / En ligne",type:"Commémoration",lat:40.7489,lng:-73.9680,attendees:50000,mode:"💻 En ligne",link:"https://www.un.org"},
  {id:84,date:"25",month:"OCT",day:"Dim",title:"Conférence internationale : Migrations et intégration",loc:"Berlin, Allemagne / En ligne",type:"Conférence",lat:52.5200,lng:13.4050,attendees:800,mode:"🔄 Hybride"},
  {id:85,date:"27",month:"OCT",day:"Mar",title:"Forum Mondial : Économie numérique et régulation",loc:"Genève / En ligne",type:"Forum",lat:46.2044,lng:6.1432,attendees:1500,mode:"🔄 Hybride"},
  {id:86,date:"29",month:"OCT",day:"Jeu",title:"Commémoration du krach de 1929 — Conférence économie",loc:"En ligne",type:"Commémoration",lat:48.8566,lng:2.3522,attendees:2000,mode:"💻 En ligne"},
  // ── NOVEMBRE 2026
  {id:87,date:"2",month:"NOV",day:"Lun",title:"Conférence sur la Démocratie et les Élections — OSCE",loc:"Varsovie, Pologne",type:"Conférence",lat:52.2297,lng:21.0122,attendees:600,mode:"🔄 Hybride"},
  {id:88,date:"4",month:"NOV",day:"Mer",title:"Commémoration de l'Armistice 1918 — Conférence historique",loc:"Verdun, France / En ligne",type:"Commémoration",lat:49.1600,lng:5.3800,attendees:1200,mode:"🔄 Hybride"},
  {id:89,date:"6",month:"NOV",day:"Ven",title:"COP31 — Ouverture Conférence Climat ONU",loc:"Nairobi, Kenya / En ligne",type:"Sommet",lat:-1.2921,lng:36.8219,attendees:25000,mode:"🔄 Hybride",link:"https://unfccc.int"},
  {id:90,date:"8",month:"NOV",day:"Dim",title:"Forum des étudiants en droit international",loc:"Strasbourg / En ligne",type:"Forum",lat:48.5734,lng:7.7521,attendees:300,mode:"🔄 Hybride"},
  {id:91,date:"9",month:"NOV",day:"Lun",title:"Anniversaire chute du Mur de Berlin — Conférence Europe",loc:"Berlin / En ligne",type:"Commémoration",lat:52.5200,lng:13.4050,attendees:5000,mode:"🔄 Hybride"},
  {id:92,date:"11",month:"NOV",day:"Mer",title:"Commémoration de l'Armistice — Cérémonie Arc de Triomphe",loc:"Paris, France",type:"Commémoration",lat:48.8738,lng:2.2950,attendees:100000,mode:"🏛️ Présentiel"},
  {id:93,date:"13",month:"NOV",day:"Ven",title:"Forum Mondial de la Santé — OMS",loc:"Genève / En ligne",type:"Forum",lat:46.2044,lng:6.1432,attendees:3000,mode:"🔄 Hybride",link:"https://www.who.int"},
  {id:94,date:"15",month:"NOV",day:"Dim",title:"Conférence : Moyen-Orient, vers une paix durable ?",loc:"Doha, Qatar / En ligne",type:"Conférence",lat:25.2854,lng:51.5310,attendees:900,mode:"🔄 Hybride"},
  {id:95,date:"17",month:"NOV",day:"Mar",title:"Conférence internationale des juristes — Droit pénal",loc:"La Haye, Pays-Bas",type:"Conférence",lat:52.0705,lng:4.3007,attendees:700,mode:"🏛️ Présentiel"},
  {id:96,date:"19",month:"NOV",day:"Jeu",title:"Journée mondiale de l'enfance — UNICEF Live",loc:"Monde / En ligne",type:"Conférence",lat:48.8566,lng:2.3522,attendees:40000,mode:"💻 En ligne",link:"https://www.unicef.org"},
  {id:97,date:"20",month:"NOV",day:"Ven",title:"Forum : Droits de l'enfant 35 ans — Convention ONU",loc:"Genève / En ligne",type:"Forum",lat:46.2044,lng:6.1432,attendees:2000,mode:"🔄 Hybride",link:"https://www.unicef.org"},
  {id:98,date:"21",month:"NOV",day:"Sam",title:"Conférence francophone sur l'éloquence et la rhétorique",loc:"Lyon, France",type:"Conférence",lat:45.7640,lng:4.8357,attendees:250,mode:"🏛️ Présentiel"},
  {id:99,date:"23",month:"NOV",day:"Lun",title:"Sommet Asie-Pacifique — APEC",loc:"Séoul, Corée du Sud / En ligne",type:"Sommet",lat:37.5665,lng:126.9780,attendees:3000,mode:"🔄 Hybride"},
  {id:100,date:"25",month:"NOV",day:"Mer",title:"Journée internationale contre les violences faites aux femmes",loc:"Monde / En ligne",type:"Conférence",lat:48.8566,lng:2.3522,attendees:50000,mode:"💻 En ligne",link:"https://www.unwomen.org"},
  {id:101,date:"27",month:"NOV",day:"Ven",title:"Forum : Intelligence artificielle et souveraineté",loc:"Paris / En ligne",type:"Forum",lat:48.8566,lng:2.3522,attendees:600,mode:"🔄 Hybride"},
  {id:102,date:"28",month:"NOV",day:"Sam",title:"Conférence sur la solidarité internationale — ONG",loc:"Bruxelles / En ligne",type:"Conférence",lat:50.8503,lng:4.3517,attendees:400,mode:"🔄 Hybride"},
  // ── DÉCEMBRE 2026
  {id:103,date:"1",month:"DÉC",day:"Mar",title:"Journée mondiale contre le SIDA — ONUSIDA",loc:"Monde / En ligne",type:"Conférence",lat:46.2044,lng:6.1432,attendees:30000,mode:"💻 En ligne",link:"https://www.unaids.org"},
  {id:104,date:"3",month:"DÉC",day:"Jeu",title:"Journée internationale des personnes handicapées — ONU",loc:"En ligne mondial",type:"Conférence",lat:48.8566,lng:2.3522,attendees:12000,mode:"💻 En ligne",link:"https://www.un.org"},
  {id:105,date:"5",month:"DÉC",day:"Sam",title:"Journée mondiale du sol — FAO Conférence",loc:"Rome / En ligne",type:"Conférence",lat:41.9028,lng:12.4964,attendees:1500,mode:"💻 En ligne",link:"https://www.fao.org"},
  {id:106,date:"7",month:"DÉC",day:"Lun",title:"Commémoration Pearl Harbor — Relations USA-Japon",loc:"Honolulu, USA / En ligne",type:"Commémoration",lat:21.3654,lng:-157.9762,attendees:5000,mode:"🔄 Hybride"},
  {id:107,date:"9",month:"DÉC",day:"Mer",title:"Journée internationale contre la corruption — ONU",loc:"En ligne mondial",type:"Conférence",lat:48.8566,lng:2.3522,attendees:8000,mode:"💻 En ligne",link:"https://www.unodc.org"},
  {id:108,date:"10",month:"DÉC",day:"Jeu",title:"Cérémonie Nobel de la Paix — Oslo",loc:"Oslo, Norvège / En ligne",type:"Commémoration",lat:59.9139,lng:10.7522,attendees:3000,mode:"🔄 Hybride"},
  {id:109,date:"10",month:"DÉC",day:"Jeu",title:"Journée des Droits de l'Homme — ONU",loc:"Genève & Monde / En ligne",type:"Conférence",lat:46.2044,lng:6.1432,attendees:25000,mode:"💻 En ligne",link:"https://www.ohchr.org"},
  {id:110,date:"14",month:"DÉC",day:"Lun",title:"Forum Mondial : Bilan 2026 et perspectives 2027",loc:"Bruxelles / En ligne",type:"Forum",lat:50.8503,lng:4.3517,attendees:1000,mode:"🔄 Hybride"},
  {id:111,date:"16",month:"DÉC",day:"Mer",title:"Conférence : Francophonie et influence culturelle française",loc:"Paris / En ligne",type:"Conférence",lat:48.8566,lng:2.3522,attendees:300,mode:"🔄 Hybride"},
  {id:112,date:"18",month:"DÉC",day:"Ven",title:"Journée internationale des migrants — OIM",loc:"En ligne mondial",type:"Conférence",lat:46.2044,lng:6.1432,attendees:10000,mode:"💻 En ligne",link:"https://www.iom.int"},
  {id:113,date:"20",month:"DÉC",day:"Dim",title:"Forum de Dakar — Relations franco-africaines",loc:"Dakar, Sénégal / En ligne",type:"Forum",lat:14.7167,lng:-17.4677,attendees:600,mode:"🔄 Hybride"},
  // ── JANVIER 2027
  {id:114,date:"1",month:"JAN",day:"Ven",title:"Discours du Nouvel An — Chefs d'État mondiaux",loc:"Monde / En ligne",type:"Commémoration",lat:48.8566,lng:2.3522,attendees:500000,mode:"💻 En ligne"},
  {id:115,date:"15",month:"JAN",day:"Ven",title:"Forum Économique Mondial — Davos 2027",loc:"Davos, Suisse / En ligne",type:"Sommet",lat:46.8026,lng:9.8372,attendees:3000,mode:"🔄 Hybride",link:"https://www.weforum.org"},
  {id:116,date:"20",month:"JAN",day:"Mer",title:"Conférence annuelle : Justice internationale et droits",loc:"La Haye / En ligne",type:"Conférence",lat:52.0705,lng:4.3007,attendees:500,mode:"🔄 Hybride"},
  {id:117,date:"27",month:"JAN",day:"Mer",title:"Journée de la mémoire de l'Holocauste — ONU",loc:"Jérusalem & Monde / En ligne",type:"Commémoration",lat:31.7683,lng:35.2137,attendees:50000,mode:"🔄 Hybride",link:"https://www.un.org"},
  // ── FÉVRIER 2027
  {id:118,date:"4",month:"FÉV",day:"Jeu",title:"Conférence sur la sécurité de Munich",loc:"Munich, Allemagne / En ligne",type:"Conférence",lat:48.1351,lng:11.5820,attendees:2000,mode:"🔄 Hybride",link:"https://securityconference.org"},
  {id:119,date:"14",month:"FÉV",day:"Sam",title:"Forum Valentine pour la Diplomatie Humanitaire",loc:"Genève / En ligne",type:"Forum",lat:46.2044,lng:6.1432,attendees:400,mode:"🔄 Hybride"},
  {id:120,date:"21",month:"FÉV",day:"Dim",title:"Journée internationale de la langue maternelle — UNESCO",loc:"Paris / En ligne",type:"Conférence",lat:48.8500,lng:2.3055,attendees:5000,mode:"💻 En ligne",link:"https://www.unesco.org"},
  // ── ÉVÉNEMENTS EN LIGNE PERMANENTS / SÉRIES
  {id:121,date:"★",month:"",day:"Récurrent",title:"Cours en ligne ONU : Introduction au droit international",loc:"En ligne — Coursera/edX",type:"Formation",lat:48.8566,lng:2.3522,attendees:50000,mode:"💻 En ligne",link:"https://www.edx.org",desc:"Cours certifiant offert par l'Université des Nations Unies. Ouvert à tous, gratuit en audit."},
  {id:122,date:"★",month:"",day:"Récurrent",title:"Conférences TED en français — Géopolitique & Société",loc:"En ligne — TED.com",type:"Formation",lat:48.8566,lng:2.3522,attendees:200000,mode:"💻 En ligne",link:"https://www.ted.com/talks?language=fr",desc:"Centaines de conférences disponibles sur la géopolitique, la diplomatie, la société."},
  {id:123,date:"★",month:"",day:"Récurrent",title:"Sciences Po MOOC — Géopolitique mondiale",loc:"En ligne — Coursera",type:"Formation",lat:48.8517,lng:2.3294,attendees:30000,mode:"💻 En ligne",link:"https://www.coursera.org",desc:"MOOC Sciences Po Paris sur la géopolitique mondiale. Certifiant et reconnu."},
  {id:124,date:"★",month:"",day:"Récurrent",title:"Conférences de l'IFRI — Institut français des relations int.",loc:"Paris / YouTube",type:"Conférence",lat:48.8566,lng:2.3522,attendees:5000,mode:"🔄 Hybride",link:"https://www.ifri.org",desc:"L'IFRI publie régulièrement des conférences et débats sur la géopolitique mondiale."},
  {id:125,date:"★",month:"",day:"Récurrent",title:"France Culture — Cours et Conférences en podcast",loc:"En ligne — France Culture",type:"Formation",lat:48.8566,lng:2.3522,attendees:500000,mode:"💻 En ligne",link:"https://www.radiofrance.fr/franceculture",desc:"Milliers d'heures de conférences, cours et débats sur tous les sujets des concours."},
  {id:126,date:"★",month:"",day:"Récurrent",title:"Webinaires hebdomadaires : Actualité internationale",loc:"Institut Montaigne, En ligne",type:"Webinaire",lat:48.8750,lng:2.3118,attendees:2000,mode:"💻 En ligne",link:"https://www.institutmontaigne.org",desc:"Chaque semaine, analyses et débats sur l'actualité géopolitique et économique mondiale."},
  {id:127,date:"★",month:"",day:"Récurrent",title:"Simulation ONU en ligne — UNA-USA",loc:"En ligne mondial",type:"Simulation",lat:40.7489,lng:-73.9680,attendees:10000,mode:"💻 En ligne",link:"https://www.una-usa.org",desc:"Simulations ONU en ligne ouvertes aux étudiants du monde entier. Plusieurs sessions par an."},
  {id:128,date:"★",month:"",day:"Récurrent",title:"Le Grand Continent — Conférences Europe",loc:"En ligne",type:"Conférence",lat:48.8566,lng:2.3522,attendees:8000,mode:"💻 En ligne",link:"https://legrandcontinent.eu",desc:"Revue géopolitique européenne avec conférences et débats réguliers en ligne."},
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
const G=(q:string)=>`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
const GW=(q:string)=>`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=WORLD&ceid=WORLD:fr`;
const RSS_SOURCES = [
  // ── Presse française directe
  {name:"Le Monde",       url:"https://www.lemonde.fr/rss/une.xml",                              tag:"LE MONDE",      tagC:"#E03535"},
  {name:"Le Figaro",      url:"https://www.lefigaro.fr/rss/figaro_actualites.xml",               tag:"LE FIGARO",     tagC:"#C0392B"},
  {name:"L'Express",      url:"https://www.lexpress.fr/rss/alaune.xml",                          tag:"L'EXPRESS",     tagC:"#E67E22"},
  {name:"Libération",     url:"https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml", tag:"LIBÉRATION",    tagC:"#8E44AD"},
  {name:"20 Minutes",     url:"https://www.20minutes.fr/feeds/rss/actu",                         tag:"20 MINUTES",    tagC:"#2980B9"},
  {name:"Courrier Int.",  url:"https://www.courrierinternational.com/feed/all/rss.xml",           tag:"COURRIER INT.", tagC:"#16A085"},
  {name:"Le Point",       url:"https://www.lepoint.fr/rss.xml",                                  tag:"LE POINT",      tagC:"#D4AC0D"},
  {name:"Les Échos",      url:"https://www.lesechos.fr/rss/rss_une.xml",                         tag:"LES ÉCHOS",     tagC:"#1A5276"},
  // ── Médias internationaux
  {name:"France 24",      url:"https://www.france24.com/fr/rss",                                 tag:"FRANCE 24",     tagC:"#2B78F5"},
  {name:"RFI",            url:"https://www.rfi.fr/fr/rss",                                       tag:"RFI",           tagC:"#27AE60"},
  {name:"BBC Afrique",    url:"https://feeds.bbci.co.uk/afrique/rss.xml",                        tag:"BBC",           tagC:"#7C3AED"},
  {name:"TV5 Monde",      url:"https://information.tv5monde.com/rss",                            tag:"TV5MONDE",      tagC:"#1ABC9C"},
  {name:"DW Français",    url:"https://rss.dw.com/rdf/rss-fr-tout",                              tag:"DW",            tagC:"#2C3E50"},
  {name:"Jeune Afrique",  url:"https://www.jeuneafrique.com/feed/",                              tag:"JEUNE AFRIQUE", tagC:"#F39C12"},
  // ── France — politique & société
  {name:"Politique FR",       url:G("politique france gouvernement"),           tag:"POLITIQUE",     tagC:"#C0392B"},
  {name:"Assemblée",          url:G("assemblée nationale sénat loi"),           tag:"PARLEMENT",     tagC:"#922B21"},
  {name:"Élections",          url:G("élections france vote résultats"),         tag:"ÉLECTIONS",     tagC:"#E74C3C"},
  {name:"Macron",             url:G("macron elysée premier ministre"),          tag:"ÉLYSÉE",        tagC:"#A93226"},
  {name:"Société FR",         url:G("société france social grève"),             tag:"SOCIÉTÉ",       tagC:"#2C3E50"},
  {name:"Justice FR",         url:G("justice tribunal cour france"),            tag:"JUSTICE",       tagC:"#784212"},
  {name:"Sécurité FR",        url:G("sécurité police gendarmerie france"),      tag:"SÉCURITÉ",      tagC:"#2E4057"},
  {name:"Immigration FR",     url:G("immigration migrants asile france"),       tag:"IMMIGRATION",   tagC:"#6C3483"},
  {name:"Éducation FR",       url:G("éducation école université france"),       tag:"ÉDUCATION",     tagC:"#1F618D"},
  {name:"Santé FR",           url:G("santé hôpital médecine france"),           tag:"SANTÉ",         tagC:"#148F77"},
  {name:"Économie FR",        url:G("économie croissance france PIB"),          tag:"ÉCONOMIE",      tagC:"#1A5276"},
  {name:"Emploi FR",          url:G("emploi chômage travail france"),           tag:"EMPLOI",        tagC:"#117A65"},
  {name:"Logement FR",        url:G("logement immobilier crise france"),        tag:"LOGEMENT",      tagC:"#7D6608"},
  {name:"Énergie FR",         url:G("énergie nucléaire électricité france"),    tag:"ÉNERGIE",       tagC:"#1A5276"},
  {name:"Transport FR",       url:G("transport sncf ratp grève france"),        tag:"TRANSPORT",     tagC:"#2980B9"},
  {name:"Culture FR",         url:G("culture musée cinéma art france"),         tag:"CULTURE",       tagC:"#7D3C98"},
  {name:"Sport FR",           url:G("sport football rugby france résultats"),   tag:"SPORT",         tagC:"#1E8449"},
  // ── Organisations internationales
  {name:"ONU",            url:G("ONU nations unies résolution conseil"),        tag:"ONU",           tagC:"#0077B5"},
  {name:"UNICEF",         url:G("UNICEF enfants humanitaire aide"),             tag:"UNICEF",        tagC:"#00AEEF"},
  {name:"UNESCO",         url:G("UNESCO patrimoine culture éducation"),         tag:"UNESCO",        tagC:"#B7950B"},
  {name:"OMS",            url:G("OMS santé mondiale pandémie vaccin"),          tag:"OMS",           tagC:"#1ABC9C"},
  {name:"OTAN",           url:G("OTAN alliance atlantique défense"),            tag:"OTAN",          tagC:"#2874A6"},
  {name:"FMI Banque M.",  url:G("FMI banque mondiale économie dette"),          tag:"FMI",           tagC:"#1F618D"},
  {name:"Union Africaine",url:G("union africaine sommet afrique"),              tag:"UA",            tagC:"#E67E22"},
  {name:"G7 G20",         url:G("G7 G20 sommet leaders mondiaux"),             tag:"G7/G20",        tagC:"#2C3E50"},
  {name:"CPI",            url:G("cour pénale internationale crime guerre"),     tag:"CPI",           tagC:"#922B21"},
  {name:"OMC",            url:G("OMC commerce international tarifs"),           tag:"OMC",           tagC:"#117A65"},
  // ── Géopolitique par région
  {name:"Géopolitique",   url:G("géopolitique relations internationales"),      tag:"GÉOPOLITIQUE",  tagC:"#D35400"},
  {name:"Diplomatie",     url:G("diplomatie ambassadeur accord traité"),        tag:"DIPLOMATIE",    tagC:"#9B59B6"},
  {name:"Conflits",       url:G("conflit guerre armée militaire"),              tag:"CONFLITS",      tagC:"#E74C3C"},
  {name:"Ukraine-Russie", url:G("ukraine russie guerre frontière"),             tag:"UKRAINE",       tagC:"#F4D03F"},
  {name:"Gaza-Israël",    url:G("gaza israel palestiniens conflit"),            tag:"GAZA",          tagC:"#E67E22"},
  {name:"Moyen-Orient",   url:G("moyen-orient iran liban syrie"),               tag:"MOYEN-ORIENT",  tagC:"#CA6F1E"},
  {name:"Chine",          url:G("chine xi jinping pékin politique"),            tag:"CHINE",         tagC:"#C0392B"},
  {name:"USA",            url:G("états-unis maison blanche congrès"),           tag:"USA",           tagC:"#2874A6"},
  {name:"Russie",         url:G("russie poutine moscou kremlin"),               tag:"RUSSIE",        tagC:"#922B21"},
  {name:"Inde",           url:G("inde modi new delhi politique"),               tag:"INDE",          tagC:"#F39C12"},
  {name:"Japon-Corée",    url:G("japon corée asie pacifique"),                  tag:"ASIE-PAC.",     tagC:"#E74C3C"},
  {name:"Afrique subsah.",url:G("afrique subsaharienne sahel mali niger"),      tag:"SAHEL",         tagC:"#D4AC0D"},
  {name:"Maghreb",        url:G("maroc algérie tunisie maghreb"),               tag:"MAGHREB",       tagC:"#F0B27A"},
  {name:"Afrique Est",    url:G("ethiopie kenya tanzanie afrique est"),         tag:"AF. EST",       tagC:"#A9DFBF"},
  {name:"Amérique Lat.",  url:G("brésil mexique venezuela amérique latine"),    tag:"AM. LATINE",    tagC:"#1ABC9C"},
  {name:"Europe Est",     url:G("pologne roumanie hongrie europe est"),         tag:"EU. EST",       tagC:"#85C1E9"},
  {name:"Balkans",        url:G("serbie kosovo balkans europe"),                tag:"BALKANS",       tagC:"#7FB3D3"},
  {name:"Caucase",        url:G("géorgie arménie azerbaïdjan caucase"),         tag:"CAUCASE",       tagC:"#A569BD"},
  {name:"Asie Centrale",  url:G("kazakhstan ouzbékistan asie centrale"),        tag:"ASIE CENT.",    tagC:"#F8C471"},
  {name:"Océanie",        url:G("australie nouvelle-zélande pacifique"),        tag:"OCÉANIE",       tagC:"#76D7C4"},
  // ── Thèmes transversaux
  {name:"Droits Humains", url:G("droits humains libertés ONG amnesty"),         tag:"DROITS",        tagC:"#A93226"},
  {name:"Réfugiés",       url:G("réfugiés déplacés HCR migration forcée"),      tag:"RÉFUGIÉS",      tagC:"#5D6D7E"},
  {name:"Développement",  url:G("développement durable pauvreté aide"),         tag:"DÉVELOPPEMENT", tagC:"#27AE60"},
  {name:"Alimentation",   url:G("fao faim sécurité alimentaire agriculture"),   tag:"ALIMENTATION",  tagC:"#28B463"},
  {name:"Eau",            url:G("eau potable accès ressources hydrique"),       tag:"EAU",           tagC:"#5DADE2"},
  {name:"Climat",         url:G("climat COP réchauffement gaz effet serre"),    tag:"CLIMAT",        tagC:"#27AE60"},
  {name:"Biodiversité",   url:G("biodiversité espèces extinctions nature"),     tag:"BIODIVERSITÉ",  tagC:"#1E8449"},
  {name:"Énergie monde",  url:G("pétrole gaz renouvelable énergie monde"),      tag:"ÉNERGIE MONDE", tagC:"#F39C12"},
  // ── Sciences & Innovation
  {name:"Science",        url:G("science recherche découverte laboratoire"),    tag:"SCIENCE",       tagC:"#8E44AD"},
  {name:"Médecine",       url:G("médecine cancer traitement vaccin"),           tag:"MÉDECINE",      tagC:"#117A65"},
  {name:"Espace",         url:G("espace nasa esa cosmos satellite"),            tag:"ESPACE",        tagC:"#1A237E"},
  {name:"IA",             url:G("intelligence artificielle IA GPT robot"),      tag:"IA",            tagC:"#1ABC9C"},
  {name:"Tech",           url:G("technologie numérique innovation startup"),    tag:"TECH",          tagC:"#2980B9"},
  {name:"Cyber",          url:G("cybersécurité piratage hacking données"),      tag:"CYBER",         tagC:"#2C3E50"},
  {name:"Spatial FR",     url:G("france espace ariane cnes spatial"),           tag:"SPATIAL",       tagC:"#1A237E"},
  // ── Histoire & Mémoire
  {name:"Histoire",       url:G("histoire patrimoine mémoire anniversaire"),    tag:"HISTOIRE",      tagC:"#784212"},
  {name:"Histoire FR",    url:G("histoire france révolution empire guerre"),    tag:"HIST. FR",      tagC:"#6E2F1A"},
  {name:"Commémoration",  url:G("commémoration mémoire guerre résistance"),     tag:"MÉMOIRE",       tagC:"#5D4037"},
  {name:"Archéologie",    url:G("archéologie fouilles découverte antique"),     tag:"ARCHÉO",        tagC:"#8D6E63"},
  // ── Droit & Institutions
  {name:"Droit",          url:G("droit loi constitution juridique"),            tag:"DROIT",         tagC:"#4A235A"},
  {name:"Droits UE",      url:G("droit européen directive règlement bruxelles"),tag:"DROIT UE",      tagC:"#1F618D"},
  {name:"Conseil État",   url:G("conseil état constitutionnel juridiction FR"), tag:"JURIDICTIONS",  tagC:"#6C3483"},
  // ── Économie monde
  {name:"Éco Mondiale",   url:G("économie mondiale croissance récession"),      tag:"ÉCO MONDE",     tagC:"#1A5276"},
  {name:"Marchés",        url:G("bourse marchés financiers actions"),           tag:"MARCHÉS",       tagC:"#2E86C1"},
  {name:"Commerce",       url:G("commerce international exportation douanes"),  tag:"COMMERCE",      tagC:"#148F77"},
  {name:"Inflation",      url:G("inflation prix banque centrale taux"),         tag:"INFLATION",     tagC:"#D35400"},
  {name:"Cryptomonnaie",  url:G("bitcoin cryptomonnaie blockchain ethereum"),   tag:"CRYPTO",        tagC:"#F39C12"},
  // ── Médias & Société
  {name:"Médias",         url:G("médias presse liberté journalisme"),           tag:"MÉDIAS",        tagC:"#2C3E50"},
  {name:"Réseaux Sociaux",url:G("réseaux sociaux twitter instagram tiktok"),    tag:"RS",            tagC:"#1DA1F2"},
  {name:"Désinformation", url:G("désinformation fake news complot manipulation"),tag:"DESINFORMATION",tagC:"#E74C3C"},
  {name:"Religion",       url:G("religion islam christianisme laïcité"),        tag:"RELIGION",      tagC:"#7D6608"},
  {name:"Féminisme",      url:G("féminisme égalité femmes droits genre"),       tag:"GENRE",         tagC:"#A93226"},
  {name:"Jeunesse",       url:G("jeunesse lycéens étudiants génération"),       tag:"JEUNESSE",      tagC:"#2ECC71"},
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

async function fetchLiveNews(onChunk?:(articles:LiveArticle[])=>void): Promise<LiveArticle[]> {
  const seen=new Set<string>();
  const all: LiveArticle[] = [];
  const rssKey = typeof window!=="undefined"?localStorage.getItem("rss2json_key")||"":"";
  const fetchOne=async(src:typeof RSS_SOURCES[0])=>{
    try{
      type RSSItem={title:string;link:string;pubDate?:string;published?:string;guid?:string;thumbnail?:string|null;enclosure?:{link?:string}};
      let items:RSSItem[]|null=null;
      try{
        const apiParam=rssKey?`&api_key=${rssKey}`:"";
        const ts=`&_=${Date.now()}`;
        const r=await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(src.url)}&count=10${apiParam}${ts}`,{signal:AbortSignal.timeout(5000),cache:"no-store"});
        if(r.ok){const d=await r.json();if(d.status==="ok"&&d.items?.length) items=d.items;}
      }catch{/*fallback*/}
      if(!items){
        try{
          const r=await fetch(`https://corsproxy.io/?${encodeURIComponent(src.url)}&_=${Date.now()}`,{signal:AbortSignal.timeout(5000),cache:"no-store"});
          if(r.ok){const t=await r.text();const parsed=parseRawRSS(t);if(parsed.length) items=parsed;}
        }catch{/*unavailable*/}
      }
      if(!items) return;
      const batch:LiveArticle[]=[];
      for(const item of items.slice(0,10)){
        const title=(item.title||"").replace(/<[^>]+>/g,"").replace(/<!\[CDATA\[|\]\]>/g,"").trim().slice(0,160);
        const id=`${src.name}-${item.guid||item.link}`;
        if(!title||seen.has(id)) continue;
        seen.add(id);
        const a:LiveArticle={id,title,src:src.name,tag:src.tag,tagC:src.tagC,
          time:makeTimeStr(item.pubDate||item.published||""),
          imgUrl:item.thumbnail||item.enclosure?.link||null,link:item.link||""};
        batch.push(a);all.push(a);
      }
      if(batch.length&&onChunk) onChunk([...all]);
    }catch{/*skip*/}
  };
  // Batch sources in groups of 20 for max speed
  const groups:typeof RSS_SOURCES[]=[];
  for(let i=0;i<RSS_SOURCES.length;i+=20) groups.push(RSS_SOURCES.slice(i,i+20) as unknown as typeof RSS_SOURCES);
  for(const group of groups) await Promise.allSettled((group as typeof RSS_SOURCES).map(fetchOne));
  return all;
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
    const articles = await fetchLiveNews((chunk)=>{
      setLiveNews(prev=>{
        const existingIds=new Set(prev.map(a=>a.id));
        const newOnes=chunk.filter(a=>!existingIds.has(a.id));
        return newOnes.length ? [...newOnes,...prev].slice(0,200) : prev;
      });
      setLiveLoading(false);
    });
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
    refreshTimerRef.current=setInterval(()=>refresh(),60*1000);
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
  type EventItem = {id:number;date:string;month:string;day:string;title:string;loc:string;type:string;lat:number;lng:number;attendees:number;isUser?:boolean;desc?:string;mode?:string;link?:string};
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
  const modeFilters=["💻 En ligne","🔄 Hybride","🏛️ Présentiel"];
  const filtered=filter==="Tout"?allEvents:modeFilters.includes(filter)?allEvents.filter(e=>e.mode===filter):allEvents.filter(e=>e.type===filter);
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
      <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:2}}>
        {["Tout","💻 En ligne","🔄 Hybride","🏛️ Présentiel","Conférence","Forum","Sommet","Webinaire","Simulation","Concours","Commémoration"].map(f=>(
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
                {ev.mode&&<div style={{marginBottom:6}}><span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:6,background:ev.mode.includes("ligne")?"#3B82F615":ev.mode.includes("Hybride")?"#F59E0B15":"#10B98115",color:ev.mode.includes("ligne")?"#3B82F6":ev.mode.includes("Hybride")?"#F59E0B":"#10B981",border:`1px solid ${ev.mode.includes("ligne")?"#3B82F630":ev.mode.includes("Hybride")?"#F59E0B30":"#10B98130"}`}}>{ev.mode}</span></div>}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                  <span style={{color:T.muted,fontSize:11}}>
                    {dist!==null?`📍 ${fmtDist(dist)} · `:""}{ev.attendees} inscrit{ev.attendees>1?"s":""}
                  </span>
                  <div style={{display:"flex",gap:6}}>
                    {ev.link&&<a href={ev.link} target="_blank" rel="noopener noreferrer" style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${T.blueB}50`,background:T.blueG,color:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textDecoration:"none"}}>🔗 Suivre</a>}
                    <button onClick={()=>setReg(s=>{const ns=new Set(s);ns.has(ev.id)?ns.delete(ev.id):ns.add(ev.id);return ns;})} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${reg.has(ev.id)?T.green:T.blueB}`,background:reg.has(ev.id)?`${T.green}15`:T.blueG,color:reg.has(ev.id)?T.green:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                      {reg.has(ev.id)?"✓ Inscrit":"S'inscrire"}
                    </button>
                  </div>
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
  const [azk,setAzk] = useState(typeof window!=="undefined"?localStorage.getItem("azure_tts_key")||"":"");
  const [azr,setAzr] = useState(typeof window!=="undefined"?localStorage.getItem("azure_tts_region")||"eastus":"");
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
          <p style={{color:T.muted,fontSize:10,marginTop:6}}>Sans clé : voix navigateur. Avec clé : voix naturelles ElevenLabs.</p>
        </div>
        {/* Azure TTS */}
        <div style={{background:T.bg2,borderRadius:12,padding:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <div style={{width:28,height:28,borderRadius:7,background:"#0078d420",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:14}}>🔊</span></div>
            <div style={{flex:1}}>
              <p style={{color:T.text,fontSize:13,fontWeight:800}}>Clé Azure TTS <span style={{color:T.green,fontSize:10,fontWeight:700}}>(recommandé — voix DeniseNeural)</span></p>
              <p style={{color:T.muted,fontSize:10}}>portal.azure.com → Speech → F0 gratuit · 500 000 chars/mois</p>
            </div>
            {azk&&<div style={{width:8,height:8,borderRadius:"50%",background:T.green,flexShrink:0}}/>}
          </div>
          <input type="password" value={azk} onChange={e=>{setAzk(e.target.value);save("azure_tts_key",e.target.value);}} placeholder="Clé Azure Speech…" style={{width:"100%",background:T.surf,border:`1px solid ${azk?T.green:T.b1}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box",marginBottom:6}}/>
          <input type="text" value={azr} onChange={e=>{setAzr(e.target.value);save("azure_tts_region",e.target.value);}} placeholder="Région (ex: eastus, westeurope…)" style={{width:"100%",background:T.surf,border:`1px solid ${T.b1}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
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
  {id:1,title:"Appel du 18 juin",speaker:"Charles de Gaulle",year:"1940",country:"🇫🇷",theme:"Résistance",excerpt:"Quoi qu'il arrive, la flamme de la résistance française ne doit pas s'éteindre et ne s'éteindra pas.",techniques:["Pathos","Urgence","Autorité morale","Antithèse"],context:"Prononcé à la radio de Londres le 18 juin 1940, lendemain de l'armistice demandé par Pétain, ce discours fonde symboliquement la France libre. De Gaulle, général peu connu, s'adresse à la nation depuis l'exil.",analysis:"De Gaulle construit son éthos sur sa seule conviction morale, sans légitimité institutionnelle. La métaphore de la flamme inextinguible crée une image mémorable et durable. L'usage du futur assertif (\"ne s'éteindra pas\") transforme un espoir en certitude, mobilisant le pathos patriotique."},
  {id:2,title:"I Have a Dream",speaker:"Martin Luther King",year:"1963",country:"🇺🇸",theme:"Droits civiques",excerpt:"J'ai le rêve qu'un jour cette nation se lèvera et vivra selon la vraie signification de ses croyances : nous tenons ces vérités pour évidentes que tous les hommes sont créés égaux.",techniques:["Anaphore","Métaphore prophétique","Vision","Références bibliques"],context:"Prononcé le 28 août 1963 lors de la Marche sur Washington devant 250 000 personnes, au pied du Lincoln Memorial. Le contexte de ségrégation raciale légale dans les États du Sud rend ce discours politiquement explosif.",analysis:"King utilise une anaphore répétée huit fois ('I have a dream') qui crée un rythme hypnotique emprunté aux sermons baptistes. Il ancre son pathos dans la douleur collective des Afro-Américains avant de projeter une vision universelle. Les références bibliques et à la Constitution renforcent la légitimité (éthos) d'un mouvement pacifique."},
  {id:3,title:"Discours de libération",speaker:"Nelson Mandela",year:"1990",country:"🇿🇦",theme:"Liberté",excerpt:"Je me tiens devant vous non pas comme un prophète, mais comme votre humble serviteur, serviteur du peuple de ce pays magnifique qui a souffert et sacrifié tellement.",techniques:["Humilité rhétorique","Éthos","Rassemblement","Anaphore"],context:"Prononcé à Cape Town le 11 février 1990, jour de sa libération après 27 ans d'emprisonnement à Robben Island. Mandela s'adresse à des dizaines de milliers de partisans qui voient en lui un symbole vivant de résistance.",analysis:"La captatio benevolentiae par l'humilité ('non pas comme prophète mais comme serviteur') désarme toute accusation de messianisme tout en renforçant paradoxalement son autorité morale. Mandela construit un éthos du sacrifice personnel pour transcender les clivages raciaux, anticipant la politique de réconciliation nationale."},
  {id:4,title:"Yes We Can",speaker:"Barack Obama",year:"2008",country:"🇺🇸",theme:"Politique",excerpt:"C'est la réponse de l'Amérique à ceux qui ont dit que nous ne pouvions pas. C'est le changement qui arrive en Amérique. Oui, nous pouvons.",techniques:["Anaphore","Espoir","Logos historique","Climax"],context:"Discours prononcé à Chicago le 4 novembre 2008 après sa victoire électorale, Obama devient le premier président afro-américain des États-Unis. Le pays sort d'une crise financière majeure et de deux guerres.",analysis:"Obama maîtrise le crescendo émotionnel : il commence par reconnaître les difficultés (logos), intègre des témoignages individuels (pathos) avant de culminer sur un appel à l'espoir collectif. La formule 'Yes We Can' en anaphore transforme le slogan de campagne en manifeste historique, jouant sur la mémoire collective du mouvement des droits civiques."},
  {id:5,title:"Le Rideau de fer",speaker:"Winston Churchill",year:"1946",country:"🇬🇧",theme:"Géopolitique",excerpt:"De Stettin dans la Baltique à Trieste dans l'Adriatique, un rideau de fer est descendu à travers le Continent européen.",techniques:["Métaphore fondatrice","Gravitas","Avertissement prophétique","Énumération géographique"],context:"Prononcé le 5 mars 1946 à Fulton, Missouri, devant le président Truman, ce discours est considéré comme le coup d'envoi officiel de la Guerre froide. Churchill n'est plus Premier ministre mais jouit d'une autorité morale internationale immense.",analysis:"La métaphore du 'rideau de fer' est une création rhétorique qui va structurer le discours géopolitique mondial pendant 45 ans. Churchill utilise une énumération de villes européennes pour ancrer l'abstraction dans la géographie concrète. Sa gravitas de vainqueur de guerre lui confère un éthos unique pour lancer cet avertissement."},
  {id:6,title:"Discours sur la peine de mort",speaker:"Robert Badinter",year:"1981",country:"🇫🇷",theme:"Justice",excerpt:"J'ai l'honneur, au nom du gouvernement de la République, de demander à l'Assemblée nationale l'abolition de la peine de mort en France.",techniques:["Éthos institutionnel","Pathos humaniste","Logos juridique","Solennité"],context:"Prononcé le 17 septembre 1981 à l'Assemblée nationale par le Garde des Sceaux Robert Badinter. La France était l'un des derniers pays d'Europe occidentale à pratiquer encore la guillotine.",analysis:"Badinter construit un argumentaire en trois registres : l'éthos du juriste et avocat engagé, le pathos de la souffrance des condamnés à mort innocents qu'il a défendus, et le logos des statistiques montrant l'inefficacité de la peine capitale comme deterrent. Sa rhétorique sobre et dépourvue d'excès émotionnel renforce paradoxalement la puissance de son appel."},
  {id:7,title:"Discours sur l'IVG",speaker:"Simone Veil",year:"1974",country:"🇫🇷",theme:"Droits des femmes",excerpt:"Je voudrais tout d'abord vous faire part d'une conviction de femme. Je m'excuse de le faire devant cette Assemblée presque exclusivement composée d'hommes.",techniques:["Captatio ironi­que","Éthos de témoignage","Pathos féminin","Courage politique"],context:"Prononcé le 26 novembre 1974 à l'Assemblée nationale devant une chambre à plus de 95% masculine. Simone Veil, rescapée des camps de concentration, défend en tant que Ministre de la Santé le projet de loi sur l'interruption volontaire de grossesse.",analysis:"Veil ouvre avec une ironie subtile ('je m'excuse de le faire devant cette Assemblée presque exclusivement composée d'hommes') qui retourne la marginalisation en arme rhétorique. Son éthos de survivante de la Shoah lui confère une autorité morale absolue pour parler de souffrance humaine. Elle évite l'idéologie pour s'appuyer sur des faits médicaux concrets, construisant un logos irrésistible."},
  {id:8,title:"Discours de Verdun",speaker:"François Mitterrand",year:"1984",country:"🇫🇷",theme:"Réconciliation européenne",excerpt:"Il n'y a rien de plus fort que ces deux hommes qui se tiennent la main, après tout ce que nos peuples ont vécu.",techniques:["Symbolisme gestuel","Silence éloquent","Pathos historique","Vision européenne"],context:"Le 22 septembre 1984, François Mitterrand et Helmut Kohl se tiennent la main devant l'ossuaire de Douaumont, à Verdun, où reposent 130 000 soldats. Le geste accompagne un discours sobre sur la réconciliation franco-allemande.",analysis:"Ce discours illustre que l'éloquence peut résider dans l'économie de mots : Mitterrand laisse le lieu et le geste parler. Il construit une narration du dépassement : la douleur partagée devient le socle d'une union nouvelle. La poignée de main avec Kohl, plus que les mots, constitue l'acte rhétorique majeur."},
  {id:9,title:"Discours de la Marche sur Washington",speaker:"Frederick Douglass",year:"1852",country:"🇺🇸",theme:"Esclavage",excerpt:"Qu'est-ce que le 4 juillet pour l'esclave américain ? Une journée qui révèle, plus que toutes les autres, l'injustice et la cruauté criardes dont il est victime constante.",techniques:["Antithèse","Ironie socratique","Pathos","Rupture rhétorique"],context:"Prononcé à Rochester le 5 juillet 1852, ce discours interroge le sens de la fête nationale américaine pour les esclaves. Frederick Douglass, lui-même ancien esclave et abolitionniste célèbre, parle devant une audience blanche libérale.",analysis:"Douglass utilise une structure en deux temps : il commence par célébrer les fondateurs américains (captatio benevolentiae) pour mieux retourner cette rhétorique contre l'institution esclavagiste. L'ironie socratique ('qu'est-ce que le 4 juillet pour l'esclave ?') transforme la fête nationale en accusation. C'est l'un des exemples les plus parfaits d'antithèse dans l'histoire de l'éloquence."},
  {id:10,title:"Discours pour la liberté",speaker:"John Stuart Mill",year:"1859",country:"🇬🇧",theme:"Liberté d'expression",excerpt:"Si toute l'humanité moins une personne était d'une même opinion, l'humanité ne serait pas pour autant plus fondée à faire taire cette personne qu'elle ne le serait à la faire taire si elle avait ce pouvoir.",techniques:["Paradoxe","Logos philosophique","Universalisme","Démonstration par l'absurde"],context:"Extrait de l'essai 'On Liberty' (1859), considéré comme la défense la plus complète de la liberté d'expression dans la pensée libérale. Mill écrivit cet ouvrage avec sa femme Harriet Taylor dans le contexte victorien d'une Angleterre en pleine industrialisation.",analysis:"Mill construit un logos philosophique implacable : la vérité ne peut émerger que du libre confrontation des idées, y compris les idées fausses. Son argument paradoxal — que même une seule voix dissidente mérite d'être entendue — transforme la minorité en garant de la liberté collective. La rigueur logique supplante toute rhétorique émotionnelle."},
  {id:11,title:"Tryst with Destiny",speaker:"Jawaharlal Nehru",year:"1947",country:"🇮🇳",theme:"Indépendance",excerpt:"A minuit, quand le monde dort, l'Inde s'éveillera à la vie et à la liberté. Un moment arrive, rare dans l'histoire, où nous sortons de l'ancien pour passer vers le nouveau.",techniques:["Métaphore du réveil","Poésie en prose","Pathos national","Logos historique"],context:"Prononcé dans la nuit du 14 au 15 août 1947 à New Delhi devant l'Assemblée constituante, lors de l'accession de l'Inde à l'indépendance après 200 ans de colonisation britannique. Nehru devient le premier Premier ministre de la République indienne.",analysis:"Nehru, formé à Cambridge, maîtrise une rhétorique anglophone d'une rare beauté littéraire. La métaphore du 'rendez-vous avec le destin' (tryst with destiny) élève le moment politique au rang d'événement cosmique. L'image de l'aube ('minuit... l'Inde s'éveille') structure l'ensemble du discours autour d'une renaissance symbolique."},
  {id:12,title:"Je suis prêt à mourir",speaker:"Nelson Mandela",year:"1964",country:"🇿🇦",theme:"Justice",excerpt:"J'ai lutté contre la domination blanche, et j'ai lutté contre la domination noire. J'ai chéri l'idéal d'une société démocratique et libre. C'est un idéal pour lequel j'espère vivre — mais si nécessaire, c'est un idéal pour lequel je suis prêt à mourir.",techniques:["Chiasme","Gradation dramatique","Éthos du martyr","Antithèse"],context:"Prononcé lors du procès de Rivonia en avril 1964, Mandela risque la peine de mort. Ce discours est la déclaration finale devant le tribunal avant qu'il soit condamné à la prison à vie. Il est considéré comme l'un des plus grands discours du XXe siècle.",analysis:"La structure en chiasme ('domination blanche... domination noire') affirme une symétrie morale qui dépasse les clivages raciaux. La gradation finale — vivre, puis mourir pour un idéal — crée un climax d'une puissance émotionnelle extraordinaire. Mandela transforme son procès en tribune politique, renversant la rhétorique du pouvoir contre lui-même."},
  {id:13,title:"Discours à l'ONU - Bandung",speaker:"Sukarno",year:"1955",country:"🇮🇩",theme:"Non-alignement",excerpt:"Nous, les peuples d'Asie et d'Afrique, nous représentons plus de la moitié de la population humaine. Nous pouvons mobiliser la volonté et les ressources de la moitié du monde.",techniques:["Logos démographique","Identité collective","Vision tiers-mondiste","Ethos continental"],context:"Discours d'ouverture de la Conférence de Bandung du 18 au 24 avril 1955, qui réunit 29 nations afro-asiatiques pour affirmer une troisième voie entre le bloc américain et soviétique. Sukarno, président de l'Indonésie indépendante depuis 1945, en est l'architecte principal.",analysis:"Sukarno construit un logos numérique impressionnant — la démographie comme argument géopolitique — qui préfigure les débats contemporains sur la montée du Sud global. Il forge une identité collective nouvelle, le 'tiers-monde', en réunissant des peuples aux histoires disparates autour du prisme commun du colonialisme vécu. C'est une rhétorique de la dignité collective."},
  {id:14,title:"Discours sur la décolonisation",speaker:"Patrice Lumumba",year:"1960",country:"🇨🇩",theme:"Décolonisation",excerpt:"Notre sort d'esclave fut imposé par la force. Nous avons connu les ironies, les insultes, les coups que nous devions subir matin, midi et soir parce que nous étions des nègres.",techniques:["Accusation directe","Rupture protocolaire","Pathos de la dignité","Témoignage historique"],context:"Prononcé le 30 juin 1960 lors de la cérémonie d'indépendance du Congo en présence du roi Baudouin de Belgique. Ce discours improvisé, en rupture avec les discours officiels convenus, provoque un incident diplomatique majeur.",analysis:"Lumumba rompt délibérément avec le protocole diplomatique pour nommer la violence coloniale devant le colonisateur lui-même. Cette transgression rhétorique transforme la cérémonie en acte politique. Le discours use d'un pathos collectif intense — 'nous avons connu' — pour faire de chaque Congolais le sujet d'un témoignage historique."},
  {id:15,title:"Discours de Accra - Indépendance",speaker:"Kwame Nkrumah",year:"1957",country:"🇬🇭",theme:"Panafricanisme",excerpt:"Le Ghana, notre pays bien-aimé, est libre pour toujours ! L'étoile de l'Afrique est en train de se lever. Nous allons démontrer au monde, à d'autres nations, que la liberté du Ghana est indissociable de la libération de l'Afrique.",techniques:["Vision panafricaine","Symbolisme de l'étoile","Anaphore","Universalisme africain"],context:"Prononcé le 6 mars 1957 à Accra lors de l'indépendance du Ghana (ancienne Gold Coast britannique), qui devient le premier pays d'Afrique subsaharienne à accéder à l'indépendance. Nkrumah devient Premier ministre.",analysis:"Nkrumah dépasse le cadre national pour formuler une vision continentale : l'indépendance du Ghana comme point de départ de la libération africaine entière. La métaphore de l'étoile montante ('étoile de l'Afrique') inscrit le moment dans une cosmologie symbolique. Il relie habilement destinée nationale et destin continental."},
  {id:16,title:"Discours de l'abolition de l'esclavage",speaker:"Abbé Grégoire",year:"1789",country:"🇫🇷",theme:"Abolition",excerpt:"L'esclavage est un crime contre l'humanité. Tout homme naît libre et égal ; c'est la loi de la nature que le préjugé a voulu effacer, que la philosophie rétablit.",techniques:["Droit naturel","Logos philosophique","Universalisme des Lumières","Pathos moral"],context:"Prononcé à l'Assemblée nationale constituante en 1789, l'abbé Grégoire est l'un des premiers à porter devant la Révolution française la question de l'abolition de l'esclavage et de l'égalité des droits pour les hommes de couleur.",analysis:"Grégoire ancre son argumentation dans la philosophie des Lumières — le droit naturel comme référentiel universel — pour rendre l'esclavage logiquement incompatible avec les principes révolutionnaires. Il transforme une question économique (la traite négrière) en question morale et philosophique incontournable."},
  {id:17,title:"Discours sur les libertés - Nobel",speaker:"Albert Camus",year:"1957",country:"🇫🇷",theme:"Littérature & engagement",excerpt:"Chaque génération, sans doute, se croit vouée à refaire le monde. La mienne sait pourtant qu'elle ne le refera pas. Mais sa tâche est peut-être plus grande : elle est d'empêcher que le monde se défasse.",techniques:["Paradoxe générationnel","Éthos de l'artiste","Pathos existentiel","Humilité épique"],context:"Prononcé à Stockholm le 10 décembre 1957 lors de la remise du Prix Nobel de Littérature. Camus, alors âgé de 44 ans, évoque sa génération marquée par la Seconde Guerre mondiale, l'Occupation et la Résistance.",analysis:"Camus construit un paradoxe frappant : la grandeur d'une génération incapable de 'refaire le monde' réside précisément dans sa résistance au chaos. L'humilité épique — reconnaître les limites pour mieux affirmer la tâche — est une figure rhétorique rare. Sa prose littéraire donne au discours une densité poétique qui transcende l'occasion."},
  {id:18,title:"Discours I am an African",speaker:"Thabo Mbeki",year:"1996",country:"🇿🇦",theme:"Identité africaine",excerpt:"Je suis né à la fois du sang des Khoisan et des esclaves, des guerriers et des missionnaires. Je suis le produit de la Grande Bretagne, de l'Europe, de l'Inde, de l'Afrique noire. Je suis africain.",techniques:["Identité plurielle","Anaphore identitaire","Pathos historique","Inclusion"],context:"Prononcé le 8 mai 1996 lors de l'adoption de la Constitution post-apartheid de l'Afrique du Sud, ce discours incarne la vision d'une 'Rainbow Nation' plurielle et réconciliée que Mbeki défend en tant que vice-président.",analysis:"Mbeki construit une identité africaine inclusive par accumulation — chaque couche historique (colonisation, esclavage, résistance) enrichit plutôt qu'elle ne divise. L'anaphore 'Je suis africain' crée une identité rhétorique ouverte à tous les héritages. C'est une réponse poétique à l'apartheid qui divisait l'humanité en catégories raciales."},
  {id:19,title:"Discours de Harlem - contre la guerre du Vietnam",speaker:"Malcolm X",year:"1964",country:"🇺🇸",theme:"Droits civiques",excerpt:"Nous ne sommes pas Américains. Nous sommes victimes de l'Amérique. La différence est importante car c'est en tant que victimes que nous avons le droit de nous défendre.",techniques:["Redéfinition sémantique","Logos radical","Rupture identitaire","Urgence"],context:"Prononcé en 1964 lors d'une réunion publique à Harlem, Malcolm X s'oppose à l'intégrationnisme de King et prône l'auto-défense et l'autonomie noire. Ce discours illustre la radicalisation du mouvement des droits civiques.",analysis:"Malcolm X utilise une redéfinition rhétorique puissante : en renommant les Noirs américains 'victimes' plutôt que 'citoyens', il reframe le problème politique entier. Cette stratégie sémantique lui permet de justifier une posture défensive plus radicale. La logique est implacable même si les conclusions sont controversées."},
  {id:20,title:"Discours de Mexico - He for She",speaker:"Emma Watson",year:"2014",country:"🇺🇳",theme:"Féminisme",excerpt:"Féminisme par définition signifie la croyance en l'égalité politique, économique et sociale des sexes. Si vous défendez l'égalité des sexes, vous êtes féministe.",techniques:["Redéfinition inclusive","Éthos de la célébrité","Logos définitionnel","Appel à l'universel"],context:"Prononcé le 20 septembre 2014 au siège de l'ONU à New York, Emma Watson, actrice et ambassadrice de bonne volonté pour ONU Femmes, lance la campagne 'HeForShe' invitant les hommes à s'engager pour l'égalité des genres.",analysis:"Watson commence par une redéfinition stratégique du féminisme pour désarmer la résistance masculine au terme. Son éthos de célébrité est délibérément mis au service de la cause plutôt que de sa propre image. Elle construit un logos inclusif : le féminisme comme mouvement universel bénéficiant à tous les genres."},
  {id:21,title:"Discours de Pretoria à sa sortie de prison",speaker:"Nelson Mandela",year:"1994",country:"🇿🇦",theme:"Réconciliation",excerpt:"Jamais, jamais et jamais encore cette belle terre ne connaîtra l'oppression de l'un par l'autre. Le soleil ne se couchera plus sur un si glorieux accomplissement humain. Que la liberté règne.",techniques:["Triple anaphore","Hyperbole temporelle","Vision utopique","Clôture solennelle"],context:"Discours d'investiture du 10 mai 1994 à Pretoria, Mandela devient le premier président noir d'Afrique du Sud après les premières élections multiraciales. C'est la conclusion historique de 350 ans d'oppression raciale institutionnalisée.",analysis:"Mandela emploie une triple anaphore 'jamais, jamais et jamais encore' qui fait écho à son discours de 1964 mais cette fois comme proclamation victorieuse plutôt que comme engagement. L'hyperbole solaire ('le soleil ne se couchera plus') élève le moment au rang de mythe fondateur. Le discours est construit comme une clôture historique."},
  {id:22,title:"Discours du Che à l'ONU",speaker:"Ernesto Che Guevara",year:"1964",country:"🇨🇺",theme:"Impérialisme",excerpt:"Nous devons proclamer que les victoires révolutionnaires ne s'exportent pas, mais qu'elles ne s'arrêtent pas aux frontières non plus. Un peuple qui ne cesse pas de lutter finit toujours par être vainqueur.",techniques:["Logos révolutionnaire","Paradoxe","Éthos du combattant","Internationalisme"],context:"Prononcé le 11 décembre 1964 à l'Assemblée générale des Nations Unies, le Che Guevara représente Cuba et dénonce l'impérialisme américain et la politique de l'apartheid. Le discours est prononcé en pleine Guerre froide, après la crise des missiles de Cuba (1962).",analysis:"Le Che construit un paradoxe rhétorique sur l'exportabilité de la révolution pour affirmer simultanément l'autonomie de chaque peuple et la solidarité internationale. Son éthos de guerrier qui a combattu au Congo et en Bolivie renforce la crédibilité d'un discours sur la lutte armée. La franchise provocatrice face à l'auditoire diplomatique est elle-même un acte rhétorique."},
  {id:23,title:"Discours de Carthagène - Simón Bolívar",speaker:"Simón Bolívar",year:"1812",country:"🇻🇪",theme:"Révolution",excerpt:"L'union dans nos États-Unis d'Amérique du Sud fera notre force. Divisés, nous tomberons un par un ; unis, nous formons un bloc indestructible.",techniques:["Antithèse union/division","Vision continentale","Éthos du libérateur","Logos militaire"],context:"Le Manifeste de Carthagène, rédigé en 1812 alors que Bolívar est en exil après la chute de la Première République du Venezuela, définit sa vision politique et militaire pour libérer l'Amérique du Sud de la domination espagnole.",analysis:"Bolívar utilise une antithèse classique (divisés/unis) pour articuler une vision géopolitique continentale bien avant son temps. Son logos militaire — l'unité comme condition de la victoire — est en même temps une vision politique de l'intégration latino-américaine. Il préfigure les débats contemporains sur l'UNASUR et le Mercosur."},
  {id:24,title:"Discours à l'ONU - Olive Branch",speaker:"Yasser Arafat",year:"1974",country:"🇵🇸",theme:"Droits nationaux",excerpt:"Je suis venu avec un rameau d'olivier dans une main et le fusil d'un combattant de la liberté dans l'autre. Ne laissez pas le rameau d'olivier tomber de ma main.",techniques:["Symbolisme de l'olivier","Métaphore des deux mains","Paradoxe guerre/paix","Appel dramatique"],context:"Prononcé le 13 novembre 1974 à l'Assemblée générale de l'ONU, Arafat est le premier représentant d'une organisation non gouvernementale invité à s'exprimer devant l'assemblée. L'OLP vient d'être reconnue comme seul représentant légitime du peuple palestinien.",analysis:"Arafat construit une métaphore visuelle puissante des deux mains — l'olivier de la paix et le fusil de la résistance — qui condense la dialectique de la lutte armée et de la diplomatie. La mise en scène de sa propre personne comme symbole vivant est une stratégie d'éthos corporel rare. Son appel final constitue une injonction directe à l'Assemblée."},
  {id:25,title:"Sankara - Discours à l'OUA",speaker:"Thomas Sankara",year:"1987",country:"🇧🇫",theme:"Dette africaine",excerpt:"La dette est un reconquête savamment organisée de l'Afrique. La dette est l'ennemi déclaré de la liberté des peuples. Qui ne comprend pas ça ne comprend rien à l'économie politique du monde.",techniques:["Logos économique radical","Métaphore de la reconquête","Urgence rhétorique","Interpellation directe"],context:"Prononcé à Addis-Abeba en juillet 1987 lors du sommet de l'Organisation de l'Unité Africaine, six mois avant son assassinat. Sankara, président révolutionnaire du Burkina Faso depuis 1983, propose que les pays africains refusent collectivement de rembourser leur dette.",analysis:"Sankara réinterprète la dette financière comme instrument de domination politique — une analyse qui préfigure les théories contemporaines sur le néocolonialisme économique. Sa rhétorique directe et imagée ('reconquête savamment organisée') transforme un débat technocratique en mobilisation politique. L'interpellation brutale à ses homologues africains est une stratégie de honte collective."},
  {id:26,title:"Discours de Moscou - Harvey Milk",speaker:"Harvey Milk",year:"1978",country:"🇺🇸",theme:"Droits LGBTQ+",excerpt:"Je suis ici pour recruter. On vous a dit que nous recrutez. Je suis ici pour dire que oui, nous recrutons. Nous recrutons des enfants pour nos familles.",techniques:["Ironie retournée","Humour politique","Éthos du témoin","Inversion du stigmate"],context:"Prononcé en 1978 à San Francisco, Harvey Milk, premier élu ouvertement gay des États-Unis, s'adresse à ses partisans lors d'une célébration du Gay Freedom Day. Il sera assassiné la même année.",analysis:"Milk emploie une stratégie rhétorique de l'ironie retournée : en acceptant ironiquement l'accusation de 'recrutement', il la vide de son sens et révèle son absurdité. L'humour politique permet de désarmer la peur. Son éthos de témoin — il parle de ce qu'il a vécu — donne une authenticité irremplaçable à sa défense des droits LGBTQ+."},
  {id:27,title:"Discours sur la tolérance",speaker:"Václav Havel",year:"1990",country:"🇨🇿",theme:"Démocratie",excerpt:"Nous vivons dans une époque souillée. Et il nous appartient, à nous qui vivons dans cette époque, de la purifier. Le péché contre l'esprit est de ne pas reconnaître sa propre responsabilité.",techniques:["Responsabilité collective","Logos moral","Éthos du dissident","Métaphore de la purification"],context:"Prononcé lors du discours du Nouvel An de 1990, Havel s'adresse à la Tchécoslovaquie comme premier président post-communiste après la Révolution de velours. Il a été emprisonné plusieurs fois pour dissidence sous le régime communiste.",analysis:"Havel opère un renversement moral : plutôt que d'accabler les anciens oppresseurs, il invite chaque citoyen à examiner sa propre complicité passive. Cette rhétorique de la responsabilité partagée prépare la réconciliation nationale. Son éthos de dissident qui refuse la revanche lui donne une autorité morale exceptionnelle pour ce discours de refondation."},
  {id:28,title:"Discours Nobel de la Paix",speaker:"Mother Teresa",year:"1979",country:"🇮🇳",theme:"Pauvreté",excerpt:"Je trouve que le plus grand destructeur de paix aujourd'hui est l'avortement, parce que c'est une guerre directe, un meurtre direct par la mère elle-même.",techniques:["Éthos de la sainteté","Paradoxe choquant","Provocation délibérée","Témoignage direct"],context:"Prononcé à Oslo le 10 décembre 1979, Mother Teresa, fondatrice des Missionnaires de la Charité à Calcutta, reçoit le Prix Nobel de la Paix pour son travail auprès des plus démunis. Son discours provoque une controverse immédiate.",analysis:"Mother Teresa utilise son éthos immense de 'sainte des bidonvilles' pour avancer des positions controversées. La provocation rhétorique — relier avortement et destruction de la paix — illustre comment l'autorité morale peut légitimer des arguments difficiles. Ce discours montre les limites et la puissance de l'éthos comme ressource rhétorique."},
  {id:29,title:"Discours du Moi suis président",speaker:"Malala Yousafzai",year:"2013",country:"🇵🇰",theme:"Éducation",excerpt:"Les terroristes pensaient qu'ils allaient changer mes objectifs et arrêter mes ambitions. Mais rien n'a changé dans ma vie, sauf ceci : la faiblesse, la peur et le désespoir sont morts. La force, le pouvoir et le courage sont nés.",techniques:["Antithèse mort/naissance","Éthos du survivant","Pathos du courage","Vision universelle"],context:"Prononcé le 12 juillet 2013 à l'ONU à New York, jour de son 16e anniversaire, Malala Yousafzai, rescapée d'une tentative d'assassinat par les talibans au Pakistan, plaide pour le droit universel à l'éducation.",analysis:"Malala transforme son attentat personnel en argument universel : la tentative d'assassin a produit l'effet inverse de celui recherché. L'antithèse mort/naissance (faiblesse/courage) structure un récit de renaissance qui transcende sa propre histoire pour devenir métaphore d'une génération entière. Son jeune âge renforce paradoxalement son autorité."},
  {id:30,title:"Discours COP21 - Notre maison brûle",speaker:"Greta Thunberg",year:"2019",country:"🇸🇪",theme:"Climat",excerpt:"Comment osez-vous ? Vous avez volé mes rêves et mon enfance avec vos paroles creuses. Et pourtant je suis l'une des chanceux. Les gens souffrent. Les gens meurent. Des écosystèmes entiers s'effondrent.",techniques:["Interpellation directe","Pathos de la jeunesse","Accusation morale","Anaphore de la douleur"],context:"Prononcé le 23 septembre 2019 au Sommet Action Climat de l'ONU à New York, Greta Thunberg, alors âgée de 16 ans, s'adresse directement aux dirigeants mondiaux lors de son discours le plus viral.",analysis:"Thunberg rompt délibérément avec le registre diplomatique — 'comment osez-vous ?' est une interpellation frontale sans précédent dans une enceinte internationale. Sa stratégie rhétorique repose entièrement sur le pathos de la génération future sacrifiée. L'accusation directe sans argument alternatif force les auditeurs à se positionner moralement."},
  {id:31,title:"Discours à la Rada ukrainienne",speaker:"Volodymyr Zelensky",year:"2022",country:"🇺🇦",theme:"Résistance",excerpt:"Je suis ici. Nous ne déposerons pas les armes. Nous défendrons notre pays, parce que nos armes sont la vérité.",techniques:["Presence physique comme argument","Conviction simple","Éthos du courage","Logos de la légitimité"],context:"Prononcé le 25 février 2022, le lendemain de l'invasion russe à grande échelle de l'Ukraine, Zelensky répond aux rumeurs de fuite en enregistrant une vidéo depuis les rues de Kiev avec ses collaborateurs.",analysis:"Zelensky transforme sa présence physique à Kiev en argument rhétorique central : rester est en soi le discours. Le logos minimal ('nos armes sont la vérité') associé au contexte dramatique crée un impact maximal. Ce discours illustre comment le contexte peut amplifier des mots simples jusqu'à l'épique."},
  {id:32,title:"Discours de Pearl Harbor",speaker:"Franklin D. Roosevelt",year:"1941",country:"🇺🇸",theme:"Guerre",excerpt:"Le 7 décembre 1941 — une date qui vivra dans l'infamie — les États-Unis d'Amérique ont été soudainement et délibérément attaqués par les forces navales et aériennes de l'Empire du Japon.",techniques:["Date comme condamnation morale","Gravitas présidentielle","Logos factuel","Appel à l'unité nationale"],context:"Prononcé devant le Congrès américain le 8 décembre 1941, le lendemain de l'attaque japonaise sur Pearl Harbor, FDR demande la déclaration de guerre. C'est l'un des discours les plus courts et les plus célèbres de l'histoire américaine (7 minutes).",analysis:"Roosevelt emploie une stratégie de narration factuelle totalement dépourvue d'ornements rhétoriques — les faits bruts comme argument irréfutable. La formule 'date qui vivra dans l'infamie' est un condensé d'éthos (présidentiel), de logos (la réalité de l'attaque) et de pathos (la honte internationale de l'agresseur). La brièveté renforce la solennité."},
  {id:33,title:"Discours de Gettysburg",speaker:"Abraham Lincoln",year:"1863",country:"🇺🇸",theme:"Démocratie",excerpt:"Il y a quatre-vingt-sept ans, nos pères ont créé sur ce continent une nation nouvelle, conçue dans la Liberté et dédiée au principe que tous les hommes sont créés égaux.",techniques:["Incipit mémorable","Cadre historique","Vision démocratique","Économie oratoire"],context:"Prononcé le 19 novembre 1863 lors de la dédicace du cimetière national de Gettysburg, 4 mois après la bataille sanglante qui fit 50 000 victimes. Lincoln parle pendant seulement 3 minutes, après un discours de 2 heures d'Edward Everett.",analysis:"Lincoln révolutionne l'art oratoire par la brièveté et la densité : en 272 mots, il redéfinit la guerre civile comme lutte pour l'idéal démocratique universel. La structure tripartite (passé/présent/futur) donne au discours une architecture temporelle. L'incipit 'Il y a quatre-vingt-sept ans' est devenu l'un des plus célèbres de l'histoire."},
  {id:34,title:"Discours Je suis Berlinois",speaker:"John F. Kennedy",year:"1963",country:"🇺🇸",theme:"Liberté",excerpt:"La fierté la plus grande, aujourd'hui, dans le monde libre, c'est de dire 'Ich bin ein Berliner'. Je suis Berlinois.",techniques:["Solidarité symbolique","Phrase en langue étrangère","Pathos de l'alliance","Climax identitaire"],context:"Prononcé le 26 juin 1963 devant 450 000 personnes à Berlin-Ouest, deux ans après la construction du Mur de Berlin par la RDA. Kennedy réaffirme l'engagement américain envers Berlin-Ouest en pleine Guerre froide.",analysis:"Kennedy utilise la langue de l'autre comme geste rhétorique de solidarité — parler allemand devant des Berlinois est un acte d'identification symbolique puissant. La structure du discours monte vers le climax de la phrase allemande, amplifiée par l'enthousiasme de la foule. C'est un exemple parfait de rhétorique de l'alliance où l'éthos se construit par l'empathie culturelle."},
  {id:35,title:"Inauguration - Ask not",speaker:"John F. Kennedy",year:"1961",country:"🇺🇸",theme:"Service civique",excerpt:"Ne demandez pas ce que votre pays peut faire pour vous — demandez ce que vous pouvez faire pour votre pays.",techniques:["Chiasme parfait","Appel au service","Inversion mémorable","Universalisme civique"],context:"Prononcé le 20 janvier 1961 lors de l'investiture présidentielle de Kennedy, le plus jeune président élu de l'histoire américaine. Le discours est préparé avec Ted Sorensen et répond au défi soviétique en pleine Guerre froide.",analysis:"Le chiasme de Kennedy ('ne demandez pas... demandez') est l'une des figures de style les plus parfaites de l'histoire oratoire. En inversant la relation État-citoyen, il reformule le contrat civique. La brièveté et la symétrie parfaite de la formule la rendent immédiatement mémorisable — critère ultime de l'efficacité rhétorique."},
  {id:36,title:"Discours sur les armes",speaker:"Gandhi",year:"1930",country:"🇮🇳",theme:"Non-violence",excerpt:"Je ne veux pas que l'Inde pratique la non-violence parce qu'elle est faible. Je veux qu'elle pratique la non-violence étant consciente de sa puissance et de sa force.",techniques:["Paradoxe force/faiblesse","Logos de la résistance","Éthos ascétique","Vision philosophique"],context:"Extrait d'une conférence de Gandhi lors de la campagne de désobéissance civile de 1930 culminant avec la Marche du Sel. Gandhi redéfinit la non-violence non comme capitulation mais comme stratégie de résistance active.",analysis:"Gandhi opère un renversement philosophique fondamental : la non-violence n'est pas l'arme des faibles mais le choix des forts qui refusent la violence. Ce paradoxe transforme la passivité en acte de puissance. Son éthos d'ascète qui jeûne jusqu'à la mort renforce la crédibilité d'un discours sur la force morale."},
  {id:37,title:"Discours de Berlin - Ich bin ein Berliner",speaker:"Konrad Adenauer",year:"1950",country:"🇩🇪",theme:"Réconciliation",excerpt:"Nous devons regarder l'avenir et non le passé. L'avenir de l'Allemagne est dans l'Europe, et l'avenir de l'Europe dans l'unité.",techniques:["Vision européenne","Rupture avec le passé","Logos pragmatique","Projection temporelle"],context:"Prononcé lors de sa politique de réconciliation franco-allemande après 1949, Adenauer, premier chancelier de la RFA, oriente délibérément l'Allemagne d'après-guerre vers l'intégration européenne plutôt que vers la revendication nationaliste.",analysis:"Adenauer emploie une rhétorique du futur délibéré pour tourner la page du nazisme sans le nier : la projection vers l'Europe sert de substitut positif à l'identité nationale problématique. C'est une rhétorique de substitution où l'idéal européen remplace le nationalisme blessé. Sa sobriété oratoire est elle-même politique."},
  {id:38,title:"Discours Libertad o Muerte",speaker:"Simón Bolívar",year:"1819",country:"🇻🇪",theme:"Indépendance",excerpt:"Nous avons obtenu notre indépendance, mais il nous reste encore à nous mériter la liberté. Et pour mériter la liberté, il faut que nous soyons capables de la maintenir.",techniques:["Distinction indépendance/liberté","Logos politique mature","Appel à la vertu","Vision républicaine"],context:"Discours du Congrès d'Angostura de 1819, Bolívar présente sa vision constitutionnelle pour la Grande Colombie naissante. Il cherche à établir des institutions républicaines durables après la guerre d'indépendance.",analysis:"Bolívar opère une distinction philosophique cruciale — l'indépendance formelle et la liberté substantielle ne sont pas synonymes — qui préfigure les débats contemporains sur la démocratie post-coloniale. Son logos politique mature reconnaît que l'émancipation n'est qu'un début. Cette nuance entre libération et liberté reste d'une actualité saisissante."},
  {id:39,title:"Discours Nobel - Liberté de la presse",speaker:"Maria Ressa",year:"2021",country:"🇵🇭",theme:"Liberté de la presse",excerpt:"Les faits sont sous attaque aujourd'hui. Sans faits, vous ne pouvez pas avoir de vérité. Sans vérité, vous ne pouvez pas avoir de confiance. Sans confiance, nous n'avons aucune réalité partagée.",techniques:["Syllogisme en cascade","Logos de la vérité","Éthos de journaliste persécutée","Urgence démocratique"],context:"Prononcé le 10 décembre 2021 à Oslo lors de la remise du Prix Nobel de la Paix, Maria Ressa, cofondatrice de Rappler aux Philippines, fait face à plusieurs procès pour ses enquêtes sur le régime de Duterte.",analysis:"Ressa construit un syllogisme rhétorique en cascade — faits, vérité, confiance, réalité — qui démontre logiquement que la liberté de la presse est la condition de la démocratie. Son éthos de journaliste poursuivie par un gouvernement autoritaire donne une dimension existentielle à un argument théorique. La concision logique est saisissante."},
  {id:40,title:"Discours You are not Forgotten",speaker:"Barack Obama",year:"2009",country:"🇺🇸",theme:"Diplomatie",excerpt:"Nous cherchons un nouveau départ entre les États-Unis et les musulmans du monde entier, basé sur l'intérêt mutuel et le respect mutuel.",techniques:["Rhétorique de l'inclusion","Logos interculturel","Éthos de l'ouverture","Vision multilatérale"],context:"Prononcé le 4 juin 2009 au Caire, Égypte, devant une audience de 3 000 personnes, ce discours marque le pivot diplomatique d'Obama vers le monde islamique après les années Bush. Obama cite le Coran et reconnaît les torts historiques américains.",analysis:"Obama emploie une rhétorique de la réciprocité — 'intérêt mutuel et respect mutuel' — pour signaler une rupture avec l'unilatéralisme américain. La citation du Coran par un président américain est un acte rhétorique interculturel sans précédent. L'éthos de l'homme au nom arabe qui reconnaît les erreurs américaines crée une crédibilité inédite dans le monde musulman."},
];
const RHETORIC_DATA=[
  {id:1,icon:"🏛️",title:"Éthos, Pathos, Logos",desc:"La triade d'Aristote",content:"ÉTHOS — Crédibilité de l'orateur\nAristote définit l'éthos comme la crédibilité que l'orateur projette. Elle repose sur trois composantes : la compétence (phronesis), la vertu morale (arété) et la bienveillance envers l'audience (eunoia). Votre expertise doit être visible, votre probité indiscutable, votre souci du bien commun manifeste.\n→ Technique : citez votre expérience directe, vos erreurs passées (humilité), vos engagements réels.\n→ Piège à éviter : l'éthos imposé ('je suis expert donc croyez-moi') suscite la méfiance. L'éthos doit être montré, pas déclaré.\n\nPATHOS — L'émotion au service de la conviction\nLe pathos ne signifie pas manipuler émotionnellement mais créer une résonance affective avec votre audience. Les neurosciences confirment (Damasio) que les décisions sont d'abord émotionnelles, puis rationalisées. Sans connexion émotionnelle, le logos reste abstrait.\n→ Technique : commencez par une anecdote concrète, un témoignage, un cas particulier avant les chiffres globaux.\n→ Hiérarchie des émotions persuasives : l'espoir > la peur > la colère > la honte. L'espoir mobilise, la peur paralyse.\n\nLOGOS — La logique comme armature\nLe logos comprend les preuves factuelles (statistiques, études, textes), les raisonnements déductifs et inductifs, et la cohérence interne du discours. Sans logos, le discours est éphémère. Sans éthos ni pathos, le logos est inaudible.\n→ Structure logique : prémisse majeure + prémisse mineure = conclusion (syllogisme). Ou : observation + généralisation (induction).\n→ Règle des 3 arguments : au-delà de 3 arguments principaux, la mémorisation chute de 60%. Sélectionner, hiérarchiser, ne pas accumuler.\n\nSYNERGIE — Comment les trois s'articulent\nLes grands orateurs maîtrisent les trois registres simultanément. King commençait par le logos historique (les promesses non tenues), passait au pathos de la douleur vécue, puis culminait avec l'éthos prophétique du rêve. L'ordre optimal : éthos (crédibilité d'abord), puis logos (démonstration), puis pathos (émotion finale pour l'action)."},
  {id:2,icon:"✍️",title:"Figures de style avancées",desc:"20 outils du discours puissant",content:"ANAPHORE — Répétition en début de phrase pour créer un rythme hypnotique.\n→ «Je refuse. Je refuse. Je refuse.» / «I have a dream...» (King, 8 fois)\n\nÉPIPHORE — Répétition en fin de phrase (effet d'insistance finale).\n→ «Le gouvernement du peuple, par le peuple, pour le peuple» (Lincoln)\n\nCHIASME — Inversion croisée de deux éléments (symétrie mémorable).\n→ «Ne demandez pas ce que votre pays peut faire pour vous, demandez ce que vous pouvez faire pour votre pays» (JFK)\n\nMÉTAPHORE FILÉE — Image développée sur plusieurs phrases.\n→ «Un rideau de fer est descendu... derrière ce rideau... dans ce secteur...» (Churchill)\n\nHYPERBOLE — Amplification délibérée pour frapper les esprits.\n→ «Nous combattrons sur les plages, dans les champs, dans les rues, nous ne nous rendrons jamais» (Churchill)\n\nLITOTE — Dire moins pour suggérer plus.\n→ «Ce n'est pas sans émotion» = je suis profondément touché.\n\nANTITHÈSE — Opposition de deux idées pour créer un contraste saisissant.\n→ «Liberté, égalité, fraternité» vs «Oppression, inégalité, division»\n\nGRADATION — Montée progressive en intensité (climax).\n→ «Du sang, de la sueur, des larmes» (Churchill — ordre croissant de gravité)\n\nAPOSTROPHE — Interpellation directe de l'audience ou d'une entité absente.\n→ «Vous, jeunes de France...» / «Ô liberté, que de crimes...»\n\nSYLLEPSE — Alliance inattendue de sens propre et figuré.\n→ «Sèche tes pleurs» (physique) et «sèche ta peine» (moral) simultanément.\n\nOXYMORE — Alliance de mots opposés créant une tension productive.\n→ «Obscure clarté» (Corneille) / «Douce violence» / «Liberté sous surveillance»\n\nPROSOPOPÉE — Faire parler une chose abstraite ou absente.\n→ «La France vous dit : relevez-vous !» / «L'histoire nous jugera»\n\nÉNUMÉRATION ASYNDÈTE — Liste sans connecteurs pour créer un effet d'accumulation.\n→ «Veni, vidi, vici» — «Je suis venu, j'ai vu, j'ai vaincu» (César)\n\nEUPHÉMISME — Atténuer une réalité difficile (à utiliser avec parcimonie).\n→ «Nettoyer ethniquement» au lieu de «massacrer» — attention : peut masquer des crimes.\n\nALLUSION — Référence implicite à un texte, événement ou personnage connu.\n→ Citer le Coran devant une audience musulmane (Obama au Caire) = geste d'inclusion.\n\nPARISOS — Deux propositions de même longueur rythmique créant un équilibre.\n→ «La paix n'est pas l'absence de guerre ; la liberté n'est pas l'absence de contrainte»\n\nINTERROGATION RHÉTORIQUE — Question sans réponse attendue pour impliquer l'audience.\n→ «Qu'est-ce que le 4 juillet pour l'esclave américain ?» (Douglass)\n\nCONCESSION-RÉFUTATION — Accorder un point adverse pour mieux le dépasser.\n→ «Certes, la mondialisation crée des inégalités. Mais supprimer les échanges ne les résoudrait pas.\"\n\nRÉPÉTITION SYNONYMIQUE — Répéter une idée avec des mots différents pour ancrer.\n→ «Nous voulons la paix, la concorde, la réconciliation, l'harmonie entre les peuples»\n\nCHUTE ÉPIPHANIQUE — Dernière phrase du discours qui synthétise et frappe définitivement.\n→ «Je suis prêt à mourir pour cet idéal» (Mandela) — silence assuré après."},
  {id:3,icon:"📐",title:"Architectures du discours",desc:"5 structures éprouvées",content:"1. STRUCTURE CLASSIQUE EN 5 ACTES (Discours politique)\nAccroche → Contexte → Développement (3 arguments) → Réfutation → Appel à l'action\n→ Quand l'utiliser : discours formel, débat préparé, plaidoirie.\n→ Durée recommandée : 10-20 minutes avec cette structure.\n→ Piège : ne pas passer plus de 40% du temps sur le développement — l'accroche et la conclusion sont décisives.\n\n2. MÉTHODE PREP (Improvisation et débat)\nP — Point : affirmez votre position en une phrase.\nR — Reason : donnez la raison principale.\nE — Example : illustrez avec un cas concret.\nP — Point : revenez à votre affirmation pour ancrer.\n→ Quand l'utiliser : oral de concours, réponse rapide, grand oral.\n→ Durée : 90 secondes à 3 minutes — idéal pour les questions flash.\n\n3. STRUCTURE NARRATIVE (Storytelling)\nSituation initiale stable → Événement perturbateur → Tension et enjeux → Résolution → Moral ou leçon.\n→ Quand l'utiliser : discours d'inauguration, TED Talk, oral de motivation.\n→ Clé : le personnage de l'histoire ne doit pas être vous-même — faites-le être l'audience.\n→ Exemples : Obama commence souvent par 'Je pense à une personne que j'ai rencontrée...'\n\n4. STRUCTURE PAS-AGITATION-SOLUTION (Advocacy)\nProblème → Amplification du problème → Solution concrète\n→ Quand l'utiliser : plaidoyer, discours de campagne, argumentaire politique.\n→ Clé : le temps consacré au problème doit être ≥ 50% — l'audience doit ressentir la douleur avant de vouloir la solution.\n→ Erreur courante : présenter la solution avant que l'audience soit convaincue de l'urgence.\n\n5. STRUCTURE SOCRATIQUE (Débat philosophique)\nQuestion → Thèse → Antithèse → Synthèse dépassante\n→ Quand l'utiliser : grand oral de philo, Sciences Po, ENS.\n→ Clé : la synthèse ne doit pas être un 'juste milieu' mou — elle doit élever le débat à un niveau supérieur.\n→ Exemple : «La liberté est-elle une illusion ?» → Non (libre-arbitre) → Si (déterminismes) → Les deux (liberté comme conquête sur les déterminismes)."},
  {id:4,icon:"🎯",title:"Persuasion & Influence",desc:"8 leviers psychologiques",content:"1. PREUVE SOCIALE (Cialdini)\n«80% des Français pensent que...» — L'humain calque ses comportements sur le groupe. Citez des études, des sondages, des consensus d'experts.\n→ Attention : la majorité peut avoir tort. Associez toujours la preuve sociale à un logos indépendant.\n\n2. AUTORITÉ LÉGITIME\n«Selon l'ONU, le GIEC, l'OMS...» — Déléguer l'autorité à une source reconnue renforce votre position sans paraître arrogant.\n→ Technique avancée : citez des autorités qui contredisent votre camp pour montrer votre honnêteté intellectuelle.\n\n3. RÉCIPROCITÉ SYMBOLIQUE\nConcéder un point à l'adversaire crée une obligation psychologique de réciprocité. L'audience perçoit votre honnêteté et est plus réceptive à vos arguments suivants.\n→ Formule : «Mon contradicteur a raison sur X. Mais cela renforce encore plus ma position sur Y, car...»\n\n4. COHÉRENCE-ENGAGEMENT\nRappelez à l'audience ses propres valeurs déclarées. Les humains agissent pour rester cohérents avec leurs déclarations publiques.\n→ «Vous avez tous dit que vous vouliez plus d'égalité. Voici ce que cette valeur implique concrètement...»\n\n5. RARETÉ ET URGENCE\n«C'est peut-être la dernière chance de...» — La perspective de perte est psychologiquement 2x plus motivante que la perspective de gain (Kahneman).\n→ À utiliser avec parcimonie : une urgence permanente perd son effet.\n\n6. APPARTENANCE ET IDENTITÉ TRIBALE\nRelier l'argument à l'identité collective de l'audience. Les gens défendent plus farouchement leurs croyances que leurs intérêts.\n→ «En tant que Français, en tant qu'Européens, en tant que citoyens du monde...\"\n\n7. VISUALISATION CONCRÈTE\nAider l'audience à imaginer précisément le futur voulu ou craint. La vivacité de l'image mentale détermine l'intensité de la réponse émotionnelle.\n→ Technique : «Imaginez que dans 10 ans, votre enfant vous demande ce que vous avez fait quand...»\n\n8. ANCRAGE COMPARATIF\nProposer d'abord une option extrême pour rendre l'option raisonnable plus acceptable.\n→ En négociation : demandez plus que ce que vous voulez. En politique : cadrez le débat autour de votre position."},
  {id:5,icon:"🎤",title:"La voix et le corps",desc:"Loi de Mehrabian et techniques",content:"LOI DE MEHRABIAN (1967) — La règle des 3V\nUne communication en face à face se décompose ainsi :\n- 7% : les mots (contenu verbal)\n- 38% : la voix (ton, rythme, volume, timbre)\n- 55% : le corps (posture, gestes, regard, expressions)\n→ Attention : cette règle s'applique spécifiquement aux communications émotionnelles. Pour un exposé technique, le poids des mots est plus élevé. Mais pour la persuasion politique, le non-verbal domine.\n\nLA VOIX — 6 paramètres maîtrisables\n1. Volume : variez entre fort et doux selon l'émotion. Le chuchotement attire souvent plus que le cri.\n2. Débit : ralentissez sur les points clés (100 mots/minute pour solennité vs 180 pour enthousiasme).\n3. Hauteur (pitch) : montez pour l'émotion, descendez pour l'autorité. Ne montez JAMAIS à la fin d'une affirmation (intonation montante = doute).\n4. Timbre : travaillez la résonance thoracique par des exercices de respiration abdominale.\n5. Pauses : le silence vaut de l'or. 3 secondes de silence après une phrase forte en décuple l'impact.\n6. Articulation : articulez exagérément en répétition, normalement à la tribune — votre articulation se réduit sous le stress.\n\nLE CORPS — Posture et gestuelle\n1. Position des pieds : pieds écartés à la largeur des épaules, légèrement ouverts vers l'audience. C'est la position de puissance.\n2. Regard : balayage systématique de la salle (3 zones : gauche, centre, droite), contact oculaire de 2-3 secondes par personne.\n3. Gestes ouverts : paumes visibles = honnêteté. Évitez bras croisés, mains dans les poches, gestes nerveux.\n4. Espace : occupez l'espace (bouger = vivacité), mais ne pace pas (agitation = anxiété).\n5. Expression faciale : synchronisez votre expression avec votre contenu. Un visage neutre sur un contenu passionné rompt la crédibilité.\n\nEXERCICES PRATIQUES\n- Enregistrez-vous en vidéo 3 minutes par jour et regardez sans le son : que dit votre corps ?\n- Pratiquez le 'power pose' (Amy Cuddy) avant de parler : 2 minutes en posture de puissance réduit le cortisol de 25%."},
  {id:6,icon:"😰",title:"Gestion du trac",desc:"Techniques immédiates et long terme",content:"COMPRENDRE LE TRAC\nLe trac est une réponse physiologique normale (adrénaline, cortisol) face à une évaluation sociale. Il n'est pas un signe de faiblesse mais une préparation biologique à la performance. Les plus grands orateurs (Churchill, Mandela) ont souffert de trac intense.\n→ Redéfinition cognitive : le trac n'est pas de la peur mais de l'excitation. Dites-vous 'je suis excité' plutôt que 'j'ai peur' — la physiologie est identique, le sens change.\n\nTECHNIQUES IMMÉDIATES (avant de parler)\n1. Respiration 4-7-8 : inspirez 4 secondes, retenez 7, expirez 8. Trois cycles suffisent pour activer le système parasympathique.\n2. Respiration diaphragmatique : main sur le ventre, gonflez le ventre à l'inspiration (pas la poitrine).\n3. Power pose : 2 minutes debout, mains sur les hanches, regard horizontal — réduit le cortisol et augmente la testostérone.\n4. Réchauffement vocal : vocalises, lecture à voix haute, humming (fredonner) pour décontracter les cordes vocales.\n5. Visualisation positive : imaginez-vous réussir — pas l'audience qui applaudit, mais vous qui ressentez la fluidité.\n\nTECHNIQUES PENDANT LE DISCOURS\n1. Regardez les visages bienveillants : identifiez 2-3 personnes qui hochent la tête et adressez-vous à eux en premier.\n2. Ralentissez : le trac accélère le débit. Ralentir délibérément réduit le stress et améliore la compréhension.\n3. Pause stratégique : si vous vous perdez, buvez une gorgée d'eau, regardez vos notes. Le public perçoit rarement l'hésitation comme une erreur.\n4. Ancrage physique : sentez le sol sous vos pieds. Le contact physique avec le sol réduit l'anxiété de performance.\n\nSTRATÉGIE LONG TERME\n1. Méthode de l'exposition graduée : commencez par parler à 1 personne, puis 5, puis 20, puis 100. Chaque succès réduit le seuil de trac pour la prochaine fois.\n2. Improvisation théâtrale : 8 semaines de cours d'impro développent la tolérance à l'imperfection.\n3. Journal de progression : notez après chaque prise de parole ce qui s'est bien passé (pas ce qui a mal tourné).\n4. Régularité : le trac diminue avec la fréquence. Visez une prise de parole publique par semaine minimum."},
  {id:7,icon:"⚡",title:"L'improvisation maîtrisée",desc:"PREP, OUI-ET, questions",content:"MYTHE DE L'IMPROVISATION\nL'improvisation n'est pas l'absence de préparation mais la maîtrise de structures que l'on peut activer en temps réel. Les grands improvisateurs (debaters, politiques en conférence de presse) ont intégré des schémas narratifs qui se déclenchent automatiquement.\n\nMÉTHODE PREP — Structure express en 90 secondes\nP — Position (5 sec) : «Je pense que X parce que Y»\nR — Reason (20 sec) : «La raison principale est que...»\nE — Example (40 sec) : «Par exemple, en 2024, [cas concret]...»\nP — Point (10 sec) : «C'est pourquoi je maintiens que X»\n→ Exercice : pratiquez avec n'importe quel sujet tiré au sort. 10 sujets par jour pendant 30 jours.\n\nMÉTHODE OUI-ET (théâtre d'improvisation)\nJamais dire 'non' ou 'mais' — toujours 'oui, et...'\nQuelqu'un dit : «Mais votre politique a échoué.»\nRéponse : «Vous avez raison que les résultats n'ont pas été à la hauteur dans ce secteur, ET c'est précisément pour cela que nous proposons maintenant...»\n→ L'acceptation de la critique suivie d'un rebond offensif est rhétoriquement bien plus forte que la dénégation.\n\nTECHNIQUE DES PONTS\nLorsque vous ne connaissez pas la réponse ou voulez éviter une question :\n1. Accusé réception : «C'est une question importante.»\n2. Réponse partielle honnête : «Ce que je peux vous dire c'est que...»\n3. Pont vers votre message : «Et ce qui est essentiel, c'est que...»\n→ Exemples de ponts : «Ce qui me semble plus fondamental c'est...» / «Mais la vraie question est...» / «Permettez-moi de replacer cela dans le contexte...\"\n\nGESTION DES QUESTIONS HOSTILES\n1. Respirez avant de répondre (2 secondes de silence = maîtrise de soi visible).\n2. Reformulez la question à votre avantage : «Si je comprends bien, vous demandez si X. La question que je me pose moi, c'est Y.»\n3. Ne jamais répéter une attaque en la réfutant : «Ce discours n'est pas populiste» dit 'populiste' deux fois.\n4. Utilisez la concession stratégique : «Vous avez tout à fait raison sur ce point. Cela renforce d'autant plus mon argument que...\"\n\nEXERCICE DES 30 CERCLES\nChaque matin, prenez n'importe quel objet. En 1 minute, trouvez 10 façons différentes de le relier à l'actualité politique. Cela développe la flexibilité associative nécessaire à l'improvisation."},
  {id:8,icon:"⚔️",title:"Le débat contradictoire",desc:"Stratégies offensives et défensives",content:"PSYCHOLOGIE DU DÉBAT\nUn débat se joue à deux niveaux : le contenu (logos) et la perception (éthos+pathos). On peut gagner sur le fond et perdre aux yeux de l'audience. La règle d'or : ne jamais laisser l'adversaire définir les termes du débat.\n\nSTRATÉGIES OFFENSIVES\n1. Attaque du prémisse : ne répondez pas à l'argument, questionnez son fondement.\n→ «Votre argument repose sur l'idée que X. Or X est précisément ce qui est contesté.»\n2. Réduction à l'absurde : poussez l'argument adverse jusqu'à ses conséquences logiques absurdes.\n→ «Si l'on suit votre logique jusqu'au bout, cela implique que...»\n3. Retournement de preuve : utilisez les exemples de l'adversaire pour prouver le contraire.\n→ «Vous citez le cas de X pour montrer Y. Mais ce même exemple montre en réalité Z.»\n4. Question socratique : posez des questions apparemment innocentes qui démolissent l'argumentation.\n→ «Comment définissez-vous exactement X ?» (souvent, l'adversaire ne peut pas)\n\nSTRATÉGIES DÉFENSIVES\n1. Distinction : «Il faut distinguer deux choses que vous confondez...»\n2. Contextualisation : «Dans le contexte de 2024, cet argument serait valide. Mais ici...»\n3. Concession-limitation : «Vous avez raison sur le cas particulier, mais cette exception ne invalide pas la règle générale.»\n4. Substitution de question : «La vraie question n'est pas X mais Y.»\n\nSOPHISMES COURANTS À IDENTIFIER\n- Ad hominem : attaquer la personne, pas l'argument. («Vous dites ça parce que vous êtes...»)\n- Homme de paille : réfuter une version caricaturale de l'argument adverse.\n- Faux dilemme : présenter seulement deux options alors qu'il en existe d'autres.\n- Pente glissante : supposer qu'une chose mène inévitablement à une autre.\n- Appel à la nature : «C'est naturel donc c'est bien» (ou «C'est artificiel donc c'est mauvais»)\n- Généralisation hâtive : tirer une règle générale d'un ou deux cas.\n- Corrélation vs causalité : confondre 'se passe en même temps' et 'l'un cause l'autre'.\n\nSTRUCTURE DE RÉFUTATION EN 4 TEMPS\n1. Reformulation : «Si je comprends bien, vous affirmez que X.»\n2. Concession partielle : «Je concède que dans le cas Y, cela peut sembler vrai.»\n3. Réfutation principale : «Cependant, cela ne tient pas parce que...»\n4. Contre-attaque : «Et cela révèle en réalité la faiblesse de votre position sur Z.\""},
  {id:9,icon:"📖",title:"Storytelling politique",desc:"Arcs narratifs et anecdotes",content:"POURQUOI LES HISTOIRES PERSUADENT\nLes neurosciences confirment (Paul Zak) que les récits bien construits libèrent de l'ocytocine — l'hormone de l'empathie et de la confiance. Une histoire est mémorisée 22 fois mieux qu'un fait isolé. Les politiques qui gagnent des élections sont systématiquement ceux qui racontent la meilleure histoire.\n\nLES 3 ARCS NARRATIFS DU DISCOURS POLITIQUE\n1. L'arc héroïque (Joseph Campbell)\nSituation initiale → Appel → Refus → Acceptation → Épreuves → Transformation → Retour victorieux\n→ Exemple : Mandela (oppression → résistance → prison → libération → président)\n→ Utilisation : discours de campagne, discours d'investiture, témoignages personnels.\n\n2. L'arc de menace (tragédie évitée)\nMonde stable → Menace émergente → Conséquences catastrophiques si inaction → Solution → Monde sauvé\n→ Exemple : Churchill en 1940 (Europe libre → nazisme → extinction de la civilisation → résistance)\n→ Utilisation : discours d'urgence, plaidoyers pour une cause, discours sur le climat.\n\n3. L'arc de transformation collective\nNous souffrions → Nous avons compris → Nous avons agi → Nous avons changé\n→ Exemple : discours de réconciliation (Mandela 1994, Havel 1990)\n→ Utilisation : discours post-crise, discours de commémoration.\n\nÉLÉMENTS D'UNE ANECDOTE EFFICACE\n1. Un personnage spécifique (pas 'une femme' mais 'Marie, 47 ans, ouvrière à Lyon...')\n2. Un moment précis dans le temps et l'espace\n3. Une tension ou un obstacle concret\n4. Une résolution ou une leçon claire\n5. Un lien explicite avec votre argument politique\n→ Durée idéale : 60-90 secondes. Au-delà, l'audience perd le fil politique.\n\nTECHNIQUE DU MIROIR\nFaites que le héros de votre histoire soit votre audience, pas vous-même. «Imaginez que vous êtes Marie, que vous rentrez du travail et que...» — l'identification est totale, la résistance s'effondre."},
  {id:10,icon:"🌍",title:"Rhétorique interculturelle",desc:"Adapter son discours au contexte culturel",content:"DIMENSIONS CULTURELLES DE HOFSTEDE\nLe sociologue Geert Hofstede a identifié 6 dimensions culturelles qui varient selon les pays et affectent directement la communication persuasive :\n\n1. Individualisme vs Collectivisme\n→ USA, France : rhétorique des droits individuels, de l'accomplissement personnel.\n→ Chine, Japon, Afrique : rhétorique de la communauté, de l'harmonie, de la responsabilité collective.\n\n2. Distance hiérarchique\n→ France (forte) : l'autorité hiérarchique est attendue dans les discours — les citations d'autorité pèsent lourd.\n→ Pays nordiques (faible) : l'orateur doit montrer qu'il est au même niveau que son audience.\n\n3. Évitement de l'incertitude\n→ Cultures à fort évitement (France, Allemagne) : structurez avec des plans clairs, des preuves multiples.\n→ Cultures à faible évitement (USA, UK) : l'improvisation visible et la spontanéité sont valorisées.\n\nSTYLES RHÉTORIQUES COMPARÉS\nSTYLE FRANÇAIS — Déductif, abstrait, universel.\nOn part du principe général pour aller vers le cas particulier. Le cadre théorique précède l'exemple. Les grandes idées (liberté, égalité) sont citées avant les faits concrets.\n→ Atout : cohérence intellectuelle, profondeur.\n→ Risque : incompréhension à l'international si l'on reste dans l'abstrait.\n\nSTYLE ANGLO-SAXON — Inductif, concret, pragmatique.\nOn part de l'anecdote concrète pour aller vers la règle générale. Les faits précèdent la théorie. 'Show, don't tell'.\n→ Atout : immédiatement accessible, mémorable.\n→ Risque : peut sembler superficiel ou anecdotique.\n\nSTYLE ASIATIQUE — Contextuel, allusif, indirect.\nLe sens se construit dans le contexte et l'implicite. Les références culturelles communes (confucianisme, harmonie) créent une communauté de sens sans être explicitées.\n→ Clé : le silence et l'allusion peuvent être plus forts que l'affirmation directe.\n\nRÈGLES D'OR DE L'ADAPTATION INTERCULTURELLE\n1. Commencez toujours par identifier les valeurs centrales de votre audience.\n2. Citez des autorités reconnues localement (et non seulement occidentales).\n3. Adaptez votre niveau de formalité au contexte hiérarchique local.\n4. Évitez l'humour dans les premières interventions — l'humour est la compétence interculturelle la plus difficile."},
  {id:11,icon:"⚖️",title:"La plaidoirie",desc:"Structure, techniques et grands avocats",content:"QU'EST-CE QU'UNE PLAIDOIRIE ?\nLa plaidoirie est l'art de plaider en faveur d'un accusé ou d'une cause devant un tribunal. Elle diffère du discours politique par ses contraintes formelles (règles de procédure, contradictoire) et son enjeu concret (liberté, argent, honneur d'un client).\n\nSTRUCTURE CLASSIQUE EN 5 TEMPS\n1. L'entrée en matière — Ne pas attaquer immédiatement. Établissez le contexte humain.\n2. Le fait justificatif — Exposez les faits de manière favorable sans mentir.\n3. L'argumentation juridique — Citez les textes, la jurisprudence, la doctrine.\n4. La réfutation du ministère public — Analysez et démolissez les arguments adverses.\n5. La péroraison — Fin émotionnelle qui appelle à la clémence ou à la justice.\n\nTECHNIQUES DES GRANDS AVOCATS\nJacques Vergès — La rupture de ban : refuser les règles du jeu et mettre le tribunal en accusation (procès Klaus Barbie). Risquée mais mémorable.\nRobert Badinter — La sobriété absolue : aucun artifice rhétorique, seulement la force des faits et du droit. Efficace face à des jurés éduqués.\nHervé Temime — La proximité humaine : faire du client une personne, pas un dossier. Chaque client a une histoire que le jury doit entendre.\n\nERREURS FATALES À ÉVITER\n1. Mentir sciemment (faute déontologique et efficacité nulle — les juges le voient).\n2. Attaquer personnellement la partie adverse (suscite la sympathie pour l'adversaire).\n3. Trop parler : une plaidoirie de 2 heures est moins efficace qu'une de 30 minutes bien construite.\n4. Ignorer les éléments à charge : il vaut mieux les aborder et les contextualiser que de sembler les esquiver.\n5. Confondre la salle d'audience avec un théâtre : les effets trop visibles nuisent à la crédibilité.\n\nCAS HISTORIQUES\n→ Zola dans J'accuse (1898) : plaidoirie publique dans la presse — élargissement du tribunal.\n→ Défense de Mandela à Rivonia (1964) : le prévenu plaide lui-même, transformant son procès en tribune politique.\n→ Nuremberg (1945-1946) : construction du droit pénal international par la plaidoirie."},
  {id:12,icon:"🌟",title:"Les 7 principes de l'éloquence",desc:"Les lois universelles de la parole",content:"PRINCIPE 1 — LA CLARTÉ AVANT TOUT\nUne idée floue dans l'esprit de l'orateur sera doublement floue pour l'audience. Testez votre maîtrise : pouvez-vous expliquer votre argument à un enfant de 10 ans ? Si non, vous ne le maîtrisez pas encore.\n→ Règle : une idée par phrase. Une thèse par discours.\n\nPRINCIPE 2 — L'AUTHENTICITÉ EST IRREMPLAÇABLE\nLes audiences modernes ont un détecteur de faux extrêmement développé. Un orateur qui parle de ce qu'il a vécu, croit réellement, souffert sera toujours plus convaincant qu'un acteur parfait jouant un rôle.\n→ Ne pas essayer d'imiter les grands orateurs — trouver sa propre voix.\n\nPRINCIPE 3 — LA RÉPÉTITION EST LA CLÉ\nHermann Ebbinghaus (1885) a montré que 70% d'un contenu est oublié dans les 24 heures sans répétition. Un grand discours dit la même chose 3 fois : en l'annonçant, en le développant, en le résumant.\n→ Maxime : «Dites ce que vous allez dire. Dites-le. Dites ce que vous avez dit.\"\n\nPRINCIPE 4 — L'ÉCONOMIE DES MOTS\nCicéron disait : «Si j'avais eu plus de temps, j'aurais écrit une lettre plus courte.» La concision est le signe de la maîtrise. Chaque mot superflu affaiblit les mots essentiels.\n→ Exercice : prenez votre discours de 10 minutes et réduisez-le à 5 sans perdre aucune idée.\n\nPRINCIPE 5 — L'ÉCOUTE ACTIVE DE L'AUDIENCE\nUn grand orateur est d'abord un grand lecteur de salle. Observer les regards, la posture, les murmures permet d'adapter en temps réel. L'éloquence n'est pas un monologue mais un dialogue.\n→ Technique : regarder l'audience dans les yeux, pas ses notes.\n\nPRINCIPE 6 — LA TENSION NARRATIVE\nTout discours doit créer et maintenir une tension : une question sans réponse, un problème sans solution visible, un mystère non résolu. La tension maintient l'attention. Résolvez-la au moment le plus fort.\n→ Technique : posez la question centrale dès le début et n'y répondez qu'à la fin.\n\nPRINCIPE 7 — LE COURAGE RHÉTORIQUE\nDire à une audience ce qu'elle a besoin d'entendre plutôt que ce qu'elle veut entendre. La flatterie est le contraire de l'éloquence. Les discours historiques ont toujours demandé quelque chose de difficile.\n→ Exemples : Badinter en 1981, Mandela à Rivonia, Churchill en 1940. Tous ont dit la vérité difficile devant des audiences hostiles ou craintives."},
];
const DICT_DATA=[
  {term:"Veto",def:"Droit des 5 membres permanents du Conseil de sécurité ONU (USA, Russie, Chine, France, Royaume-Uni) de bloquer toute résolution par un vote négatif. Depuis 1945, le veto a été utilisé plus de 290 fois. La Russie/URSS est le premier utilisateur historique. En 2022, le veto russe a bloqué toute résolution sur la guerre en Ukraine, illustrant les limites du système."},
  {term:"Soft Power",def:"Concept élaboré par Joseph Nye (1990) désignant la capacité d'un État à influencer par son attractivité culturelle, ses valeurs et ses institutions plutôt que par la contrainte militaire ou économique. Les États-Unis exercent un soft power via Hollywood, les universités, le dollar et les réseaux sociaux américains. La Chine investit massivement dans les Instituts Confucius et les médias internationaux (CGTN) pour développer son propre soft power."},
  {term:"Hard Power",def:"Capacité d'un État à contraindre d'autres acteurs par la force militaire ou la pression économique (sanctions, embargos). Opposé au soft power, le hard power repose sur la coercition. Les États-Unis dépensent 800 milliards de dollars annuels en défense (2023). La Chine a multiplié par 10 son budget militaire en 20 ans (250 Mds$ en 2023). Le hard power seul crée la résistance ; associé au soft power, il devient du 'smart power'."},
  {term:"Smart Power",def:"Combinaison stratégique du hard power et du soft power, théorisée par Joseph Nye et popularisée par Hillary Clinton en 2009. Le smart power reconnaît que la force seule ne suffit pas à résoudre les conflits contemporains. L'approche américaine en Afghanistan (2001-2021) illustre les limites du hard power sans smart power : victoire militaire rapide mais échec politique total."},
  {term:"Souveraineté",def:"Autorité suprême et exclusive d'un État sur son territoire, sa population et ses affaires internes. Principe fondamental du droit international depuis le Traité de Westphalie (1648) qui mit fin à la Guerre de Trente Ans. La souveraineté est aujourd'hui challengée par la mondialisation économique, les droits de l'homme (R2P), les organisations supranationales (UE) et les acteurs non-étatiques (multinationales, ONG, groupes terroristes)."},
  {term:"Multilatéralisme",def:"Approche impliquant trois États ou plus dans la résolution de problèmes communs, par opposition au bilatéralisme ou à l'unilatéralisme. Le multilatéralisme est incarné par l'ONU, l'OMC, l'OTAN. Depuis les années 2010, il est en crise : retrait américain de l'Accord de Paris (2017), de l'OMC bloquée, montée des accords bilatéraux. La pandémie de Covid-19 (2020) a révélé à la fois la nécessité du multilatéralisme et ses lacunes (course aux vaccins)."},
  {term:"Résolution Ch. VII",def:"Décision du Conseil de sécurité de l'ONU prise au titre du Chapitre VII de la Charte (maintien de la paix), autorisant le recours à la force militaire ou des mesures coercitives. Contraignante pour tous les membres. Exemples : Rés. 678 (1990, guerre du Golfe), Rés. 1973 (2011, Libye). L'absence de Chapitre VII dans les interventions en Syrie (veto russe et chinois) a paralysé la réponse internationale au conflit."},
  {term:"DIH",def:"Droit International Humanitaire : ensemble de règles limitant les effets des conflits armés pour protéger les personnes qui n'y participent pas. Fondé sur les Conventions de Genève de 1949 et leurs Protocoles additionnels de 1977. Le CICR en est le gardien. Les violations du DIH constituent des crimes de guerre passibles de poursuites devant la Cour pénale internationale, comme dans les affaires ex-Yougoslavie (TPIY) et Rwanda (TPIR)."},
  {term:"Non-alignement",def:"Politique étrangère refusant l'alignement sur les grandes puissances rivales. Le Mouvement des Non-Alignés (MNA) fut fondé en 1961 à Belgrade lors de la Conférence de Bandung (1955) par Nehru, Nasser, Tito, Sukarno et Nkrumah. Il compte 120 membres en 2024. Le concept connaît un renouveau avec l'émergence du 'Sud global' qui refuse de choisir entre les États-Unis et la Chine dans la rivalité sino-américaine."},
  {term:"Realpolitik",def:"Approche pragmatique de la politique étrangère fondée sur les intérêts nationaux et les rapports de force concrets, indépendamment des considérations idéologiques ou morales. Théorisée par Bismarck au XIXe siècle, popularisée par Henry Kissinger (Prix Nobel de la Paix 1973). La Realpolitik explique l'alliance américaine avec des régimes autoritaires (Arabie Saoudite, Égypte) au nom de la stabilité régionale et des intérêts stratégiques."},
  {term:"Sanctions",def:"Mesures de pression économiques ou diplomatiques (gel d'avoirs, embargo, interdictions de voyage) imposées par un État ou une organisation internationale pour contraindre un autre acteur à changer de comportement. Les sanctions contre la Russie post-2022 sont les plus importantes de l'histoire (plus de 15 000 mesures individuelles). Leur efficacité est débattue : l'Iran sanctionné depuis 1979 continue son programme nucléaire ; la Corée du Nord depuis les années 2000."},
  {term:"G7 / G20",def:"G7 (Groupe des 7) : forum informel des 7 pays les plus industrialisés (USA, Allemagne, France, Japon, UK, Italie, Canada + UE), représentant ~45% du PIB mondial. Fondé en 1975 à Rambouillet. G20 : créé en 1999 après la crise asiatique, rassemble 20 économies majeures représentant 85% du PIB mondial, 75% du commerce et 65% de la population. Depuis la crise de 2008, le G20 est devenu le principal forum de coordination économique mondiale."},
  {term:"Géopolitique",def:"Discipline qui analyse les relations entre la géographie (territoire, ressources, position) et la politique des États. Fondée par Rudolf Kjellén (1899) et Halford Mackinder (théorie du 'heartland', 1904). La géopolitique explique les intérêts des États par leur positionnement géographique : la Russie cherche des ports en eau chaude depuis Pierre le Grand ; la Chine cherche à sécuriser ses routes commerciales (Nouvelles Routes de la Soie)."},
  {term:"Mondialisation",def:"Processus d'intégration croissante des économies, cultures et sociétés mondiales via les échanges commerciaux, les flux financiers, l'information et les migrations. Accélérée après 1991 par la chute du mur de Berlin, internet et l'OMC. Elle a sorti 1,1 milliard de personnes de la pauvreté en 30 ans (Chine, Inde). Elle a aussi creusé les inégalités au sein des pays développés, alimentant le populisme. La 'démondialisation' partielle post-Covid et post-Ukraine reconfigure les chaînes de valeur."},
  {term:"Droit d'ingérence",def:"Concept émergent (Mario Bettati, Bernard Kouchner, 1987) selon lequel la communauté internationale aurait le droit, voire le devoir, d'intervenir dans les affaires intérieures d'un État pour protéger des populations civiles en danger. Controversé car en tension directe avec le principe de souveraineté. Évolution : la Responsabilité de Protéger (R2P, 2005) lui a donné un cadre juridique plus formel mais son application reste sélective."},
  {term:"R2P",def:"Responsabilité de Protéger (Responsibility to Protect) : principe adopté à l'unanimité par l'Assemblée générale de l'ONU en 2005. Il stipule que la souveraineté implique une responsabilité : si un État ne protège pas sa population des génocides, crimes de guerre, épuration ethnique et crimes contre l'humanité, la communauté internationale peut intervenir. Appliqué en Libye (2011, Rés. 1973), mais le détournement libyen (changement de régime au lieu de protection civile) a fragilisé le concept pour les interventions suivantes."},
  {term:"OTAN",def:"Organisation du Traité de l'Atlantique Nord : alliance militaire défensive fondée le 4 avril 1949 à Washington. Compte 32 membres en 2024 (après l'adhésion de la Finlande en 2023 et de la Suède en mars 2024). L'Article 5 stipule qu'une attaque contre un membre est une attaque contre tous (invoqué une seule fois : après le 11 septembre 2001). Budget cumulé des membres : +1 000 milliards de dollars. Secrétaire général depuis octobre 2024 : Mark Rutte (Pays-Bas)."},
  {term:"Union Européenne",def:"Organisation supranationale de 27 États membres (après le Brexit de 2020), fondée par le Traité de Rome (1957) comme CEE, devenue UE par le Traité de Maastricht (1992). Institutions principales : Commission (initiative législative), Parlement (co-législation), Conseil de l'UE (États membres), Cour de justice. PIB cumulé : ~16 000 milliards d'euros. Zone euro : 20 membres partageant la monnaie unique. Prix Nobel de la Paix en 2012."},
  {term:"Fédéralisme",def:"Système politique dans lequel le pouvoir est partagé entre un gouvernement central et des entités fédérées (États, provinces, Länder) jouissant d'une autonomie constitutionnellement garantie. Exemples : États-Unis (1787), Allemagne (Loi fondamentale 1949), Suisse, Inde. Distinctions : le fédéralisme dual (séparation stricte) vs le fédéralisme coopératif (compétences partagées). La France est un État unitaire avec décentralisation, non fédéral."},
  {term:"Démocratie directe",def:"Forme de gouvernement dans laquelle les citoyens participent directement aux décisions politiques, sans représentants intermédiaires. Instruments : référendum (Suisse : plusieurs fois par an), initiative citoyenne (Autriche, Italie), recall (révocation d'élus en Californie). La Suisse est le modèle le plus développé de démocratie directe dans le monde. Critique : risque de tyrannie de la majorité sur les minorités (référendum hongrois 2021 contre les droits LGBTQ+)."},
  {term:"Populisme",def:"Idéologie politique qui oppose un 'peuple pur' à une 'élite corrompue' et prétend que la politique doit exprimer la volonté générale du peuple. Concept analysé par Ernesto Laclau et Cas Mudde. Se décline à gauche (Podemos, AMLO) et à droite (Trump, Orbán, Meloni). En crise depuis 2016 : Brexit, Trump, gouvernements populistes en Europe centrale. Débat : est-ce une pathologie de la démocratie ou un symptôme de son déficit de représentativité ?"},
  {term:"Nationalisme",def:"Idéologie affirmant que la nation (unité culturelle, linguistique ou ethnique) doit constituer le fondement de l'organisation politique et que chaque nation doit avoir son propre État. Historiquement, le nationalisme a produit les États-nations modernes (XIXe siècle), mais aussi les deux guerres mondiales. Le nationalisme contemporain se décline en patriotisme civique (France républicaine) et en nationalisme ethnique ou populiste (Orbán, Modi)."},
  {term:"Impérialisme",def:"Politique d'extension du pouvoir d'un État sur d'autres territoires ou peuples par la force, l'économie ou la culture. Lénine l'analyse (1917) comme 'stade suprême du capitalisme'. L'impérialisme colonial européen (XIXe-XXe siècles) a dominé 85% de la surface du globe. Le néo-impérialisme contemporain est souvent économique (dépendance aux IDE, dettes) ou culturel (domination des normes américaines). La Chine est accusée d'impérialisme économique en Afrique."},
  {term:"Colonialisme",def:"Système d'occupation et d'exploitation d'un territoire par une puissance étrangère, impliquant domination politique, exploitation économique et oppression culturelle. Le colonialisme européen (XVe-XXe siècles) a concerné l'Asie, l'Afrique, les Amériques et l'Océanie. Ses conséquences persistent : inégalités structurelles, conflits ethniques hérités des frontières coloniales (Afrique), crises identitaires. La décolonisation formelle (1945-1975) n'a pas éliminé le néocolonialisme économique."},
  {term:"Décolonisation",def:"Processus par lequel les territoires colonisés ont accédé à l'indépendance politique. Vague principale : 1945-1975, avec l'émergence de 90 nouveaux États. Deux grandes voies : négociée (Ghana 1957, Inde 1947) ou conflictuelle (Algérie 1954-1962, Vietnam 1946-1975). L'ONU a joué un rôle majeur par la Déclaration de 1960 sur l'octroi de l'indépendance. Les séquelles économiques, institutionnelles et identitaires alimentent encore les crises africaines et moyen-orientales."},
  {term:"Autodétermination",def:"Droit des peuples à choisir librement leur statut politique et leur mode de développement économique, social et culturel. Consacré par la Charte de l'ONU (article 1) et les Pactes internationaux de 1966. Sa mise en oeuvre pose des contradictions : le Kosovo (2008) et le Timor oriental (2002) ont revendiqué et obtenu l'indépendance ; la Catalogne (2017) et la Crimée (2014, contrôlée par la Russie) se sont heurtées au principe d'intégrité territoriale."},
  {term:"Terrorisme",def:"Usage délibéré de la violence contre des civils pour semer la terreur et atteindre des objectifs politiques, idéologiques ou religieux. Définition juridique variable selon les États (enjeux de classification politique). Al-Qaïda (attentat du 11 sept. 2001 : 2 977 morts) et Daech (califat 2013-2019 en Irak-Syrie) sont les organisations les plus connues du XXIe siècle. Le terrorisme d'extrême droite monte en Europe depuis 2015 (Breivik 2011, Christchurch 2019)."},
  {term:"Cyberguerre",def:"Ensemble des opérations offensives et défensives menées dans le cyberespace par des États ou acteurs mandatés, visant des infrastructures critiques, des systèmes électoraux ou des secrets d'État. Exemples : Stuxnet (USA-Israël contre l'Iran, 2010), cyberattaques russes contre l'Ukraine (NotPetya, 2017), interférences électorales (USA 2016). L'OTAN a reconnu le cyberespace comme domaine opérationnel en 2016. Absence de droit international conventionnel clair."},
  {term:"CPI",def:"Cour Pénale Internationale : juridiction permanente créée par le Statut de Rome (1998), siégeant à La Haye depuis 2002. Compétente pour les génocides, crimes contre l'humanité, crimes de guerre et crime d'agression. 124 États membres (USA, Russie, Chine ne sont pas membres). A émis des mandats contre Poutine (2023, déportation d'enfants ukrainiens), Omar el-Béchir (Soudan), et plusieurs dirigeants africains. Critiquée pour sa focalisation sur l'Afrique."},
  {term:"Génocide",def:"Crime de droit international défini par la Convention de 1948 comme actes commis 'avec l'intention de détruire, en tout ou en partie, un groupe national, ethnique, racial ou religieux'. Exemples reconnus : Shoah (6 millions de Juifs, 1941-1945), Rwanda (800 000 Tutsis, 1994), Srebrenica (8 000 Bosniaques, 1995). La qualification juridique est un enjeu politique majeur : la reconnaissance du génocide arménien (1915) par la France en 2001 a provoqué une crise diplomatique avec la Turquie."},
  {term:"Crime contre l'humanité",def:"Actes graves commis de façon systématique ou à grande échelle contre une population civile : meurtre, extermination, réduction en esclavage, déportation, torture, viol, apartheid. Concept né à Nuremberg (1945). Diffère du génocide en ce qu'il n'exige pas l'intention de détruire un groupe spécifique. Les auteurs peuvent être poursuivis devant la CPI ou des tribunaux ad hoc (TPIY, TPIR). La prescription ne s'applique pas à ces crimes."},
  {term:"Réfugié",def:"Personne qui a fui son pays d'origine en raison d'une persécution fondée sur la race, la religion, la nationalité, l'appartenance à un groupe social ou les opinions politiques (Convention de Genève de 1951). À distinguer du 'migrant économique' (qui part pour améliorer ses conditions de vie). En 2023, 110 millions de personnes sont déplacées dans le monde (record absolu, HCR). Le 'non-refoulement' (interdiction de renvoyer un réfugié vers son pays d'origine) est la pierre angulaire du droit des réfugiés."},
  {term:"ONG",def:"Organisation Non Gouvernementale : entité privée à but non lucratif opérant au niveau national ou international. Les ONG jouent un rôle croissant dans la gouvernance mondiale : plaidoyer (Amnesty International, HRW), aide humanitaire (MSF, CICR), développement (OXFAM), environnement (Greenpeace, WWF). Plus de 40 000 ONG opèrent à l'échelle internationale. Critiques : manque de légitimité démocratique, dépendance aux financements des États et fondations privées occidentales."},
  {term:"Lobbying",def:"Pratique consistant à tenter d'influencer les décisions politiques et législatives au profit d'intérêts particuliers. Légal aux États-Unis depuis 1946 (Lobbying Disclosure Act), encadré en Europe depuis 2011 (registre de transparence européen). Aux États-Unis, les lobbyistes représentaient 3,7 milliards de dollars de dépenses en 2022. Le 'tourniquets' (revolving door) — passage entre fonctions publiques et lobbying privé — est une pratique controversée qui affecte l'indépendance des décideurs."},
  {term:"Diaspora",def:"Dispersion d'une population hors de son territoire d'origine, tout en maintenant une identité collective et des liens avec le pays d'origine. Les grandes diasporas : chinoise (60 millions de membres), indienne (32 millions), juive (15 millions), irlandaise (80 millions de descendants aux USA). Les diasporas jouent un rôle économique (remittances : 860 milliards de dollars en 2023, surpassant l'aide au développement) et politique (lobbying, financement des partis)."},
  {term:"Géostratégie",def:"Discipline qui applique les analyses géopolitiques à la stratégie militaire et à la politique de sécurité. Concepts fondamentaux : heartland (Mackinder — qui contrôle l'Eurasie contrôle le monde), rimland (Spykman — zones côtières eurasiatiques), puissance maritime vs terrestre (Mahan). La compétition sino-américaine en mer de Chine méridionale est un exemple de géostratégie contemporaine : la Chine cherche à sécuriser ses voies d'approvisionnement en énergie."},
  {term:"Endiguement",def:"Stratégie américaine de la Guerre froide visant à empêcher l'expansion soviétique, formulée par George Kennan en 1946 ('Long Telegram') et mise en oeuvre par Truman (doctrine Truman, 1947). S'est traduit par le Plan Marshall (1948), la création de l'OTAN (1949), les guerres de Corée (1950-1953) et du Vietnam (1964-1975). Certains analystes voient dans la stratégie américaine en Indo-Pacifique (QUAD, AUKUS) un 'endiguement de la Chine' du XXIe siècle."},
  {term:"Détente",def:"Période de réduction des tensions entre les États-Unis et l'URSS au début des années 1970, sous Nixon et Kissinger. Se traduit par les accords SALT I (1972, limitation des armements stratégiques), la visite de Nixon en Chine (1972) et les Accords d'Helsinki (1975, reconnaissance des frontières européennes). La détente prend fin avec l'invasion soviétique de l'Afghanistan (1979) et l'élection de Reagan (1981). Terme repris pour décrire toute période d'apaisement entre grandes puissances."},
  {term:"ADM",def:"Armes de Destruction Massive : armes nucléaires, biologiques, chimiques ou radiologiques capables de tuer massivement et indistinctement. Traités de non-prolifération : TNP (1968, nucléaire), Convention sur les armes biologiques (1972), Convention sur les armes chimiques (1993). 9 États possèdent des armes nucléaires en 2024 (USA, Russie, France, UK, Chine, Inde, Pakistan, Israël, Corée du Nord). L'usage d'armes chimiques par Assad en Syrie (2013, 2018) a montré les limites des mécanismes de contrôle."},
  {term:"Alliance",def:"Accord formel entre deux ou plusieurs États pour coopérer en matière de sécurité et de défense. Types : alliance défensive (OTAN, article 5), alliance offensive (pacte germano-soviétique 1939), alliance conditionnelle. La théorie des alliances (Waltz, Walt) explique leur formation par la menace perçue. Les alliances de la Guerre froide (OTAN vs Pacte de Varsovie) ont cédé la place à des architectures de sécurité plus flexibles et situationnelles (coalitions ad hoc)."},
  {term:"Équilibre des puissances",def:"Théorie des relations internationales selon laquelle les États cherchent à empêcher qu'un seul acteur ne domine le système international, en formant des coalitions contre la puissance hégémonique. Concept formulé par Vattel (XVIIIe siècle), institutionnalisé par le Concert de l'Europe (1815-1914). La question centrale du XXIe siècle : la montée de la Chine va-t-elle créer un équilibre bipolaire USA-Chine ou un système multipolaire désorganisé ?"},
  {term:"Hégémonie",def:"Domination d'un acteur sur un système politique par sa supériorité économique, militaire, culturelle et institutionnelle. Hégémonie américaine post-1991 : 'moment unipolaire' (Krauthammer). Gramsci analyse l'hégémonie comme consentement culturel plus que domination par la force. La 'stability theory' (Gilpin) postule qu'un hégémon stable est bénéfique pour le système international (fourniture de biens publics mondiaux : sécurité des mers, dollar de réserve)."},
  {term:"Sphère d'influence",def:"Zone géographique dans laquelle un État exerce une influence prédominante sur les affaires politiques, économiques et militaires d'autres États, sans les contrôler formellement. Concept central de la diplomatie des grandes puissances. La doctrine Monroe (1823) définissait les Amériques comme sphère d'influence américaine. La Russie considère l'ex-espace soviétique comme sa sphère d'influence ('étranger proche'), justification partielle de l'invasion de l'Ukraine (2022)."},
  {term:"Diplomatie préventive",def:"Ensemble d'actions diplomatiques visant à prévenir l'émergence, l'escalade ou l'extension des conflits armés. Concept opérationnalisé par l'ONU (Boutros-Ghali, 'Agenda pour la Paix', 1992). Instruments : missions d'observation, médiation précoce, mesures de confiance. Succès relatifs : Mozambique (1992), Namibie (1990). Limites : nécessite la volonté des parties et souvent le consentement de l'État hôte, absent dans les situations les plus explosives."},
  {term:"FMI",def:"Fonds Monétaire International : institution créée à Bretton Woods en 1944, basée à Washington, comptant 190 membres. Missions : surveillance macroéconomique mondiale, aide aux pays en crise de balance des paiements (prêts conditionnels à des réformes structurelles). Sa conditionnalité (austérité budgétaire, libéralisation) est très critiquée pour ses effets sociaux (Grèce 2010-2018, Argentine 2001). Directrice générale : Kristalina Georgieva depuis 2019."},
  {term:"Banque mondiale",def:"Groupe d'institutions financières internationales (BIRD, IDA, SFI) basé à Washington, créé à Bretton Woods (1944). Finance les projets de développement dans les pays à revenus faibles et intermédiaires : éducation, santé, infrastructure. Budget annuel ~80 milliards de dollars. Critiques similaires au FMI : conditionnalités néolibérales, impact environnemental de projets financés, déficit démocratique. Président : Ajay Banga depuis juin 2023."},
  {term:"ODD",def:"Objectifs de Développement Durable : 17 objectifs adoptés par l'ONU en 2015 pour l'horizon 2030 (Agenda 2030), couvrant la pauvreté, la faim, la santé, l'éducation, l'égalité des genres, l'eau, l'énergie, le travail, l'industrie, les inégalités, les villes, la consommation, le climat, la vie marine, la vie terrestre, la paix et les partenariats. Bilan 2023 : selon l'ONU, seuls 15% des ODD sont sur bonne trajectoire. La pandémie de Covid-19 a fait reculer significativement les progrès."},
  {term:"Accord de Paris",def:"Accord international sur le climat signé le 12 décembre 2015 dans le cadre de la COP21, ratifié par 196 parties. Objectif central : limiter le réchauffement climatique bien en dessous de +2°C et si possible à +1,5°C par rapport aux niveaux préindustriels. Mécanisme : contributions nationales déterminées (NDC), révisées tous les 5 ans. Limite : non contraignant, pas de mécanisme de sanction. En 2023, les émissions mondiales de CO2 ont atteint un niveau record de 36,8 gigatonnes."},
  {term:"BRICS",def:"Groupement de grandes économies émergentes : Brésil, Russie, Inde, Chine, Afrique du Sud (acronyme créé par Goldman Sachs en 2001). BRICS+ depuis janvier 2024 : l'Égypte, l'Éthiopie, l'Iran, l'Arabie Saoudite et les Émirats arabes unis ont rejoint. PIB combiné (PPA) : environ 35% du PIB mondial. Institutions : Nouvelle Banque de Développement (NBD). Enjeu central : dédollarisation des échanges internationaux et création d'une monnaie commune ou d'un système de paiement alternatif."},
  {term:"ASEAN",def:"Association des Nations de l'Asie du Sud-Est : créée en 1967 à Bangkok par 5 États (Indonésie, Malaisie, Philippines, Singapour, Thaïlande), elle compte aujourd'hui 10 membres. PIB cumulé : ~3 700 milliards de dollars. Principes fondateurs : non-ingérence dans les affaires internes et consensus. Communauté ASEAN formée en 2015. Défi central : naviguer entre la rivalité sino-américaine sans choisir de camp, tout en gérant les conflits en mer de Chine méridionale."},
  {term:"Mercosur",def:"Marché commun d'Amérique du Sud fondé en 1991 par le Traité d'Asunción (Argentine, Brésil, Paraguay, Uruguay). Venezuela suspendu depuis 2016. Bolivie en adhésion depuis 2015. PIB cumulé : ~3 000 milliards de dollars. Accord avec l'UE négocié depuis 1999, signé en 2019 mais bloqué par les réticences françaises (agriculture, déforestation). Limite principale : asymétrie des économies, Brésil représentant 70% du PIB total."},
  {term:"Zone euro",def:"Espace monétaire réunissant les pays membres de l'UE ayant adopté l'euro comme monnaie unique. 20 membres en 2024. Création en 1999 (taux de change fixes), billets et pièces en 2002. Gouvernée par la Banque centrale européenne (BCE, Francfort). La crise de la dette souveraine (2010-2015, Grèce, Irlande, Portugal, Espagne, Italie) a révélé les limites d'une union monétaire sans union budgétaire. Le mécanisme européen de stabilité (MES) et l'union bancaire sont des réponses partielles."},
  {term:"Brexit",def:"Sortie du Royaume-Uni de l'Union européenne, formalisée le 31 janvier 2020 après le référendum du 23 juin 2016 (51,9% pour le Leave). Résultat d'une campagne marquée par des promesses exagérées ('350 millions de livres par semaine pour le NHS'). Accord de retrait signé en décembre 2020 (Boris Johnson). Conséquences : baisse des échanges UK-UE d'environ 15%, pénuries de main-d'oeuvre, perte d'influence britannique. Débat persistant sur le 'Regrexit'."},
  {term:"Laïcité",def:"Principe de séparation de l'État et des institutions religieuses, garantissant la liberté de conscience et la neutralité de l'État en matière religieuse. En France, consacrée par la loi de 1905 sur la séparation des Églises et de l'État. La laïcité française, 'jacobine' et assimilationniste, est plus stricte que le modèle anglo-saxon de pluralisme religieux. Débats contemporains : voile islamique à l'école (loi 2004), abayas (2023), laïcité dans les associations."},
  {term:"État-providence",def:"Modèle d'organisation sociale dans lequel l'État garantit à tous les citoyens un niveau minimal de bien-être par des politiques redistributives (protection sociale, santé, éducation). Théorisé par William Beveridge (Rapport Beveridge, 1942, Royaume-Uni). En France : Sécurité sociale créée en 1945. Dépenses sociales françaises : ~32% du PIB (plus élevé de l'OCDE). Sous pression depuis les années 1980 (néolibéralisme, vieillissement démographique, mondialisation)."},
  {term:"Démocratie illibérale",def:"Concept forgé par Fareed Zakaria (1997) désignant des régimes qui organisent des élections formellement libres mais violent les droits fondamentaux, l'État de droit et l'indépendance des institutions. Viktor Orbán en Hongrie s'est lui-même revendiqué de ce modèle (2014). Exemples : Hongrie, Pologne (avant 2023), Türkiye, Israël sous Netanyahou (réforme judiciaire 2023). Tension croissante entre légitimité électorale et respect des contre-pouvoirs."},
  {term:"Néolibéralisme",def:"Doctrine économique privilégiant le marché libre, la privatisation, la déréglementation et la limitation de l'intervention étatique. Théorisé par Hayek ('La Route de la servitude', 1944) et Friedman (École de Chicago). Mis en oeuvre par Thatcher (UK, 1979) et Reagan (USA, 1981). Dominant jusqu'à la crise de 2008. Critiqué pour son rôle dans la montée des inégalités et la crise financière mondiale. L'ère post-Covid (Biden, IRA 2022) marque un retour au dirigisme industriel."},
  {term:"Keynésianisme",def:"Théorie économique de John Maynard Keynes ('Théorie générale', 1936) selon laquelle l'État doit intervenir par la dépense publique pour soutenir la demande aggregate et sortir des récessions. Fondement du New Deal (Roosevelt, 1933) et de la reconstruction européenne post-1945. Remis en cause par la stagflation des années 1970. Renaissance après 2008 (plans de relance) et 2020 (Covid). Keynes : 'À long terme, nous sommes tous morts.'"},
  {term:"Protectionnisme",def:"Politique économique consistant à protéger les producteurs nationaux de la concurrence étrangère par des tarifs douaniers, quotas, normes techniques ou subventions. Tarifs Smoot-Hawley (1930, USA) ont aggravé la Grande Dépression. L'OMC vise à réduire le protectionnisme. Retour depuis 2018 : guerre commerciale USA-Chine (Trump), Inflation Reduction Act (Biden, 2022), politiques industrielles nationales. Débat : 'protectionnisme intelligent' (filières stratégiques) vs libre-échange."},
  {term:"Développement durable",def:"Concept formulé par le rapport Brundtland (1987) comme 'un développement qui répond aux besoins du présent sans compromettre la capacité des générations futures à répondre aux leurs'. Trois piliers : économique, social, environnemental. Institutionnalisé par le Sommet de la Terre (Rio, 1992), les OMD (2000-2015) et les ODD (2015-2030). Tensions persistantes entre croissance économique et limites planétaires (concept des 'limites planétaires' de Rockström, 2009)."},
  {term:"Gouvernance mondiale",def:"Ensemble des normes, institutions, processus et acteurs qui régulent les affaires globales en l'absence d'un gouvernement mondial. Se distingue du gouvernement par son caractère pluricentrique (États, OI, ONG, multinationales). Institutions clés : ONU, OMC, FMI, G20. Déficits identifiés : représentativité (sur-représentation de l'Occident), effectivité (accords non contraignants), légitimité démocratique. Les 'biens publics mondiaux' (stabilité financière, santé mondiale, climat) sont ses objets prioritaires."},
  {term:"Transition énergétique",def:"Processus de transformation profonde des systèmes énergétiques pour passer des combustibles fossiles (pétrole, gaz, charbon) aux énergies renouvelables (solaire, éolien, hydraulique). Nécessaire pour atteindre la neutralité carbone. Investissements requis : 5 000 milliards de dollars par an selon l'AIE. Tensions géopolitiques : les minéraux critiques (lithium, cobalt, terres rares) concentrés en Chine, RDC, Chili. La Chine domine 80% de la production de panneaux solaires mondiaux."},
  {term:"Droits de l'homme",def:"Droits inhérents à tout être humain, indépendamment de la nationalité, du sexe, de l'origine ethnique ou de la religion. Fondement : Déclaration universelle des droits de l'homme (ONU, 10 décembre 1948, Eleanor Roosevelt). Deux générations : droits civils et politiques (Pacte 1966) + droits économiques, sociaux, culturels (Pacte 1966). Troisième génération : droit au développement, à l'environnement. Universalité contestée : relativisme culturel (pays asiatiques, islamiques) vs universalisme occidental."},
  {term:"Plaidoirie",def:"Art et acte de plaider devant un tribunal en faveur d'une partie, en exposant les faits, la loi et les arguments pour convaincre le juge ou les jurés. La plaidoirie combine éthos (crédibilité de l'avocat), pathos (appel à la justice) et logos (argumentation juridique). Grands plaideurs français : Jacques Vergès, Robert Badinter, Éric Dupond-Moretti. Elle se termine toujours par des conclusions claires demandant un verdict précis."},
  {term:"Procès équitable",def:"Droit fondamental garanti par l'article 6 de la Convention européenne des droits de l'homme et l'article 14 du Pacte international relatif aux droits civils et politiques. Il comprend : égalité des armes, impartialité du tribunal, délai raisonnable, présomption d'innocence, droit à un défenseur, publicité des débats. La Cour européenne des droits de l'homme a condamné la France plus de 200 fois pour violation du droit à un procès équitable, principalement pour durée excessive des procédures."},
  {term:"Présomption d'innocence",def:"Principe fondamental du droit pénal selon lequel toute personne accusée d'un crime est présumée innocente jusqu'à ce que sa culpabilité soit légalement établie. Consacré par l'article 9 de la DDHC (1789) et l'article 6-2 de la CEDH. En France, sa violation dans les médias constitue une faute civile (article 9-1 du Code civil). La présomption d'innocence est mise à l'épreuve par les arrestations médiatisées, les fuites judiciaires et les réseaux sociaux."},
  {term:"Séparation des pouvoirs",def:"Doctrine politique formulée par John Locke (1689) et théorisée par Montesquieu ('De l'esprit des lois', 1748) préconisant la division du pouvoir politique en trois branches indépendantes : exécutif (gouverner), législatif (légiférer), judiciaire (juger). Objectif : prévenir la tyrannie par les checks and balances. La Ve République française concentre fortement le pouvoir exécutif (président + premier ministre). Les démocraties illibérales attaquent systématiquement l'indépendance judiciaire."},
  {term:"État de droit",def:"Principe selon lequel tout pouvoir, y compris l'État lui-même, est soumis au droit et ne peut agir qu'en vertu et dans les limites de celui-ci. Comprend la légalité (lois publiques, stables, générales), la non-rétroactivité, l'égalité devant la loi et le contrôle juridictionnel des actes de l'État. Contrôle constitutionnel en France : Conseil constitutionnel (depuis 1958) et QPC (depuis 2010). L'état d'urgence post-attentats (2015-2017) puis Covid (2020) a soulevé des questions sur ses limites."},
  {term:"Subsidiarité",def:"Principe selon lequel les décisions doivent être prises au niveau le plus proche possible des citoyens concernés, et ne remonter à un niveau supérieur que si le niveau inférieur est insuffisant pour les prendre efficacement. Principe constitutif de l'Union européenne (Traité de Maastricht, 1992, article 5 TUE). En France, principe de l'organisation territoriale (Loi de décentralisation de 1982, Acte II 2003). Permet de justifier à la fois la décentralisation (État vers collectivités) et la coopération internationale (États vers OI)."},
];
const FICHES_DATA=[
  {id:1,title:"Organisation des Nations Unies",icon:"🌐",color:"#2B78F5",items:["193 États membres, fondée le 24 octobre 1945 (Charte de San Francisco, 51 États fondateurs)","Conseil de sécurité : 5 membres permanents avec droit de veto (USA, Russie, Chine, France, UK) + 10 membres non permanents élus pour 2 ans","Assemblée générale : 1 État = 1 voix, résolutions non contraignantes — séances plénières annuelles en septembre","Secrétaire général : António Guterres (depuis 2017, réélu 2022-2026, ancien PM du Portugal)","Cour internationale de Justice (CIJ) : siège à La Haye, 15 juges élus pour 9 ans — tranche les différends inter-étatiques","Budget ordinaire 2024 : ~3,59 milliards de dollars — USA sont le premier contributeur (22%)","Opérations de maintien de la paix (OMP) : 12 missions actives, ~87 000 personnels en 2024, coût annuel ~6,4 Mds$","Agences spécialisées : UNESCO (éducation), OMS (santé), FAO (alimentation), PNUD (développement), HCR (réfugiés), UNICEF (enfants), OIT (travail)","Veto utilisé 290 fois depuis 1945 : Russie/URSS (120 fois), USA (82 fois), UK (29 fois), France (16 fois), Chine (17 fois)","Réformes débattues : élargissement du Conseil de sécurité (Inde, Brésil, Allemagne, Japon et Afrique revendiquent un siège permanent)","Déclaration universelle des droits de l'homme : adoptée le 10 décembre 1948, 30 articles, 500 langues de traduction","Prix Nobel de la Paix : ONU et ses agences récompensées 9 fois (ONU 2001, GIEC+Gore 2007, CICR 1944, 1963)","Financement : contributions obligatoires (quotes-parts) + contributions volontaires — 40% du budget vient des contributions volontaires","ONU et les grands défis : changement climatique (CCNUCC), pandémies (OMS), terrorisme (Comité 1267), armes nucléaires (TNP)","Scandales et limites : génocide du Rwanda (1994) sans intervention, Srebrenica (1995), réforme bloquée par les P5","Organisation duale : secrétariat (fonctionnaires internationaux) + États membres (souverains)","Agenda 2030 : 17 ODD adoptés en 2015, bilan mitigé — seulement 15% sur bonne trajectoire selon rapport 2023","ECOSOC : Conseil économique et social, 54 membres, coordination des agences et programmes","Cour pénale internationale (CPI) : distincte de la CIJ, créée par le Statut de Rome (1998), 124 membres","Tribunal international du droit de la mer (TIDM) : siège à Hambourg, compétent sur les conflits maritimes"]},
  {id:2,title:"Union Européenne",icon:"🇪🇺",color:"#E03535",items:["27 États membres après le Brexit (31 janvier 2020) — Union fondée sur les Traités de Rome (1957, CEE) et Maastricht (1992)","Traité de Lisbonne (2009) : base juridique actuelle, personnalité juridique de l'UE, Charte des droits fondamentaux contraignante","Parlement européen : 720 sièges (élections juin 2024), co-législateur avec le Conseil de l'UE","Commission européenne : 27 commissaires, droit d'initiative législative — Présidente Ursula von der Leyen (2e mandat 2024-2029)","Conseil de l'UE : 27 ministres des États membres par domaine, vote à la majorité qualifiée ou à l'unanimité","Conseil européen : chefs d'État et de gouvernement, fixe les orientations stratégiques — Président Charles Michel (2019-2024), puis António Costa","BCE (Banque centrale européenne, Francfort) : fixe les taux directeurs pour les 20 pays de la zone euro","Cour de justice de l'UE (CJUE) : Luxembourg, interprète le droit européen, compétence obligatoire pour tous les membres","PIB UE : ~16 700 milliards d'euros (2023), 2e puissance économique mondiale après les USA, 1re avant la Chine","Zone euro : 20 membres (2024) — Bulgarie, Hongrie, Pologne, République tchèque, Roumanie, Suède hors zone euro","Politique agricole commune (PAC) : ~32% du budget UE 2021-2027 — 387 milliards d'euros sur 7 ans","Schengen : 29 pays (25 membres UE + Islande, Norvège, Suisse, Liechtenstein) — libre circulation sans contrôle aux frontières","Budget UE 2021-2027 : 1 074 milliards d'euros + 750 Mds de Next Generation EU (relance post-Covid)","Élargissement : candidats officiels — Ukraine, Moldavie (2022), Géorgie, Balkans occidentaux (Albanie, Macédoine du Nord, Monténégro, Serbie)","Politique étrangère et de sécurité commune (PESC) : limitée par la règle de l'unanimité","PESCO (coopération structurée permanente) : 26 États membres, 60 projets militaires communs","Commissaires aux droits fondamentaux : Charte des droits fondamentaux (50 articles) depuis 2009","Crise de l'État de droit : procédures d'infraction contre Hongrie et Pologne, gel de fonds structurels","Politique commerciale : compétence exclusive de l'UE — premier exportateur mondial de biens et services","Réforme institutionnelle : débat sur le vote à la majorité qualifiée en politique étrangère, assemblée constituante proposée"]},
  {id:3,title:"OTAN",icon:"🛡️",color:"#7C3AED",items:["32 membres en 2024 (Suède intégrée le 7 mars 2024, Finlande en 2023 — fin de leur neutralité historique de 70 ans)","Fondée le 4 avril 1949 — Traité de Washington — réponse à la menace soviétique post-Seconde Guerre mondiale","Article 5 : attaque contre un membre = attaque contre tous — invoqué une seule fois le 12 septembre 2001 après les attentats du 11/09","Article 4 : consultations entre membres en cas de menace — invoqué 8 fois (dont 3 fois par la Turquie pour la Syrie)","Secrétaire général : Mark Rutte (depuis octobre 2024, ex-Premier ministre des Pays-Bas) — succède à Jens Stoltenberg","Siège : Bruxelles (Belgique) — SHAPE (commandement suprême) à Mons, Belgique","Commandant suprême des forces alliées en Europe (SACEUR) : toujours un général américain depuis 1951","Objectif budgétaire : 2% du PIB — 23 membres atteignent cet objectif en 2024 (vs 9 en 2022) après l'invasion de l'Ukraine","Budget cumulé des membres : +1 350 milliards de dollars en 2024 (USA = 68% du total)","Missions hors-zone : Afghanistan (ISAF 2001-2014, RSM 2014-2021), Kosovo (KFOR depuis 1999), Méditerranée (Sea Guardian)","Sommet de Vilnius (2023) : soutien à l'Ukraine sans adhésion immédiate — Macron annonce une 'aide substantielle'","Sommet de Washington (2024) : 75e anniversaire, renforcement du flanc est, 100 000 soldats américains en Europe","Bouclier antimissile : opérationnel depuis 2016 (Aegis à terre en Roumanie et Pologne) — critiqué par Moscou","Guerre en Ukraine : l'OTAN soutient l'Ukraine en armes (~200 Mds$ depuis 2022) mais refuse l'intervention directe","Force de réaction rapide (NRF) : 40 000 soldats en alerte élevée — doublé depuis 2022 à 300 000","Cyber-défense : cyberespace reconnu comme 5e domaine opérationnel (Varsovie 2016) en plus de la terre, mer, air, espace","Partenariats : Ukraine, Géorgie, Moldavie (aspirants membres), Australie, Japon, Corée du Sud, NZ (IP4 — partenaires Indo-Pacifique)","Russie-OTAN : Conseil OTAN-Russie suspendu depuis 2022, ambassadeurs respectifs expulsés","Armes nucléaires : partage nucléaire avec 6 pays (Belgique, Pays-Bas, Allemagne, Italie, Turquie, USA bases) — ~150 bombes B61","France : réintégrée dans le commandement militaire en 2009 (Sarkozy) après avoir quitté en 1966 (De Gaulle)"]},
  {id:4,title:"Géopolitique 2025",icon:"🗺️",color:"#D97706",items:["Guerre Ukraine-Russie (depuis 24 février 2022) : +700 000 victimes estimées, 6 millions de réfugiés en Europe, 6,5 millions de déplacés internes","Conflit Gaza (depuis 7 octobre 2023) : attaque du Hamas (1 195 morts israéliens, 251 otages), offensive israélienne (+46 000 morts à Gaza selon MSF, crise humanitaire)","Tensions Taïwan : exercices militaires chinois massifs (2022, 2023, 2024) — élections présidentielles janv. 2024, Lai Ching-te élu","Sahel — rupture avec la France : coups d'État au Mali (2021), Burkina Faso (2022), Niger (2023), Gabon (2023) — retrait militaire français, présence Wagner/Africa Corps","Indo-Pacifique — nouvelles alliances : AUKUS (USA-UK-Australie, sous-marins nucléaires), QUAD (USA-Inde-Japon-Australie), I2U2 (USA-Israël-Inde-EAU)","Mer de Chine méridionale : Chine vs Philippines — collisions répétées en 2024, arrêt CPA (2016) ignoré par Pékin","Iran-Israël : échanges de frappes directes en avril et octobre 2024 — première confrontation militaire directe israélo-iranienne de l'histoire","BRICS+ (2024) : Égypte, Éthiopie, Iran, Arabie Saoudite, EAU — représentent désormais 35% du PIB mondial en PPA","Elections 2024 — 'super-année électorale' : 64 pays aux urnes, 4 milliards de votants, Trump réélu aux USA (nov. 2024)","Frontières de l'Arctique : fonte des glaces — nouvelles routes commerciales (passage du Nord-Est), enjeux Russie-Canada-Danemark-USA","Corée du Nord-Russie : accord de coopération militaire (2024) — envoi de soldats nord-coréens en Ukraine confirmé par l'OTAN","Somalie, Éthiopie, Mozambique : conflits persistants — présence d'Al-Shebab, Daech-AOS","Réarmement mondial : dépenses militaires globales = 2 443 milliards de dollars en 2023 (record depuis la Guerre froide)","Rivalité technologique : interdictions américaines sur semi-conducteurs avancés vers la Chine (TSMC, NVIDIA) — contre-mesures chinoises sur gallium, germanium","Dérèglement climatique comme multiplicateur de conflits : sécheresses au Sahel, inondations en Asie du Sud, réfugiés climatiques","Afghanistan (Taliban depuis août 2021) : 97% de la population sous le seuil de pauvreté, retrait des droits des femmes","Syrie : normalisations arabes du régime Assad en 2023 — retour dans la Ligue arabe — chute d'Assad (décembre 2024)","Yemen : guerre civile (Houthis vs coalition saoudienne) depuis 2015 — frappes sur navires en mer Rouge (2024) impactant le commerce mondial","Haïti : État effondré, 80% de la capitale sous contrôle des gangs — mission kényane (2024) autorisée par l'ONU","Caucase du Sud : normalisations Azerbaïdjan-Arménie après la reconquête du Haut-Karabakh (sept. 2023) par Bakou"]},
  {id:5,title:"Institutions françaises",icon:"🏛️",color:"#16A34A",items:["Ve République : Constitution du 4 octobre 1958 (De Gaulle) — 24 révisions constitutionnelles à ce jour","Président de la République : élu au suffrage universel direct depuis 1962 (réforme gaullienne), mandat 5 ans (quinquennat depuis 2000), limité à 2 mandats","Pouvoirs présidentiels : nomination du PM, dissolution de l'Assemblée nationale, référendum (art. 11), état d'exception (art. 16), droit de grâce","Premier ministre : nommé par le président, responsable devant l'Assemblée — peut survivre à une cohabitation (1986-88, 1993-95, 1997-2002)","Gouvernement : responsable devant l'Assemblée nationale — motion de censure (art. 49-3 permet l'adoption sans vote)","Assemblée nationale : 577 députés élus pour 5 ans au scrutin uninominal majoritaire à 2 tours dans 577 circonscriptions","Sénat : 348 sénateurs élus pour 6 ans (renouvelé par moitié tous les 3 ans) par les grands électeurs — chambre conservatrice","Conseil constitutionnel : 9 membres nommés pour 9 ans non renouvelables (3 par le Président, 3 par l'AN, 3 par le Sénat)","QPC (Question prioritaire de constitutionnalité) : depuis 2010, les citoyens peuvent contester la constitutionnalité d'une loi lors d'un procès","Conseil d'État : juridiction administrative suprême + conseil juridique du gouvernement — fondé en 1799 (Napoléon)","Cour de cassation : juridiction judiciaire suprême — contrôle la correcte application de la loi, ne rejuge pas les faits","Tribunal des conflits : départage les conflits de compétence entre ordre judiciaire et administratif","Conseil économique, social et environnemental (CESE) : 233 membres représentant la société civile — rôle consultatif","Défenseur des droits : autorité constitutionnelle indépendante, défend les citoyens contre les mauvaises administrations et discriminations","Cour des comptes : contrôle les finances publiques — publie des rapports annuels d'évaluation des politiques publiques","Collectivités territoriales : 18 régions (dont 5 ultramarines), 101 départements, 35 000 communes — décentralisation depuis la loi Defferre (1982)","Budget de l'État 2025 : ~500 milliards de dépenses, déficit ~5% du PIB, dette publique ~113% du PIB","Haute Autorité pour la transparence de la vie publique (HATVP) : contrôle les déclarations d'intérêts des élus depuis 2013","Parquet national financier (PNF) : créé en 2014, spécialisé dans la grande criminalité financière — affaire Fillon, affaire Sarkozy","Cinquième République en tension : élections législatives 2024 — Assemblée sans majorité absolue, gouvernement de coalition inédit"]},
  {id:6,title:"BRICS & Puissances émergentes",icon:"🌍",color:"#16A34A",items:["BRICS acronyme créé par Jim O'Neill (Goldman Sachs, 2001) pour Brésil, Russie, Inde, Chine — Afrique du Sud intégrée en 2010","BRICS+ depuis janvier 2024 : Égypte, Éthiopie, Iran, Arabie Saoudite, Émirats arabes unis — 10 membres au total","PIB combiné BRICS+ (PPA) : ~35% du PIB mondial — dépasse le G7 (~30%) en parité de pouvoir d'achat","Chine : 2e économie mondiale (18 000 Mds$), 1re en PPA — puissance manufacturière (28% de la production industrielle mondiale)","Inde : 5e économie mondiale (~3 700 Mds$), croissance ~7% — passera le Japon et l'Allemagne d'ici 2027","Russie : 11e économie mondiale — sanctionnée mais résiliente grâce aux hydrocarbures et au pivot asiatique","Brésil : 9e économie mondiale, Lula revenu au pouvoir (2023) — puissance agricole (1er exportateur mondial de soja)","Afrique du Sud : seul pays africain, 2e économie du continent — enjeux de représentativité","Nouvelle Banque de Développement (NBD) : siège à Shanghai, capital initial 100 Mds$, alternativeo à la Banque mondiale","Dédollarisation : enjeu central — échanges en yuans, roubles et monnaies locales — part du dollar dans réserves mondiales baisse (60% en 2023 vs 71% en 2001)","Rivalité avec le G7 : les BRICS refusent la conditionnalité des prêts du FMI/BM et prônent une gouvernance mondiale plus représentative","Chine-Afrique : 300 milliards de dollars d'investissements depuis 2000 — 'piège de la dette' selon certains analystes","Inde-Occident : rapprochement stratégique USA-Inde (Quad) tout en maintenant des liens avec Moscou — 'ambiguité stratégique'","Population combinée BRICS+ : ~3,5 milliards de personnes (45% de la population mondiale)","Énergie BRICS : Russie et Arabie Saoudite contrôlent ~25% des exportations mondiales de pétrole — levier géopolitique majeur","Lutte d'influence : concurrence BRICS vs G7 pour influencer les institutions de Bretton Woods (FMI, BM)","Indonésie, Arabie Saoudite, Turquie, Mexique : prochains candidats potentiels à l'adhésion (plus de 40 pays ont exprimé leur intérêt)","Limites internes : rivalités sino-indiennes (frontière himalayenne), idéologies divergentes (démocratie indienne vs autoritarisme chinois)","Forums connexes : G20 (BRICS y pèsent fortement), OCS (Organisation de Coopération de Shanghai) — Russie, Chine, Inde, Pakistan, Iran","Commerce Sud-Sud : +300% en 20 ans — alternative aux chaînes de valeur Nord-Sud traditionnelles"]},
  {id:7,title:"Histoire contemporaine XXe",icon:"📅",color:"#7C3AED",items:["1914-1918 : Première Guerre mondiale — 20 millions de morts, fin des empires austro-hongrois, ottoman, allemand et russe","1917 : Révolution russe (février : chute du tsar ; octobre : prise du pouvoir bolchevique) — naissance de l'URSS en 1922","1919 : Traité de Versailles — 'diktat' pour l'Allemagne, génie de Wilson (SDN) mais refus du Sénat américain","1929 : Krach de Wall Street (24 octobre) — Grande Dépression mondiale, 30% de chômage aux USA, montée des fascismes","1933 : Hitler chancelier — réarmement allemand, lois de Nuremberg (1935), Anschluss (1938), Pacte germano-soviétique (août 1939)","1939-1945 : Deuxième Guerre mondiale — 70-85 millions de morts dont 6 millions de Juifs (Shoah), 27 millions de Soviétiques","1945 : Conférences de Yalta (février) et Potsdam (juillet-août) — partage du monde, création de l'ONU, bombes atomiques sur Hiroshima et Nagasaki","1947 : Plan Marshall (13 Mds$), doctrine Truman (endiguement), Partition de l'Inde (Pakistan), début de la Guerre froide","1948 : Déclaration universelle des droits de l'homme, État d'Israël proclamé (mai 1948), Blocus de Berlin","1949 : OTAN créée, RFA et RDA fondées, Mao proclame la République populaire de Chine (1er octobre)","1950-1953 : Guerre de Corée — 3 millions de morts, armistice à Panmunjeom, péninsule toujours divisée","1955-1962 : Décolonisation accelerée — Conférence de Bandung (1955), Maroc et Tunisie (1956), indépendances africaines en 1960, Algérie (1962)","1961-1972 : Paroxysme de la Guerre froide — mur de Berlin (août 1961), crise des missiles de Cuba (octobre 1962, 13 jours), guerre du Vietnam","1968 : Printemps de Prague (réprimé en août), Mai 68 en France (10 millions de grévistes), assassinats de MLK (avril) et RFK (juin)","1973 : Choc pétrolier (octobre), fin des accords de Bretton Woods (1971), guerre de Kippour, accord de Paris sur le Vietnam","1979 : Révolution iranienne (Khomeini), invasion de l'Afghanistan par l'URSS (décembre), élection de Thatcher (mai)","1989 : Chute du mur de Berlin (9 novembre), place Tiananmen (juin), révolutions en Europe de l'Est","1991 : Dissolution de l'URSS (25 décembre), 15 républiques indépendantes, guerre du Golfe (jan.-fév.), éclatement de la Yougoslavie","1994 : Génocide du Rwanda (800 000 morts en 100 jours), Accord d'Oslo Israël-OLP (1993), Accords du Vendredi saint pour l'Irlande du Nord (1998)","2001 : Attentats du 11 septembre (2 977 morts) — guerre en Afghanistan (2001-2021), Patriot Act, redéfinition de la sécurité mondiale"]},
  {id:8,title:"Économie internationale",icon:"💹",color:"#D97706",items:["Bretton Woods (1944) : système monétaire international fondé sur le dollar lié à l'or (35$/once) — effondrement en 1971 (Nixon)","FMI : 190 membres, prêts conditionnels liés à des plans d'ajustement structurel — DTS (Droits de Tirage Spéciaux) comme monnaie de réserve","Banque mondiale : groupe de 5 institutions, finance le développement — critique persistante sur la conditionnalité néolibérale","OMC (1995) : 164 membres, règlement des différends commerciaux — Ronde de Doha (2001) bloquée, appel ORD paralysé depuis 2020","G7 : 7 pays industrialisés représentant ~45% du PIB mondial nominale — coordination sur sanctions, taux, dette des pays pauvres","G20 : créé en 1999, 85% du PIB mondial et 75% du commerce — forum principal de coordination économique post-2008","PIB mondial 2024 : ~110 000 milliards de dollars — USA (27%), Chine (18%), UE (16%), Japon (4%), Inde (3,5%)","Commerce mondial 2023 : ~31 000 milliards de dollars — biens (23 000 Mds$) + services (7 500 Mds$)","Inflation 2022-2023 : pic à +10% en zone euro (oct. 2022), +9,1% aux USA (juin 2022) — choc énergétique + chaînes d'approvisionnement post-Covid","Politique monétaire : remontée historique des taux directeurs 2022-2024 — BCE de 0% à 4,5%, FED de 0,25% à 5,5%","Dette mondiale 2024 : 313 000 milliards de dollars (FMI) — record absolu, 330% du PIB mondial","Inégalités mondiales : 1% des plus riches possèdent 43% de la richesse mondiale (Oxfam, 2023) — coefficient de Gini mondial en hausse","Transition verte : 5 000 milliards de dollars d'investissements annuels nécessaires pour atteindre la neutralité carbone (AIE)","Inflation Reduction Act (USA, 2022) : 369 Mds$ de subventions vertes — déclenche une guerre de subsidies avec l'UE","Reshoring / nearshoring : retour de la production aux USA et en Europe — semi-conducteurs (CHIPS Act), batteries, médicaments","Économie de plateforme : GAFAM + Alibaba + Tencent = capitalisation cumulée >10 000 Mds$ (2024)","Crypto-monnaies : Bitcoin (capitalisation ~1 000 Mds$, 2024) — ETF Bitcoin approuvé aux USA (janvier 2024), débat sur la régulation","Déflation chinoise : croissance ralentie (~5%), crise immobilière (Evergrande 2021), guerre commerciale, tensions géopolitiques","Afrique : croissance moyenne ~4% mais disparités immenses — Éthiopie, Rwanda, Côte d'Ivoire en tête","Indicateurs alternatifs au PIB : IDH (PNUD), bien-être subjectif (ONU), économie du donut (Kate Raworth)"]},
  {id:9,title:"Droit constitutionnel",icon:"⚖️",color:"#E03535",items:["Constitution : norme suprême de l'ordre juridique — théorie de la hiérarchie des normes de Hans Kelsen ('pyramide de Kelsen')","Bloc de constitutionnalité français : Constitution 1958 + DDHC 1789 + Préambule 1946 + Charte environnement 2004 + PFRLR","Séparation des pouvoirs : Montesquieu ('De l'esprit des lois', 1748) — exécutif, législatif, judiciaire — checks and balances américains","État de droit (Rechtsstaat) : tout acte du pouvoir public doit avoir un fondement juridique et respecter les droits fondamentaux","Révision constitutionnelle (art. 89) : vote à la majorité des 3/5 du Congrès ou référendum — 24 révisions depuis 1958","QPC (Question prioritaire de constitutionnalité) : depuis 2010, tout citoyen peut contester la constitutionnalité d'une loi applicable à son litige","Contrôle a priori : Conseil constitutionnel saisi avant la promulgation (art. 61) — lois organiques, règlements des assemblées obligatoirement","Article 49-3 : engage la responsabilité du gouvernement sur un texte — si pas de censure dans les 24h, le texte est adopté sans vote","Article 16 : pouvoirs exceptionnels du Président en cas de menace grave sur les institutions — utilisé 5 mois par De Gaulle en 1961","Referendum (art. 11 et 89) : organisé 9 fois depuis 1958 — victoire du Non en 2005 (Traité constitutionnel européen)","Droit de dissolution (art. 12) : le Président peut dissoudre l'Assemblée nationale après consultation des présidents des assemblées — 5 fois","Régime parlementaire rationalisé : la Ve République a renforcé l'exécutif par rapport aux IIIe et IVe Républiques (instabilité ministérielle)","Cohabitation : possible quand le Président et le PM sont de camps opposés — 1986-88 (Chirac-Mitterrand), 1993-95, 1997-2002","Contrôle de constitutionnalité : concentré (Conseil constitutionnel en France) vs diffus (toutes les juridictions, modèle américain)","Droit constitutionnel comparé : systèmes présidentiel (USA), semi-présidentiel (France), parlementaire (UK, Allemagne), fédéral (Allemagne, USA)","Loi constitutionnelle du 23 juillet 2008 : limitation à 2 mandats présidentiels, question du gouvernement en séance, droit de pétition","Conseil d'État : contrôle la légalité des actes réglementaires — excès de pouvoir, détournement, erreur manifeste d'appréciation","DDHC 1789 : 17 articles — liberté, égalité, souveraineté nationale, séparation des pouvoirs, présomption d'innocence","Préambule de 1946 : droits sociaux constitutionnalisés — égalité homme/femme, droit d'asile, droit de grève, liberté syndicale","État d'urgence : cadre légal depuis la loi de 1955 (Algérie), prolongé 2015-2017 (terrorisme), puis état d'urgence sanitaire (2020-2022)"]},
  {id:10,title:"Libertés fondamentales & CEDH",icon:"🕊️",color:"#2B78F5",items:["CEDH signée à Rome le 4 novembre 1950 — Conseil de l'Europe (46 membres, distinct de l'UE) — ratifiée par 46 États","Cour européenne des droits de l'homme (CEDH) : siège à Strasbourg — 47 juges (un par État) — fondée en 1959","Art. 2 : droit à la vie — interdit la peine de mort (protocoles 6 et 13) — Turquie dernier État en avoir abolie la peine de mort pour adhérer au Conseil","Art. 3 : interdiction absolue de la torture et des traitements inhumains ou dégradants — aucune dérogation possible même en état d'urgence","Art. 5 : droit à la liberté et à la sûreté — interdit les détentions arbitraires — délai raisonnable obligatoire","Art. 6 : droit à un procès équitable — tribunal impartial, délai raisonnable, présomption d'innocence, défense effective","Art. 8 : droit au respect de la vie privée et familiale — source jurisprudentielle majeure (protection des données, regroupement familial, orientation sexuelle)","Art. 9 : liberté de pensée, de conscience et de religion — laïcité française a été jugée compatible avec l'article 9","Art. 10 : liberté d'expression — inclut les médias, artistes, journalistes — soumise à des restrictions proportionnées","Art. 11 : liberté de réunion et d'association — protection des syndicats et partis politiques","Art. 14 : interdiction de la discrimination dans la jouissance des droits garantis — protocole 12 : interdiction générale de discrimination","Protocole 1, art. 3 : droit à des élections libres — premier traité international protégeant spécifiquement le droit de vote","France condamnée ~85-100 fois par an par la CEDH — principalement pour durée excessive des procédures et conditions de détention","Arrêts historiques : Handyside (1976, liberté expression), Klass (1978, surveillance), Soering (1989, extradition vers la peine de mort)","Déclaration universelle des droits de l'homme (ONU, 10 décembre 1948) — 30 articles — 500 langues — non contraignante juridiquement","Pacte international relatif aux droits civils et politiques (1966) : traité ONU contraignant — Comité des droits de l'homme à Genève","Charte africaine des droits de l'homme et des peuples (1981, Banjul) — Cour africaine à Arusha (Tanzanie)","Charte des droits fondamentaux de l'UE (2000/2009) : 50 articles contraignants depuis le Traité de Lisbonne","Convention contre la torture (CAT, 1984) : Comité contre la torture à Genève — 173 États parties","Droits de 3e génération : droit au développement (Déclaration ONU 1986), droit à l'environnement, droit à la paix — encore non contraignants","Dignité humaine : fondement philosophique de tous les droits fondamentaux (Kant) — consacrée en art. 1 de la Charte UE"]},
  {id:11,title:"Climat & Accords internationaux",icon:"🌱",color:"#16A34A",items:["Accord de Paris (12 décembre 2015, COP21) : 196 parties signataires, limite le réchauffement à +1,5°C vs préindustriel","Mécanisme NDC : contributions nationales déterminées, révisées à la hausse tous les 5 ans — insuffisantes pour atteindre 1,5°C","GIEC (créé 1988) : 195 pays membres, rapports d'évaluation scientifique tous les ~6 ans — AR6 (2021-2022) : code rouge pour l'humanité","Émissions mondiales CO2 (2023) : 36,8 gigatonnes — record historique malgré les accords climatiques","Températures 2024 : +1,54°C au-dessus des niveaux préindustriels — premier franchissement annuel du seuil de +1,5°C","Principaux émetteurs : Chine (27%), USA (14%), UE (8%), Inde (7%), Russie (5%) — les 5 représentent 61% des émissions","COP27 (Sharm el-Sheikh, 2022) : création du Fonds pour les pertes et dommages — pays vulnérables — accord historique mais montants insuffisants","COP28 (Dubaï, décembre 2023) : première mention de la 'sortie des combustibles fossiles' — présidé par sultan Al Jaber (directeur d'Abu Dhabi National Oil Company)","COP29 (Bakou, novembre 2024) : financement climat 300 Mds$ annuels pour les pays en développement d'ici 2035 — critiqué comme insuffisant","Pacte vert européen (Green Deal) : neutralité carbone UE en 2050, -55% d'émissions en 2030 vs 1990 — loi européenne sur le climat","Mécanisme d'ajustement carbone aux frontières (MACF) : en vigueur depuis 2026, sur acier, aluminium, ciment, engrais, électricité","Finance verte : 1 000 milliards de dollars d'obligations vertes émises en 2023 — risque de greenwashing","Energies renouvelables : solaire + éolien = 30% de la production d'électricité mondiale (2023) — coût du solaire divisé par 90% en 10 ans","Points de basculement (tipping points) : dégel du permafrost, effondrement de la calotte glaciaire antarctique, mort des récifs coralliens","Biodiversité : Accord de Kunming-Montréal (COP15 Biodiversité, déc. 2022) — 30% des terres et mers protégées d'ici 2030","Désertification : Sahel — 100 millions de personnes menacées — frontière de désert avance de 48 km/an","Eau : 3,6 milliards de personnes en zones de pénurie d'eau au moins 1 mois/an — 5 milliards d'ici 2050","Litiges climatiques : plus de 2 500 procès climatiques dans 65 pays — arrêt CEDH vs Suisse (2024) : obligation de protéger contre le changement climatique","Inégalités climatiques : les 1% les plus riches émettent autant que les 66% les plus pauvres (Oxfam, 2023)","Réfugiés climatiques : 21,5 millions de personnes déplacées par des catastrophes météorologiques chaque année — pas de statut juridique"]},
  {id:12,title:"Organisations africaines",icon:"🌍",color:"#D97706",items:["Union Africaine (UA) : 55 membres (tous les États africains, Maroc réintégré en 2017), fondée en 2002 à Durban (succède à l'OUA de 1963)","Commission de l'UA : siège à Addis-Abeba (Éthiopie), Présidente Moussa Faki Mahamat jusqu'en 2025 — équivalent de la Commission européenne","Conseil de paix et de sécurité (CPS) de l'UA : 15 membres, peut autoriser des interventions militaires — doctrine 'non-indifférence'","AMISOM/ATMIS : mission de l'UA en Somalie contre Al-Shebab depuis 2007 — transition vers forces somaliennes en 2022","Agenda 2063 : vision africaine 'L'Afrique que nous voulons' — intégration continentale, industrialisation, démocratie","CEDEAO (ECOWAS) : 15 États d'Afrique de l'Ouest, fondée en 1975, siège à Abuja — libre circulation des personnes","CEDEAO en crise : Mali, Burkina Faso, Niger se retirent en 2024 pour former l'Alliance des États du Sahel (AES) — défi existentiel","SADC : 16 États d'Afrique australe, siège à Gaborone — zone de libre-échange partielle, mission en Mozambique (Cabo Delgado)","EAC (Communauté d'Afrique de l'Est) : 7 membres (Kenya, Tanzanie, Ouganda, Rwanda, Burundi, Soudan du Sud, RDC) — intégration économique","IGAD : 8 États de la Corne de l'Afrique — médiateur dans les conflits (Soudan, Éthiopie, Somalie)","ZLECAf (Zone de libre-échange continentale africaine) : opérationnelle depuis 2021 — marché de 1,4 Md de personnes, 3 400 Mds$ de PIB","Banque africaine de développement (BAD) : siège à Abidjan, capital de 250 Mds$, finance les projets d'infrastructure","Population africaine : 1,4 milliard (2023), sera 2,5 milliards en 2050 — 60% ont moins de 25 ans — dividende démographique","PIB africain : ~3 000 milliards de dollars — Nigeria (440 Mds$) + Égypte (400 Mds$) + Afrique du Sud (380 Mds$) = 40% du PIB continental","Francophonie africaine : 30 des 54 États africains sont membres de l'OIF — influence française en recul post-2020 dans le Sahel","Présence chinoise en Afrique : 300 Mds$ d'investissements depuis 2000, Forum Chine-Afrique (FOCAC) tous les 3 ans","Présence russe : Wagner/Africa Corps au Mali, Burkina, Niger, Libye, Centrafrique — offre sécuritaire alternative à la France","Défi de gouvernance : 54 des 195 États les plus fragiles au monde sont africains (Fragile States Index, 2024)","Transition énergétique africaine : Afrique subsaharienne émet 3% des GES mondiaux mais subit le plus les effets — justice climatique","Initiative africaine du continent numérique : ambition de 'smart cities', fintech (MPesa au Kenya), internet par satellite"]},
  {id:13,title:"Numérique, IA & Gouvernance",icon:"🤖",color:"#7C3AED",items:["IA générative : ChatGPT lancé le 30 novembre 2022 — 100 millions d'utilisateurs en 2 mois (record absolu de croissance)","Règlement européen sur l'IA (AI Act) : adopté en mars 2024, entré en vigueur août 2024 — premier cadre juridique mondial contraignant sur l'IA","AI Act : approche par niveaux de risque — risque inacceptable (biométrie en temps réel, manipulation), haut risque (emploi, justice), faible risque","RGPD (2018) : protection des données personnelles — amendes jusqu'à 4% du chiffre d'affaires mondial — modèle exporté mondialement","GAFAM : Google, Apple, Facebook/Meta, Amazon, Microsoft — capitalisation cumulée ~12 000 milliards de dollars (2024)","Digital Services Act (DSA, 2022) : régulation des contenus illicites en ligne, responsabilité des plateformes — très grandes plateformes (VLOPs)","Digital Markets Act (DMA, 2022) : régulation des 'gatekeepers' numériques — concurrence, interopérabilité — amende possible de 10% du CA","Cybersécurité : 26 000 attaques par heure dans le monde (2024) — NotPetya (2017, 10 Mds$ de dégâts), SolarWinds (2020), pipeline Colonial (2021)","Guerre de l'IA : USA vs Chine — NVIDIA (puces H100 interdites d'exportation), Huawei (puce 910B maison), rivalité sur LLM (GPT-4 vs Ernie, Qwen)","Fracture numérique : 2,6 milliards de personnes sans accès à internet (2024) — concentration en Afrique subsaharienne et Asie du Sud","Gouvernance d'internet : ICANN (noms de domaine), IGF (Forum de gouvernance de l'internet) — modèle multi-acteurs vs modèle intergouvernemental chinois","Starlink (SpaceX) : 6 000 satellites en orbite basse, couverture mondiale — utilisé en Ukraine — révolution géopolitique de la connectivité","IA et démocratie : deepfakes électoraux (élections 2024 au Bangladesh, Taiwan, USA), génération de désinformation à grande échelle","IA Act applicabilité : des amendes de 35 millions d'euros (risque inacceptable) ou 15 millions (risque élevé)","ChatGPT, Gemini, Claude, Mistral : course aux grands modèles de langage — Mistral (France) comme 'champion européen'","Reconnaissance faciale : interdite dans l'espace public par l'AI Act européen (avec exceptions policières encadrées)","Metavers et Web3 : ralentissement après euphorie 2021-2022 — blockchain, NFT, crypto en crise de confiance (FTX, 2022)","Algorithmes et biais : discriminations raciales dans les logiciels de reconnaissance faciale (MIT Media Lab, 2018) — exigence d'explicabilité","Quantum computing : IBM, Google, Chine — ordinateurs quantiques qui pourraient casser les chiffrement RSA actuels d'ici 2030","Souveraineté numérique : cloud européen (Gaia-X), PINE, stratégie française — dépendance aux GAFAM comme enjeu de sécurité nationale"]},
  {id:14,title:"Commerce international & OMC",icon:"📦",color:"#E03535",items:["GATT (1947) : Accord général sur les tarifs douaniers et le commerce — 23 membres fondateurs, réductions progressives des droits de douane","OMC fondée le 1er janvier 1995 (succède au GATT) — 164 membres (95% du commerce mondial) — siège à Genève","Fonctions OMC : négociation commerciale, surveillance des politiques commerciales, règlement des différends (ORD)","Organe de règlement des différends (ORD) : 'tribunal du commerce mondial' — 600 différends depuis 1995 — appel paralysé depuis 2020 (blocage USA)","Ronde de Doha (2001-) : lancée après le 11/09 pour intégrer les pays en développement — agriculture bloquée par USA/UE — de facto morte","Accord de Bali (2013) : premier accord multilatéral OMC conclu — facilitation des échanges (simplification douanière)","Guerre commerciale USA-Chine : tarifs Trump (2018-2019), Biden maintient les tarifs + nouveaux (VE, batteries 2024) — 370 Mds$ de biens affectés","Commerce de services : 7 500 milliards de dollars (2023) — tourisme, finance, numérique, assurance en forte croissance","Chaînes de valeur mondiales (CVM) : 70% du commerce — une BMW fabriquée avec des pièces de 30 pays — fragmentation de la production","Accord de libre-échange Asie-Pacifique RCEP (2022) : 15 pays, 30% du PIB mondial — le plus grand accord commercial de l'histoire","CETA (2017) : accord UE-Canada — 40% des droits supprimés — modèle controversé (ISDS, tribunaux d'arbitrage investisseurs-États)","Brexit commercial : -15% sur les échanges UK-UE (FMI) — nouvelle barrière non-tarifaires, frictions douanières","Protectionnisme vert : politiques industrielles nationales — IRA américain (369 Mds$), CHIPS Act (52 Mds$), NZI européen — 'course aux subventions'","Démondialisation partielle : pandémie + guerre Ukraine = relocalisation des productions stratégiques (semi-conducteurs, médicaments, batteries)","Exportations mondiales de biens 2023 : ~23 000 milliards de dollars — Chine premier exportateur (14%), USA 2e (8%), Allemagne 3e (7%)","Accords bilatéraux : plus de 350 accords de libre-échange en vigueur dans le monde — spaghetti bowl (enchevêtrement d'accords)","Commerce des matières premières : pétrole, gaz, minerais — géopolitique des ressources, 'malédiction des ressources naturelles'","Dumping social et environnemental : firmes délocalisent vers des pays à faibles standards — taxe carbone aux frontières (MACF) comme réponse","Règles d'origine : déterminent si un produit peut bénéficier des préférences tarifaires — complexité croissante des accords","Commerce et développement : les pays pauvres exportent des matières premières, importent des produits manufacturés — 'termes de l'échange défavorables' (Prebisch-Singer)"]},
  {id:15,title:"Droits de l'homme & ONG",icon:"✊",color:"#2B78F5",items:["Amnesty International : fondée en 1961 (Peter Benenson), 10 millions de membres dans 150 pays — prix Nobel de la Paix 1977 — rapport annuel sur la torture","Human Rights Watch : fondée en 1978 à New York — rapports d'investigation sur violations — rapporteurs sur place dans les zones de conflit","CICR (Comité international de la Croix-Rouge) : fondé en 1863 (Henri Dunant), gardien du DIH — accès aux prisonniers de guerre — prix Nobel 1917, 1944, 1963","Médecins Sans Frontières (MSF) : fondée en 1971, présente dans 70 pays — prix Nobel de la Paix 1999 — 'témoignage' comme principe d'action","Transparency International : fondée en 1993 — indice de perceptions de la corruption (IPC) — 180 pays classés annuellement","Reporters sans frontières (RSF) : classement annuel de la liberté de la presse — 180 pays — France : 21e en 2024","Oxfam : fondée en 1942 (Oxford Committee for Famine Relief) — rapports annuels sur les inégalités mondiales au Forum de Davos","Greenpeace : fondée en 1971 à Vancouver — actions directes non-violentes — campagnes sur le nucléaire, les baleines, le plastique","WWF (Fonds mondial pour la nature) : fondé en 1961 — plus grande ONG environnementale, 5 millions de membres, panda comme symbole","Human Rights Council (Conseil des droits de l'homme ONU) : 47 membres élus par l'AG, créé en 2006 (remplace la CDH) — siège à Genève","Rapporteurs spéciaux ONU : experts indépendants bénévoles nommés par le CDH sur des thèmes ou des pays — 44 mandats thématiques en 2024","Haut-Commissariat aux droits de l'homme (HCDH) : bureau ONU depuis 1993 — Haut-Commissaire : Volker Türk (depuis 2022)","Cour pénale internationale (CPI) : créée par le Statut de Rome (1998), opérationnelle depuis 2002, 124 États membres — La Haye","Mandats d'arrêt CPI : Poutine (2023, déportation enfants), Netanyahou et Gallant (2024, Gaza), Kony, Kadhafi, Kagamé (toujours en fuite)","Universal Periodic Review (UPR) : mécanisme ONU de révision par les pairs de tous les États tous les 4 ans sur les droits de l'homme","Défenseurs des droits de l'homme : 300+ tués chaque année dans le monde selon Front Line Defenders","Traités ONU sur les droits de l'homme : 9 traités principaux (PIDCP, PIDESC, CEDEF, CRC, CAT, ICERD, CMW, CRPD, CPED) + Comités","Accès humanitaire : article 70 de la Charte — refus d'accès = violation du DIH — Syrie, Yemen, Gaza : obstacles systématiques aux ONG","Financement ONG : méfiance des États autoritaires (loi ONG 'agent étranger' en Russie 2012, Hongrie 2017) — enjeu de l'espace civique","Histoire récente : procès Nuremberg (1945-46) = acte fondateur, Tribunal Rwanda et ex-Yougoslavie (1993-94) = préfigurent la CPI"]},
  {id:16,title:"Relations USA-Chine",icon:"🌏",color:"#E03535",items:["Rivalité systémique : affrontement entre les deux premières économies mondiales et puissances militaires — Thucydide Trap (G. Allison)","PIB comparé : USA ~27 000 Mds$ vs Chine ~18 000 Mds$ (nominal) — Chine 1e en PPA depuis 2014","Commerce bilatéral : 690 milliards de dollars en 2023 malgré les tensions — interdépendance paradoxale et dangereuse","Guerre commerciale Trump (2018) : tarifs sur 370 Mds$ de biens chinois — Biden a maintenu et renforcé (semi-conducteurs 2022, VE 2024)","Semiconducteurs : restriction américaine sur les puces avancées vers la Chine (NVIDIA H100) — Chine investit massivement dans son propre secteur","Taïwan : ligne rouge de Pékin, 'garant de fait' américain — loi sur les relations avec Taïwan (1979) — Taïwan = 90% des puces avancées mondiales (TSMC)","Mer de Chine méridionale : îles artificielles chinoises, revendications de 80% de la zone — collisions sino-philippines en 2024","AUKUS (2021) : sous-marins nucléaires pour l'Australie — rupture avec la France — interprété comme endiguement maritime de la Chine","Détroit de Malacca : 80% des importations pétrolières chinoises y transitent — vulnérabilité stratégique majeure de Pékin","Initiatives chinoises : Nouvelles Routes de la Soie (2013, 140 pays, 1 000 Mds$), AIIB, Ceinture polaire (Chine 'État quasi-arctique')","Initiatives américaines : Indo-Pacific Economic Framework (IPEF), Partenariat pour l'infrastructure mondiale (PGI) — alternative aux RSdS","Espionnage et cyber : ballons espions (février 2023), hacks des agences fédérales USA (Salt Typhoon, 2024), vols de propriété intellectuelle","Fentanyl : crise des opioïdes aux USA (100 000 morts/an) — précurseurs chimiques venant de Chine — enjeu bilatéral","Hong Kong : loi sur la sécurité nationale (2020) — fin du 'un pays deux systèmes' — démantèlement de l'opposition démocratique","Xinjiang et Ouïghours : 1 million de détenus dans des 'camps de rééducation' (accusation USA) — accusation de génocide culturel","Tibet : occupation depuis 1950, répression de 1959 — Dalaï Lama en exil à Dharamsala — enjeu de légitimité internationale","Coopération persistante : climat (accord Sunnylands, nov. 2023), contrôle des narcotiques, non-prolifération nucléaire — 'coopétition'","Scénarios 2025-2030 : Taïwan comme étincelle potentielle — Biden puis Trump, Kamala Harris... positionnement américain incertain","Guerre économique des normes : standards 5G (Huawei vs Ericsson/Nokia), normes IA, règles du commerce numérique","Opinion publique : 83% d'opinions défavorables à la Chine aux USA (Pew, 2023) — 79% d'opinions défavorables aux USA en Chine"]},
  {id:17,title:"Moyen-Orient contemporain",icon:"🕌",color:"#D97706",items:["Conflit israélo-palestinien : 1948 (Nakba), 1967 (Six Jours, occupation), Oslo (1993), Intifadas, Gaza (2007 Hamas), 7 oct. 2023 (+46 000 morts)","Question palestinienne : deux États (position internationale) vs annexion (droite israélienne) — colonisation en Cisjordanie (750 000 colons en 2024)","Iran : Révolution islamique (1979), programme nucléaire (accord JCPOA 2015, dénoncé par Trump 2018), frappes directes Iran-Israël (avril-oct. 2024)","Arabie Saoudite : pétromonarchie, Vision 2030 (diversification économique, MBS), normalisation avec Israël en cours (accord Abraham 2020 avec EAU, Bahreïn, Maroc)","Syrie : guerre civile (2011-), 500 000 morts, 6 millions de réfugiés — Assad soutenu par Russie-Iran — chute de Damas (décembre 2024) — HTS au pouvoir","Yémen : guerre Houthis (Ansar Allah, proira­nien) vs coalition saoudo-émiranienne (2015-) — 400 000 morts, famine — attaques en mer Rouge 2024","Liban : Hezbollah (mouvement chiite pro-Iran), crise économique (2019-), explosion de Beyrouth (2020), guerre Israël-Hezbollah (2024)","Irak post-2003 : invasion USA, Daech (2013-2019), milices pro-iraniennes, gouvernement fragile — Iran première puissance d'influence réelle","Turquie : membre OTAN mais achète S-400 russes, médiation Ukraine-Russie, question kurde (PKK), aspirant à l'OCS, Erdogan depuis 2003","Kurdistans : Kurdes = 4e peuple du Monde-Orient sans État — Irak (KRI autonome), Syrie (Rojava-FDS), Turquie (PKK), Iran","Qatar : financement Hamas (controverse), Al Jazeera, médiateur dans les conflits (Gaza négociations), Coupe du Monde 2022","Émirats arabes unis : diversification économique réussie (Dubaï), accords Abraham avec Israël (2020), investissements mondiaux","Pétrole et gaz : Arabie Saoudite (1er producteur OPEP), Iran (sanctions), Irak, Koweït, Qatar (GNL) — 40% des réserves prouvées mondiales","OPEP+ : Arabie Saoudite et Russie coopèrent sur les prix du pétrole — politique de restriction de l'offre","Eau : ressource rare — Nil (Éthiopie vs Égypte vs Soudan), aquifères surexploités, désertification croissante","Réformes sociales Arabie Saoudite : femmes au volant (2018), cinémas ouverts, concerts — 'soft power' de Vision 2030","Printemps arabes (2010-2012) : Tunisie (seule 'réussite' fragile), Égypte (coup d'État Sissi 2013), Libye (guerre civile), Syrie (guerre civile)","Enjeu nucléaire régional : Israël (arsenal non déclaré, ~90 têtes), Iran (enrichissement à 60%), menace de prolifération chez les voisins","Migrations méditerranéennes : 5 millions de Syriens au Liban, Turquie, Jordanie — départ vers l'Europe (Lesbos, Lampedusa)","Conflits de légitimité : chiites vs sunnites (Iran vs Arabie Saoudite), nationalisme arabe vs islamisme politique vs laïcisme militaire"]},
  {id:18,title:"Guerre en Ukraine",icon:"⚔️",color:"#7C3AED",items:["Contexte : Ukraine indépendante en 1991, mémorandum de Budapest (1994, renonce aux armes nucléaires en échange de garanties), révolution Maïdan (2014)","Annexion de la Crimée : 27 février 2014 — référendum non reconnu internationalement — premier changement de frontière en Europe depuis 1945","Donbass 2014-2022 : guerre dans l'est, accords de Minsk I (sept. 2014) et II (fév. 2015) — 14 000 morts en 8 ans","Invasion à grande échelle : 24 février 2022 — 190 000 soldats russes, objectif : Kiev en 3 jours — Résistance ukrainienne surprenante","Bilan humain estimé 2022-2025 : Ukraine (100 000 tués militaires) + Russie (200 000+ tués militaires selon estimations OTAN), millions de civils déplacés","Aide militaire occidentale : +200 milliards de dollars depuis 2022 — USA (75 Mds$), UE (60 Mds$), Allemagne (17 Mds$) — chars, HIMARS, F-16","Sanctions contre la Russie : plus de 16 500 sanctions individuelles et sectorielles — gel de 300 Mds$ de réserves russes","Résilience économique russe : économie en guerre (+3,6% croissance 2023), revenus pétroliers maintenus via Inde et Chine, pivot économique asiatique","Soutiens de la Russie : Chine (aide économique), Corée du Nord (munitions, soldats), Iran (drones Shahed) — multilatéralisme anti-occidental","Théâtres d'opérations : Kherson (reconquis oct. 2022), Kharkiv, Zaporijia (centrale nucléaire), Bakhmout (2023), Avdiïvka (fév. 2024), Kursk (incursion ukrainienne, août 2024)","Centrale nucléaire de Zaporijia : plus grande d'Europe, sous occupation russe depuis mars 2022 — menace nucléaire permanente selon AIEA","Crimes de guerre : procureur CPI (Karim Khan) — mandat d'arrêt contre Poutine (17 mars 2023, déportation d'enfants) — documentation en cours","Grain Initiative : accord Ukraine-Russie (juillet 2022, médiation ONU-Turquie) permettant exportations céréalières — dénoncé par Russie (juillet 2023)","Impact alimentaire mondial : Ukraine = 'grenier de l'Europe' — 25% du blé mondial, 15% du maïs, 50% de l'huile de tournesol — crise alimentaire mondiale","Reconstruction : estimée à 486 milliards de dollars (Banque mondiale, 2023) — débat sur utilisation des avoirs russes gelés","Zelensky : communication exceptionnelle — discours quotidiens en vidéo depuis le début, contacts avec 180 Parlements, Prix de l'An de Time","Négociations : refus ukrainien de tout cessez-le-feu impliquant une concession territoriale — plan de paix en 10 points","Trump et Ukraine : crainte d'un accord forcé défavorable à l'Ukraine après la réélection de Trump (novembre 2024) — conditionnalité de l'aide","OTAN et Ukraine : promesse d'adhésion 'quand les conditions seront réunies' (Vilnius 2023, Washington 2024) — pas de calendrier","Impact géopolitique : réarmement européen massif, Finlande et Suède rejoignent l'OTAN, fin de la neutralité, relance de l'industrie de défense UE"]},
  {id:19,title:"Amérique latine contemporaine",icon:"🌎",color:"#16A34A",items:["Géographie politique : 33 États indépendants, 660 millions d'habitants, PIB cumulé ~6 000 milliards de dollars — Brésil = 50% du PIB régional","Cycle rose actuel : Lula (Brésil, réélu 2022), Petro (Colombie, 2022), Boric (Chili, 2022), Fernández puis Milei (Argentine, 2023), Sheinbaum (Mexique, 2024)","Milei et l'hyperlibéralisme argentin : président libertarien élu nov. 2023 — dollarisation, tronçonneuse du budget, -70% de l'État — résultats contrastés","Venezuela : régime de Maduro, hyperinflation (2018 : 1 000 000%), 7 millions d'émigrés (2e exode le plus important au monde après Syrie)","Cuba : embargo américain depuis 1962, régime communiste, libéralisation économique partielle — Raúl puis Díaz-Canel","Crime organisé : cartels mexicains (Sinaloa, CJNG), gangs au Brésil (PCC, CV), MS-13/Barrio 18 en Amérique centrale — homicides les plus élevés au monde","Équateur 2024 : État en 'conflit armé interne' contre gangs — assassinat candidat présidentiel (2023) — militarisation","Migration vers les USA : 2 millions d'interpellations à la frontière (2023) — record absolu — cause électorale majeure aux USA","Ressources naturelles : Amazonie (60% Brésil, poumons de la planète), lithium (Chili, Argentine, Bolivie = Triangle du lithium), pétrole (Venezuela, Équateur)","Triangle du lithium : 58% des réserves mondiales de lithium — enjeu géopolitique de la transition énergétique — tensions sur la souveraineté","Déforestation Amazonie : Bolsonaro (2018-2022) = +75% de déforestation — Lula : objectif zéro déforestation en 2030 — résultats positifs en 2023","CELAC (2010) : alternative à l'OEA sans USA et Canada — 33 membres — divisée entre gauche et droite","Mercosur : accord avec l'UE (2019, signé 2024) — bloqué par France (agriculture, déforestation) — 260 millions de consommateurs","Alliance du Pacifique : Chili, Colombie, Mexique, Pérou — modèle libre-échangiste, pro-occidental","Influence chinoise : principal partenaire commercial de la plupart des pays — Route de la Soie, Huawei, investissements portuaires","Influence russe : Venezuela, Cuba, Nicaragua — alliance contre-hégémonique","Haiti : État effondré depuis le tremblement de terre (2010) + assassination de Moïse (2021) — 80% de la capitale contrôlée par gangs","Mexique : premier exportateur vers les USA (supplanté la Chine en 2023) — nearshoring bénéfique mais violence des cartels","Bolivie : réserves de gaz nationalisées, tensions ethniques, putsch raté (2024) contre Arce — ressources de lithium comme enjeu d'avenir","Droits des peuples autochtones : Cour suprême du Brésil, constitution bolivienne (plurinationalité), CIRDI et mines sur terres ancestrales"]},
  {id:20,title:"Philosophie politique",icon:"🤔",color:"#2B78F5",items:["Contrat social : Hobbes (Léviathan, 1651 — état de nature 'guerre de tous contre tous', État absolu), Locke (état de nature paisible, État limité), Rousseau (volonté générale, souveraineté populaire)","Libéralisme politique : Locke, Constant, Mill — liberté individuelle primordiale, État minimal, droits naturels, tolérance — 'harm principle' de Mill","Républicanisme : Machiavel, Montesquieu, Arendt — liberté comme non-domination, vertu civique, participation à la vie publique","Démocratie : Athènes (Clisthène, 508 av. J.-C.) — direct vs représentatif — Tocqueville ('tyranie de la majorité'), Schumpeter ('démocratie procédurale')","Justice distributive : Rawls ('Théorie de la justice', 1971) — voile d'ignorance, principe de différence (les inégalités ne sont justes que si elles profitent aux plus défavorisés)","Libertarisme : Nozick ('Anarchie, État et utopie', 1974) — État minimal, droits de propriété absolus — critique de Rawls","Socialisme : Marx (analyse du capitalisme, dictature du prolétariat), social-démocratie (réforme graduée), communisme (collectivisation des moyens de production)","Communitarisme : MacIntyre, Sandel, Taylor — critique du libéralisme — l'individu n'existe pas sans sa communauté d'appartenance","Féminisme politique : 1e vague (droits civiques, Wollstonecraft 1792), 2e vague (liberation, Beauvoir 1949), 3e vague (intersectionnalité, 1990s), 4e vague (numérique, #MeToo)","Post-colonialisme : Fanon ('Les damnés de la terre', 1961), Spivak, Mbembe ('Nécropolitique') — critique de la colonialité du savoir et du pouvoir","Nationalisme et cosmopolitisme : opposition entre appartenance nationale (communauté de destin) et citoyenneté mondiale (Nussbaum, Singer)","Démocratie délibérative : Habermas — raison communicationnelle, espace public — les décisions légitimes émergent d'une délibération rationnelle ouverte","Réalisme politique : Machiavel, Hobbes, Morgenthau — les États poursuivent leurs intérêts, la morale est secondaire en politique internationale","Bien commun : Aristote, Aquin, catholicisme social — la politique vise le bien de tous, pas seulement des individus ou groupes","Autorité et légitimité : Weber (trois types — traditionnelle, charismatique, légale-rationnelle) — la légitimité comme fondement du pouvoir","Populisme (théorie) : Laclau ('La raison populiste', 2005) — le peuple comme construction rhétorique contre l'élite — ni droite ni gauche","Ecologie politique : Jonas ('Principe responsabilité', 1979), Latour (Gaïa) — obligation envers les générations futures, démocratie élargie au vivant","Bioéthique et politique : vie, mort, Corps — euthanasie, avortement, transhumanisme — convergence entre éthique et législation","Démocratie et vérité : Arendt ('La crise de la culture') — distinctions entre vérité factuelle, opinion politique et mensonge — fake news comme danger existentiel","Figures majeures à connaître : Platon, Aristote, Machiavel, Hobbes, Locke, Rousseau, Montesquieu, Kant, Mill, Marx, Rawls, Habermas, Arendt"]},
  {id:21,title:"Sociologie & Société",icon:"👥",color:"#16A34A",items:["Fondateurs de la sociologie : Auguste Comte (positivisme, 1839), Émile Durkheim (faits sociaux, anomie, solidarité), Max Weber (rationalisation, compréhension), Karl Marx (lutte des classes)","Durkheim : 'Le Suicide' (1897) — taux de suicide social (non individuel) — anomie, suicide égoïste, altruiste, fataliste — méthode sociologique empirique","Bourdieu : capital économique, social, culturel, symbolique — habitus (dispositions incorporées), champ (espace de luttes), reproduction sociale ('Les héritiers', 1964)","Classes sociales : Marx (bourgeoisie vs prolétariat), Weber (statut + classe + parti), Bourdieu (espace social multidimensionnel) — débat sur la 'mort des classes'","Inégalités sociales France : coefficient de Gini de 0,29 (avant redistribution 0,52) — top 10% = 50% du patrimoine, 1% = 25%","Mobilité sociale : ascendante (enfants mieux que parents) vs descendante (préoccupation croissante, classe moyenne) — 'société bloquée' ou dynamique ?","Famille et genre : modèle traditionnel → diversification (familles monoparentales 25%, recomposées, homoparentales légalisées en France 2013 avec le mariage pour tous)","Racisme systémique : discrimination à l'embauche (CV expériences par Petit, 2007), dans le logement, dans les contrôles policiers — débat sur les statistiques ethniques en France","Laïcité et religions : catholicisme déclinant (38% de pratiquants 1960 → 5% 2023), islam 2e religion (5-6 millions), sécularisation globale mais résurgences religieuses","Numérique et société : 4,6 heures de temps d'écran/jour en France — réseaux sociaux et polarisation (chambre d'écho, biais de confirmation)","Jeunesse et politique : abstention électorale des 18-34 ans (~60%) — désaffection des partis traditionnels — engagement associatif et causes environnementales","Vieillissement démographique : 20% de la population française a plus de 65 ans (2023) → 25% en 2040 — financement des retraites (réforme 2023, 64 ans)","Immigration et intégration : 10% de la population française est étrangère ou enfants d'étrangers — modèle républicain assimilationniste vs multiculturalisme","Pauvreté en France : 9 millions de personnes sous le seuil de pauvreté (60% du revenu médian = 1 120 €/mois) — RSA, CAF, logement social","Travail et emploi : taux de chômage ~7% (2024), CDI vs ubérisation/auto-entrepreneuriat, question du sens au travail (Grande Démission, quiet quitting)","Santé et inégalités : espérance de vie en France = 82 ans (8e mondiale) — écart de 13 ans entre un ouvrier et un cadre supérieur","Éducation et reproduction sociale : 'Les héritiers' (Bourdieu-Passeron, 1964) — le mérite scolaire cache la reproduction — réformes : mixité sociale, réseau REP+","Médias et opinion : concentration (Bolloré, Arnault, Bouygues possèdent 90% des médias) — enjeu de pluralisme démocratique","Mouvement sociaux contemporains : Nuits debout (2016), Gilets Jaunes (2018-2019), Extinction Rebellion, ZAD, #MeToo — nouvelles formes d'action collective","Communautarisme et antisémitisme : hausse des actes antisémites (+300% après 7 oct. 2023), islamophobie, racisme — rapport annuel CNCDH"]},
  {id:22,title:"Économie française",icon:"🇫🇷",color:"#2B78F5",items:["PIB France 2024 : ~2 800 milliards d'euros, 7e économie mondiale, 3e européenne — croissance +1,1% en 2024","Structure économique : services (78% du PIB), industrie (16%), agriculture (2%), bâtiment (4%) — désindustrialisation depuis 1970s","Budget de l'État 2025 : 493 milliards de dépenses — principaux postes : éducation nationale (60 Mds), défense (47 Mds), dette (55 Mds)","Dette publique : 113% du PIB (3 200 Mds€) — au-dessus des 60% du Pacte de stabilité — 3e pays le plus endetté de la zone euro","Déficit public 2024 : ~6% du PIB — objectif de 3% repoussé à 2029 — procédure de déficit excessif ouverte par la Commission","Inflation française 2024 : ~2,2% — retour à la normale après les pics de 2022 (6%) — baisse du pouvoir d'achat persistante pour les ménages modestes","Chômage : 7,3% (T3 2024) — jeunes : 17% — chômage de longue durée (>1 an) : 2,8% — France au-dessus de la moyenne UE (6%)","Retraites : réforme 2023 (64 ans), système par répartition, déficit projeté de 14 Mds€ en 2030 — alternatives : capitalisation, points","CAC 40 : indice boursier des 40 premières capitalisations françaises — LVMH (400 Mds€), TotalEnergies, Hermès, L'Oréal — capitalisation cumulée ~2 500 Mds€","LVMH (Bernard Arnault) : 1er groupe mondial de luxe, 75 maisons, 79 Mds€ de CA — soft power économique français mondial","Exportations françaises : ~580 milliards d'euros (2023) — aéronautique (Airbus), luxe, agroalimentaire, pharmacie, défense — balance commerciale déficitaire de 100 Mds€","Secteurs en difficulté : industrie automobile (reconversion VE), distribution (Amazon), presse, agriculture (coûts de production)","Secteurs dynamiques : aérospatial (Airbus, Safran), défense (Thales, MBDA, Dassault), énergie nucléaire (EDF), luxe, tourisme (100M de visiteurs/an)","France France-Startup Nation : 36 licornes françaises en 2024 — écosystème Station F (Paris) — French Tech internationale","Fiscalité : taux de prélèvements obligatoires = 45% du PIB (2e plus haut OCDE) — impôt sur le revenu, TVA (150 Mds€/an), IS, CSG","Politique industrielle : France 2030 (54 Mds€ d'investissements publics, hydrogène, VE, semi-conducteurs, nucléaire, IA, biomédicaments)","Énergie : nucléaire (70% de l'électricité), objectif 50% en 2035 — 56 réacteurs, relance de 6 nouveaux EPR2 (2023) — EDF renationalisé (2022)","Modèle social : dépenses sociales = 32% du PIB (plus élevé OCDE) — retraites (14%), santé (8%), famille (2%), chômage (2%), logement (2%)","Géographie économique : Île-de-France = 30% du PIB national — déserts industriels (Nord, Centre), dynamisme Aix-Marseille-Nice, Bordeaux, Toulouse","Histoire économique : trente glorieuses (1945-1975, +5%/an), chocs pétroliers, désindustrialisation, chômage structurel depuis 1975"]},
  {id:23,title:"Droit pénal international",icon:"⚖️",color:"#E03535",items:["Nuremberg (1945-1946) : acte fondateur du droit pénal international — 24 accusés, 12 condamnés à mort — principe : les individus répondent de leurs crimes même sous ordre","Crimes jugés à Nuremberg : crimes contre la paix (guerre d'agression), crimes de guerre, crimes contre l'humanité — principe de responsabilité individuelle","TPIY (Tribunal pénal international pour l'ex-Yougoslavie, 1993-2017) : La Haye — 161 mises en examen dont Milosevic, Karadzic, Mladic — génocide de Srebrenica reconnu","TPIR (Tribunal pénal international pour le Rwanda, 1994-2015) : Arusha — 93 condamnations — génocide reconnu officiellement — premier tribunal à condamner pour viol comme crime contre l'humanité","CPI (Cour pénale internationale) : Statut de Rome (1998), opérationnelle 2002, 124 États membres (USA, Russie, Chine, Inde = non-membres)","Compétence CPI : génocide, crimes contre l'humanité, crimes de guerre, crime d'agression (ajouté en 2017) — compétence complémentaire (États en premier)","Mandats CPI 2024 : Poutine (déportation d'enfants), Netanyahou et Gallant (Gaza), Omar el-Béchir (Soudan, en fuite), Kony (LRA, Ouganda, en fuite)","Génocide (Convention de 1948) : intention de détruire un groupe national, ethnique, racial ou religieux — Shoah, Rwanda (1994), Srebrenica (1995)","Crimes contre l'humanité : actes graves et systématiques contre des civils — extermination, esclavage, déportation, torture, viol, apartheid — imprescriptibles","Crime de guerre : violation grave du DIH en conflit armé — cibler des civils, torture, pillage, utilisation d'armes chimiques — Conventions de Genève","Principe de complémentarité : la CPI n'intervient que si les États sont 'incapables ou n'ont pas la volonté' de poursuivre — primauté des juridictions nationales","Justice transitionnelle : réconciliation après conflits — Commission Vérité et Réconciliation (Afrique du Sud, 1996-2003), Gacaca (Rwanda), TRC","Immunités : question non résolue — immunité des chefs d'État en exercice vs compétence universelle — affaire Pinochet (Royaume-Uni, 1998)","Compétence universelle : certains États (Belgique jusqu'en 2003, Espagne) se sont arrogé le droit de juger des crimes universels commis ailleurs","Droit de Genève vs droit de La Haye : Droit de Genève (protection victimes de guerre, CICR) vs Droit de La Haye (limitations des méthodes de guerre)","Conventions de Genève (1949) : 4 conventions + 3 protocoles — statut des prisonniers, des blessés, des civils — ratifiées par 196 États (universalité)","Convention contre la torture (CAT, 1984) : 173 États parties — interdiction absolue, compétence universelle pour les poursuites","R2P et CPI : tension entre responsabilité de protéger (potentielle intervention) et compétence de la CPI (poursuite des responsables)","Financement CPI : 170 millions d'euros/an — dépendance aux contributions des États membres — fragilité institutionnelle","Limites du droit pénal international : sélectivité politique (USA, Russie, Chine exemptés de facto), lenteur des procès (20 ans pour certains), difficulté d'exécution des mandats"]},
  {id:24,title:"Religions & Géopolitique",icon:"🕊️",color:"#D97706",items:["Cartographie religieuse mondiale : christianisme (2,4 Mds, 31%), islam (1,9 Mds, 24%), hindouisme (1,2 Mds, 15%), bouddhisme (500 M, 7%), judaïsme (14 M, 0,2%)","Islam : sunnites (87-90%) vs chiites (10-13%) — fracture géopolitique structurante — Iran (chiite) vs Arabie Saoudite (sunnite) — conflit par procuration au Yémen, Syrie, Liban","Chiisme et Iran : révolution islamique (1979, Khomeini) — République islamique — projet d'hégémonie régionale chiite — 'axe de résistance' (Hezbollah, Hamas, Houthis)","Islamisme politique : des Frères musulmans (Égypte, 1928) au salafisme jihadiste (Al-Qaïda, Daech) — Islam politique modéré (AKP turc, Ennahda tunisien) vs radical","Christianisme et géopolitique : Catholicisme (1,3 Mds, Vatican) — influence dans les organisations internationales — question de l'avortement aux USA (Roe v. Wade 2022)","Protestantisme évangélique américain : 80% ont voté Trump (2016, 2020, 2024) — lobbying pro-israélien, anti-avortement, pro-armes — 'bible belt'","Vatican et diplomatie : Saint-Siège a statut d'observateur permanent à l'ONU — diplomatie de médiation (Cuba-USA 2015, Colombie) — pape François et les migrants","Orthodoxie russe : l'Église orthodoxe russe soutient la guerre en Ukraine ('monde russe') — Kirill vs Bartholomée (Constantinople) — schisme de 2018","Hindouisme et nationalisme : BJP (Modi) — 'Hindutva' (suprématie hindoue), tensions avec minorité musulmane (200 millions), violence intercommunautaire","Bouddhisme et politique : Birmanie (nationalisme bouddhiste, génocide Rohingyas) vs Thaïlande (monarchie bouddhiste) vs Tibet (Dalaï Lama, exil)","Antisémitisme : hausse de 300% en Europe après le 7 octobre 2023 — Holocaust denial — mémoire de la Shoah comme enjeu de politique intérieure","Islamophobie : attentats de Charlie Hebdo (2015), Nice (2016), Christchurch (2019) — législations nationales sur le voile, l'abaya, la construction de mosquées","Laïcité française : modèle jacobin de séparation stricte vs multiculturalisme anglo-saxon — loi 1905, voile à l'école (2004), charte de la laïcité (2013)","Jérusalem : ville sainte pour les trois monothéismes — revendiquée comme capitale par Israël (reconnue par USA en 2017) — enjeu du processus de paix","Conflit hindou-musulman : Inde-Pakistan — Cachemire — nationalisme religieux des deux côtés — risque nucléaire","Populisme religieux : Orbán se réclame de la civilisation chrétienne, Erdogan de l'islam sunnite ottoman, Modi de l'hindouisme — instrumentalisation politique","Liberté de religion : art. 18 DUDH, art. 9 CEDH — persécutions des Ouïghours (Chine), des chrétiens d'Irak et Syrie (Daech), des Rohingyas (Birmanie)","Réforme protestante (1517) et démocratie : Weber ('L'éthique protestante et l'esprit du capitalisme') — lien entre protestantisme et développement démocratique-capitaliste","Sécularisation : recul de la pratique religieuse en Europe occidentale — mais renouveau religieux en Afrique (pentecôtisme), en Asie (islam), en Amérique latine (évangélisme)","Dialogue interreligieux : ONU décret 2000 sur la 'décennie pour la promotion d'une culture de la paix' — rôle des institutions religieuses dans la résolution des conflits"]},
  {id:25,title:"Médias & Démocratie",icon:"📺",color:"#7C3AED",items:["Quatrième pouvoir : la presse comme contre-pouvoir démocratique — liberté de la presse garantie par l'art. 10 CEDH et l'art. 11 DDHC 1789","Concentration des médias en France : Bolloré (CNews, C8, BFM, RMC), Niel (Le Monde), Arnault (Le Parisien, Les Échos), Bouygues (TF1, LCI) — 90% des grands médias","Indice RSF 2024 : Norvège 1ère, France 21e, USA 55e, Turquie 158e, Russie 162e, Chine 172e, Corée du Nord 177e (sur 180)","Fake news et désinformation : rapport Mueller (2019) sur interférences russes élection USA 2016 — 126 millions d'Américains exposés à des contenus russes sur Facebook","Réseaux sociaux et démocratie : l'algorithme favorise les contenus polarisants (engagement > vérité) — 'bulle de filtre' (Pariser), 'chambre d'écho'","DSA (Digital Services Act, 2022) : obligation de transparence algorithmique, retrait des contenus illicites — très grandes plateformes (100M d'utilisateurs) soumises à audit","Presse et journaux : crise du modèle économique (chute de la publicité imprimée) — mutations vers le numérique — mécénat (Le Monde, Le Figaro)","TF1, France Télévisions : service public audiovisuel (France Télévisions) vs chaînes privées — redevance supprimée (2022), budget via TVA","Radio et podcast : 82% des Français écoutent la radio — essor des podcasts natifs numériques — Spotify, Deezer comme nouvelles plateformes","Al Jazeera : fondée en 1996 au Qatar, en arabe puis anglais — révolution dans les médias du monde arabe — accusée de partialité pro-Hamas","RT (Russia Today) : outil de soft power russe — interdite en Europe depuis mars 2022 après l'invasion de l'Ukraine — désinformation active","TikTok et IA : 1,7 milliard d'utilisateurs — algorithme opaque — loi américaine visant l'interdiction (2024) pour raisons sécuritaires","Journalistes tués : 100+ journalistes tués en 2023 (RSF) — Palestine premier pays de décès (dont Shireen Abu Akleh, Al Jazeera, 2022)","Whistleblowers : Snowden (NSA, 2013), Manning (documents militaires, 2010), WikiLeaks (Assange, poursuivi 2019-2024) — tension transparence vs sécurité nationale","L'affaire Cambridge Analytica (2018) : données de 87 millions d'utilisateurs Facebook exploitées pour cibler des électeurs — Trump 2016, Brexit","Médias et populisme : CNews soutenu par Bolloré = augmentation du vote RN selon plusieurs études — 'Fox News effect' aux USA","Service public à l'ère numérique : BBC (UK), France Télévisions, ARD/ZDF (All.) — légitimité contestée, financement en débat, concurrence SVOD","Deepfakes électoraux : détection des fausses vidéos (Elections Act en cours aux USA et UE) — ingérence électorale via deepfakes en 2024 (Slovaquie)","Droit à l'oubli (RGPD art. 17) : possibilité de demander la suppression de résultats de recherche — Google doit supprimer les liens — enjeu de mémoire numérique","Pluralisme médiatique et démocratie : la concentration médiatique menace l'indépendance éditoriale — Arcom surveille le pluralisme en France — question d'un financement public stable"]},
];

const CONCOURS_STATS:{[k:string]:{annee:number;places:number;candidats:number;admis:number;taux:string;noteMin:string;noteMoy:string;info:string}[]}={
  sciencespo:[
    {annee:2024,places:890,candidats:11200,admis:890,taux:"7,9 %",noteMin:"10/20",noteMoy:"14,8/20",info:"Concours commun IEP. Épreuves écrites (histoire, questions contemporaines) + oral de personnalité."},
    {annee:2023,places:880,candidats:10800,admis:880,taux:"8,1 %",noteMin:"10/20",noteMoy:"14,6/20",info:"Renforcement du poids de la géopolitique dans l'épreuve de questions contemporaines."},
    {annee:2022,places:870,candidats:10500,admis:870,taux:"8,3 %",noteMin:"10/20",noteMoy:"14,5/20",info:"Retour à un format normal après les adaptations Covid."},
    {annee:2021,places:850,candidats:9800,admis:850,taux:"8,7 %",noteMin:"10/20",noteMoy:"14,3/20",info:"Épreuves maintenues en présentiel malgré la crise sanitaire."},
    {annee:2020,places:830,candidats:9200,admis:830,taux:"9,0 %",noteMin:"10/20",noteMoy:"14,1/20",info:"Épreuves partiellement adaptées en raison du 1er confinement."},
  ],
  ens:[
    {annee:2024,places:204,candidats:1850,admis:204,taux:"11,0 %",noteMin:"10/20",noteMoy:"15,2/20",info:"ENS Ulm + ENS Lyon combinés (filières littéraires et scientifiques). 2 ans de classe préparatoire requis."},
    {annee:2023,places:200,candidats:1790,admis:200,taux:"11,2 %",noteMin:"10/20",noteMoy:"15,1/20",info:"Hausse du nombre de candidats dans les filières sciences humaines et sociales."},
    {annee:2022,places:196,candidats:1750,admis:196,taux:"11,2 %",noteMin:"10/20",noteMoy:"15,0/20",info:"Réforme des épreuves de philosophie et de sciences sociales."},
    {annee:2021,places:190,candidats:1700,admis:190,taux:"11,2 %",noteMin:"10/20",noteMoy:"14,9/20",info:"Épreuves orales maintenues en présentiel avec protocole sanitaire renforcé."},
    {annee:2020,places:185,candidats:1620,admis:185,taux:"11,4 %",noteMin:"10/20",noteMoy:"14,8/20",info:"Oraux reportés et adaptés suite au confinement de mars 2020."},
  ],
  fonction:[
    {annee:2024,places:60,candidats:680,admis:60,taux:"8,8 %",noteMin:"8/20",noteMoy:"13,8/20",info:"INSP (Institut National du Service Public, ex-ENA). Concours externe, interne et 3e voie. Stage de 2 ans."},
    {annee:2023,places:58,candidats:650,admis:58,taux:"8,9 %",noteMin:"8/20",noteMoy:"13,6/20",info:"2e promotion INSP — davantage de places ouvertes à la 3e voie (société civile)."},
    {annee:2022,places:55,candidats:630,admis:55,taux:"8,7 %",noteMin:"8/20",noteMoy:"13,5/20",info:"1ère promotion INSP après la suppression de l'ENA, rebaptisée Promotion René Cassin."},
    {annee:2021,places:80,candidats:700,admis:80,taux:"11,4 %",noteMin:"8/20",noteMoy:"13,2/20",info:"Dernière promotion ENA — Promotion Germaine Tillion. Annonce de la suppression dès 2022."},
    {annee:2020,places:78,candidats:720,admis:78,taux:"10,8 %",noteMin:"8/20",noteMoy:"13,0/20",info:"Promotion Molière. Épreuves maintenues avec adaptation du calendrier."},
  ],
  droit:[
    {annee:2024,places:3800,candidats:5200,admis:3120,taux:"60,0 %",noteMin:"10/20",noteMoy:"12,5/20",info:"CRFPA. Note éliminatoire dans l'épreuve principale (droit des obligations ou procédure). 18 mois de formation à l'école du barreau (EFB) après réussite."},
    {annee:2023,places:3750,candidats:5100,admis:3060,taux:"60,0 %",noteMin:"10/20",noteMoy:"12,4/20",info:"Réforme partielle du programme : renforcement du droit des affaires et du droit européen."},
    {annee:2022,places:3700,candidats:4900,admis:2940,taux:"60,0 %",noteMin:"10/20",noteMoy:"12,3/20",info:"Hausse des candidats issue d'une forte promotion L3/M1 post-Covid."},
    {annee:2021,places:3600,candidats:4800,admis:2880,taux:"60,0 %",noteMin:"10/20",noteMoy:"12,2/20",info:"Retour aux épreuves en présentiel. Fort taux de réussite au 2e rattrapage."},
    {annee:2020,places:3500,candidats:4700,admis:2450,taux:"52,1 %",noteMin:"10/20",noteMoy:"12,0/20",info:"Taux historiquement bas dû aux perturbations liées au 1er confinement et aux reports d'épreuves."},
  ],
};

const CONCOURS_GRILLES:{[k:string]:{epreuve:string;bareme:number;eliminatoire?:string;criteres:{label:string;pts:number;desc:string}[];conseils:string[]}[]}={
  sciencespo:[
    {epreuve:"Dissertation de culture générale",bareme:20,eliminatoire:"5/20",criteres:[
      {label:"Compréhension du sujet",pts:4,desc:"Le sujet est correctement délimité, les termes définis, les enjeux identifiés. Hors-sujet = note éliminatoire."},
      {label:"Problématique",pts:4,desc:"Une problématique explicite, non évidente, qui guide le devoir. Elle doit être clairement formulée en introduction."},
      {label:"Plan et structure",pts:4,desc:"Plan apparent, équilibré, logique (2 ou 3 parties). Transitions rédigées. Cohérence entre les parties."},
      {label:"Richesse du contenu",pts:5,desc:"Exemples précis (dates, noms, chiffres), références historiques, politiques, littéraires. Variété des domaines mobilisés."},
      {label:"Expression écrite",pts:3,desc:"Syntaxe correcte, vocabulaire précis, style fluide. Pas de fautes rédhibitoires. Introduction et conclusion soignées."},
    ],conseils:["Commencez par l'analyse des mots-clés avant de rédiger","Minimum 3 exemples concrets par partie","La problématique doit être une vraie question, pas un simple plan déguisé","Évitez le catalogue d'idées sans fil directeur","L'introduction doit représenter ~15% du devoir"]},
    {epreuve:"Dissertation d'histoire",bareme:20,eliminatoire:"5/20",criteres:[
      {label:"Maîtrise chronologique",pts:5,desc:"Les dates, événements et périodes sont correctement situés. Pas d'anachronismes. Connaissance solide du programme."},
      {label:"Problématique historique",pts:4,desc:"Le devoir dépasse le simple récit pour proposer une interprétation historique. Capacité à mettre en tension des forces historiques."},
      {label:"Plan thématique ou chronothématique",pts:4,desc:"Préférence pour un plan thématique. Chaque partie doit répondre à une sous-question de la problématique."},
      {label:"Exemples et documents",pts:4,desc:"Acteurs historiques précis, événements datés, contextes explicités. Référence à des historiens si possible."},
      {label:"Expression et rigueur",pts:3,desc:"Vocabulaire historique approprié, dates exactes, noms correctement orthographiés."},
    ],conseils:["Ne jamais commencer par 'De tout temps...' ou 'Depuis la nuit des temps...'","Citez des historiens (Braudel, Hobsbawm, Furet...)","Distinguez causes, événements et conséquences","Le récit pur est insuffisant : analysez et interprétez","Soignez la conclusion : portée historique du sujet"]},
    {epreuve:"Oral de personnalité",bareme:20,eliminatoire:"8/20",criteres:[
      {label:"Connaissance du dossier",pts:4,desc:"Le candidat maîtrise son dossier scolaire et ses expériences extra-scolaires. Il répond précisément aux questions."},
      {label:"Culture générale et actualité",pts:5,desc:"Connaissance des grands enjeux contemporains (politique, économie, géopolitique, société). Capacité à établir des liens."},
      {label:"Qualité argumentative",pts:4,desc:"Les opinions sont défendues avec des arguments structurés et des exemples. Le candidat ne se contredit pas."},
      {label:"Expression orale",pts:4,desc:"Clarté, fluidité, vocabulaire adapté, contact visuel. Pas de tics de langage excessifs. Gestion du stress."},
      {label:"Personnalité et motivation",pts:3,desc:"Le candidat montre une vraie motivation pour Sciences Po, un projet cohérent, une personnalité affirmée."},
    ],conseils:["Préparez un 'pitch' de 2 min sur votre parcours","Lisez la presse quotidiennement (Le Monde, Le Figaro, Courrier International)","Préparez 3 sujets d'actualité que vous maîtrisez parfaitement","Soyez prêt à défendre vos opinions sous pression","Montrez de la curiosité intellectuelle, pas seulement des bonnes notes"]},
  ],
  ens:[
    {epreuve:"Dissertation de philosophie",bareme:20,eliminatoire:"5/20",criteres:[
      {label:"Analyse conceptuelle",pts:5,desc:"Les concepts centraux sont définis avec précision. L'argumentation s'appuie sur des distinctions conceptuelles rigoureuses."},
      {label:"Problématisation",pts:5,desc:"Le devoir soulève une vraie tension philosophique. La problématique révèle quelque chose de non-évident dans le sujet."},
      {label:"Maîtrise de la tradition",pts:4,desc:"Références précises à des philosophes (nom, œuvre, argument). Pas de citations mal attribuées."},
      {label:"Rigueur argumentative",pts:4,desc:"Chaque thèse est défendue par des arguments valides. Les objections sont anticipées et traitées."},
      {label:"Style philosophique",pts:2,desc:"Écriture claire, précise, sans jargon inutile. La forme sert le fond."},
    ],conseils:["La citation en épigraphe est un piège si elle n'est pas parfaitement maîtrisée","Préférez 3 parties à 2 : thèse, antithèse, dépassement","Chaque paragraphe doit avoir une thèse propre","La culture philosophique s'évalue sur la précision, pas la quantité","Les exemples littéraires ou scientifiques enrichissent si ils sont rigoureux"]},
    {epreuve:"Dissertation de sciences sociales",bareme:20,eliminatoire:"5/20",criteres:[
      {label:"Définition des concepts",pts:4,desc:"Les notions sociologiques, économiques ou politiques sont définies selon les auteurs de référence."},
      {label:"Mobilisation des auteurs",pts:5,desc:"Références précises à des sociologues, économistes, politistes (Bourdieu, Weber, Durkheim, Rawls...)."},
      {label:"Articulation théorie/empirie",pts:4,desc:"Les théories sont illustrées par des données empiriques, études, statistiques, enquêtes."},
      {label:"Problématique et plan",pts:4,desc:"Problématique non triviale, plan en 2 ou 3 parties logiquement articulées."},
      {label:"Expression",pts:3,desc:"Précision du vocabulaire des sciences sociales, pas d'approximation conceptuelle."},
    ],conseils:["Maîtrisez les 10 auteurs incontournables : Bourdieu, Weber, Durkheim, Tocqueville, Marx, Rawls, Sen, Keynes, Foucault, Arendt","Chaque argument théorique doit être suivi d'une illustration empirique","Évitez le sens commun : utilisez le vocabulaire savant","Les débats entre auteurs montrent votre maîtrise","Mentionnez des études et enquêtes récentes"]},
    {epreuve:"Grand oral ENS",bareme:20,eliminatoire:"8/20",criteres:[
      {label:"Qualité de l'exposé",pts:5,desc:"Structure claire, introduction, développement, conclusion. Durée respectée (généralement 10 min)."},
      {label:"Profondeur de la réflexion",pts:5,desc:"Le candidat va au-delà du cours, propose une réflexion personnelle et originale."},
      {label:"Maîtrise de la bibliographie",pts:4,desc:"Références précises, capacité à discuter des œuvres et articles mentionnés."},
      {label:"Réponse aux questions du jury",pts:4,desc:"Le candidat répond précisément, reconnaît ses limites, rebondit sur les questions."},
      {label:"Expression et présence",pts:2,desc:"Clarté, articulation, rythme, absence de lecture. Contact avec le jury."},
    ],conseils:["Préparez une bibliographie de 10-15 références que vous maîtrisez parfaitement","Anticipez 20 questions difficiles sur votre sujet","Ne lisez jamais vos notes lors de l'exposé","Si vous ne savez pas, dites-le honnêtement — le jury respecte l'honnêteté","L'originalité de la pensée prime sur l'érudition"]},
  ],
  fonction:[
    {epreuve:"Note de synthèse",bareme:20,eliminatoire:"5/20",criteres:[
      {label:"Fidélité aux documents",pts:6,desc:"La note ne contient que des informations tirées du dossier. Aucune idée personnelle non étayée. Les idées sont correctement attribuées."},
      {label:"Exhaustivité",pts:4,desc:"Tous les documents sont exploités. Les idées essentielles sont toutes présentes. Aucun document majeur ignoré."},
      {label:"Structure administrative",pts:4,desc:"Format respecté : titre, introduction (contexte + plan), développement en 2-3 parties titrées, conclusion. Pas de sous-titres excessifs."},
      {label:"Style administratif",pts:4,desc:"Langage clair, neutre, concis. Pas de jugements de valeur. Formulations impersonnelles. Absence de fautes."},
      {label:"Longueur et présentation",pts:2,desc:"Respect de la longueur indiquée (généralement 4-6 pages). Mise en page soignée, paragraphes aérés."},
    ],conseils:["Ne jamais insérer d'idées personnelles : la note synthétise, elle n'argumente pas","La lecture active des documents (30-40 min) est aussi importante que la rédaction","Numérotez vos sources entre parenthèses ou en notes de bas de page","L'introduction doit poser l'enjeu du dossier en 2-3 phrases","Méthode : lire → annoter → regrouper les idées → rédiger le plan → rédiger"]},
    {epreuve:"Dissertation de culture générale",bareme:20,eliminatoire:"5/20",criteres:[
      {label:"Compréhension de l'enjeu administratif",pts:5,desc:"Le devoir montre une compréhension des réalités de l'administration et des politiques publiques."},
      {label:"Problématique et plan",pts:4,desc:"Problématique claire, plan en 2-3 parties logiques, transitions apparentes."},
      {label:"Exemples de politiques publiques",pts:5,desc:"Références à des lois, réformes, rapports officiels, données chiffrées sur l'administration française."},
      {label:"Expression écrite",pts:3,desc:"Style administratif accessible, syntaxe correcte, vocabulaire juridique et administratif maîtrisé."},
      {label:"Conclusion opérationnelle",pts:3,desc:"La conclusion propose des perspectives concrètes, non des généralités."},
    ],conseils:["Maîtrisez les grandes réformes de l'État (RGPP, MAP, CAP22, INSP)","Citez des rapports officiels (Cour des comptes, OCDE, France Stratégie)","Montrez que vous connaissez le fonctionnement réel de l'administration","Les exemples étrangers (Royaume-Uni, Suède, Allemagne) enrichissent","Évitez les formules creuses : soyez précis et concret"]},
    {epreuve:"Grand oral devant jury",bareme:20,eliminatoire:"8/20",criteres:[
      {label:"Présentation personnelle",pts:3,desc:"Présentation claire du parcours, de la motivation, du projet professionnel dans la fonction publique."},
      {label:"Connaissance des enjeux de l'administration",pts:5,desc:"Le candidat connaît les réformes en cours, les défis de modernisation, les politiques publiques majeures."},
      {label:"Qualité argumentative",pts:5,desc:"Opinions défendues avec des arguments structurés, des exemples précis, une pensée rigoureuse."},
      {label:"Gestion de la contradiction",pts:4,desc:"Le jury met le candidat sous pression : il doit maintenir ses positions ou les réviser avec élégance."},
      {label:"Présence et expression",pts:3,desc:"Clarté, calme sous pression, contact visuel, absence de tics. Le candidat incarne le futur haut fonctionnaire."},
    ],conseils:["Le jury cherche un futur dirigeant, pas un encyclopédiste","Préparez votre 'portrait chinois' administratif : quelle politique publique changeriez-vous ?","Lisez les rapports de la Cour des comptes et de l'inspection générale","Montrez que vous comprenez les contraintes budgétaires","L'humilité intelligente (reconnaître la complexité) vaut mieux que la certitude superficielle"]},
  ],
  droit:[
    {epreuve:"Épreuve principale (droit des obligations)",bareme:20,eliminatoire:"10/20",criteres:[
      {label:"Identification du problème juridique",pts:4,desc:"Le candidat identifie immédiatement et précisément le ou les problèmes de droit soulevés par le cas."},
      {label:"Annonce du syllogisme",pts:3,desc:"La règle de droit applicable est clairement énoncée avec ses conditions d'application (majeure)."},
      {label:"Application aux faits",pts:5,desc:"Les faits de l'espèce sont qualifiés selon les critères légaux et jurisprudentiels (mineure). Chaque condition est analysée."},
      {label:"Références jurisprudentielles",pts:4,desc:"La jurisprudence pertinente est citée précisément (Cass. civ. 1ère, date ; CE, date). Les arrêts de principe sont maîtrisés."},
      {label:"Solution motivée",pts:4,desc:"La conclusion juridique est clairement exprimée, motivée, et tient compte de toutes les hypothèses."},
    ],conseils:["La méthode syllogistique est obligatoire : règle → application → solution","Citez toujours les articles du Code civil, pénal ou de procédure","Les arrêts de la Cour de cassation et du Conseil d'État sont incontournables","N'oubliez jamais les hypothèses alternatives","Le style doit être sobre et précis : évitez les formulations incertaines"]},
    {epreuve:"Épreuve de procédure",bareme:20,eliminatoire:"8/20",criteres:[
      {label:"Maîtrise des délais",pts:4,desc:"Les délais de procédure (appel, cassation, prescription) sont exactement connus et appliqués."},
      {label:"Voies de recours",pts:4,desc:"Les voies de recours ordinaires (appel) et extraordinaires (pourvoi, révision) sont identifiées et appliquées."},
      {label:"Compétence juridictionnelle",pts:4,desc:"La juridiction compétente (TJ, CA, Cass., TA, CAA, CE) est correctement déterminée selon la nature du litige."},
      {label:"Principes directeurs du procès",pts:4,desc:"Contradictoire, égalité des armes, loyauté des preuves, droits de la défense sont appliqués."},
      {label:"Rédaction des actes",pts:4,desc:"Si demandée, la rédaction d'actes de procédure (assignation, conclusions) respecte les mentions obligatoires."},
    ],conseils:["Les délais sont éliminatoires : apprenez-les par cœur","Distinguez bien juridictions civiles, pénales et administratives","Maîtrisez la réforme de la procédure civile (décret 2019)","Les nullités de forme nécessitent un grief : vérifiez systématiquement","La procédure orale (tribunaux de proximité) diffère de la procédure écrite"]},
    {epreuve:"Grand oral du CRFPA",bareme:20,eliminatoire:"8/20",criteres:[
      {label:"Exposé structuré",pts:4,desc:"Introduction (contextualisation + problématique), développement en 2 parties, conclusion. Durée : 10 min."},
      {label:"Maîtrise technique du droit",pts:6,desc:"Le candidat démontre une connaissance approfondie des textes, de la jurisprudence et de la doctrine sur le sujet tiré."},
      {label:"Réponse aux questions",pts:5,desc:"Le candidat répond avec précision aux questions du jury, y compris sur des points techniques pointus."},
      {label:"Posture d'avocat",pts:3,desc:"Argumentation convaincante, défense d'une position, capacité à plaider. Le candidat montre qu'il pense comme un avocat."},
      {label:"Expression orale",pts:2,desc:"Clarté, fluidité, articulation, vocabulaire juridique précis. Absence de lecture."},
    ],conseils:["Le sujet est tiré au sort : préparez tous les domaines du programme","La posture d'avocat est évaluée : prenez position, ne vous contentez pas d'exposer","Citez des arrêts récents (moins de 5 ans) pour montrer votre veille juridique","Préparez-vous à défendre des positions contraires à votre intuition","Le jury est souvent composé d'avocats : montrez que vous voulez vraiment exercer"]},
  ],
};

const CONCOURS_EPREUVES:{[k:string]:{annee:number;matiere:string;sujet:string;type:string}[]}={
  sciencespo:[
    {annee:2024,matiere:"Histoire",sujet:"L'État et ses transformations dans le monde depuis 1945",type:"Dissertation"},
    {annee:2024,matiere:"Questions contemporaines",sujet:"La démocratie est-elle en crise ?",type:"Dissertation"},
    {annee:2024,matiere:"Géopolitique",sujet:"L'Afrique dans les relations internationales du XXIe siècle",type:"Dissertation"},
    {annee:2023,matiere:"Histoire",sujet:"Les démocraties face aux crises économiques (1929-2008)",type:"Dissertation"},
    {annee:2023,matiere:"Questions contemporaines",sujet:"Migrations et frontières dans le monde contemporain",type:"Dissertation"},
    {annee:2023,matiere:"Géopolitique",sujet:"La puissance américaine au XXIe siècle : déclin ou recomposition ?",type:"Dissertation"},
    {annee:2022,matiere:"Histoire",sujet:"Guerre et paix dans les relations internationales depuis 1945",type:"Dissertation"},
    {annee:2022,matiere:"Questions contemporaines",sujet:"Le multilatéralisme en question",type:"Dissertation"},
    {annee:2022,matiere:"Économie",sujet:"La mondialisation est-elle en recul ?",type:"Dissertation"},
    {annee:2021,matiere:"Histoire",sujet:"Révolutions et contre-révolutions au XXe siècle",type:"Dissertation"},
    {annee:2021,matiere:"Questions contemporaines",sujet:"L'urgence climatique : enjeux politiques et économiques",type:"Dissertation"},
    {annee:2020,matiere:"Histoire",sujet:"L'Europe depuis 1945 : construction et crises",type:"Dissertation"},
    {annee:2020,matiere:"Questions contemporaines",sujet:"La Chine, une puissance mondiale ?",type:"Dissertation"},
  ],
  ens:[
    {annee:2024,matiere:"Philosophie",sujet:"Peut-on agir sans raisons ?",type:"Dissertation"},
    {annee:2024,matiere:"Histoire",sujet:"Les empires : formation, apogée, déclin (antiquité-XXe s.)",type:"Dissertation"},
    {annee:2024,matiere:"Sciences sociales",sujet:"Les inégalités sont-elles naturelles ?",type:"Dissertation"},
    {annee:2024,matiere:"Littérature",sujet:"La littérature peut-elle changer le monde ?",type:"Dissertation"},
    {annee:2023,matiere:"Philosophie",sujet:"La liberté est-elle une illusion ?",type:"Dissertation"},
    {annee:2023,matiere:"Histoire",sujet:"Violence et politique au XXe siècle",type:"Dissertation"},
    {annee:2023,matiere:"Sciences sociales",sujet:"L'État-providence en question",type:"Dissertation"},
    {annee:2022,matiere:"Philosophie",sujet:"Connaître, est-ce douter ?",type:"Dissertation"},
    {annee:2022,matiere:"Histoire",sujet:"Les révolutions industrielles et leurs conséquences sociales",type:"Dissertation"},
    {annee:2022,matiere:"Économie",sujet:"Croissance économique et développement durable sont-ils compatibles ?",type:"Dissertation"},
    {annee:2021,matiere:"Philosophie",sujet:"L'art est-il inutile ?",type:"Dissertation"},
    {annee:2021,matiere:"Sciences sociales",sujet:"La démocratie représentative est-elle en crise ?",type:"Dissertation"},
    {annee:2020,matiere:"Philosophie",sujet:"Le temps est-il notre ennemi ?",type:"Dissertation"},
    {annee:2020,matiere:"Histoire",sujet:"La mémoire et l'histoire : usages et enjeux politiques",type:"Dissertation"},
  ],
  fonction:[
    {annee:2024,matiere:"Culture générale",sujet:"L'administration face aux défis du numérique",type:"Note de synthèse"},
    {annee:2024,matiere:"Droit public",sujet:"Le principe de légalité et ses exceptions",type:"Dissertation"},
    {annee:2024,matiere:"Économie",sujet:"La dette publique : menace ou outil de politique économique ?",type:"Dissertation"},
    {annee:2024,matiere:"Cas pratique",sujet:"Gestion d'une crise sanitaire dans une collectivité territoriale",type:"Mise en situation"},
    {annee:2023,matiere:"Culture générale",sujet:"Service public et transformation digitale",type:"Note de synthèse"},
    {annee:2023,matiere:"Droit public",sujet:"L'État et les collectivités territoriales : décentralisation et déconcentration",type:"Dissertation"},
    {annee:2023,matiere:"Économie",sujet:"Transition énergétique : enjeux économiques et rôle de l'État",type:"Dissertation"},
    {annee:2022,matiere:"Culture générale",sujet:"L'égalité dans le service public",type:"Note de synthèse"},
    {annee:2022,matiere:"Droit public",sujet:"Le contrôle de l'administration par le juge administratif",type:"Dissertation"},
    {annee:2022,matiere:"Économie",sujet:"Politique monétaire et inflation : les défis de la BCE",type:"Dissertation"},
    {annee:2021,matiere:"Culture générale",sujet:"La crise sanitaire et l'action publique",type:"Note de synthèse"},
    {annee:2021,matiere:"Droit public",sujet:"L'état d'urgence et les libertés fondamentales",type:"Dissertation"},
    {annee:2020,matiere:"Culture générale",sujet:"Enjeux environnementaux et politiques publiques",type:"Note de synthèse"},
    {annee:2020,matiere:"Droit public",sujet:"La responsabilité de l'État",type:"Dissertation"},
  ],
  droit:[
    {annee:2024,matiere:"Droit civil",sujet:"La responsabilité extracontractuelle : évolutions récentes",type:"Cas pratique"},
    {annee:2024,matiere:"Droit pénal",sujet:"La présomption d'innocence à l'épreuve des médias",type:"Dissertation"},
    {annee:2024,matiere:"Droit public",sujet:"Le Conseil constitutionnel : gardien des libertés ?",type:"Dissertation"},
    {annee:2024,matiere:"Procédure civile",sujet:"L'office du juge dans le procès civil",type:"Dissertation"},
    {annee:2023,matiere:"Droit civil",sujet:"Le contrat et l'imprévision",type:"Cas pratique"},
    {annee:2023,matiere:"Droit pénal",sujet:"La complicité en droit pénal français",type:"Dissertation"},
    {annee:2023,matiere:"Droit des affaires",sujet:"La société par actions simplifiée (SAS) : avantages et limites",type:"Dissertation"},
    {annee:2022,matiere:"Droit civil",sujet:"La réforme du droit des successions",type:"Dissertation"},
    {annee:2022,matiere:"Droit pénal",sujet:"La récidive : réponse pénale et réinsertion",type:"Dissertation"},
    {annee:2022,matiere:"Droit public",sujet:"Le droit à un recours effectif",type:"Dissertation"},
    {annee:2021,matiere:"Droit civil",sujet:"Les effets du mariage et du PACS",type:"Cas pratique"},
    {annee:2021,matiere:"Droit pénal",sujet:"Le blanchiment d'argent : évolutions législatives",type:"Dissertation"},
    {annee:2020,matiere:"Droit civil",sujet:"La force majeure en droit des contrats",type:"Cas pratique"},
    {annee:2020,matiere:"Droit public",sujet:"Les pouvoirs de crise du président de la République",type:"Dissertation"},
  ],
};

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
            {selSpeech.context && (
              <div style={{background:`${T.blueB}08`,border:`1px solid ${T.blueB}25`,borderRadius:14,padding:16}}>
                <p style={{color:T.blueB,fontSize:12,fontWeight:800,marginBottom:6,letterSpacing:0.5}}>CONTEXTE HISTORIQUE</p>
                <p style={{color:T.textD,fontSize:13,lineHeight:1.6}}>{selSpeech.context}</p>
              </div>
            )}
            <div style={{background:`${T.blueB}10`,border:`1px solid ${T.blueB}30`,borderRadius:14,padding:16}}>
              <p style={{color:T.blueB,fontSize:12,fontWeight:800,marginBottom:6,letterSpacing:0.5}}>ANALYSE RHÉTORIQUE</p>
              <p style={{color:T.textD,fontSize:13,lineHeight:1.6}}>{selSpeech.analysis || `Thème : ${selSpeech.theme}. Ce discours incarne les 3 piliers : crédibilité de l'orateur (éthos), émotion transmise (pathos) et logique des arguments (logos).`}</p>
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
  const [sub,setSub]=useState<"menu"|"generateur"|"builder"|"concours">("menu");
  const [genSubject,setGenSubject]=useState("");
  const [genResult,setGenResult]=useState("");
  const [genLoading,setGenLoading]=useState(false);
  const [buildPos,setBuildPos]=useState("");
  const [buildResult,setBuildResult]=useState("");
  const [buildLoading,setBuildLoading]=useState(false);
  const [concoursKey,setConcoursKey]=useState<"sciencespo"|"ens"|"fonction"|"droit">("sciencespo");
  const [concoursAnnee,setConcoursAnnee]=useState<number|null>(null);
  const [concoursTab,setConcoursTab]=useState<"epreuves"|"stats"|"grilles">("epreuves");
  const [corrId,setCorrId]=useState<string|null>(null);
  const [corrTexts,setCorrTexts]=useState<Record<string,string>>({});
  const [corrLoading,setCorrLoading]=useState<string|null>(null);

  const genCorrection=async(e:{annee:number;matiere:string;sujet:string;type:string},key2:string)=>{
    const key=getKey();if(!key){setCorrTexts(p=>({...p,[key2]:"⚠️ Clé Gemini requise dans les paramètres."}));return;}
    setCorrLoading(key2);
    const prompts:Record<string,string>={
      "Dissertation":`Tu es un professeur de classe préparatoire. Génère une correction complète de cette dissertation : "${e.sujet}" (matière : ${e.matiere}, concours ${e.annee}). Structure : 1) Analyse du sujet et définitions clés, 2) Problématique proposée, 3) Plan détaillé (I → A B C, II → A B C, III → A B C avec arguments et exemples précis pour chaque sous-partie), 4) Introduction rédigée, 5) Conclusion. Réponds en français.`,
      "Note de synthèse":`Tu es un expert en fonction publique. Pour cette note de synthèse : "${e.sujet}" (${e.matiere}, ${e.annee}), génère : 1) Méthode de la note de synthèse, 2) Plan en 2 parties avec sous-parties, 3) Idées principales à traiter avec exemples concrets, 4) Points de vigilance (erreurs à éviter), 5) Conclusion opérationnelle. Réponds en français.`,
      "Cas pratique":`Tu es un juriste expert. Pour ce cas pratique : "${e.sujet}" (${e.matiere}, ${e.annee}), génère : 1) Méthode de résolution du cas pratique (syllogisme juridique), 2) Qualification juridique des faits, 3) Règles de droit applicables avec références précises (articles, jurisprudence), 4) Application au cas, 5) Solution motivée. Réponds en français.`,
      "Mise en situation":`Tu es un formateur en fonction publique. Pour cette mise en situation : "${e.sujet}" (${e.annee}), génère : 1) Analyse de la situation et enjeux, 2) Cadre juridique et réglementaire applicable, 3) Plan d'action détaillé (mesures immédiates, moyen terme, long terme), 4) Acteurs à mobiliser, 5) Points de vigilance. Réponds en français.`,
    };
    const prompt=prompts[e.type]||prompts["Dissertation"];
    try{
      const r=await callGemini(prompt,[{role:"user",parts:[{text:e.sujet}]}],key,800);
      setCorrTexts(p=>({...p,[key2]:r}));addXP(10);
    }catch(err){setCorrTexts(p=>({...p,[key2]:"Erreur: "+(err instanceof Error?err.message:"inconnu")+". Vérifie ta clé Gemini dans Profil > Paramètres."}));}
    setCorrLoading(null);
  };
  const getKey=()=>typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";

  const genDiscours=async()=>{
    const key=getKey();if(!key){setGenResult("⚠️ Clé Gemini requise dans les paramètres.");return;}
    setGenLoading(true);setGenResult("");
    try{const r=await callGemini(`Tu es un expert en rhétorique. Génère un discours de 3 minutes (400 mots) sur : "${genSubject}". Structure : accroche percutante, problème, 3 arguments avec exemples concrets, conclusion mémorable. Utilise des figures de style (anaphore, métaphore).`,[{role:"user",parts:[{text:genSubject}]}],key,600);setGenResult(r);addXP(20);}
    catch(err){setGenResult("Erreur: "+(err instanceof Error?err.message:"inconnu"));}
    setGenLoading(false);
  };

  const buildArgs=async()=>{
    const key=getKey();if(!key){setBuildResult("⚠️ Clé Gemini requise.");return;}
    setBuildLoading(true);setBuildResult("");
    try{const r=await callGemini(`Expert en argumentation. Pour la position : "${buildPos}", génère : 3 arguments POUR avec exemple et chiffre, 3 arguments CONTRE avec exemple et chiffre, 3 réfutations. Format clair et structuré.`,[{role:"user",parts:[{text:buildPos}]}],key,500);setBuildResult(r);addXP(15);}
    catch(err){setBuildResult("Erreur: "+(err instanceof Error?err.message:"inconnu"));}
    setBuildLoading(false);
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

  if(sub==="concours"){
    const CONC_META=[
      {key:"sciencespo" as const,label:"Sciences Po",color:"#2B78F5",desc:"Culture générale · Histoire · Géopolitique"},
      {key:"ens" as const,label:"ENS",color:"#7C3AED",desc:"Philosophie · Histoire · Sciences sociales"},
      {key:"fonction" as const,label:"Fonction pub.",color:"#16A34A",desc:"Droit public · Culture G · Cas pratique"},
      {key:"droit" as const,label:"Barreau",color:"#E03535",desc:"Droit civil · Pénal · Procédure"},
    ];
    const meta=CONC_META.find(c=>c.key===concoursKey)!;
    const epreuves=CONCOURS_EPREUVES[concoursKey];
    const stats=CONCOURS_STATS[concoursKey];
    const grilles=CONCOURS_GRILLES[concoursKey];
    const annees=[...new Set(epreuves.map(e=>e.annee))].sort((a,b)=>b-a);
    const filtered=concoursAnnee?epreuves.filter(e=>e.annee===concoursAnnee):epreuves;
    const typeColor=(t:string)=>({Dissertation:"#2B78F5","Note de synthèse":"#16A34A","Cas pratique":"#E03535","Mise en situation":"#D97706"}[t]||"#888");
    return(
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
          <button onClick={()=>setSub("menu")} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
          <div><h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Prépa concours</h2><p style={{color:T.muted,fontSize:11}}>{meta.desc}</p></div>
        </div>
        {/* Concours tabs */}
        <div style={{display:"flex",gap:8,padding:"10px 14px",overflowX:"auto",borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
          {CONC_META.map(c=>(
            <button key={c.key} onClick={()=>{setConcoursKey(c.key);setConcoursAnnee(null);}} style={{flexShrink:0,padding:"8px 14px",borderRadius:20,border:`1.5px solid ${concoursKey===c.key?c.color:T.b1}`,background:concoursKey===c.key?c.color:"transparent",color:concoursKey===c.key?"#fff":T.textD,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
              {c.label}
            </button>
          ))}
        </div>
        {/* Sujets / Résultats / Grilles tab switch */}
        <div style={{display:"flex",borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
          {(["epreuves","stats","grilles"] as const).map(t=>(
            <button key={t} onClick={()=>setConcoursTab(t as typeof concoursTab)} style={{flex:1,padding:"9px 4px",background:"none",border:"none",borderBottom:`2.5px solid ${concoursTab===t?meta.color:"transparent"}`,color:concoursTab===t?meta.color:T.muted,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
              {t==="epreuves"?"📝 Sujets":t==="stats"?"📊 Résultats":"📋 Grilles"}
            </button>
          ))}
        </div>

        {concoursTab==="epreuves"&&<>
          <div style={{display:"flex",gap:6,padding:"8px 14px",overflowX:"auto",borderBottom:`1px solid ${T.b1}`,flexShrink:0,alignItems:"center"}}>
            <button onClick={()=>setConcoursAnnee(null)} style={{flexShrink:0,padding:"5px 12px",borderRadius:14,border:`1px solid ${concoursAnnee===null?meta.color:T.b1}`,background:concoursAnnee===null?`${meta.color}20`:"transparent",color:concoursAnnee===null?meta.color:T.muted,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Toutes</button>
            {annees.map(a=>(
              <button key={a} onClick={()=>setConcoursAnnee(concoursAnnee===a?null:a)} style={{flexShrink:0,padding:"5px 12px",borderRadius:14,border:`1px solid ${concoursAnnee===a?meta.color:T.b1}`,background:concoursAnnee===a?`${meta.color}20`:"transparent",color:concoursAnnee===a?meta.color:T.muted,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{a}</button>
            ))}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
            <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:2}}>{filtered.length} épreuve{filtered.length>1?"s":""}</p>
            {filtered.map((e,i)=>{
              const tc=typeColor(e.type);
              const cid=`${concoursKey}-${e.annee}-${i}`;
              const open=corrId===cid;
              const corrText=corrTexts[cid];
              const loading=corrLoading===cid;
              return(
                <div key={i} style={{background:T.card,border:`1px solid ${open?meta.color:T.b1}`,borderRadius:14,padding:14,transition:"border .2s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,gap:8,flexWrap:"wrap"}}>
                    <span style={{background:`${meta.color}18`,color:meta.color,fontSize:10,padding:"3px 10px",borderRadius:10,fontWeight:800}}>{e.matiere}</span>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{background:`${tc}15`,color:tc,fontSize:10,padding:"3px 8px",borderRadius:10,fontWeight:700}}>{e.type}</span>
                      <span style={{color:T.muted,fontSize:11,fontWeight:700}}>{e.annee}</span>
                    </div>
                  </div>
                  <p style={{color:T.text,fontSize:13,fontWeight:600,lineHeight:1.5,marginBottom:10}}>{e.sujet}</p>
                  <button onClick={()=>{
                    if(open){setCorrId(null);}
                    else{setCorrId(cid);if(!corrText&&!loading)genCorrection(e,cid);}
                  }} style={{width:"100%",padding:"8px",borderRadius:10,border:`1px solid ${meta.color}40`,background:open?`${meta.color}15`:`${meta.color}08`,color:meta.color,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    {loading?"Génération en cours…":open&&corrText?"▲ Masquer la correction":"📖 Correction IA · +10 XP"}
                  </button>
                  {open&&corrText&&(
                    <div style={{marginTop:10,background:T.bg2,borderRadius:10,padding:14,borderLeft:`3px solid ${meta.color}`}}>
                      {corrText.split("\n").map((line,li)=>{
                        if(!line.trim())return <div key={li} style={{height:6}}/>;
                        if(/^\d+\)/.test(line)||/^[IVX]+\./.test(line)||/^[A-C]\)/.test(line))
                          return <p key={li} style={{color:meta.color,fontWeight:800,fontSize:13,marginTop:10,marginBottom:2}}>{line}</p>;
                        if(line.startsWith("→")||line.startsWith("-"))
                          return <p key={li} style={{color:T.textD,fontSize:12,lineHeight:1.6,marginLeft:10}}>{line}</p>;
                        return <p key={li} style={{color:T.text,fontSize:12,lineHeight:1.6}}>{line}</p>;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>}

        {concoursTab==="stats"&&(
          <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:12}}>
            <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:2}}>Statistiques d&apos;admission 2020-2024</p>
            {stats.map((s,i)=>(
              <div key={i} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:16,padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <span style={{color:T.text,fontWeight:800,fontSize:17}}>{s.annee}</span>
                  <span style={{background:`${meta.color}20`,color:meta.color,fontSize:14,padding:"4px 12px",borderRadius:10,fontWeight:800}}>{s.taux}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:s.info?10:0}}>
                  <div style={{background:T.bg2,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <p style={{color:T.muted,fontSize:9,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Candidats</p>
                    <p style={{color:T.text,fontSize:16,fontWeight:800}}>{s.candidats.toLocaleString("fr-FR")}</p>
                  </div>
                  <div style={{background:T.bg2,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <p style={{color:T.muted,fontSize:9,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Admis</p>
                    <p style={{color:"#16A34A",fontSize:16,fontWeight:800}}>{s.admis.toLocaleString("fr-FR")}</p>
                  </div>
                  <div style={{background:T.bg2,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <p style={{color:T.muted,fontSize:9,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Moy. admis</p>
                    <p style={{color:meta.color,fontSize:14,fontWeight:800}}>{s.noteMoy}</p>
                  </div>
                </div>
                {s.info&&<p style={{color:T.textD,fontSize:12,lineHeight:1.5,borderTop:`1px solid ${T.b1}`,paddingTop:8,marginTop:4}}>{s.info}</p>}
              </div>
            ))}
          </div>
        )}

        {concoursTab==="grilles"&&(
          <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:14}}>
            <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:2}}>Grilles de notation officielles</p>
            {grilles.map((g,gi)=>(
              <div key={gi} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:16,overflow:"hidden"}}>
                <div style={{padding:"12px 14px",background:`${meta.color}10`,borderBottom:`1px solid ${meta.color}30`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <p style={{color:T.text,fontWeight:800,fontSize:14}}>{g.epreuve}</p>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    {g.eliminatoire&&<span style={{background:"#E0353520",color:"#E03535",fontSize:10,padding:"2px 8px",borderRadius:8,fontWeight:700}}>Élim. {g.eliminatoire}</span>}
                    <span style={{background:`${meta.color}20`,color:meta.color,fontSize:12,padding:"2px 8px",borderRadius:8,fontWeight:800}}>{g.bareme}/20</span>
                  </div>
                </div>
                <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
                  {g.criteres.map((c,ci)=>(
                    <div key={ci} style={{display:"flex",gap:10,alignItems:"flex-start",paddingBottom:8,borderBottom:ci<g.criteres.length-1?`1px solid ${T.b1}`:"none"}}>
                      <div style={{width:34,height:34,borderRadius:10,background:`${meta.color}15`,border:`1px solid ${meta.color}30`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <p style={{color:meta.color,fontSize:13,fontWeight:800}}>{c.pts}</p>
                      </div>
                      <div style={{flex:1}}>
                        <p style={{color:T.text,fontWeight:700,fontSize:13}}>{c.label}</p>
                        <p style={{color:T.textD,fontSize:12,lineHeight:1.5,marginTop:2}}>{c.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{padding:"10px 14px",background:T.bg2,borderTop:`1px solid ${T.b1}`}}>
                  <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>Conseils du jury</p>
                  {g.conseils.map((tip,ti)=>(
                    <p key={ti} style={{color:T.textD,fontSize:12,lineHeight:1.5,marginBottom:3}}>→ {tip}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="chevL" s={22} c={T.text}/></button>
        <div><h2 style={{color:T.text,fontWeight:800,fontSize:18}}>Carrière & Concours</h2><p style={{color:T.muted,fontSize:11}}>Outils IA pour ta progression</p></div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
        {([{id:"generateur",icon:"✍️",label:"Générateur de discours",desc:"Discours IA structuré sur n'importe quel sujet",color:"#2B78F5"},{id:"builder",icon:"🧱",label:"Builder d'arguments",desc:"Structure tes pour/contre instantanément",color:"#7C3AED"},{id:"concours",icon:"🎓",label:"Prépa concours",desc:"Sciences Po, ENS, Barreau, Fonction publique",color:"#D97706"}] as const).map(s=>(
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
  const [azk,setAzk] = useState(typeof window!=="undefined"?localStorage.getItem("azure_tts_key")||"":"");
  const [azr,setAzr] = useState(typeof window!=="undefined"?localStorage.getItem("azure_tts_region")||"eastus":"");
  const [hfk,setHfk] = useState(typeof window!=="undefined"?localStorage.getItem("hf_token")||"":"");
  const save = (key:string,val:string)=>{ if(typeof window!=="undefined") localStorage.setItem(key,val); };
  return(
    <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Clé Gemini AI (GRATUIT)</p>
        <input type="password" value={ck} onChange={e=>{setCk(e.target.value);save("gemini_key",e.target.value);}} placeholder="AIza…" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>aistudio.google.com → Get API key · Nécessaire pour les simulations IA</p>
      </div>
      <div style={{background:T.card,border:`1px solid ${azk?"#0078d4":T.b1}`,borderRadius:12,padding:14,transition:"border .2s"}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>🔊 Azure TTS <span style={{color:"#16A34A",fontWeight:700,textTransform:"none",letterSpacing:0}}>(recommandé — DeniseNeural)</span></p>
        <input type="password" value={azk} onChange={e=>{setAzk(e.target.value);save("azure_tts_key",e.target.value);}} placeholder="Clé Azure Speech…" style={{width:"100%",background:T.bg2,border:`1px solid ${azk?"#0078d4":T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box",marginBottom:6}}/>
        <input type="text" value={azr} onChange={e=>{setAzr(e.target.value);save("azure_tts_region",e.target.value);}} placeholder="Région Azure (ex: eastus)" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>portal.azure.com → Speech → F0 gratuit · 500 000 chars/mois · Voix française naturelle</p>
      </div>
      <div style={{background:T.card,border:`1px solid ${hfk?"#FF6B00":T.b1}`,borderRadius:12,padding:14,transition:"border .2s"}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>🤗 HuggingFace TTS <span style={{color:T.green,fontWeight:700,textTransform:"none",letterSpacing:0}}>(gratuit — sans carte bancaire)</span></p>
        <input type="password" value={hfk} onChange={e=>{setHfk(e.target.value);save("hf_token",e.target.value);}} placeholder="hf_…" style={{width:"100%",background:T.bg2,border:`1px solid ${hfk?"#FF6B00":T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>huggingface.co → Settings → Access Tokens → New token (Read) · Gratuit sans carte</p>
      </div>
      <div style={{background:T.card,border:`1px solid ${ek?T.purple:T.b1}`,borderRadius:12,padding:14,transition:"border .2s"}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>🎙️ ElevenLabs <span style={{color:T.muted,fontWeight:400,textTransform:"none",letterSpacing:0}}>(optionnel)</span></p>
        <input type="password" value={ek} onChange={e=>{setEk(e.target.value);save("el_key",e.target.value);}} placeholder="sk_…" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>elevenlabs.io → Profile → API Keys · 10 000 chars/mois gratuit</p>
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
  const [dark,setDark] = useState(false);
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
  const scrollRef = useRef<HTMLDivElement>(null);

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
    if(id==="feed"){
      setFeedUnread(0);
      setFeedKey(k=>k+1);
      scrollRef.current?.scrollTo({top:0,behavior:"smooth"});
      if(typeof window!=="undefined")localStorage.setItem("nexus_unread","0");
    }
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
      <div ref={scrollRef} style={{flex:1,overflowY:"auto",overflowX:"hidden"}}>
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
