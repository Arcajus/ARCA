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
  {id:"confirme",tier:3,label:"Confirmé",sub:"Avocat, cadre, haut fonctionnaire",premium:true},
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
  {id:"geo",icon:"globe",color:"#2B78F5",label:"Géopolitique",topics:["La réforme de l'ONU est-elle inévitable ?","OTAN : pertinence à l'ère multipolaire","La Chine va-t-elle dépasser les États-Unis ?","Guerre en Ukraine : négociation ou victoire ?","Nucléaire iranien : accord à tout prix ?","Israël-Palestine : solution à deux États encore possible ?","Afrique : néocolonialisme ou partenariats équitables ?","Les BRICS vont-ils créer une alternative au dollar ?","Taïwan : l'Occident doit-il s'engager militairement ?","Sahel : la France a-t-elle perdu la guerre ?","Le Conseil de Sécurité de l'ONU est-il obsolète ?","Monde unipolaire, bipolaire ou multipolaire ?","La mondialisation est-elle en crise ?","Les sanctions économiques sont-elles efficaces ?","La Russie peut-elle redevenir un partenaire de l'Occident ?","Indo-Pacifique : nouvelle zone de tension mondiale ?","Faut-il réformer le FMI et la Banque mondiale ?","La diplomatie du carnet de chèques — danger ou pragmatisme ?","Proche-Orient : les accords d'Abraham, victoire ou compromis ?","Kosovo, Palestine, Catalogne : qui a droit à l'autodétermination ?","Diplomatie climatique : succès ou échec ?","La CPI est-elle efficace ?","L'aide humanitaire peut-elle être politisée ?","Les ONG remplacent-elles les États dans les crises ?","Médiation internationale : l'ONU ou les puissances régionales ?","Faut-il un siège permanent africain au Conseil de Sécurité ?","La Corée du Nord : isolement ou engagement ?","Le Venezuela : modèle ou désastre ?","Faut-il reconnaître l'État palestinien ?","La Turquie : partenaire fiable ou cheval de Troie ?"]},
  {id:"histoire",icon:"info",color:"#7C3AED",label:"Histoire & Mémoire",topics:["Esclavage et réparations : où en est le débat ?","Décolonisation : bilan et mémoire","Histoire des peuples : les rébellions oubliées","La France peut-elle regarder son passé colonial en face ?","Colonisation : crime contre l'humanité ou mission civilisatrice ?","Génocide arménien : pourquoi ça bloque encore ?","Mai 68 : révolution ou illusion ?","Napoléon : génie ou tyran ?","La traite négrière arabe : tabou ou mémoire occultée ?","Guerre d'Algérie : peut-on réconcilier les mémoires ?","Apartheid : les héritages économiques persistent-ils ?","Hiroshima-Nagasaki : la bombe était-elle nécessaire ?","La Révolution française : universelle ou nationale ?","Les empires : pourquoi s'effondrent-ils toujours ?","Haïti : première révolution noire, premier échec du monde ?","La guerre froide : quelles leçons pour aujourd'hui ?","La Shoah : comment transmettre la mémoire ?","Le colonialisme belge au Congo : génocide oublié ?","Les révolutions du XXe siècle : bilan 100 ans après","L'esclavage en Mauritanie : pourquoi persiste-t-il ?","Les guerres napoléoniennes : conquête ou libération ?","La traite atlantique : qui était complice ?","Les grandes découvertes : exploration ou pillage ?","La chute de Rome : leçons pour l'Occident moderne ?","Les croisades : foi ou conquête ?","La Première Guerre mondiale était-elle évitable ?","La déstalinisation : Khrouchtchev a-t-il tout changé ?","La résistance française : mythe ou réalité ?","Les mouvements indépendantistes africains des années 60","La Révolution cubaine : 60 ans après, quel bilan ?"]},
  {id:"societe",icon:"users",color:"#16A34A",label:"Société & Politique",topics:["Immigration : politique ou humanitaire ?","Institutions françaises : réforme de la Ve République ?","La laïcité est-elle menacée en France ?","Le voile islamique : liberté ou atteinte à la laïcité ?","Faut-il légaliser le cannabis en France ?","Faut-il abaisser le droit de vote à 16 ans ?","Proportionnelle ou scrutin majoritaire ?","La démocratie participative peut-elle remplacer la représentative ?","Le féminisme a-t-il atteint ses objectifs ?","Racisme systémique : réalité française ou importation ?","La cancel culture menace-t-elle la liberté d'expression ?","Réseaux sociaux : faut-il réguler ou libérer ?","La désinformation : comment répondre sans censurer ?","Justice pénale : punir ou réhabiliter ?","Faut-il un service militaire obligatoire ?","Populisme : symptôme ou maladie de la démocratie ?","Les extrêmes : gauche et droite se valent-elles ?","La police : faut-il la réformer en profondeur ?","Faut-il rétablir la peine de mort ?","Le communautarisme menace-t-il la République ?","Parentalité et État : jusqu'où peut-on intervenir ?","Faut-il légaliser la prostitution ?","La PMA pour toutes : où en est la société ?","Faut-il encadrer les sectes ?","L'obésité : problème individuel ou de santé publique ?","Faut-il interdire les réseaux sociaux aux moins de 15 ans ?","La gratuité des transports en commun : réaliste ?","Faut-il un revenu de base pour les artistes ?","Le sans-abrisme : échec de la société ?","Faut-il sanctionner les discriminations à l'embauche ?"]},
  {id:"eco",icon:"bar",color:"#D97706",label:"Économie & Finance",topics:["IA et souveraineté numérique des États","Le capitalisme peut-il être réformé de l'intérieur ?","Cryptomonnaies : avenir ou bulle spéculative ?","Faut-il taxer les milliardaires ?","La retraite à 64 ans : réforme juste ou injuste ?","Les GAFA : faut-il les démanteler ?","La dette publique : faut-il vraiment s'en inquiéter ?","Commerce libre ou protectionnisme ?","Le revenu universel : utopie ou nécessité ?","Les inégalités mondiales se creusent — qui est responsable ?","Made in France : nationalisme économique ou pragmatisme ?","L'austérité est-elle efficace ?","Le chômage : faut-il un emploi garanti par l'État ?","Les syndicats ont-ils encore un rôle à jouer ?","La BCE : indépendance ou contrôle démocratique ?","Le travail à temps partiel : flexibilité ou précarité ?","Faut-il plafonner les loyers ?","L'économie circulaire peut-elle remplacer le modèle linéaire ?","La semaine de 4 jours : révolution du travail ?","Faut-il nationaliser les grandes banques ?","L'économie informelle : obstacle ou solution ?","Faut-il taxer les robots ?","La croissance économique est-elle compatible avec l'écologie ?","Le tourisme de masse : bénédiction ou fléau ?","Faut-il annuler la dette des pays pauvres ?","L'inflation : qui en est vraiment responsable ?","Faut-il encadrer les prix de l'alimentation ?","L'ubérisation du travail : progrès ou régression sociale ?","Le capitalisme a-t-il une date d'expiration ?","Faut-il supprimer les paradis fiscaux ?"]},
  {id:"sciences",icon:"zap",color:"#0891B2",label:"Sciences & Médecine",topics:["Euthanasie : le droit de mourir dans la dignité ?","Vaccins obligatoires : liberté ou sécurité collective ?","Avortement : où s'arrête la liberté de la femme ?","GPA : exploitation ou solidarité ?","Transidentité chez les mineurs : quand intervenir ?","Les drogues psychédéliques en thérapie : révolution médicale ?","Faut-il légaliser l'euthanasie active ?","Faut-il breveter les médicaments essentiels ?","La médecine prédictive : espoir ou menace ?","Les OGM : danger ou solution à la faim mondiale ?","Faut-il rendre les essais cliniques totalement transparents ?","L'alimentation ultra-transformée : faut-il l'interdire ?","Clonage humain : jamais, ou sous conditions ?","La thérapie génique peut-elle tout guérir ?","Faut-il financer la recherche sur le vieillissement ?","Le gluten, le lactose : intolérances réelles ou marketing ?","Médecine traditionnelle vs médecine moderne : faux débat ?","Faut-il rembourser les médecines douces ?","Le burn-out est-il une maladie professionnelle reconnue ?","Déserts médicaux : comment y remédier ?","La psychiatrie force-t-elle trop d'hospitalisations ?","Faut-il interdire la publicité pour l'alcool ?","Le sport de haut niveau et la santé : contradiction ?","Faut-il un revenu universel pour les chercheurs ?","La médecine préventive : investissement ou dépense ?","Faut-il encadrer les régimes alimentaires chez les enfants ?","L'obésité infantile : responsabilité des parents ou de l'État ?","Faut-il tester les drogues avant de les interdire ?","Les antibiotiques : crise mondiale à venir ?","Santé mentale des jeunes : la société est-elle responsable ?"]},
  {id:"philo",icon:"star",color:"#9333EA",label:"Philosophie & Éthique",topics:["La liberté existe-t-elle vraiment ?","Le bonheur est-il le but ultime de l'existence ?","Peut-on être moral sans religion ?","L'État a-t-il le droit de mentir à ses citoyens ?","La peine de mort est-elle jamais justifiable ?","Le sacrifice d'un innocent pour sauver mille vies : acceptable ?","L'intelligence artificielle peut-elle avoir des droits ?","Faut-il obéir à une loi injuste ?","Exist-il des vérités absolues ?","L'art peut-il être immoral ?","La vie a-t-elle un sens objectif ?","La démocratie est-elle le meilleur système possible ?","Faut-il toujours dire la vérité ?","L'argent peut-il acheter le bonheur ?","La nature humaine est-elle fondamentalement bonne ou mauvaise ?","Le progrès est-il toujours un bien ?","Sommes-nous responsables du bonheur des autres ?","La vengeance est-elle une forme de justice ?","Le travail : droit ou obligation ?","La vie animale a-t-elle la même valeur que la vie humaine ?","Peut-on admirer l'œuvre sans approuver l'auteur ?","L'amour romantique est-il une construction sociale ?","La souffrance est-elle nécessaire au bonheur ?","Faut-il craindre la mort ?","L'individualisme moderne est-il un progrès ou une régression ?","Le relativisme moral est-il dangereux ?","La vérité est-elle accessible à tous ?","Le libre arbitre : illusion ou réalité ?","Peut-on justifier la guerre ?","La philosophie est-elle encore utile dans le monde moderne ?"]},
  {id:"militaire",icon:"shield",color:"#E03535",label:"Armée & Défense",topics:["Faut-il augmenter le budget de la défense française ?","L'OTAN est-il encore crédible ?","Guerre asymétrique : comment combattre sans frontières ?","Les drones de combat : révolution ou déshumanisation de la guerre ?","Faut-il rétablir le service militaire obligatoire ?","La dissuasion nucléaire protège-t-elle vraiment la paix ?","Cybersécurité : la prochaine guerre sera-t-elle numérique ?","Les sociétés militaires privées : nécessaires ou dangereuses ?","La guerre juste existe-t-elle encore ?","Faut-il abolir les armes à sous-munitions ?","L'armée de terre est-elle dépassée ?","Faut-il une armée européenne autonome ?","Les conflits en Afrique : ingérence ou abandon ?","Vendre des armes à des régimes autoritaires : acceptable ?","Le génocide de Srebrenica : l'ONU a-t-elle failli ?","Faut-il juger les soldats pour crimes de guerre ?","L'intelligence artificielle dans l'armée : jusqu'où ?","Les guerres proxy : jeu dangereux des grandes puissances ?","La résistance armée est-elle toujours légitime ?","Les vétérans de guerre : la société les abandonne-t-elle ?","Faut-il interdire les armes autonomes létales ?","La paix perpétuelle de Kant : utopie ou programme ?","Les sanctions économiques sont-elles une alternative à la guerre ?","Faut-il une police internationale ?","Le terrorisme peut-il être vaincu ?"]},
  {id:"tech",icon:"zap",color:"#16A34A",label:"Technologie & IA",topics:["L'intelligence artificielle va-t-elle détruire l'emploi ?","Faut-il réguler l'IA générative ?","Transhumanisme : améliorer l'humain, jusqu'où ?","Surveillance numérique : sécurité ou Big Brother ?","Espace : la privatisation est-elle une bonne idée ?","Algorithmes et biais : peut-on faire confiance aux machines ?","Deepfakes : menace pour la démocratie ?","Robots dans les soins aux personnes âgées : acceptable ?","Vie privée en 2030 : sera-t-elle encore possible ?","L'humain augmenté : vers une société à deux vitesses ?","Faut-il une IA des droits humains à l'ONU ?","Réseaux 5G et 6G : dangers sanitaires ou progrès ?","L'école face au numérique : tablettes ou craie ?","Faut-il interdire la reconnaissance faciale dans l'espace public ?","Faut-il taxer les robots qui remplacent des travailleurs ?","L'open source peut-il sauver le web ?","Les réseaux sociaux rendent-ils vraiment plus bête ?","Faut-il un droit à la déconnexion numérique ?","Le métavers : avenir du web ou échec annoncé ?","Blockchain : au-delà de la crypto, quel futur ?","Faut-il encadrer les algorithmes des plateformes ?","L'automatisation bénéficiera-t-elle à tous ?","Faut-il un permis pour utiliser l'IA ?","La réalité virtuelle peut-elle remplacer le monde réel ?","L'IA peut-elle créer de l'art authentique ?"]},
  {id:"env",icon:"globe",color:"#15803D",label:"Environnement & Énergie",topics:["Urgence climatique : les politiques sont-elles à la hauteur ?","Nucléaire : solution au changement climatique ou danger ?","Faut-il manger moins de viande pour sauver la planète ?","Voiture électrique : vraie solution ou fausse promesse ?","Décroissance économique : nécessité ou utopie ?","Les pays riches doivent-ils payer pour le climat des pays pauvres ?","Agriculture intensive : faut-il l'interdire ?","L'eau sera-t-elle au cœur des guerres futures ?","Forêts tropicales : souveraineté ou patrimoine mondial ?","Faut-il un crime d'écocide dans le droit international ?","Les activistes climatiques sont-ils trop radicaux ?","Énergies renouvelables : peut-on tout miser dessus ?","Le plastique : les réglementations actuelles suffisent-elles ?","Migration climatique : les sociétés sont-elles prêtes ?","Faut-il taxer les billets d'avion ?","La déforestation amazonienne : crime planétaire ?","Les OGM peuvent-ils nourrir la planète durablement ?","Faut-il interdire la chasse ?","La pêche industrielle détruit-elle les océans ?","Faut-il taxer les produits polluants à la production ?","La sobriété énergétique : contrainte ou mode de vie ?","Les villes de demain seront-elles vraiment vertes ?","Faut-il rendre les bâtiments publics à énergie positive ?","Le tourisme spatial est-il acceptable écologiquement ?","La géo-ingénierie peut-elle sauver le climat ?"]},
  {id:"culture",icon:"award",color:"#BE185D",label:"Culture, Sport & Éducation",topics:["L'école française est-elle à la hauteur des défis du XXIe siècle ?","Faut-il rendre l'université gratuite pour tous ?","Le sport de haut niveau est-il encore un modèle pour la jeunesse ?","Les JO sont-ils devenus une machine commerciale ?","Faut-il réformer le baccalauréat ?","La culture populaire peut-elle être intellectuelle ?","Faut-il des quotas de diversité dans les médias ?","L'art contemporain est-il compris du grand public ?","Faut-il nationaliser les grandes salles de spectacle ?","Cinéma français : exception culturelle ou protectionnisme ?","Faut-il enseigner la philosophie dès le primaire ?","Les jeux vidéo violents influencent-ils les comportements ?","La lecture est-elle en danger ?","Faut-il imposer des quotas de chansons françaises à la radio ?","Le rap est-il de la poésie ?","Les études de lettres ont-elles encore un avenir ?","Faut-il rendre le latin obligatoire ?","Les musées doivent-ils rendre les œuvres coloniales ?","Faut-il supprimer les notes à l'école ?","Le dopage dans le sport : punir ou encadrer ?","L'éducation sexuelle à l'école : qui doit en décider ?","Faut-il interdire les téléphones dans les écoles ?","La mixité sociale à l'école : comment l'atteindre vraiment ?","Le sport féminin est-il encore sous-médiatisé ?","Faut-il enseigner les religions à l'école publique ?"]},
  {id:"europe",icon:"flag",color:"#2B78F5",label:"Europe & Relations Int.",topics:["Europe : fédération ou désintégration ?","Faut-il sortir de l'euro ?","L'Europe peut-elle s'affranchir de l'OTAN ?","Brexit : le Royaume-Uni a-t-il eu raison ?","Faut-il une armée européenne ?","L'Union européenne est-elle trop bureaucratique ?","Schengen : faut-il rétablir les frontières ?","L'élargissement de l'UE à l'Ukraine est-il prématuré ?","La Turquie a-t-elle encore sa place dans l'OTAN ?","L'Europe peut-elle rivaliser avec les États-Unis et la Chine ?","Faut-il un président de l'Europe élu au suffrage universel ?","La zone euro est-elle une réussite ?","L'Europe sociale existe-t-elle vraiment ?","Faut-il une politique d'immigration européenne commune ?","La souveraineté numérique européenne : possible ?","L'accord avec le Mercosur : libre-échange ou trahison écologique ?","Faut-il un impôt européen ?","La politique agricole commune est-elle dépassée ?","Les populismes menacent-ils l'UE de l'intérieur ?","L'Europe doit-elle parler d'une seule voix à l'ONU ?","Faut-il réformer le parlement européen ?","La subsidiarité : principe vivant ou mort ?","L'Afrique est-elle le partenaire naturel de l'Europe ?","La Russie sera-t-elle un jour dans l'UE ?","Faut-il un référendum sur la sortie de l'euro ?"]},
  {id:"droit",icon:"scale",color:"#E03535",label:"Droit, Justice & Libertés",topics:["La peine de mort est-elle jamais justifiable ?","Faut-il légaliser l'euthanasie en France ?","Le droit à l'avortement est-il menacé en Europe ?","Mariage pour tous : où en est l'Europe ?","Faut-il encadrer le port d'armes ?","La présomption d'innocence est-elle respectée ?","Faut-il abolir la détention provisoire ?","Les prisons françaises : état d'urgence ?","Faut-il dépénaliser le cannabis ?","La justice des mineurs est-elle trop laxiste ?","Faut-il élargir le droit d'asile ?","La liberté d'expression a-t-elle des limites ?","Faut-il réguler les discours de haine en ligne ?","Le droit à l'oubli numérique : réalité ou illusion ?","Faut-il une amnistie pour les gilets jaunes ?","La justice climatique est-elle une réalité ?","Faut-il créer un crime d'écocide en droit français ?","Les lanceurs d'alerte sont-ils suffisamment protégés ?","Faut-il réformer la Cour de cassation ?","Le secret professionnel des avocats est-il absolu ?","La justice prédictive par IA : acceptable ?","Faut-il indemniser les victimes d'erreurs judiciaires plus largement ?","Le droit à mourir dans la dignité : où en est la France ?","Faut-il un droit constitutionnel à l'environnement ?","Les droits des animaux : vers une personnalité juridique ?"]},
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
  {id:1,name:"Communauté Géopolitique",last:"Le sommet de l'OTAN a changé beaucoup de choses...",time:"14:23",unread:7,init:"GÉO"},
  {id:2,name:"Alumni Sciences Po",last:"Débat interne demain soir 19h — sujet : IA et démocratie",time:"12:10",unread:4,init:"SP"},
  {id:3,name:"Club Éloquence Marseille",last:"Résultats du concours — félicitations à Amira !",time:"Hier",unread:0,init:"ÉL"},
  {id:4,name:"Réseau Diplomatie France",last:"Forum 24 mai — il reste 12 places",time:"Lun",unread:3,init:"RD"},
  {id:5,name:"Karim M.",last:"Code NEXUS-4821 — prêt pour le duel ?",time:"Lun",unread:3,init:"KM"},
  {id:6,name:"Groupe Concours ENA/INSP",last:"Quelqu'un a le corrigé de la note de synthèse 2023 ?",time:"Dim",unread:9,init:"ENA"},
  {id:7,name:"Débat Philo & Politique",last:"Rawls vs Nozick : qui a raison sur la justice ?",time:"Sam",unread:2,init:"PHI"},
  {id:8,name:"Priya N.",last:"Tu veux faire un duel NEXUS ce soir ?",time:"Sam",unread:2,init:"PN"},
  {id:9,name:"Réseau Afriqu'Elite",last:"Conférence UA la semaine prochaine — qui vient ?",time:"Ven",unread:5,init:"AE"},
  {id:10,name:"Youssef T.",last:"J'ai adoré ton analyse sur la crise au Sahel !",time:"Ven",unread:1,init:"YT"},
  {id:11,name:"Cercle des Orateurs",last:"Prochain atelier : gestion du trac · jeudi 20h",time:"Jeu",unread:0,init:"CO"},
  {id:12,name:"Sciences Po Bordeaux",last:"Inscription ouverte — simulation Conseil de sécurité",time:"Mer",unread:6,init:"SB"},
];

// ── WISDOM STORIES ────────────────────────────────────────────
type WisdomEntry = {id:string;name:string;init:string;role:string;color:string;location?:string;story:{type:string;quote?:string;attribution?:string;caption?:string;bg:string;imgUrl?:string}};
const WISDOM_STORIES: WisdomEntry[] = [
  // PROVERBES
  {id:"ws1",name:"Proverbe · Africain",init:"P1",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Si tu veux aller vite, marche seul. Si tu veux aller loin, marche ensemble.",attribution:"Proverbe africain",bg:"linear-gradient(135deg,#D97706,#16A34A)",imgUrl:"https://picsum.photos/seed/proverbe1/430/760"}},
  {id:"ws2",name:"Proverbe · Chinois",init:"P2",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"L'homme qui déplace des montagnes commence par emporter de petites pierres.",attribution:"Proverbe chinois",bg:"linear-gradient(135deg,#E03535,#D97706)",imgUrl:"https://picsum.photos/seed/proverbe2/430/760"}},
  {id:"ws3",name:"Proverbe · Chinois",init:"P3",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Mieux vaut allumer une bougie que maudire l'obscurité.",attribution:"Proverbe chinois",bg:"linear-gradient(135deg,#2B78F5,#7C3AED)",imgUrl:"https://picsum.photos/seed/proverbe3/430/760"}},
  {id:"ws4",name:"Proverbe · Africain",init:"P4",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Ce que l'on fait pour les autres demeure. Ce que l'on fait pour soi disparaît.",attribution:"Proverbe africain",bg:"linear-gradient(135deg,#16A34A,#D97706)",imgUrl:"https://picsum.photos/seed/proverbe4/430/760"}},
  {id:"ws5",name:"Proverbe · Latin",init:"P5",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Il n'y a pas de vent favorable pour celui qui ne sait pas où il va.",attribution:"Sénèque",bg:"linear-gradient(135deg,#7C3AED,#2B78F5)",imgUrl:"https://picsum.photos/seed/proverbe5/430/760"}},
  {id:"ws6",name:"Proverbe · Japonais",init:"P6",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Les mots qu'on ne dit pas sont les fleurs du silence.",attribution:"Proverbe japonais",bg:"linear-gradient(135deg,#16A34A,#7C3AED)",imgUrl:"https://picsum.photos/seed/proverbe6/430/760"}},
  {id:"ws7",name:"Proverbe · Universel",init:"P7",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Ne juge pas chaque jour à la récolte que tu fais, mais aux graines que tu sèmes.",attribution:"Robert Louis Stevenson",bg:"linear-gradient(135deg,#2B78F5,#16A34A)",imgUrl:"https://picsum.photos/seed/proverbe7/430/760"}},
  {id:"ws8",name:"Proverbe · Africain",init:"P8",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"L'eau qui dort est plus dangereuse que l'eau qui court.",attribution:"Proverbe africain",bg:"linear-gradient(135deg,#0891B2,#16A34A)",imgUrl:"https://picsum.photos/seed/proverbe8/430/760"}},
  {id:"ws9",name:"Proverbe · Taoïste",init:"P9",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Un voyage de mille lieues commence toujours par un seul pas.",attribution:"Lao Tseu",bg:"linear-gradient(135deg,#7C3AED,#E03535)",imgUrl:"https://picsum.photos/seed/proverbe9/430/760"}},
  {id:"ws10",name:"Proverbe · Africain",init:"P10",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"L'éducation est l'arme la plus puissante que vous puissiez utiliser pour changer le monde.",attribution:"Nelson Mandela",bg:"linear-gradient(135deg,#16A34A,#2B78F5)",imgUrl:"https://picsum.photos/seed/proverbe10/430/760"}},
  {id:"ws11",name:"Proverbe · Biblique",init:"P11",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"Educa un enfant dans la voie qu'il doit suivre, et quand il sera vieux, il ne s'en détournera pas.",attribution:"Proverbes 22:6",bg:"linear-gradient(135deg,#D97706,#7C3AED)",imgUrl:"https://picsum.photos/seed/proverbe11/430/760"}},
  {id:"ws12",name:"Proverbe · Universel",init:"P12",role:"Sagesse ancestrale",color:"#D97706",story:{type:"proverbe",quote:"La chute n'est pas un échec. L'échec, c'est de rester là où on est tombé.",attribution:"Proverbe",bg:"linear-gradient(135deg,#E03535,#2B78F5)",imgUrl:"https://picsum.photos/seed/proverbe12/430/760"}},
  // PHILOSOPHES
  {id:"ws13",name:"Socrate",init:"So",role:"Philosophe · 470–399 av. J.-C.",color:"#7C3AED",story:{type:"philosophe",quote:"Je sais que je ne sais rien.",attribution:"Socrate",bg:"linear-gradient(135deg,#7C3AED,#2B78F5)",imgUrl:"https://picsum.photos/seed/philo1/430/760"}},
  {id:"ws14",name:"Aristote",init:"Ar",role:"Philosophe · 384–322 av. J.-C.",color:"#7C3AED",story:{type:"philosophe",quote:"L'excellence n'est pas un acte, c'est une habitude.",attribution:"Aristote",bg:"linear-gradient(135deg,#7C3AED,#16A34A)",imgUrl:"https://picsum.photos/seed/philo2/430/760"}},
  {id:"ws15",name:"Platon",init:"Pl",role:"Philosophe · 428–348 av. J.-C.",color:"#7C3AED",story:{type:"philosophe",quote:"La nécessité est la mère de l'invention.",attribution:"Platon",bg:"linear-gradient(135deg,#2B78F5,#7C3AED)",imgUrl:"https://picsum.photos/seed/philo3/430/760"}},
  {id:"ws16",name:"Descartes",init:"De",role:"Philosophe · 1596–1650",color:"#7C3AED",story:{type:"philosophe",quote:"Je pense, donc je suis.",attribution:"Descartes",bg:"linear-gradient(135deg,#7C3AED,#E03535)",imgUrl:"https://picsum.photos/seed/philo4/430/760"}},
  {id:"ws17",name:"Voltaire",init:"Vo",role:"Philosophe · 1694–1778",color:"#7C3AED",story:{type:"philosophe",quote:"Il faut cultiver notre jardin.",attribution:"Voltaire",bg:"linear-gradient(135deg,#D97706,#7C3AED)",imgUrl:"https://picsum.photos/seed/philo5/430/760"}},
  {id:"ws18",name:"Nietzsche",init:"Ni",role:"Philosophe · 1844–1900",color:"#7C3AED",story:{type:"philosophe",quote:"Ce qui ne me tue pas me rend plus fort.",attribution:"Nietzsche",bg:"linear-gradient(135deg,#E03535,#7C3AED)",imgUrl:"https://picsum.photos/seed/philo6/430/760"}},
  {id:"ws19",name:"Rousseau",init:"Ro",role:"Philosophe · 1712–1778",color:"#7C3AED",story:{type:"philosophe",quote:"L'homme est né libre, et partout il est dans les fers.",attribution:"Rousseau",bg:"linear-gradient(135deg,#7C3AED,#D97706)",imgUrl:"https://picsum.photos/seed/philo7/430/760"}},
  {id:"ws20",name:"Kant",init:"Ka",role:"Philosophe · 1724–1804",color:"#7C3AED",story:{type:"philosophe",quote:"Aie le courage de te servir de ta propre intelligence.",attribution:"Kant",bg:"linear-gradient(135deg,#2B78F5,#7C3AED)",imgUrl:"https://picsum.photos/seed/philo8/430/760"}},
  {id:"ws21",name:"Sartre",init:"Sa",role:"Philosophe · 1905–1980",color:"#7C3AED",story:{type:"philosophe",quote:"L'existence précède l'essence.",attribution:"Sartre",bg:"linear-gradient(135deg,#7C3AED,#16A34A)",imgUrl:"https://picsum.photos/seed/philo9/430/760"}},
  {id:"ws22",name:"Simone de Beauvoir",init:"SB",role:"Philosophe · 1908–1986",color:"#7C3AED",story:{type:"philosophe",quote:"On ne naît pas femme, on le devient.",attribution:"Simone de Beauvoir",bg:"linear-gradient(135deg,#E03535,#7C3AED)",imgUrl:"https://picsum.photos/seed/philo10/430/760"}},
  {id:"ws23",name:"Albert Camus",init:"AC",role:"Philosophe · 1913–1960",color:"#7C3AED",story:{type:"philosophe",quote:"Au milieu de l'hiver, j'ai découvert en moi un invincible été.",attribution:"Albert Camus",bg:"linear-gradient(135deg,#2B78F5,#16A34A)",imgUrl:"https://picsum.photos/seed/philo11/430/760"}},
  {id:"ws24",name:"Hannah Arendt",init:"HA",role:"Philosophe · 1906–1975",color:"#7C3AED",story:{type:"philosophe",quote:"La tyrannie est la seule forme de gouvernement qui ne puisse se maintenir que par la terreur.",attribution:"Hannah Arendt",bg:"linear-gradient(135deg,#7C3AED,#E03535)",imgUrl:"https://picsum.photos/seed/philo12/430/760"}},
  // AUTEURS
  {id:"ws25",name:"Victor Hugo",init:"VH",role:"Auteur · Les Misérables",color:"#2B78F5",story:{type:"auteur",quote:"Vous qui souffrez parce que vous aimez, aimez encore davantage. Mourir d'amour, c'est vivre par lui.",attribution:"Victor Hugo",bg:"linear-gradient(135deg,#2B78F5,#7C3AED)",imgUrl:"https://picsum.photos/seed/auteur1/430/760"}},
  {id:"ws26",name:"Marcel Proust",init:"MP",role:"Auteur · À la recherche du temps perdu",color:"#2B78F5",story:{type:"auteur",quote:"Le vrai voyage de découverte ne consiste pas à chercher de nouveaux paysages, mais à avoir de nouveaux yeux.",attribution:"Marcel Proust",bg:"linear-gradient(135deg,#7C3AED,#2B78F5)",imgUrl:"https://picsum.photos/seed/auteur2/430/760"}},
  {id:"ws27",name:"Aimé Césaire",init:"AiC",role:"Auteur · Cahier d'un retour au pays natal",color:"#2B78F5",story:{type:"auteur",quote:"Ma bouche sera la bouche des malheurs qui n'ont point de bouche, ma voix, la liberté de celles qui s'affaissent au cachot du désespoir.",attribution:"Aimé Césaire",bg:"linear-gradient(135deg,#E03535,#2B78F5)",imgUrl:"https://picsum.photos/seed/auteur3/430/760"}},
  {id:"ws28",name:"Simone de Beauvoir",init:"SdB",role:"Auteur · Le Deuxième Sexe",color:"#2B78F5",story:{type:"auteur",quote:"Toute oppression crée un état de guerre.",attribution:"Simone de Beauvoir",bg:"linear-gradient(135deg,#E03535,#16A34A)",imgUrl:"https://picsum.photos/seed/auteur4/430/760"}},
  {id:"ws29",name:"Montaigne",init:"Mo",role:"Auteur · Les Essais",color:"#2B78F5",story:{type:"auteur",quote:"Chaque homme porte la forme entière de l'humaine condition.",attribution:"Montaigne",bg:"linear-gradient(135deg,#D97706,#2B78F5)",imgUrl:"https://picsum.photos/seed/auteur5/430/760"}},
  {id:"ws30",name:"Dostoïevski",init:"Do",role:"Auteur · L'Idiot",color:"#2B78F5",story:{type:"auteur",quote:"Aimer quelqu'un, c'est le voir tel que Dieu l'a voulu.",attribution:"Dostoïevski",bg:"linear-gradient(135deg,#2B78F5,#D97706)",imgUrl:"https://picsum.photos/seed/auteur6/430/760"}},
  {id:"ws31",name:"Albert Camus",init:"AlC",role:"Auteur · L'Étranger",color:"#2B78F5",story:{type:"auteur",quote:"Il faut imaginer Sisyphe heureux.",attribution:"Albert Camus",bg:"linear-gradient(135deg,#16A34A,#2B78F5)",imgUrl:"https://picsum.photos/seed/auteur7/430/760"}},
  {id:"ws32",name:"Frantz Fanon",init:"FF",role:"Auteur · Les Damnés de la Terre",color:"#2B78F5",story:{type:"auteur",quote:"Chaque génération doit, dans une relative opacité, découvrir sa mission, la remplir ou la trahir.",attribution:"Frantz Fanon",bg:"linear-gradient(135deg,#E03535,#D97706)",imgUrl:"https://picsum.photos/seed/auteur8/430/760"}},
  {id:"ws33",name:"Léopold Sédar Senghor",init:"LS",role:"Auteur · Négritude",color:"#2B78F5",story:{type:"auteur",quote:"La négritude, c'est la simple reconnaissance du fait d'être noir, et l'acceptation de ce destin.",attribution:"Léopold Sédar Senghor",bg:"linear-gradient(135deg,#16A34A,#7C3AED)",imgUrl:"https://picsum.photos/seed/auteur9/430/760"}},
  {id:"ws34",name:"Antoine de Saint-Exupéry",init:"ASE",role:"Auteur · Le Petit Prince",color:"#2B78F5",story:{type:"auteur",quote:"L'essentiel est invisible pour les yeux.",attribution:"Antoine de Saint-Exupéry",bg:"linear-gradient(135deg,#D97706,#E03535)",imgUrl:"https://picsum.photos/seed/auteur10/430/760"}},
  {id:"ws35",name:"George Orwell",init:"GO",role:"Auteur · 1984",color:"#2B78F5",story:{type:"auteur",quote:"La guerre, c'est la paix. La liberté, c'est l'esclavage. L'ignorance, c'est la force.",attribution:"George Orwell",bg:"linear-gradient(135deg,#E03535,#16A34A)",imgUrl:"https://picsum.photos/seed/auteur11/430/760"}},
  {id:"ws36",name:"Voltaire",init:"VoC",role:"Auteur · Candide",color:"#2B78F5",story:{type:"auteur",quote:"Il faut cultiver notre jardin.",attribution:"Voltaire",bg:"linear-gradient(135deg,#D97706,#16A34A)",imgUrl:"https://picsum.photos/seed/auteur12/430/760"}},
  // BIBLE
  {id:"ws37",name:"La Bible · Psaumes",init:"Ps",role:"Paroles sacrées · Psaumes 23:1",color:"#D97706",story:{type:"bible",quote:"L'Éternel est mon berger : je ne manquerai de rien.",attribution:"Psaumes 23:1",bg:"linear-gradient(135deg,#D97706,#7C3AED)",imgUrl:"https://picsum.photos/seed/bible1/430/760"}},
  {id:"ws38",name:"La Bible · Jean",init:"Jn",role:"Paroles sacrées · Jean 3:16",color:"#D97706",story:{type:"bible",quote:"Car Dieu a tant aimé le monde qu'il a donné son Fils unique, afin que quiconque croit en lui ne périsse point, mais qu'il ait la vie éternelle.",attribution:"Jean 3:16",bg:"linear-gradient(135deg,#7C3AED,#D97706)",imgUrl:"https://picsum.photos/seed/bible2/430/760"}},
  {id:"ws39",name:"La Bible · Matthieu",init:"Mt",role:"Paroles sacrées · Matthieu 5:9",color:"#D97706",story:{type:"bible",quote:"Heureux les artisans de paix, car ils seront appelés fils de Dieu.",attribution:"Matthieu 5:9",bg:"linear-gradient(135deg,#16A34A,#D97706)",imgUrl:"https://picsum.photos/seed/bible3/430/760"}},
  {id:"ws40",name:"La Bible · Proverbes",init:"Pv",role:"Paroles sacrées · Proverbes 3:5",color:"#D97706",story:{type:"bible",quote:"Confie-toi en l'Éternel de tout ton cœur, et ne t'appuie pas sur ta propre sagesse.",attribution:"Proverbes 3:5",bg:"linear-gradient(135deg,#D97706,#2B78F5)",imgUrl:"https://picsum.photos/seed/bible4/430/760"}},
  {id:"ws41",name:"La Bible · Romains",init:"Rm",role:"Paroles sacrées · Romains 8:28",color:"#D97706",story:{type:"bible",quote:"Nous savons, d'ailleurs, que toutes choses concourent au bien de ceux qui aiment Dieu.",attribution:"Romains 8:28",bg:"linear-gradient(135deg,#2B78F5,#D97706)",imgUrl:"https://picsum.photos/seed/bible5/430/760"}},
  {id:"ws42",name:"La Bible · 1 Corinthiens",init:"1Co",role:"Paroles sacrées · 1 Corinthiens 13:4",color:"#D97706",story:{type:"bible",quote:"L'amour est patient, l'amour est plein de bonté ; l'amour n'est point envieux ; l'amour ne se vante point, il ne s'enfle point d'orgueil.",attribution:"1 Corinthiens 13:4",bg:"linear-gradient(135deg,#E03535,#D97706)",imgUrl:"https://picsum.photos/seed/bible6/430/760"}},
  {id:"ws43",name:"La Bible · Philippiens",init:"Ph",role:"Paroles sacrées · Philippiens 4:13",color:"#D97706",story:{type:"bible",quote:"Je puis tout par celui qui me fortifie.",attribution:"Philippiens 4:13",bg:"linear-gradient(135deg,#D97706,#16A34A)",imgUrl:"https://picsum.photos/seed/bible7/430/760"}},
  {id:"ws44",name:"La Bible · Jérémie",init:"Jr",role:"Paroles sacrées · Jérémie 29:11",color:"#D97706",story:{type:"bible",quote:"Car je connais les projets que j'ai formés sur vous, dit l'Éternel, projets de paix et non de malheur, afin de vous donner un avenir et une espérance.",attribution:"Jérémie 29:11",bg:"linear-gradient(135deg,#16A34A,#D97706)",imgUrl:"https://picsum.photos/seed/bible8/430/760"}},
  {id:"ws45",name:"La Bible · Ésaïe",init:"És",role:"Paroles sacrées · Ésaïe 40:31",color:"#D97706",story:{type:"bible",quote:"Mais ceux qui se confient en l'Éternel renouvellent leurs forces. Ils prennent le vol comme les aigles.",attribution:"Ésaïe 40:31",bg:"linear-gradient(135deg,#2B78F5,#16A34A)",imgUrl:"https://picsum.photos/seed/bible9/430/760"}},
  {id:"ws46",name:"La Bible · Psaumes",init:"Ps2",role:"Paroles sacrées · Psaumes 46:2",color:"#D97706",story:{type:"bible",quote:"Dieu est notre refuge et notre force, un secours qui ne manque jamais dans la détresse.",attribution:"Psaumes 46:2",bg:"linear-gradient(135deg,#7C3AED,#16A34A)",imgUrl:"https://picsum.photos/seed/bible10/430/760"}},
  {id:"ws47",name:"La Bible · Matthieu",init:"Mt2",role:"Paroles sacrées · Matthieu 6:33",color:"#D97706",story:{type:"bible",quote:"Cherchez premièrement le royaume et la justice de Dieu ; et toutes ces choses vous seront données par-dessus.",attribution:"Matthieu 6:33",bg:"linear-gradient(135deg,#D97706,#E03535)",imgUrl:"https://picsum.photos/seed/bible11/430/760"}},
  {id:"ws48",name:"La Bible · Galates",init:"Ga",role:"Paroles sacrées · Galates 6:9",color:"#D97706",story:{type:"bible",quote:"Ne nous lassons pas de faire le bien ; car nous moissonnerons au temps convenable, si nous ne nous relâchons pas.",attribution:"Galates 6:9",bg:"linear-gradient(135deg,#16A34A,#2B78F5)",imgUrl:"https://picsum.photos/seed/bible12/430/760"}},
  {id:"ws49",name:"La Bible · Deutéronome",init:"Dt",role:"Paroles sacrées · Deutéronome 31:6",color:"#D97706",story:{type:"bible",quote:"Fortifiez-vous et ayez du courage ! Ne craignez point et ne soyez point effrayés devant eux ; car l'Éternel, ton Dieu, marchera lui-même avec toi.",attribution:"Deutéronome 31:6",bg:"linear-gradient(135deg,#D97706,#7C3AED)",imgUrl:"https://picsum.photos/seed/bible13/430/760"}},
  {id:"ws50",name:"La Bible · Josué",init:"Jo",role:"Paroles sacrées · Josué 1:9",color:"#D97706",story:{type:"bible",quote:"Je t'ordonne d'être ferme et courageux. Ne t'effraie point et ne t'épouvante point, car l'Éternel, ton Dieu, est avec toi dans tout ce que tu entreprendras.",attribution:"Josué 1:9",bg:"linear-gradient(135deg,#7C3AED,#16A34A)",imgUrl:"https://picsum.photos/seed/bible14/430/760"}},
];
// ── DEMO PROFILES (30 fake users for prototype) ──────────────
const DEMO_PROFILES = [
  {id:"dp1",name:"Amira Konaté",init:"AK",role:"Doctorante en droit international",location:"Paris",verified:true,color:"#2B78F5",followers:1420,bio:"Spécialiste droit humanitaire · CIJ · ONU",story:{type:"photo",caption:"À La Haye pour la présentation de ma thèse sur les avis consultatifs de la CIJ 🏛️",bg:"linear-gradient(135deg,#2B78F5,#7C3AED)"}},
  {id:"dp2",name:"Baptiste Renard",init:"BR",role:"Journaliste géopolitique",location:"Bruxelles",verified:true,color:"#16A34A",followers:3280,bio:"Correspondant UE · Le Monde diplomatique",story:{type:"video",caption:"Live depuis le Parlement européen — session extraordinaire sur la défense commune 🎙️",bg:"linear-gradient(135deg,#16A34A,#0891B2)"}},
  {id:"dp3",name:"Chiara Romano",init:"CR",role:"Chercheuse en relations internationales",location:"Rome",verified:false,color:"#7C3AED",followers:890,bio:"Sciences Po Paris · LUISS Roma",story:{type:"photo",caption:"En vacances à Athènes — ville berceau de la démocratie ☀️",bg:"linear-gradient(135deg,#7C3AED,#E03535)"}},
  {id:"dp4",name:"Daouda Traoré",init:"DT",role:"Analyste politique Afrique",location:"Dakar",verified:true,color:"#D97706",followers:2150,bio:"Institut Afrique Monde · Géopolitique subsaharienne",story:{type:"photo",caption:"Forum sur la sécurité au Sahel — j'ai participé au panel principal à Dakar 🌍",bg:"linear-gradient(135deg,#D97706,#E03535)"}},
  {id:"dp5",name:"Elena Vasquez",init:"EV",role:"Avocate droits de l'homme",location:"Madrid",verified:true,color:"#E03535",followers:1870,bio:"Amnesty International · Barreau de Paris",story:{type:"share",caption:"Je partage cet article sur la situation des défenseurs des droits humains en Iran 🔗",bg:"linear-gradient(135deg,#E03535,#D97706)"}},
  {id:"dp6",name:"Farid Mansouri",init:"FM",role:"Économiste politique",location:"Lyon",verified:false,color:"#2B78F5",followers:640,bio:"ENS Lyon · Économie des inégalités",story:{type:"photo",caption:"Conférence à l'ENS Lyon sur les inégalités économiques — 200 étudiants présents 📊",bg:"linear-gradient(135deg,#2B78F5,#16A34A)"}},
  {id:"dp7",name:"Giulia Ferrari",init:"GF",role:"Eurodéputée (fictif)",location:"Strasbourg",verified:true,color:"#16A34A",followers:8900,bio:"Parlement européen · Commission affaires étrangères",story:{type:"video",caption:"Déclaration officielle sur la politique d'élargissement de l'UE à Strasbourg 🇪🇺",bg:"linear-gradient(135deg,#16A34A,#2B78F5)"}},
  {id:"dp8",name:"Hassan Al-Rashid",init:"HR",role:"Diplomat & Think-tank",location:"Genève",verified:true,color:"#7C3AED",followers:4200,bio:"GCSP · Sécurité internationale · Moyen-Orient",story:{type:"photo",caption:"Au GCSP Genève — rencontre avec des diplomates de 30 pays sur la sécurité régionale 🌐",bg:"linear-gradient(135deg,#7C3AED,#2B78F5)"}},
  {id:"dp9",name:"Isabelle Morin",init:"IM",role:"Professeure de Sciences politiques",location:"Toulouse",verified:false,color:"#D97706",followers:1100,bio:"Université Toulouse Capitole · Démocratie comparée"},
  {id:"dp10",name:"Jonas Weber",init:"JW",role:"Analyste défense & OTAN",location:"Berlin",verified:true,color:"#E03535",followers:2700,bio:"Stiftung Wissenschaft · Institut Montaigne",story:{type:"video",caption:"Mon analyse du dernier sommet OTAN — quelques observations clés à ne pas manquer 🎯",bg:"linear-gradient(135deg,#E03535,#7C3AED)"}},
  {id:"dp11",name:"Kofi Mensah",init:"KM",role:"Étudiant Sciences Po",location:"Abidjan",verified:false,color:"#2B78F5",followers:380,bio:"Sciences Po Paris '27 · Relation franco-africaines",story:{type:"photo",caption:"Mon 1er jour sur le campus de Sciences Po Paris — rêve réalisé ! 🎓",bg:"linear-gradient(135deg,#2B78F5,#D97706)"}},
  {id:"dp12",name:"Layla Benali",init:"LB",role:"Journaliste investigatrice",location:"Tunis",verified:true,color:"#16A34A",followers:5600,bio:"Inkyfada · Nawaat · Presse indépendante Maghreb",story:{type:"share",caption:"Mon reportage sur la liberté de la presse en Tunisie vient d'être publié 📰",bg:"linear-gradient(135deg,#16A34A,#7C3AED)"}},
  {id:"dp13",name:"Marc Dupont",init:"MD",role:"Consultant stratégie politique",location:"Paris",verified:false,color:"#7C3AED",followers:720,bio:"Ex-conseiller ministériel · Campus politique"},
  {id:"dp14",name:"Nadia Petrov",init:"NP",role:"Correspondante Europe de l'Est",location:"Varsovie",verified:true,color:"#D97706",followers:3100,bio:"ARTE · Le Figaro · Ukraine & Russie",story:{type:"photo",caption:"En reportage à Varsovie — 3 ans après l'invasion russe, que reste-t-il du traumatisme ? 📸",bg:"linear-gradient(135deg,#D97706,#E03535)"}},
  {id:"dp15",name:"Omar Diallo",init:"OD",role:"Avocat pénaliste international",location:"La Haye",verified:true,color:"#E03535",followers:1950,bio:"CPI · Tribunal pénal international",story:{type:"video",caption:"Intervention à la CPI — affaire en cours, commentaires sous embargo jusqu'au verdict 🏛️",bg:"linear-gradient(135deg,#E03535,#2B78F5)"}},
  {id:"dp16",name:"Priya Sharma",init:"PS",role:"Chercheuse Indo-Pacifique",location:"New Delhi",verified:true,color:"#2B78F5",followers:2830,bio:"Observer Research Foundation · Géopolitique Asie",story:{type:"photo",caption:"En vacances aux Maldives — consciente que ces îles disparaîtront d'ici 2100 🌊",bg:"linear-gradient(135deg,#2B78F5,#16A34A)"}},
  {id:"dp17",name:"Quentin Leclerc",init:"QL",role:"Étudiant prépa Sciences Po",location:"Bordeaux",verified:false,color:"#16A34A",followers:210,bio:"Concours SciencesPo 2025 · Rhétorique & débat",story:{type:"photo",caption:"Résultat admissible au concours Sciences Po — le travail paye ! 🥳",bg:"linear-gradient(135deg,#16A34A,#2B78F5)"}},
  {id:"dp18",name:"Rania Aziz",init:"RA",role:"Militante droits des femmes",location:"Le Caire",verified:false,color:"#7C3AED",followers:4400,bio:"Féminisme · Droits MENA · Militante digitale",story:{type:"share",caption:"Je partage le manifeste des 100 militantes arabes pour l'égalité des droits 📢",bg:"linear-gradient(135deg,#7C3AED,#E03535)"}},
  {id:"dp19",name:"Sébastien Blanc",init:"SBl",role:"Historien contemporain",location:"Strasbourg",verified:true,color:"#D97706",followers:1640,bio:"Université de Strasbourg · Histoire du XXe siècle",story:{type:"photo",caption:"Visite des Archives nationales à Paris — découverte de documents inédits sur Mai 68 🗄️",bg:"linear-gradient(135deg,#D97706,#7C3AED)"}},
  {id:"dp20",name:"Tamar Cohen",init:"TC",role:"Analyste sécurité Israel-Palestine",location:"Tel Aviv",verified:true,color:"#E03535",followers:6200,bio:"INSS · Conflit israélo-palestinien"},
  {id:"dp21",name:"Uriel Morales",init:"UM",role:"Économiste Latino-Amérique",location:"Buenos Aires",verified:false,color:"#2B78F5",followers:830,bio:"CEPAL · Économie politique Amérique du Sud",story:{type:"video",caption:"Live depuis Buenos Aires : le peso argentin et la politique économique de Milei 📉",bg:"linear-gradient(135deg,#2B78F5,#D97706)"}},
  {id:"dp22",name:"Valentina Cruz",init:"VC",role:"Juriste droit européen",location:"Barcelone",verified:true,color:"#16A34A",followers:1290,bio:"CJUE · Droit UE · Libertés fondamentales",story:{type:"photo",caption:"En vacances à Lisbonne — entre deux dossiers sur la CJUE 😊",bg:"linear-gradient(135deg,#16A34A,#E03535)"}},
  {id:"dp23",name:"William Osei",init:"WO",role:"Diplomate UA",location:"Addis-Abeba",verified:true,color:"#7C3AED",followers:3700,bio:"Union Africaine · Paix et sécurité · CAERT",story:{type:"photo",caption:"Sommet de l'Union Africaine — j'ai participé au panel sécurité & développement 🌍",bg:"linear-gradient(135deg,#7C3AED,#16A34A)"}},
  {id:"dp24",name:"Xinyi Zhang",init:"XZ",role:"Analyste Chine & Asie",location:"Shanghai",verified:false,color:"#D97706",followers:950,bio:"Fudan University · Politique étrangère chinoise"},
  {id:"dp25",name:"Yasmine Dubois",init:"YD",role:"Journaliste politique France",location:"Paris",verified:true,color:"#E03535",followers:7800,bio:"France Info · L'Obs · Politique intérieure",story:{type:"video",caption:"Mon direct depuis l'Élysée — réactions à l'annonce du Premier ministre 📺",bg:"linear-gradient(135deg,#E03535,#7C3AED)"}},
  {id:"dp26",name:"Zara Nkosi",init:"ZN",role:"Militante écologie & justice",location:"Johannesburg",verified:false,color:"#2B78F5",followers:2100,bio:"Activisme climatique · Justice environnementale Afrique",story:{type:"share",caption:"Je partage ce rapport accablant sur la pollution minière en Afrique du Sud 🌱",bg:"linear-gradient(135deg,#2B78F5,#16A34A)"}},
  {id:"dp27",name:"Antoine Lefebvre",init:"AL",role:"Professeur de philosophie politique",location:"Paris",verified:true,color:"#16A34A",followers:4300,bio:"Sciences Po Paris · Rousseau · Rawls · Libéralisme"},
  {id:"dp28",name:"Béatrice Nzinga",init:"BN",role:"Chercheuse panafricanisme",location:"Kinshasa",verified:false,color:"#7C3AED",followers:670,bio:"UNIKIN · Héritage Lumumba · Panafricanisme",story:{type:"photo",caption:"À Kinshasa pour commémorer les 65 ans de l'assassinat de Lumumba 🕯️",bg:"linear-gradient(135deg,#7C3AED,#D97706)"}},
  {id:"dp29",name:"Cédric Martin",init:"CM",role:"Analyste renseignement",location:"Paris",verified:true,color:"#D97706",followers:5100,bio:"Ex-DGSE · Géostratégie · Renseignement ouvert"},
  {id:"dp30",name:"Diana Pham",init:"DP",role:"Avocate droit international pénal",location:"Genève",verified:true,color:"#E03535",followers:2400,bio:"CPI · Crimes de guerre · Droit humanitaire",story:{type:"video",caption:"Retour sur mon plaidoyer à la CPI — pourquoi ce procès est historique ⚖️",bg:"linear-gradient(135deg,#E03535,#16A34A)"}},
];
const ALL_STORIES = [...DEMO_PROFILES.filter(p=>(p as any).story), ...WISDOM_STORIES] as any[];

// ── DEMO POSTS (fake articles from demo profiles) ─────────────
const now2 = Date.now();
const h=(n:number)=>now2-n*3600000;
const DEMO_POSTS: Array<{id:string;profileId:string;title:string;text:string;tag:string;tagC:string;time:number;source:string;sourceUrl:string;verified:boolean;verifiedLabel?:string;likes:number;comments:number;mediaType?:"photo"|"video";mediaBg?:string}> = [
  {id:"demo1",profileId:"dp1",title:"La CIJ et les nouvelles demandes d'avis consultatifs",text:"La Cour internationale de justice a reçu une demande d'avis consultatif de l'Assemblée générale de l'ONU sur les obligations des États en matière de changement climatique. C'est un tournant majeur : pour la première fois, le droit international climatique pourrait être codifié par la plus haute juridiction mondiale. Les implications pour les petits États insulaires menacés de submersion sont considérables.",tag:"DROIT",tagC:"#7C3AED",time:h(2),source:"Cour internationale de justice",sourceUrl:"https://www.icj-cij.org",verified:true,verifiedLabel:"Source officielle",likes:234,comments:47,mediaType:"photo",mediaBg:"linear-gradient(135deg,#2B78F5,#7C3AED)"},
  {id:"demo2",profileId:"dp2",title:"L'UE face à la fragmentation des démocraties",text:"Le rapport annuel de Freedom House 2024 confirme une tendance inquiétante : 18 des 27 États membres de l'UE ont subi une érosion de leurs indicateurs démocratiques au cours des cinq dernières années. La Hongrie et la Slovaquie sont les cas les plus documentés, mais des signaux préoccupants émergent également en France (recul des libertés syndicales) et en Allemagne (montée de l'AfD). L'article 7 du TUE s'avère un outil trop rigide pour répondre à cette crise.",tag:"EUROPE",tagC:"#2B78F5",time:h(5),source:"Freedom House",sourceUrl:"https://freedomhouse.org",verified:true,verifiedLabel:"Source vérifiée",likes:412,comments:89,mediaType:"video",mediaBg:"linear-gradient(135deg,#16A34A,#2B78F5)"},
  {id:"demo3",profileId:"dp4",title:"Le Sahel post-CEDEAO : vers une recomposition géopolitique",text:"Le retrait du Mali, du Burkina Faso et du Niger de la CEDEAO en janvier 2024 pour former l'Alliance des États du Sahel (AES) marque une rupture historique dans l'architecture sécuritaire africaine. L'influence française s'effondre (départ de Barkhane, expulsion des ambassadeurs), remplacée par Wagner/Africa Corps et des partenariats avec la Russie. La question centrale : l'AES peut-elle réellement assurer la sécurité sans le soutien logistique occidental ?",tag:"AFRIQUE",tagC:"#D97706",time:h(8),source:"Institut Afrique Monde",sourceUrl:"https://www.institutafriquemond.org",verified:false,likes:567,comments:134,mediaType:"photo",mediaBg:"linear-gradient(135deg,#D97706,#16A34A)"},
  {id:"demo4",profileId:"dp5",title:"Détention arbitraire : le comité ONU interpelle la France",text:"Le Groupe de travail sur la détention arbitraire de l'ONU a conclu en mars 2024 que la France avait violé le droit international en maintenant en détention provisoire pendant 36 mois un ressortissant franco-algérien sans base légale suffisante. La France est régulièrement épinglée pour ses délais de détention provisoire qui excèdent les standards européens. Cette décision, non contraignante mais politiquement significative, relance le débat sur la réforme de la procédure pénale.",tag:"DROIT",tagC:"#7C3AED",time:h(12),source:"OHCHR / ONU",sourceUrl:"https://www.ohchr.org",verified:true,verifiedLabel:"Source officielle ONU",likes:189,comments:52},
  {id:"demo5",profileId:"dp7",title:"Budget européen 2028-2034 : les lignes de fracture",text:"Les négociations sur le prochain cadre financier pluriannuel de l'UE (2028-2034) débutent dans un contexte tendu. L'élargissement aux pays des Balkans et à l'Ukraine nécessiterait une augmentation du budget de 30%, que les 'frugaux' (Pays-Bas, Autriche, Suède) refusent catégoriquement. Le Parlement européen demande des ressources propres nouvelles (taxe carbone aux frontières, taxe sur les GAFAM) pour réduire la dépendance aux contributions nationales.",tag:"EUROPE",tagC:"#2B78F5",time:h(15),source:"Parlement européen",sourceUrl:"https://europarl.europa.eu",verified:true,verifiedLabel:"Source institutionnelle",likes:298,comments:67},
  {id:"demo6",profileId:"dp10",title:"OTAN 2024 : le défi de la solidarité collective",text:"75 ans après sa fondation, l'OTAN se retrouve face à son plus grand défi depuis la Guerre froide. Les dépenses de défense atteignent 2% du PIB dans 23 des 32 membres — un record. Mais la question centrale n'est plus financière : c'est celle de la volonté politique. L'article 5 serait-il réellement déclenché si un État baltique était attaqué ? Les déclarations divergentes des dirigeants européens et américains alimentent les doutes.",tag:"GÉOPOLITIQUE",tagC:"#E03535",time:h(18),source:"OTAN / analyse Berlin Policy Journal",sourceUrl:"https://berlinpolicyjournal.com",verified:true,verifiedLabel:"Analyse vérifiée",likes:876,comments:201,mediaType:"video",mediaBg:"linear-gradient(135deg,#E03535,#7C3AED)"},
  {id:"demo7",profileId:"dp12",title:"Tunisie : la répression des médias indépendants s'intensifie",text:"Depuis l'adoption de la Constitution de 2022 par Kaïs Saïed, les arrestations de journalistes tunisiens se multiplient. En 2024, 14 journalistes ou blogueurs sont derrière les barreaux, dont plusieurs correspondants de médias internationaux. Le décret 54 sur la 'cybercriminalité' est utilisé pour criminaliser toute critique du pouvoir. La Tunisie, modèle de la transition démocratique arabe après 2011, est désormais classée 'partiellement libre' par Freedom House.",tag:"DROIT",tagC:"#7C3AED",time:h(22),source:"Reporters sans frontières",sourceUrl:"https://rsf.org",verified:true,verifiedLabel:"RSF vérifié",likes:445,comments:98},
  {id:"demo8",profileId:"dp8",title:"Les négociations de désarmement nucléaire : impasse totale",text:"Les discussions entre grandes puissances nucléaires sont au point mort depuis 2021. La Russie a suspendu sa participation au traité New START, la Chine refuse d'entrer dans tout cadre multilatéral tant qu'elle n'atteint pas la parité avec USA et Russie, et les États-Unis ont conditionné tout dialogue à une dénucléarisation nord-coréenne préalable. Le monde dispose aujourd'hui de ~13 000 têtes nucléaires, dont 90% entre mains russo-américaines.",tag:"GÉOPOLITIQUE",tagC:"#E03535",time:h(26),source:"Bulletin of the Atomic Scientists",sourceUrl:"https://thebulletin.org",verified:true,verifiedLabel:"Source scientifique",likes:334,comments:77},
  {id:"demo9",profileId:"dp16",title:"L'Inde et la présidence du G20 : une diplomatie tous azimuts",text:"Sous la présidence indienne du G20 en 2023, New Delhi a réussi à faire adopter une déclaration finale unanime — exploit diplomatique considérable compte tenu des divergences sur l'Ukraine. L'Inde a ainsi prouvé qu'elle pouvait jouer le rôle de médiateur entre le bloc occidental et le Sud global. Cette stratégie de 'multi-alignement' (ni avec les USA ni avec la Chine/Russie) est désormais la marque de fabrique de la diplomatie Modi.",tag:"GÉOPOLITIQUE",tagC:"#E03535",time:h(30),source:"Observer Research Foundation",sourceUrl:"https://www.orfonline.org",verified:true,verifiedLabel:"Think-tank vérifié",likes:523,comments:112,mediaType:"photo",mediaBg:"linear-gradient(135deg,#2B78F5,#D97706)"},
  {id:"demo10",profileId:"dp14",title:"Pologne : le retour de l'État de droit après Tusk ?",text:"L'élection de Donald Tusk comme Premier ministre en octobre 2023 et la formation d'une coalition pro-européenne ont mis fin à 8 ans de gouvernance PiS. Mais démonter l'appareil institutionnel du parti Droit et Justice prend du temps : la Cour suprême, la Cour constitutionnelle et les médias publics restent partiellement sous influence du PiS. La Commission européenne a annoncé le déblocage de 35 milliards d'euros de fonds conditionnellement.",tag:"EUROPE",tagC:"#2B78F5",time:h(36),source:"Le Figaro / Reuters",sourceUrl:"https://lefigaro.fr",verified:true,verifiedLabel:"Source vérifiée",likes:287,comments:64},
  {id:"demo11",profileId:"dp18",title:"Féminisme et Islam : le faux débat ?",text:"La question du voile en France continue de diviser. Mais le débat tel qu'il est posé — laïcité vs religion — occulte la voix des premières concernées. Des études sociologiques récentes (CNRS, 2023) montrent que 67% des femmes portant le hijab en France le vivent comme un choix personnel, non comme une contrainte. La conflation entre patriarcat islamique et pratique religieuse volontaire nuit à la fois à la laïcité et au féminisme. Les femmes musulmanes ne sont pas un objet de politique publique.",tag:"SOCIÉTÉ",tagC:"#16A34A",time:h(40),source:"CNRS / Revue française de sociologie",sourceUrl:"https://www.cnrs.fr",verified:false,likes:1240,comments:398},
  {id:"demo12",profileId:"dp20",title:"Gaza 2024 : le droit international à l'épreuve",text:"Plus de 35 000 morts civils documentés (ONU, mai 2024), des hôpitaux détruits, des convois humanitaires bloqués. La CIJ a ordonné à Israël de prendre des mesures pour prévenir les actes de génocide (26 janvier 2024), sans ordonner de cessez-le-feu. La CPI a demandé des mandats d'arrêt contre Netanyahou, Gallant et des dirigeants du Hamas. La question centrale : quand le droit international n'est pas appliqué, que vaut-il ?",tag:"DROIT",tagC:"#7C3AED",time:h(44),source:"Cour pénale internationale / ONU",sourceUrl:"https://www.icc-cpi.int",verified:true,verifiedLabel:"Sources officielles",likes:2890,comments:745},
  {id:"demo13",profileId:"dp23",title:"Union Africaine : réformes institutionnelles en cours",text:"La réforme de l'Union Africaine, engagée depuis 2016 sous l'impulsion du rapport Kagame, avance lentement. L'UA cherche à réduire sa dépendance aux financements extérieurs (actuellement 60% du budget provient de l'UE et des USA) en augmentant les contributions nationales et en levant un prélèvement de 0,2% sur les importations. La Zone de libre-échange continentale africaine (ZLECAF), opérationnelle depuis 2021, représente un marché potentiel de 1,3 milliard de personnes.",tag:"AFRIQUE",tagC:"#D97706",time:h(50),source:"Commission de l'Union Africaine",sourceUrl:"https://au.int",verified:true,verifiedLabel:"Source institutionnelle",likes:431,comments:89},
  {id:"demo14",profileId:"dp27",title:"Rawls contre Sandel : la justice entre liberté et communauté",text:"Le débat philosophique entre John Rawls et Michael Sandel reste l'un des plus féconds de la philosophie politique contemporaine. Pour Rawls, la justice exige un voile d'ignorance : nous devons décider des règles sans savoir quelle position nous occuperons dans la société. Pour Sandel, cette abstraction est impossible et indésirable : nous sommes des êtres situés, définis par nos communautés, et la politique doit en tenir compte. Ce débat éclaire directement les tensions actuelles entre libéralisme et populisme.",tag:"PHILOSOPHIE",tagC:"#7C3AED",time:h(55),source:"Harvard Political Review",sourceUrl:"https://harvardpolitics.com",verified:false,likes:678,comments:156,mediaType:"photo",mediaBg:"linear-gradient(135deg,#7C3AED,#2B78F5)"},
  {id:"demo15",profileId:"dp2",title:"Desinformation : l'Europe contre les réseaux sociaux",text:"Le Digital Services Act (DSA) de l'UE, entré en vigueur en 2023, oblige les très grandes plateformes (META, X, TikTok, Google) à évaluer et réduire les risques systémiques, dont la désinformation. Les premières enquêtes de la Commission révèlent des manquements graves de X (ex-Twitter) : amplification de contenus violents, insuffisance des modèles de transparence. L'UE peut infliger des amendes jusqu'à 6% du CA mondial — un outil inédit.",tag:"NUMÉRIQUE",tagC:"#2B78F5",time:h(60),source:"Commission européenne / DSA",sourceUrl:"https://ec.europa.eu",verified:true,verifiedLabel:"Source officielle UE",likes:543,comments:121},
  {id:"demo16",profileId:"dp3",title:"L'extrême droite en Europe : une vague ou un raz-de-marée ?",text:"Aux élections européennes de juin 2024, les partis d'extrême droite ont progressé dans la quasi-totalité des États membres mais sans atteindre la majorité absolue. Le groupe ECR (dont FdI de Meloni) et ID (dont le RN) totalisent ~23% des sièges. Ils restent exclus des coalitions gouvernementales au niveau européen, mais leur influence sur le discours — migration, sécurité, identité — est considérable. L'extrême droite joue désormais le rôle de faiseur d'agenda.",tag:"EUROPE",tagC:"#2B78F5",time:h(68),source:"EuropeElects / Politico",sourceUrl:"https://politico.eu",verified:true,verifiedLabel:"Données électorales",likes:892,comments:234,mediaType:"video",mediaBg:"linear-gradient(135deg,#2B78F5,#E03535)"},
  {id:"demo17",profileId:"dp25",title:"François Bayrou Premier ministre : enjeux et défis",text:"La nomination de François Bayrou comme Premier ministre en décembre 2024 signe le retour du centrisme historique au sommet de l'exécutif. Chef du MoDem depuis 1994, il dispose d'une connaissance encyclopédique des institutions mais d'une majorité parlementaire inexistante. Sa priorité affichée : le redressement des finances publiques avec un déficit à 6% du PIB. La question de la réforme des retraites, restée dans les esprits, sera le premier test de sa capacité à gouverner sans majorité.",tag:"POLITIQUE",tagC:"#E03535",time:h(72),source:"France Info / Le Monde",sourceUrl:"https://lemonde.fr",verified:true,verifiedLabel:"Source journalistique",likes:1120,comments:367},
  {id:"demo18",profileId:"dp29",title:"Services de renseignement : la réforme silencieuse",text:"La loi de programmation du renseignement 2023-2027 a considérablement élargi les capacités de surveillance de la DGSI et de la DGSE. Le cadre légal des 'boîtes noires' algorithmiques permettant d'analyser les flux de communication en temps réel a été étendu. Ces dispositifs, défendus au nom de la lutte antiterroriste, soulèvent des questions fondamentales sur le respect de la vie privée et l'équilibre entre sécurité nationale et libertés individuelles.",tag:"SÉCURITÉ",tagC:"#D97706",time:h(78),source:"Légifrance / CNCTR",sourceUrl:"https://www.legifrance.gouv.fr",verified:true,verifiedLabel:"Source officielle",likes:387,comments:94},
  {id:"demo19",profileId:"dp6",title:"Inégalités en France : le rapport Piketty 2024",text:"La France reste l'un des pays les moins inégalitaires de l'OCDE en termes de revenus, mais les inégalités de patrimoine ont fortement augmenté depuis 2010. Le 1% le plus riche détient désormais 25% du patrimoine total. La réforme de l'ISF en IFI (2018) a surtout bénéficié aux très hauts patrimoines sans effets mesurables sur l'investissement productif. Thomas Piketty préconise un impôt mondial sur la fortune, idée qui progresse lentement dans les enceintes du G20.",tag:"ÉCONOMIE",tagC:"#16A34A",time:h(85),source:"World Inequality Lab / EHESS",sourceUrl:"https://wid.world",verified:false,likes:654,comments:178},
  {id:"demo20",profileId:"dp15",title:"Le procès de Lubanga 20 ans après : bilan de la CPI",text:"La condamnation de Thomas Lubanga Dyilo en 2012 pour enrôlement d'enfants soldats fut la première décision de la CPI. 20 ans après sa création, le bilan est mitigé : 30 condamnations, mais des acquittements symboliques (Laurent Gbagbo), des fugitifs toujours en liberté (Kony, Bashir), et une légitimité contestée par les puissances non membres. La justice pénale internationale progresse mais ne peut s'appliquer qu'avec la coopération des États.",tag:"DROIT",tagC:"#7C3AED",time:h(92),source:"CPI / coalition pour la CPI",sourceUrl:"https://www.icc-cpi.int",verified:true,verifiedLabel:"Source officielle CPI",likes:298,comments:67},
];

// ── NOTIFICATIONS ──────────────────────────────────────────────
const NOTIFICATIONS_DATA = [
  {id:"n1",type:"follow",text:"Amira Konaté vous suit désormais",profile:"AK",color:"#2B78F5",time:h(0.5)},
  {id:"n2",type:"like",text:"Baptiste Renard a aimé votre analyse",profile:"BR",color:"#16A34A",time:h(1)},
  {id:"n3",type:"comment",text:"Daouda Traoré a commenté votre publication : \"Analyse très pertinente, je partage ce constat...\"",profile:"DT",color:"#D97706",time:h(2)},
  {id:"n4",type:"share",text:"Elena Vasquez a partagé votre publication",profile:"EV",color:"#E03535",time:h(3)},
  {id:"n5",type:"follow",text:"Hassan Al-Rashid vous suit désormais",profile:"HR",color:"#7C3AED",time:h(5)},
  {id:"n6",type:"mention",text:"Giulia Ferrari vous a mentionné dans un commentaire",profile:"GF",color:"#16A34A",time:h(8)},
  {id:"n7",type:"like",text:"Jonas Weber et 12 autres ont aimé votre publication",profile:"JW",color:"#E03535",time:h(12)},
  {id:"n8",type:"comment",text:"Layla Benali a commenté : \"Je recommande aussi la source RSF pour compléter.\"",profile:"LB",color:"#16A34A",time:h(15)},
  {id:"n9",type:"follow",text:"Priya Sharma vous suit désormais",profile:"PS",color:"#2B78F5",time:h(20)},
  {id:"n10",type:"share",text:"William Osei a partagé votre analyse sur l'UA",profile:"WO",color:"#7C3AED",time:h(24)},
  {id:"n11",type:"comment",text:"Antoine Lefebvre a commenté : \"Rawls dirait que le voile d'ignorance s'applique précisément ici...\"",profile:"AL",color:"#16A34A",time:h(28)},
  {id:"n12",type:"like",text:"Yasmine Dubois et 34 autres ont aimé votre publication",profile:"YD",color:"#E03535",time:h(36)},
  {id:"n13",type:"follow",text:"Nadia Petrov vous suit désormais",profile:"NP",color:"#D97706",time:h(40)},
  {id:"n14",type:"share",text:"Cédric Martin a partagé votre article",profile:"CM",color:"#D97706",time:h(48)},
  {id:"n15",type:"mention",text:"Zara Nkosi vous a mentionné dans sa story",profile:"ZN",color:"#2B78F5",time:h(56)},
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
function TopicPicker({topic,setTopic,T,onPremium}:{topic:string;setTopic:(t:string)=>void;T:Theme;onPremium:()=>void}) {
  const [catId,setCatId] = useState<string|null>(null);
  const cat = DEBATE_CATEGORIES.find(c=>c.id===catId);
  return (
    <div>
      <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Sujet du débat</p>
      {topic&&<p style={{color:T.blueB,fontSize:12,fontWeight:600,marginBottom:8,padding:"6px 10px",background:T.blueG,borderRadius:8}}>✓ {topic.slice(0,50)}{topic.length>50?"…":""}</p>}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
        {DEBATE_CATEGORIES.map(c=>(
          <button key={c.id} onClick={()=>setCatId(catId===c.id?null:c.id)} style={{padding:"5px 11px",borderRadius:20,border:`1.5px solid ${catId===c.id?(c as {color:string}).color:T.b1}`,background:catId===c.id?`${(c as {color:string}).color}18`:T.card,color:catId===c.id?(c as {color:string}).color:T.textD,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .2s",display:"flex",alignItems:"center",gap:5}}>
            <Ic n={(c as {icon:string}).icon} s={11} c={catId===c.id?(c as {color:string}).color:T.textD}/>
            {c.label}
          </button>
        ))}
      </div>
      {cat&&(
        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:240,overflowY:"auto",border:`1px solid ${T.b1}`,borderRadius:10,padding:8}}>
          {cat.topics.map((t,i)=>{
            const isPrem = i>=5;
            return(
              <button key={t} onClick={()=>{if(isPrem){onPremium();}else{setTopic(t);setCatId(null);}}} style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${isPrem?T.amber+"40":topic===t?T.blueB:T.b1}`,background:topic===t&&!isPrem?T.blueG:isPrem?`${T.amber}08`:"transparent",cursor:"pointer",textAlign:"left",color:isPrem?T.amber:topic===t?T.blueB:T.text,fontSize:12,fontWeight:topic===t?700:400,transition:"all .15s",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                <span>{t}</span>
                {isPrem&&<Ic n="lock" s={11} c={T.amber}/>}
              </button>
            );
          })}
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
function StudioScreen({T,onPremium}:{T:Theme;onPremium:()=>void}) {
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
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16,height:"100%",overflowY:"auto",boxSizing:"border-box"}}>
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
      <TopicPicker topic={topic} setTopic={setTopic} T={T} onPremium={onPremium}/>
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
type LiveArticle = {id:string;title:string;src:string;tag:string;tagC:string;time:string;imgUrl:string|null;videoUrl?:string;link:string;verif?:{label:string;color:string}};

function getYtId(url:string):string|null{
  const m=url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m?m[1]:null;
}

function parseRawRSS(xml:string):{title:string;link:string;pubDate:string;guid:string;thumbnail:string|undefined;videoUrl:string|undefined}[]{
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
      const videoUrl=el.querySelector("enclosure[type^='video']")?.getAttribute("url")
        ||undefined;
      return{title:txt("title"),link,pubDate:txt("pubDate")||txt("published"),guid:txt("guid")||link,thumbnail:thumb,videoUrl};
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
function timeFromTs(ts:number):string{
  const diff=Date.now()-ts;
  if(diff<3600000) return `${Math.max(1,Math.floor(diff/60000))}min`;
  if(diff<86400000) return `${Math.floor(diff/3600000)}h`;
  if(diff<604800000) return `${Math.floor(diff/86400000)}j`;
  return new Date(ts).toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
}
const TAG_IMG_POOLS: Record<string,string[]> = {
  "GÉOPOLITIQUE":["photo-1541872703-74c5e44368f9","photo-1569950044272-e4ef57e0e29b","photo-1551288049-bebda4e38f71","photo-1453928582365-b6ad33cbcf64"],
  "DIPLOMATIE":["photo-1569950044272-e4ef57e0e29b","photo-1541872703-74c5e44368f9","photo-1453928582365-b6ad33cbcf64","photo-1529107386315-e1a2ed48a620"],
  "CONFLITS":["photo-1582481725274-d63bdf929a90","photo-1541872703-74c5e44368f9","photo-1569950044272-e4ef57e0e29b","photo-1453928582365-b6ad33cbcf64"],
  "GUERRE":["photo-1582481725274-d63bdf929a90","photo-1541872703-74c5e44368f9","photo-1569950044272-e4ef57e0e29b","photo-1529107386315-e1a2ed48a620"],
  "UKRAINE":["photo-1582481725274-d63bdf929a90","photo-1541872703-74c5e44368f9","photo-1569950044272-e4ef57e0e29b","photo-1453928582365-b6ad33cbcf64"],
  "ONU":["photo-1541872703-74c5e44368f9","photo-1569950044272-e4ef57e0e29b","photo-1529107386315-e1a2ed48a620","photo-1453928582365-b6ad33cbcf64"],
  "UNESCO":["photo-1481627834876-b7833e8f5570","photo-1523050854058-8df90110c9f1","photo-1507003211169-0a1dd7228f2d","photo-1541872703-74c5e44368f9"],
  "UNICEF":["photo-1532375810709-75b1da00537c","photo-1523050854058-8df90110c9f1","photo-1481627834876-b7833e8f5570","photo-1569950044272-e4ef57e0e29b"],
  "POLITIQUE":["photo-1540910419892-4a36d2c3266c","photo-1529107386315-e1a2ed48a620","photo-1541872703-74c5e44368f9","photo-1453928582365-b6ad33cbcf64"],
  "ÉLECTIONS":["photo-1540910419892-4a36d2c3266c","photo-1529107386315-e1a2ed48a620","photo-1551288049-bebda4e38f71","photo-1569950044272-e4ef57e0e29b"],
  "ÉCONOMIE":["photo-1551288049-bebda4e38f71","photo-1529107386315-e1a2ed48a620","photo-1453928582365-b6ad33cbcf64","photo-1540910419892-4a36d2c3266c"],
  "ÉDUCATION":["photo-1523050854058-8df90110c9f1","photo-1481627834876-b7833e8f5570","photo-1507003211169-0a1dd7228f2d","photo-1532375810709-75b1da00537c"],
  "SCIENCE":["photo-1507003211169-0a1dd7228f2d","photo-1523050854058-8df90110c9f1","photo-1551288049-bebda4e38f71","photo-1481627834876-b7833e8f5570"],
  "MÉDECINE":["photo-1532375810709-75b1da00537c","photo-1507003211169-0a1dd7228f2d","photo-1523050854058-8df90110c9f1","photo-1551288049-bebda4e38f71"],
  "ESPACE":["photo-1541697418-d4b63bda48a2","photo-1507003211169-0a1dd7228f2d","photo-1551288049-bebda4e38f71","photo-1523050854058-8df90110c9f1"],
  "CLIMAT":["photo-1504711434969-e33886168f5c","photo-1532375810709-75b1da00537c","photo-1481627834876-b7833e8f5570","photo-1507003211169-0a1dd7228f2d"],
  "CULTURE":["photo-1481627834876-b7833e8f5570","photo-1523050854058-8df90110c9f1","photo-1507003211169-0a1dd7228f2d","photo-1532375810709-75b1da00537c"],
  "HISTOIRE":["photo-1481627834876-b7833e8f5570","photo-1453928582365-b6ad33cbcf64","photo-1541872703-74c5e44368f9","photo-1507003211169-0a1dd7228f2d"],
  "IA":["photo-1551288049-bebda4e38f71","photo-1507003211169-0a1dd7228f2d","photo-1529107386315-e1a2ed48a620","photo-1523050854058-8df90110c9f1"],
  "TECH":["photo-1551288049-bebda4e38f71","photo-1507003211169-0a1dd7228f2d","photo-1529107386315-e1a2ed48a620","photo-1541697418-d4b63bda48a2"],
  "IMMIGRATION":["photo-1532375810709-75b1da00537c","photo-1569950044272-e4ef57e0e29b","photo-1453928582365-b6ad33cbcf64","photo-1504711434969-e33886168f5c"],
  "GAZA":["photo-1582481725274-d63bdf929a90","photo-1541872703-74c5e44368f9","photo-1569950044272-e4ef57e0e29b","photo-1453928582365-b6ad33cbcf64"],
  "SAHEL":["photo-1504711434969-e33886168f5c","photo-1532375810709-75b1da00537c","photo-1569950044272-e4ef57e0e29b","photo-1541872703-74c5e44368f9"],
  "SPORT":["photo-1540910419892-4a36d2c3266c","photo-1529107386315-e1a2ed48a620","photo-1551288049-bebda4e38f71","photo-1453928582365-b6ad33cbcf64"],
};
const FALLBACK_POOL=["photo-1541872703-74c5e44368f9","photo-1569950044272-e4ef57e0e29b","photo-1551288049-bebda4e38f71","photo-1481627834876-b7833e8f5570","photo-1532375810709-75b1da00537c","photo-1523050854058-8df90110c9f1","photo-1504711434969-e33886168f5c","photo-1507003211169-0a1dd7228f2d"];
function getFallbackImg(tag:string,seed:string=""):string{
  const pool=TAG_IMG_POOLS[tag]||TAG_IMG_POOLS[Object.keys(TAG_IMG_POOLS).find(k=>tag.includes(k))||""]||FALLBACK_POOL;
  const hash=(seed+tag).split("").reduce((a,c)=>a+c.charCodeAt(0),0);
  return `https://images.unsplash.com/${pool[hash%pool.length]}?w=700&q=70`;
}
function interleave<T extends {src:string}>(items:T[]):T[]{
  const groups=new Map<string,T[]>();
  for(const item of items){if(!groups.has(item.src))groups.set(item.src,[]);groups.get(item.src)!.push(item);}
  const sources=[...groups.values()];
  const result:T[]=[];
  let i=0;
  while(result.length<items.length){
    let added=false;
    for(let j=0;j<sources.length;j++){const s=sources[(i+j)%sources.length];if(s.length){result.push(s.shift()!);added=true;break;}}
    if(!added)break;
    i++;
  }
  return result;
}

async function fetchLiveNews(onChunk?:(articles:LiveArticle[])=>void): Promise<LiveArticle[]> {
  const seen=new Set<string>();
  const all: LiveArticle[] = [];
  const rssKey = typeof window!=="undefined"?localStorage.getItem("rss2json_key")||"":"";
  const fetchOne=async(src:typeof RSS_SOURCES[0])=>{
    try{
      type RSSItem={title:string;link:string;pubDate?:string;published?:string;guid?:string;thumbnail?:string|null;enclosure?:{link?:string;type?:string}};
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
        const lnk=item.link||"";
        const ytId=getYtId(lnk);
        const encVideo=item.enclosure?.type?.startsWith("video")?item.enclosure.link:undefined;
        const encImg=(!item.enclosure?.type||item.enclosure.type.startsWith("image"))?item.enclosure?.link:undefined;
        const parsedVideo=(item as {videoUrl?:string}).videoUrl;
        const a:LiveArticle={id,title,src:src.name,tag:src.tag,tagC:src.tagC,
          time:makeTimeStr(item.pubDate||item.published||""),
          imgUrl:item.thumbnail||encImg||null,
          videoUrl:ytId?`yt:${ytId}`:(encVideo||parsedVideo||undefined),
          link:lnk};
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
  const [storyIdx,setStoryIdx] = useState<number|null>(null);
  const [storyProgress,setStoryProgress] = useState(0);
  const storyTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const storyProgressRef = useRef<ReturnType<typeof setInterval>|null>(null);
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

  useEffect(()=>{
    if(storyProgressRef.current) clearInterval(storyProgressRef.current);
    if(storyTimerRef.current) clearTimeout(storyTimerRef.current);
    if(storyIdx===null){setStoryProgress(0);return;}
    setStoryProgress(0);
    storyProgressRef.current = setInterval(()=>setStoryProgress(p=>Math.min(p+1,100)),55);
    storyTimerRef.current = setTimeout(()=>{
      setStoryIdx(i=>i!==null&&i<ALL_STORIES.length-1?i+1:null);
    },5500);
    return()=>{
      if(storyProgressRef.current) clearInterval(storyProgressRef.current);
      if(storyTimerRef.current) clearTimeout(storyTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storyIdx]);

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
                <p style={{color:T.amber,fontSize:11,fontWeight:600}}>Configurez votre clé Gemini dans Profil → Réglages pour activer la vérification IA automatique</p>
              </div>
            )}
            <button onClick={publishPost} disabled={!composed.trim()||verifying} style={{padding:15,borderRadius:12,border:"none",background:composed.trim()&&!verifying?T.blueB:T.b1,color:composed.trim()&&!verifying?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:composed.trim()&&!verifying?"pointer":"not-allowed",fontFamily:"inherit",transition:"background .2s"}}>
              {verifying?"Vérification IA en cours…":"Publier"}
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
      {/* Story viewer modal */}
      {storyIdx!==null&&(()=>{
        const s = ALL_STORIES[storyIdx] as any;
        const st = s.story;
        const isWisdom = !!st.quote;
        const hasPrev = storyIdx>0;
        const hasNext = storyIdx<ALL_STORIES.length-1;
        const goNext=()=>{if(storyProgressRef.current)clearInterval(storyProgressRef.current);if(storyTimerRef.current)clearTimeout(storyTimerRef.current);if(hasNext)setStoryIdx(storyIdx+1);else setStoryIdx(null);};
        const goPrev=()=>{if(storyProgressRef.current)clearInterval(storyProgressRef.current);if(storyTimerRef.current)clearTimeout(storyTimerRef.current);if(hasPrev)setStoryIdx(storyIdx-1);};
        return(
          <div style={{position:"fixed",inset:0,zIndex:500,background:"#000",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn .15s"}}>
            <div style={{width:"100%",maxWidth:430,height:"100%",position:"relative",overflow:"hidden"}}>
              {/* Real image background */}
              {st.imgUrl&&<img src={st.imgUrl} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",opacity:.45}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>}
              {/* Gradient overlay */}
              <div style={{position:"absolute",inset:0,background:st.bg||`linear-gradient(135deg,${s.color||"#2B78F5"},#7C3AED)`}}/>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,rgba(0,0,0,.4) 0%,transparent 40%,transparent 50%,rgba(0,0,0,.7) 100%)"}}/>
              {/* Progress bar */}
              <div style={{position:"absolute",top:16,left:12,right:12,height:3,background:"rgba(255,255,255,.3)",borderRadius:2}}>
                <div style={{height:"100%",width:`${storyProgress}%`,background:"rgba(255,255,255,.95)",borderRadius:2,transition:"width .05s linear"}}/>
              </div>
              {/* Header */}
              <div style={{position:"absolute",top:28,left:16,right:48,display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:"rgba(255,255,255,.2)",border:"2px solid rgba(255,255,255,.6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",flexShrink:0}}>
                  {s.init?.slice(0,2)||"N"}
                </div>
                <div>
                  <p style={{color:"#fff",fontWeight:700,fontSize:13,lineHeight:1.2}}>{s.name}</p>
                  <p style={{color:"rgba(255,255,255,.7)",fontSize:10,lineHeight:1.2}}>{s.role}</p>
                </div>
                {st.type==="video"&&<span style={{marginLeft:"auto",background:"rgba(255,0,0,.7)",color:"#fff",fontSize:10,padding:"3px 8px",borderRadius:8,fontWeight:700}}>▶ VIDÉO</span>}
                {st.type==="proverbe"&&<span style={{marginLeft:"auto",background:"rgba(217,119,6,.7)",color:"#fff",fontSize:10,padding:"3px 8px",borderRadius:8,fontWeight:700}}>💬 PROVERBE</span>}
                {st.type==="philosophe"&&<span style={{marginLeft:"auto",background:"rgba(124,58,237,.7)",color:"#fff",fontSize:10,padding:"3px 8px",borderRadius:8,fontWeight:700}}>🏛️ PHILOSOPHIE</span>}
                {st.type==="auteur"&&<span style={{marginLeft:"auto",background:"rgba(43,120,245,.7)",color:"#fff",fontSize:10,padding:"3px 8px",borderRadius:8,fontWeight:700}}>📚 LITTÉRATURE</span>}
                {st.type==="bible"&&<span style={{marginLeft:"auto",background:"rgba(217,119,6,.85)",color:"#fff",fontSize:10,padding:"3px 8px",borderRadius:8,fontWeight:700}}>✝ BIBLE</span>}
              </div>
              {/* Content center */}
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:"80px 24px 160px"}}>
                {!isWisdom&&st.type==="photo"&&(
                  <div style={{textAlign:"center"}}>
                    <div style={{width:80,height:80,borderRadius:20,background:"rgba(255,255,255,.15)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}>
                      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                    <p style={{color:"rgba(255,255,255,.55)",fontSize:11,marginTop:10}}>📸 {s.location||""}</p>
                  </div>
                )}
                {!isWisdom&&st.type==="video"&&(
                  <div style={{textAlign:"center"}}>
                    <div style={{width:80,height:80,borderRadius:"50%",background:"rgba(255,255,255,.15)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}>
                      <svg viewBox="0 0 24 24" width="36" height="36" fill="rgba(255,255,255,.8)"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                    <p style={{color:"rgba(255,255,255,.55)",fontSize:11,marginTop:10}}>🎬 {s.location||""}</p>
                  </div>
                )}
                {isWisdom&&(
                  <div style={{textAlign:"center"}}>
                    <p style={{color:"rgba(255,255,255,.3)",fontSize:48,lineHeight:1,marginBottom:8}}>&ldquo;</p>
                    <p style={{color:"#fff",fontSize:16,fontWeight:600,lineHeight:1.6,textAlign:"center",textShadow:"0 2px 8px rgba(0,0,0,.5)"}}>{st.quote}</p>
                    <p style={{color:"rgba(255,255,255,.3)",fontSize:48,lineHeight:1,marginTop:4}}>&rdquo;</p>
                  </div>
                )}
              </div>
              {/* Caption / attribution box */}
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"16px 20px 36px"}}>
                <div style={{background:"rgba(0,0,0,.5)",backdropFilter:"blur(12px)",borderRadius:16,padding:"14px 16px"}}>
                  {isWisdom?(
                    <>
                      <p style={{color:"rgba(255,255,255,.9)",fontSize:13,fontWeight:700,lineHeight:1.4}}>— {st.attribution}</p>
                      <p style={{color:"rgba(255,255,255,.4)",fontSize:10,marginTop:4,textTransform:"uppercase",letterSpacing:.8}}>
                        {st.type==="proverbe"?"Proverbe":st.type==="philosophe"?"Philosophie":st.type==="auteur"?"Littérature":st.type==="bible"?"Paroles sacrées":"Sagesse"}
                      </p>
                    </>
                  ):(
                    <>
                      <p style={{color:"#fff",fontSize:14,lineHeight:1.5,fontWeight:500}}>{st.caption}</p>
                      <p style={{color:"rgba(255,255,255,.45)",fontSize:10,marginTop:6}}>{s.role} · {s.location}</p>
                    </>
                  )}
                </div>
              </div>
              {/* Tap zones */}
              <div onClick={goPrev} style={{position:"absolute",left:0,top:56,bottom:0,width:"38%",cursor:hasPrev?"pointer":"default"}}/>
              <div onClick={goNext} style={{position:"absolute",right:0,top:56,bottom:0,width:"62%",cursor:"pointer"}}/>
              {/* Close button */}
              <button onClick={()=>setStoryIdx(null)} style={{position:"absolute",top:28,right:16,width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,.2)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10}}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="#fff" strokeWidth="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        );
      })()}
      {/* Stories */}
      <div style={{padding:"10px 20px",borderBottom:`1px solid ${T.b1}`,display:"flex",gap:12,overflowX:"auto"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flexShrink:0}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:T.blueG,border:`1.5px dashed ${T.blueB}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="plus" s={18} c={T.blueB}/></div>
          <span style={{fontSize:10,color:T.muted,fontWeight:600}}>Ma story</span>
        </div>
        {ALL_STORIES.map((p,i)=>{
          const st = (p as any).story;
          const isWisdom = !!st.quote;
          const icon = st.type==="proverbe"?"💬":st.type==="philosophe"?"🏛️":st.type==="auteur"?"📚":st.type==="bible"?"✝":"📖";
          return(
            <div key={i} onClick={()=>{setStoryIdx(i);}} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flexShrink:0,cursor:"pointer"}}>
              <div style={{width:52,height:52,borderRadius:"50%",padding:2,background:st.bg||`linear-gradient(135deg,${(p as any).color||"#2B78F5"},#7C3AED)`}}>
                {isWisdom?(
                  <div style={{width:"100%",height:"100%",borderRadius:"50%",background:"rgba(0,0,0,.35)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>
                    {icon}
                  </div>
                ):(
                  <div style={{width:"100%",height:"100%",borderRadius:"50%",background:"#fff",border:"2px solid rgba(255,255,255,.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:(p as any).color||"#2B78F5",position:"relative"}}>
                    {(p as any).init?.slice(0,2)||"?"}
                    {(p as any).verified&&<div style={{position:"absolute",bottom:-1,right:-1,width:14,height:14,borderRadius:"50%",background:"#2B78F5",border:"1.5px solid #fff",display:"flex",alignItems:"center",justifyContent:"center"}}><svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>}
                    {st.type==="video"&&<div style={{position:"absolute",top:-2,right:-2,width:14,height:14,borderRadius:"50%",background:"#E03535",border:"1.5px solid #fff",display:"flex",alignItems:"center",justifyContent:"center"}}><svg viewBox="0 0 24 24" width="7" height="7" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>}
                  </div>
                )}
              </div>
              <span style={{fontSize:9,color:T.textD,fontWeight:600,maxWidth:52,textAlign:"center",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
                {(p as any).name.split(" ")[0]}
              </span>
            </div>
          );
        })}
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
                    <span style={{color:T.muted,fontSize:11}}>· {timeFromTs(p.id)}</span>
                  </div>
                </div>
              </div>
              <div style={{padding:"4px 14px 10px"}}>
                <p style={{color:T.text,fontSize:14,lineHeight:1.6}}>{p.text}</p>
                {p.verif&&<p style={{color:p.verif.color,fontSize:11,marginTop:6,fontWeight:600}}>Analyse IA : {p.verif.comment}</p>}
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
      {/* Mixed feed: demo community posts + NEXUS official, sorted by time */}
      {(()=>{
        const D_MAP: Record<string,string[]> = {"Géopolitique":["GÉOPOLITIQUE","SÉCURITÉ"],"Diplomatie":["DIPLOMATIE"],"Histoire":["HISTOIRE"],"Droit":["DROIT"],"Élections":["POLITIQUE","ÉLECTIONS"],"Europe":["EUROPE"],"Afrique":["AFRIQUE"]};
        const N_MAP: Record<string,string[]> = {"Géopolitique":["GÉOPOLITIQUE","GUERRE","DIPLOMATIE","INTERNATIONAL"],"Diplomatie":["DIPLOMATIE"],"Histoire":["HISTOIRE"],"Droit":["DROIT","IMMIGRATION"],"Élections":["ÉLECTIONS","POLITIQUE"],"Europe":["EUROPE","DIPLOMATIE"],"Afrique":["AFRIQUE"]};
        const kd = filter!=="Tout"?D_MAP[filter]||[]:null;
        const kn = filter!=="Tout"?N_MAP[filter]||[]:null;
        const demoFiltered = DEMO_POSTS.filter(p=>{
          const sm = !search||p.title.toLowerCase().includes(search.toLowerCase())||p.text.toLowerCase().includes(search.toLowerCase());
          const tm = !kd||kd.some(k=>p.tag.toUpperCase().includes(k)||p.title.toUpperCase().includes(k));
          return sm&&tm;
        }).map(p=>({kind:"demo" as const, ts:p.time, p}));
        const nexusFiltered = interleave(nexusPosts.filter(p=>{
          const sm = !search||p.title.toLowerCase().includes(search.toLowerCase())||p.src.toLowerCase().includes(search.toLowerCase());
          const tm = !kn||kn.some(k=>p.tag.toUpperCase().includes(k)||p.title.toUpperCase().includes(k));
          return sm&&tm;
        })).slice(0,100).map(p=>({kind:"nexus" as const, ts:p.publishedAt||0, p}));
        const merged = [...demoFiltered,...nexusFiltered].sort((a,b)=>b.ts-a.ts);
        return(
          <div style={{display:"flex",flexDirection:"column"}}>
            {merged.map(item=>{
              if(item.kind==="demo"){
                const p=item.p;
                const prof=DEMO_PROFILES.find(d=>d.id===p.profileId)!;
                return(
                  <div key={p.id} style={{background:T.card,borderBottom:`1px solid ${T.b1}`,animation:"fadeUp .4s ease"}}>
                    <div style={{padding:"12px 16px 8px",display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:38,height:38,borderRadius:"50%",background:`${prof?.color||T.blueB}20`,border:`1.5px solid ${prof?.color||T.blueB}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:prof?.color||T.blueB,flexShrink:0,position:"relative"}}>
                        {(prof?.init||"?").slice(0,2)}
                        {prof?.verified&&<div style={{position:"absolute",bottom:-1,right:-1,width:13,height:13,borderRadius:"50%",background:T.blueB,border:`1.5px solid ${T.card}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="check" s={7} c="#fff"/></div>}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span style={{color:T.text,fontWeight:700,fontSize:13}}>{prof?.name||"Utilisateur"}</span>
                          {prof?.verified&&<span style={{background:`${T.blueB}20`,color:T.blueB,fontSize:9,padding:"2px 6px",borderRadius:4,fontWeight:800}}>✓ Vérifié</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2,flexWrap:"wrap"}}>
                          <Tag label={p.tag} color={p.tagC} small/>
                          <span style={{color:T.muted,fontSize:10}}>· {timeFromTs(p.time)}</span>
                          <span style={{color:T.muted,fontSize:10}}>· {prof?.role}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{padding:"0 16px 10px"}}>
                      <p style={{color:T.text,fontSize:14,fontWeight:700,lineHeight:1.5,marginBottom:6}}>{p.title}</p>
                      <p style={{color:T.textD,fontSize:13,lineHeight:1.6}}>{p.text}</p>
                      {p.mediaType&&(
                        <div style={{margin:"10px -16px 0",height:180,background:p.mediaBg||T.bg2,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8,position:"relative",overflow:"hidden"}}>
                          <div style={{width:52,height:52,borderRadius:"50%",background:"rgba(0,0,0,.35)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            <Ic n={p.mediaType==="video"?"play":"image"} s={24} c="#fff"/>
                          </div>
                          <span style={{color:"rgba(255,255,255,.85)",fontSize:11,fontWeight:700,letterSpacing:.5,textTransform:"uppercase"}}>{p.mediaType==="video"?"Vidéo":"Photo"}</span>
                          {p.mediaType==="video"&&(
                            <div style={{position:"absolute",top:8,right:10,background:"rgba(0,0,0,.65)",borderRadius:4,padding:"2px 8px",display:"flex",alignItems:"center",gap:5}}>
                              <div style={{width:6,height:6,borderRadius:"50%",background:"#E03535"}}/>
                              <span style={{color:"#fff",fontSize:10,fontWeight:700}}>VIDÉO</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{marginTop:8,padding:"6px 10px",background:p.verified?`${T.blueB}08`:`${T.amber}08`,border:`1px solid ${p.verified?T.blueB+"30":T.amber+"30"}`,borderRadius:8,display:"flex",alignItems:"center",gap:6}}>
                        <Ic n={p.verified?"check":"info"} s={11} c={p.verified?T.blueB:T.amber}/>
                        <span style={{color:p.verified?T.blueB:T.amber,fontSize:10,fontWeight:700}}>{p.verified?"Source vérifiée":"Non vérifié"} · {p.source}</span>
                      </div>
                    </div>
                    <div style={{padding:"8px 16px 12px",display:"flex",alignItems:"center",borderTop:`1px solid ${T.b1}`,gap:4}}>
                      <button style={{display:"flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"4px 8px"}}>
                        <Ic n="heart" s={15} c={T.textD}/><span style={{fontSize:12,fontWeight:600}}>{p.likes}</span>
                      </button>
                      <button style={{display:"flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"4px 8px"}}>
                        <Ic n="msg" s={15} c={T.textD}/><span style={{fontSize:12,fontWeight:600}}>{p.comments}</span>
                      </button>
                      <button style={{display:"flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"4px 8px"}}>
                        <Ic n="share" s={15} c={T.textD}/>
                      </button>
                      <button onClick={onDebate} style={{marginLeft:"auto",background:T.blueG,border:`1px solid ${T.blueB}40`,borderRadius:8,padding:"5px 12px",color:T.blueB,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Débattre</button>
                    </div>
                  </div>
                );
              } else {
                const p=item.p;
                return(
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
                          <span style={{color:T.muted,fontSize:11}}>· {timeFromTs(p.publishedAt||Date.now())}</span>
                          <span style={{color:T.muted,fontSize:11}}>· {p.src}</span>
                        </div>
                      </div>
                    </div>
                    {(()=>{
                      const ytId=p.videoUrl?.startsWith("yt:")?p.videoUrl.slice(3):null;
                      const directVideo=p.videoUrl&&!p.videoUrl.startsWith("yt:")?p.videoUrl:null;
                      if(ytId) return(
                        <a href={p.link} target="_blank" rel="noopener noreferrer" style={{display:"block",position:"relative",width:"100%",height:200,overflow:"hidden",background:"#000"}}>
                          <img src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.85}}/>
                          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                            <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid rgba(255,255,255,.8)"}}>
                              <Ic n="play" s={22} c="#fff"/>
                            </div>
                          </div>
                          <div style={{position:"absolute",bottom:8,right:10,background:"rgba(0,0,0,.75)",borderRadius:4,padding:"2px 7px"}}>
                            <span style={{color:"#fff",fontSize:11,fontWeight:700}}>YouTube</span>
                          </div>
                        </a>
                      );
                      if(directVideo) return(
                        <video src={directVideo} controls preload="none" poster={p.imgUrl||undefined} style={{width:"100%",height:200,objectFit:"cover",background:"#000",display:"block"}}/>
                      );
                      return(
                        <div style={{width:"100%",height:200,overflow:"hidden",background:T.bg2}}>
                          <img src={p.imgUrl||getFallbackImg(p.tag,p.id)} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).src=getFallbackImg(p.tag,p.id);}}/>
                        </div>
                      );
                    })()}
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
                );
              }
            })}
          </div>
        );
      })()}
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

// ── OPPORTUNITIES DATA ────────────────────────────────────────
type Opportunity={id:number;title:string;org:string;orgEmoji:string;type:"Stage"|"Alternance"|"Emploi"|"Bénévolat"|"JPO";domain:string;location:string;zone:"France"|"Europe"|"Monde";duration?:string;deadline?:string;deadlineIso?:string;link:string;desc:string;remote?:boolean};
const OPPORTUNITIES_DATA:Opportunity[]=[
  // ── ONU / UN ──
  {id:1,title:"Programme de stages — Nations Unies",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Stage",domain:"Relations internationales",location:"New York / Genève / Vienne",zone:"Monde",duration:"3–6 mois",link:"https://careers.un.org/internship",desc:"Programme officiel de stages ONU dans toutes ses directions : politique, droits de l'homme, communication, économie."},
  {id:2,title:"Programme Jeunes Professionnels (JPO) — ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"JPO",domain:"Diplomatie / Développement",location:"New York / monde entier",zone:"Monde",duration:"2 ans renouvelables",deadline:"Candidatures : oct. 2026",deadlineIso:"2026-10-15",link:"https://inspira.un.org",desc:"Contrat 2 ans financé par la France. Requis : Master, <32 ans, 2 ans d'expérience. Candidature via le MEAE."},
  {id:3,title:"Volontaire des Nations Unies (UNV)",org:"ONU – Programme UNV",orgEmoji:"🇺🇳",type:"Bénévolat",domain:"Développement / Humanitaire",location:"150+ pays",zone:"Monde",duration:"1–2 ans",link:"https://www.unv.org/become-volunteer",desc:"Volontariat ONU dans 150 pays. Indemnité de subsistance couverte. Master + 2–5 ans d'expérience selon poste."},
  {id:4,title:"Délégué·e Jeunesse ONU — Forum politique",org:"Nations Unies – Jeunesse",orgEmoji:"🇺🇳",type:"Bénévolat",domain:"Jeunesse / RI",location:"New York",zone:"Monde",deadline:"Candidatures : 30 sept. 2026",deadlineIso:"2026-09-30",link:"https://www.un.org/development/desa/youth/",desc:"Participer au Forum de haut niveau ou à des conférences ONU comme délégué jeune. Financement partiel disponible selon pays."},
  // ── UNICEF ──
  {id:5,title:"Stage UNICEF France — Communication & Plaidoyer",org:"UNICEF France",orgEmoji:"💙",type:"Stage",domain:"Communication / Droits de l'enfant",location:"Paris",zone:"France",duration:"4–6 mois",deadline:"Ouvert en continu",link:"https://www.unicef.fr/nous-rejoindre",desc:"Stage au siège UNICEF France. Campagnes de sensibilisation, contenu numérique, plaidoyer politique auprès des institutions."},
  {id:6,title:"Jeune Ambassadeur·rice UNICEF",org:"UNICEF France",orgEmoji:"💙",type:"Bénévolat",domain:"Sensibilisation / Jeunesse (15–25 ans)",location:"France entière",zone:"France",link:"https://www.unicef.fr/article/devenez-jeune-ambassadeur",desc:"Programme bénévole pour les 15–25 ans. Mobiliser son lycée/université autour des droits de l'enfant et des ODD. Formation assurée."},
  {id:7,title:"Bénévole UNICEF — Comité local",org:"UNICEF France",orgEmoji:"💙",type:"Bénévolat",domain:"Humanitaire / Collecte",location:"France entière",zone:"France",link:"https://www.unicef.fr/devenir-benevole",desc:"Rejoindre un comité local UNICEF. Collecte de fonds, organisation d'événements, sensibilisation dans les écoles."},
  {id:8,title:"Club UNICEF Campus — Ambassadeur universitaire",org:"UNICEF France",orgEmoji:"💙",type:"Bénévolat",domain:"Sensibilisation étudiante",location:"Universités françaises",zone:"France",link:"https://www.unicef.fr/nous-rejoindre/campus-benevole",desc:"Créer ou rejoindre un club UNICEF dans ton université. Organiser des collectes, événements, projections. Accompagnement UNICEF."},
  {id:9,title:"Stage UNICEF HQ — Programme & Politique",org:"UNICEF International",orgEmoji:"💙",type:"Stage",domain:"Politique sociale / RI",location:"New York, USA",zone:"Monde",duration:"6 mois",link:"https://www.unicef.org/careers/internships",desc:"Stage au siège mondial UNICEF. Protection de l'enfance, urgences humanitaires, plaidoyer. Anglais courant requis."},
  // ── UNESCO ──
  {id:10,title:"Stage UNESCO — Éducation & Culture",org:"UNESCO",orgEmoji:"🎓",type:"Stage",domain:"Éducation / Culture / Sciences",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.unesco.org/en/careers/internships",desc:"Stages dans toutes les divisions de l'UNESCO à Paris : éducation, sciences, culture, communication."},
  {id:11,title:"Forum Jeunesse UNESCO",org:"UNESCO",orgEmoji:"🎓",type:"Bénévolat",domain:"Jeunesse / Culture",location:"Paris / Monde",zone:"Monde",link:"https://www.unesco.org/en/youth",desc:"Participation aux conférences UNESCO, groupes de travail thématiques. Pour les 18–35 ans."},
  // ── FAO ──
  {id:12,title:"Stage FAO — Sécurité alimentaire mondiale",org:"FAO (ONU)",orgEmoji:"🌾",type:"Stage",domain:"Agriculture / Alimentation",location:"Rome, Italie",zone:"Europe",duration:"3–6 mois",link:"https://www.fao.org/employment/internship",desc:"Stage à l'Organisation de l'ONU pour l'alimentation. Politiques agricoles, urgences alimentaires, développement rural."},
  // ── OIT / ILO ──
  {id:13,title:"Stage OIT — Droit du travail international",org:"OIT (ILO)",orgEmoji:"⚖️",type:"Stage",domain:"Droit / Travail",location:"Genève, Suisse",zone:"Monde",duration:"3–6 mois",link:"https://www.ilo.org/employment/internship",desc:"Stage à l'Organisation internationale du travail. Normes du travail, lutte contre le travail des enfants, emploi décent."},
  {id:14,title:"JPO OIT — Jeune expert professionnel",org:"OIT (ILO)",orgEmoji:"⚖️",type:"JPO",domain:"Droit / Travail / RI",location:"Genève / Terrain",zone:"Monde",duration:"2 ans",deadline:"Candidatures : oct. 2026",deadlineIso:"2026-10-15",link:"https://www.ilo.org/employment/junior-professional-officers",desc:"Programme JPO financé par la France à l'OIT. Requis : Master, 2 ans d'expérience, <32 ans. Via MEAE."},
  // ── OMS / WHO ──
  {id:15,title:"Stage OMS — Santé mondiale",org:"OMS (WHO)",orgEmoji:"🏥",type:"Stage",domain:"Santé publique",location:"Genève, Suisse",zone:"Monde",duration:"6 mois",link:"https://www.who.int/careers/internships",desc:"Programme de stages OMS. Épidémies, santé mentale, accès aux médicaments, politiques sanitaires."},
  // ── HCR / UNHCR ──
  {id:16,title:"Stage HCR — Droit des réfugiés",org:"HCR (UNHCR)",orgEmoji:"🔵",type:"Stage",domain:"Droit / Réfugiés",location:"Genève / terrain mondial",zone:"Monde",duration:"6 mois",link:"https://www.unhcr.org/careers/internships",desc:"Stage au Haut Commissariat pour les réfugiés. Protection juridique, assistance terrain, plaidoyer. Postes en terrain disponibles."},
  {id:17,title:"Bénévole HCR / partenaires terrain",org:"HCR (UNHCR)",orgEmoji:"🔵",type:"Bénévolat",domain:"Humanitaire",location:"Monde entier",zone:"Monde",link:"https://www.unhcr.org/get-involved/volunteer",desc:"Mission de terrain dans les camps de réfugiés via les ONG partenaires HCR (IRC, NRC, etc.)."},
  // ── CICR ──
  {id:18,title:"Stage CICR — Droit international humanitaire",org:"CICR (ICRC)",orgEmoji:"🔴",type:"Stage",domain:"Droit humanitaire",location:"Genève, Suisse",zone:"Monde",duration:"3–12 mois",link:"https://www.icrc.org/fr/jobs/internship",desc:"Stage au Comité international de la Croix-Rouge. DIH, protection des civils, opérations terrain."},
  {id:19,title:"Délégué·e terrain — CICR",org:"CICR (ICRC)",orgEmoji:"🔴",type:"Emploi",domain:"Humanitaire / Terrain",location:"Zones de conflit",zone:"Monde",link:"https://www.icrc.org/fr/jobs",desc:"Poste de délégué en zone de conflit. Requis : expérience humanitaire, langue (arabe/russe/espagnol), Master+."},
  // ── TRIBUNAUX INTERNATIONAUX ──
  {id:20,title:"Stage CPI — Juriste international",org:"Cour Pénale Internationale",orgEmoji:"⚖️",type:"Stage",domain:"Droit pénal international",location:"La Haye, Pays-Bas",zone:"Europe",duration:"6 mois",link:"https://www.icc-cpi.int/vacancies",desc:"Stage à la CPI. Bureau du Procureur, Chambre préliminaire, section Victimes. Master Droit requis."},
  {id:21,title:"Stage CIJ — Cour internationale de Justice",org:"CIJ (ICJ)",orgEmoji:"⚖️",type:"Stage",domain:"Droit international public",location:"La Haye, Pays-Bas",zone:"Europe",duration:"3 mois",link:"https://www.icj-cij.org/internship",desc:"Stage à la CIJ. Recherche juridique sur les affaires inter-étatiques. Master Droit international requis."},
  {id:22,title:"Stage CEDH — Cour européenne des droits de l'homme",org:"CEDH / Conseil de l'Europe",orgEmoji:"🏛️",type:"Stage",domain:"Droits de l'homme / Droit",location:"Strasbourg",zone:"Europe",duration:"3 mois",link:"https://www.echr.coe.int/internships",desc:"Stage à la CEDH. Filtrage des requêtes, rédaction de documents juridiques. En français ou anglais."},
  {id:23,title:"Stage Mécanisme Résiduel TPIY/TPIR",org:"MICT (ONU)",orgEmoji:"⚖️",type:"Stage",domain:"Droit pénal international",location:"La Haye / Arusha",zone:"Monde",duration:"3–6 mois",link:"https://www.irmct.org/en/jobs/internships",desc:"Stage au Mécanisme pour les Tribunaux pénaux de l'ONU. Recherche sur les crimes de guerre, génocides."},
  {id:24,title:"Stage Tribunal de l'Union européenne",org:"Tribunal UE (CJUE)",orgEmoji:"⚖️",type:"Stage",domain:"Droit européen",location:"Luxembourg",zone:"Europe",duration:"5 mois",link:"https://curia.europa.eu/jcms/jcms/Jo2_7008/",desc:"Stage au Tribunal de l'UE (contentieux administratif). Assistance aux juges, rédaction de notes juridiques."},
  {id:25,title:"Stage Cour de Justice de l'UE",org:"CJUE",orgEmoji:"⚖️",type:"Stage",domain:"Droit européen",location:"Luxembourg",zone:"Europe",duration:"5 mois",link:"https://curia.europa.eu/jcms/jcms/Jo2_7008/",desc:"Stage au cabinet des juges ou avocats généraux de la CJUE. Excellent niveau en droit de l'UE requis."},
  // ── INSTITUTIONS EUROPÉENNES ──
  {id:26,title:"Stage Robert Schuman — Parlement européen (fév. 2027)",org:"Parlement européen",orgEmoji:"🇪🇺",type:"Stage",domain:"Politique européenne",location:"Bruxelles / Strasbourg",zone:"Europe",duration:"5 mois",deadline:"Clôture : 31 oct. 2026",deadlineIso:"2026-10-31",link:"https://www.europarl.europa.eu/traineeships",desc:"Programme phare du PE — session février 2027. Groupes politiques ou directions générales. Rémunéré 1350 €/mois."},
  {id:27,title:"Stage Blue Book — Commission européenne (mars 2027)",org:"Commission européenne",orgEmoji:"🇪🇺",type:"Stage",domain:"Toutes directions (RI, Commerce, Climat…)",location:"Bruxelles",zone:"Europe",duration:"5 mois",deadline:"Clôture : 31 août 2026",deadlineIso:"2026-08-31",link:"https://traineeships.ec.europa.eu",desc:"Stage rémunéré (1430 €/mois) — session mars 2027. Toutes DG : Relations extérieures, Commerce, Environnement, etc."},
  {id:28,title:"Stage SEAE — Diplomatie européenne (oct. 2026)",org:"Service européen d'action extérieure",orgEmoji:"🇪🇺",type:"Stage",domain:"Diplomatie / RI",location:"Bruxelles / Délégations UE",zone:"Europe",duration:"5 mois",deadline:"Clôture : 15 juil. 2026",deadlineIso:"2026-07-15",link:"https://www.eeas.europa.eu/eeas/traineeships_en",desc:"Stage dans le service diplomatique de l'UE — session octobre 2026. Délégations mondiales ou siège Bruxelles."},
  {id:29,title:"Stage Conseil de l'Europe",org:"Conseil de l'Europe",orgEmoji:"🏛️",type:"Stage",domain:"Droits de l'homme / Démocratie",location:"Strasbourg",zone:"Europe",duration:"3 mois",link:"https://www.coe.int/en/web/jobs/traineeships",desc:"500 stages/an au Conseil de l'Europe. Droits de l'homme, démocratie, état de droit."},
  {id:30,title:"Stage APCE — Assemblée parlementaire",org:"Conseil de l'Europe",orgEmoji:"🏛️",type:"Stage",domain:"Politique / Droit",location:"Strasbourg",zone:"Europe",duration:"3 mois",link:"https://www.coe.int/en/web/jobs/traineeships",desc:"Stage à l'Assemblée parlementaire du Conseil de l'Europe. Commissions thématiques, résolutions, rédaction de rapports."},
  {id:31,title:"Stage OTAN",org:"OTAN",orgEmoji:"🛡️",type:"Stage",domain:"Défense / RI / Cyber",location:"Bruxelles",zone:"Europe",duration:"3–6 mois",link:"https://www.nato.int/cps/en/natohq/85562.htm",desc:"Stages dans les divisions OTAN (opérations, communication, cyber). Pour ressortissants des pays membres."},
  {id:32,title:"Stage OSCE — Sécurité européenne",org:"OSCE",orgEmoji:"🔶",type:"Stage",domain:"Sécurité / RI",location:"Vienne, Autriche",zone:"Europe",duration:"3–6 mois",link:"https://www.osce.org/internships",desc:"Stage à l'OSCE. Prévention des conflits, démocratie, droits de l'homme, non-prolifération."},
  {id:33,title:"Assistant·e parlementaire — Parlement européen",org:"Parlement européen",orgEmoji:"🇪🇺",type:"Emploi",domain:"Politique / Législatif",location:"Bruxelles / Strasbourg",zone:"Europe",link:"https://www.europarl.europa.eu/about-parliament/fr/organisation-and-rules/organisation/secretariat/careers",desc:"Poste salarié auprès d'un eurodéputé. Recherche, rédaction, agenda, suivi des dossiers législatifs. CDD 5 ans."},
  // ── FRANCE ──
  {id:34,title:"Stage Ministère des Affaires étrangères",org:"MEAE (France)",orgEmoji:"🇫🇷",type:"Stage",domain:"Diplomatie / RI",location:"Paris / Ambassades",zone:"France",duration:"6 mois max",link:"https://www.diplomatie.gouv.fr/fr/le-ministere-et-son-reseau/recruter-au-ministere/",desc:"Stages dans les directions du MEAE ou dans les ambassades françaises. Direction politique, juridique, culturelle ou économique."},
  {id:35,title:"Concours diplomate — Conseiller des Affaires étrangères",org:"MEAE (France)",orgEmoji:"🇫🇷",type:"Emploi",domain:"Diplomatie",location:"France / Monde",zone:"France",link:"https://www.diplomatie.gouv.fr/fr/le-ministere-et-son-reseau/recruter-au-ministere/concours/",desc:"Concours du MEAE pour devenir diplomate. Cadres Orient, Amériques, Asie, Afrique. Préparation : écoles de commerce, Sciences Po."},
  {id:36,title:"Stage AFD — Développement international",org:"AFD",orgEmoji:"🌿",type:"Stage",domain:"Développement / Finance",location:"Paris / Terrain mondial",zone:"France",duration:"4–6 mois",link:"https://www.afd.fr/fr/rejoindre-lafd/stages",desc:"Stage à l'AFD. Financement de projets en Afrique, Asie, Amérique latine. Approches économiques et sociales."},
  {id:37,title:"Alternance AFD — Chargé·e de projet RI",org:"AFD",orgEmoji:"🌿",type:"Alternance",domain:"RI / Développement",location:"Paris",zone:"France",duration:"1–2 ans",link:"https://www.afd.fr/fr/rejoindre-lafd/alternance",desc:"Alternance M1/M2 sur des projets de développement international. Candidatures sur LinkedIn et site AFD."},
  {id:38,title:"Stage Assemblée Nationale — Collaborateur·rice",org:"Assemblée Nationale",orgEmoji:"🏛️",type:"Stage",domain:"Politique / Législatif",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.assemblee-nationale.fr/stages",desc:"Stage auprès d'un·e député·e ou dans les services de l'AN. Suivi législatif, recherche, relations publiques."},
  {id:39,title:"Stage Sénat — Commission des affaires étrangères",org:"Sénat",orgEmoji:"🏛️",type:"Stage",domain:"RI / Droit",location:"Paris",zone:"France",duration:"3 mois",link:"https://www.senat.fr/stage.html",desc:"Stage dans les services du Sénat. Direction européenne, commission des affaires étrangères, défense."},
  {id:40,title:"Attaché·e de coopération culturelle — Ambassades",org:"MEAE / Institut Français",orgEmoji:"🇫🇷",type:"Emploi",domain:"Diplomatie culturelle",location:"Ambassades monde entier",zone:"Monde",link:"https://www.institutfrancais.com/fr/emplois",desc:"Promotion de la langue et de la culture françaises dans les ambassades. Poste contractuel via l'Institut Français."},
  {id:41,title:"Stage Réseau ONU France (UNRIC)",org:"UNRIC France",orgEmoji:"🇺🇳",type:"Stage",domain:"Communication / RI",location:"Paris",zone:"France",duration:"3–4 mois",link:"https://unric.org/fr/",desc:"Stage au Centre d'information des Nations Unies pour la France. Communication, événements, sensibilisation multilingue."},
  // ── ONG ──
  {id:42,title:"Stage Amnesty International France",org:"Amnesty International",orgEmoji:"🕯️",type:"Stage",domain:"Droits de l'homme / Communication",location:"Paris",zone:"France",duration:"4–6 mois",link:"https://www.amnesty.fr/rejoignez-nous/stages",desc:"Stage au siège Amnesty France. Communication digitale, campagnes de plaidoyer, recherche sur les violations."},
  {id:43,title:"Bénévole Amnesty International France",org:"Amnesty International",orgEmoji:"🕯️",type:"Bénévolat",domain:"Droits de l'homme",location:"France entière",zone:"France",link:"https://www.amnesty.fr/rejoignez-nous/benevoles",desc:"Rejoindre un groupe local. Lettres d'urgence, manifestations, campagnes, sensibilisation dans les lycées."},
  {id:44,title:"Stage Amnesty International — Siège mondial",org:"Amnesty International",orgEmoji:"🕯️",type:"Stage",domain:"Droits de l'homme / Recherche",location:"Londres, Royaume-Uni",zone:"Monde",duration:"6 mois",link:"https://www.amnesty.org/en/careers",desc:"Stage au siège mondial d'Amnesty à Londres. Recherche, publications, campagnes. Anglais courant requis."},
  {id:45,title:"Stage MSF — Communication & Humanitaire",org:"Médecins Sans Frontières",orgEmoji:"🏥",type:"Stage",domain:"Humanitaire / Communication",location:"Paris",zone:"France",duration:"4–6 mois",link:"https://www.msf.fr/nos-actions/rejoindre-msf/stages",desc:"Stage au siège MSF Paris. Communication, logistique humanitaire, RH expatriés. Mission terrain possible selon profil."},
  {id:46,title:"Logisticien·ne terrain — MSF",org:"Médecins Sans Frontières",orgEmoji:"🏥",type:"Emploi",domain:"Logistique humanitaire",location:"Zones de crise",zone:"Monde",link:"https://www.msf.fr/nos-actions/rejoindre-msf/logisticien",desc:"Poste en zones de crise. Gestion des bases, chaîne d'approvisionnement, équipements médicaux. Mission 6–12 mois."},
  {id:47,title:"Bénévole Croix-Rouge Française",org:"Croix-Rouge Française",orgEmoji:"🔴",type:"Bénévolat",domain:"Humanitaire / Social",location:"France entière",zone:"France",link:"https://www.croix-rouge.fr/benevoles",desc:"Maraude, soutien aux réfugiés, collecte alimentaire. 600 délégations locales en France."},
  {id:48,title:"Stage Croix-Rouge — Coopération internationale",org:"Croix-Rouge Française",orgEmoji:"🔴",type:"Stage",domain:"Coopération internationale",location:"Paris / Terrain",zone:"France",duration:"4–6 mois",link:"https://www.croix-rouge.fr/stages",desc:"Stage dans la Direction de l'Action Internationale. Projets terrain (Afrique, Moyen-Orient), coordination FICR."},
  {id:49,title:"Stage Human Rights Watch",org:"Human Rights Watch",orgEmoji:"👁️",type:"Stage",domain:"Droits de l'homme / Journalisme",location:"Paris / Bruxelles / New York",zone:"Monde",duration:"3–6 mois",link:"https://www.hrw.org/jobs",desc:"Recherche, rédaction de rapports, plaidoyer institutionnel. Anglais courant requis."},
  {id:50,title:"Stage Reporters Sans Frontières",org:"RSF",orgEmoji:"✒️",type:"Stage",domain:"Liberté de la presse / Droits",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://rsf.org/fr/rejoignez-nous",desc:"Suivi des journalistes emprisonnés, communication, production du classement mondial de la liberté de la presse."},
  {id:51,title:"Stage Oxfam France — Plaidoyer",org:"Oxfam France",orgEmoji:"🟠",type:"Stage",domain:"Inégalités / Justice fiscale",location:"Paris",zone:"France",duration:"4–6 mois",link:"https://www.oxfamfrance.org/agir/rejoindre-oxfam/",desc:"Plaidoyer Oxfam France : inégalités mondiales, justice fiscale, justice climatique. Recherche, communication, lobbying."},
  {id:52,title:"Stage Save the Children",org:"Save the Children",orgEmoji:"🟢",type:"Stage",domain:"Droits de l'enfant",location:"Paris / Londres",zone:"Europe",duration:"4–6 mois",link:"https://www.savethechildren.net/careers",desc:"Programmes d'urgence ou de développement pour les enfants. Paris (section FR) ou Londres (siège international)."},
  {id:53,title:"Stage WWF France — Politique environnementale",org:"WWF France",orgEmoji:"🐼",type:"Stage",domain:"Environnement / Politique",location:"Paris",zone:"France",duration:"4–6 mois",link:"https://www.wwf.fr/nous-rejoindre/stages",desc:"Politiques de conservation, énergie, forêts, océans. Plaidoyer institutionnel, communication."},
  {id:54,title:"Stage Greenpeace France — Campagnes",org:"Greenpeace France",orgEmoji:"🌱",type:"Stage",domain:"Environnement / Communication",location:"Paris",zone:"France",duration:"4–6 mois",link:"https://www.greenpeace.fr/nous-rejoindre/stages/",desc:"Campagnes énergie, forêts, océans, agriculture. Communication, mobilisation citoyenne, plaidoyer."},
  {id:55,title:"Bénévole Greenpeace",org:"Greenpeace",orgEmoji:"🌱",type:"Bénévolat",domain:"Environnement",location:"France entière",zone:"France",link:"https://www.greenpeace.fr/nous-rejoindre/benevoles/",desc:"Rejoindre les équipes locales Greenpeace. Actions terrain, sensibilisation, présence aux événements."},
  {id:56,title:"Stage ACTED — ONG humanitaire",org:"ACTED",orgEmoji:"🌍",type:"Stage",domain:"Humanitaire / Terrain",location:"Paris / Terrain mondial",zone:"France",duration:"4–6 mois",link:"https://www.acted.org/fr/rejoindre-acted/stages/",desc:"Stage siège (Paris) ou terrain (Moyen-Orient, Asie Centrale, Sahel). 40+ pays couverts."},
  {id:57,title:"Coordonnateur·rice terrain — ACTED",org:"ACTED",orgEmoji:"🌍",type:"Emploi",domain:"Coordination humanitaire",location:"Zones de crise",zone:"Monde",link:"https://www.acted.org/fr/rejoindre-acted/postes/",desc:"Gestion d'équipes terrain, rapports bailleurs, sécurité. Expérience terrain exigée."},
  {id:58,title:"Stage Handicap International (HI)",org:"Humanity & Inclusion",orgEmoji:"♿",type:"Stage",domain:"Droits / Humanitaire",location:"Lyon / Bruxelles",zone:"Europe",duration:"4–6 mois",link:"https://www.hi.org/fr/rejoignez-nous/stages",desc:"Plaidoyer contre les mines antipersonnel, droits des personnes handicapées en situations d'urgence."},
  // ── INSTITUTIONS INTERNATIONALES ──
  {id:59,title:"Stage OCDE — Politiques publiques",org:"OCDE",orgEmoji:"📊",type:"Stage",domain:"Économie / Politiques publiques",location:"Paris",zone:"France",duration:"6 mois",link:"https://www.oecd.org/careers/internship-programme/",desc:"600 stages/an à l'OCDE Paris. Économie, éducation, santé, fiscalité, énergie. Rémunéré."},
  {id:60,title:"Analyste politiques publiques — OCDE",org:"OCDE",orgEmoji:"📊",type:"Emploi",domain:"Économie / Politiques publiques",location:"Paris",zone:"France",link:"https://www.oecd.org/careers",desc:"Poste d'analyste ou économiste à l'OCDE. Master/PhD en économie ou sciences politiques. Anglais + français requis."},
  {id:61,title:"Stage OIM — Migration internationale",org:"OIM (IOM)",orgEmoji:"🔵",type:"Stage",domain:"Migration / Humanitaire",location:"Genève / Terrain",zone:"Monde",duration:"3–6 mois",link:"https://www.iom.int/careers/internship",desc:"Stage à l'Organisation Internationale pour les Migrations. Politiques migratoires, assistance terrain, intégration."},
  {id:62,title:"Stage HCDH — Droits de l'homme ONU",org:"HCDH (OHCHR)",orgEmoji:"🕊️",type:"Stage",domain:"Droits de l'homme",location:"Genève / New York",zone:"Monde",duration:"3–6 mois",link:"https://www.ohchr.org/en/get-involved/opportunities",desc:"Stage au Haut-Commissariat aux droits de l'homme. Rapports de pays, mécanismes conventionnels, Conseil des DH."},
  {id:63,title:"Stage PNUD — Développement durable",org:"PNUD (UNDP)",orgEmoji:"🌍",type:"Stage",domain:"Développement durable",location:"New York / Pays programmes",zone:"Monde",duration:"3–6 mois",link:"https://jobs.undp.org",desc:"Stage au Programme des Nations Unies pour le développement. Projets dans 170 pays sur les ODD, gouvernance, résilience climatique."},
  {id:64,title:"Stage PNUE — Environnement mondial",org:"PNUE (UNEP)",orgEmoji:"🌍",type:"Stage",domain:"Environnement / Climat",location:"Nairobi / Genève / Paris",zone:"Monde",duration:"3–6 mois",link:"https://www.unep.org/work-with-unep/internships",desc:"Stage au Programme ONU pour l'environnement. Biodiversité, changement climatique, pollution, économie verte."},
  {id:65,title:"Stage ONUDC — Lutte contre la criminalité",org:"ONUDC (ONU)",orgEmoji:"🇺🇳",type:"Stage",domain:"Criminalité / Droit international",location:"Vienne, Autriche",zone:"Europe",duration:"3–6 mois",link:"https://www.unodc.org/unodc/en/about-unodc/internships.html",desc:"Stage à l'Office ONU contre la drogue et le crime. Trafic, terrorisme, corruption internationale."},
  {id:66,title:"Stage Banque Mondiale — Développement",org:"Banque Mondiale",orgEmoji:"🌐",type:"Stage",domain:"Finance internationale / Développement",location:"Washington DC",zone:"Monde",duration:"3–6 mois",link:"https://www.worldbank.org/en/about/careers/programs-and-internships",desc:"Junior Professional Associates. Développement économique, lutte contre la pauvreté, projets dans pays émergents."},
  {id:67,title:"Stage FMI — Économie internationale",org:"FMI",orgEmoji:"💱",type:"Stage",domain:"Économie / Finance",location:"Washington DC",zone:"Monde",duration:"6–12 mois",link:"https://www.imf.org/careers",desc:"Stage au FMI. Analyse macro-économique, surveillance des économies mondiales, programmes d'ajustement."},
  // ── ÉCOLES / ALTERNANCES SPÉCIALES ──
  {id:68,title:"Alternance Sciences Po — Institutions partenaires",org:"Sciences Po Paris",orgEmoji:"🎓",type:"Alternance",domain:"RI / Politique publique",location:"Paris",zone:"France",duration:"1–2 ans",deadline:"Candidatures : oct. 2026",deadlineIso:"2026-10-31",link:"https://www.sciencespo.fr/apprentissage",desc:"Alternance via Sciences Po avec ONG, institutions européennes, ministères. Master RI, PSIA, Gouvernance."},
  {id:69,title:"Alternance Sciences Po Aix — RI & Sécurité",org:"Sciences Po Aix",orgEmoji:"🎓",type:"Alternance",domain:"RI / Sécurité",location:"Aix-en-Provence",zone:"France",duration:"1–2 ans",deadline:"Candidatures : oct. 2026",deadlineIso:"2026-10-31",link:"https://www.sciencespo-aix.fr/formation/alternance/",desc:"Alternance avec collectivités, institutions européennes, ONG. Spécialités RI et sécurité internationale."},
  {id:70,title:"Fondation Jean-Jaurès — Stage analyse politique",org:"Fondation Jean-Jaurès",orgEmoji:"📚",type:"Stage",domain:"Analyse politique / RI",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://jean-jaures.org/nous-rejoindre/",desc:"Stage au think tank progressiste français. Rédaction de notes, veille internationale, organisation de conférences."},
  {id:71,title:"Institut Montaigne — Stage analyse politique",org:"Institut Montaigne",orgEmoji:"📚",type:"Stage",domain:"Analyse politique / Économie",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.institutmontaigne.org/devenez-collaborateur",desc:"Stage dans le think tank centriste. Études politiques, économiques, géopolitiques. Rédaction de rapports d'analyse."},
  {id:72,title:"Stage IRIS — Institut de Relations Internationales",org:"IRIS",orgEmoji:"🔭",type:"Stage",domain:"Géopolitique / Recherche",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.iris-france.org/nous-rejoindre/",desc:"Stage au principal think tank français de RI. Recherche géopolitique, organisation d'événements, édition de la Revue internationale."},
  {id:73,title:"Stage IFRI — Affaires internationales",org:"IFRI",orgEmoji:"🔭",type:"Stage",domain:"Géopolitique / Recherche",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.ifri.org/fr/travailler-chez-lifri",desc:"Stage à l'Institut Français des Relations Internationales. Centres thématiques : Russie, Asie, Énergie, Sécurité. Renommé mondialement."},
  {id:74,title:"Stage Fondation Robert Schuman — Europe",org:"Fondation Robert Schuman",orgEmoji:"🇪🇺",type:"Stage",domain:"Europe / Politique",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.robert-schuman.eu/fr/stages",desc:"Stage dans le think tank pro-européen. Analyse des politiques de l'UE, rédaction de publications, organisation de colloques."},
  {id:75,title:"Stage UNESCO — Programme MAB Biosphère",org:"UNESCO",orgEmoji:"🎓",type:"Stage",domain:"Environnement / Sciences",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.unesco.org/en/careers/internships",desc:"Stage dans le programme Man and Biosphere de l'UNESCO. Conservation, biodiversité, développement durable."},
  // ── EMPLOIS ONU / SYSTÈME ONUSIEN ──
  {id:76,title:"Spécialiste des affaires politiques — ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Affaires politiques / Paix",location:"New York / Missions terrain",zone:"Monde",link:"https://careers.un.org",desc:"Analyse de situation politique, rapports au Conseil de sécurité, appui aux missions de paix ONU. Master + 5 ans d'expérience."},
  {id:77,title:"Officier·ère des droits de l'homme — ONU",org:"Nations Unies / HCDH",orgEmoji:"🇺🇳",type:"Emploi",domain:"Droits de l'homme",location:"Genève / Missions terrain",zone:"Monde",link:"https://careers.un.org",desc:"Enquête sur les violations des droits humains, rédaction de rapports pour les mécanismes onusiens. Anglais + 2e langue ONU."},
  {id:78,title:"Économiste — ONU / CNUCED",org:"CNUCED (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Économie internationale / Commerce",location:"Genève",zone:"Monde",link:"https://unctad.org/careers",desc:"Recherche économique sur le commerce, développement, dette souveraine, investissements. PhD ou Master + expérience."},
  {id:79,title:"Chargé·e de communication — ONU Genève",org:"ONUG (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Communication / Médias",location:"Genève",zone:"Monde",link:"https://careers.un.org",desc:"Production de contenu multimédia, relations médias, couverture des conférences intergouvernementales à Genève."},
  {id:80,title:"Administrateur·rice de programme — PNUD",org:"PNUD (UNDP)",orgEmoji:"🌍",type:"Emploi",domain:"Développement / Gestion de projets",location:"Monde entier (170 pays)",zone:"Monde",link:"https://jobs.undp.org",desc:"Coordination de projets de développement dans les pays partenaires. Gestion budgétaire, suivi-évaluation, rapports aux bailleurs."},
  {id:81,title:"Conseiller·ère technique — FAO",org:"FAO (ONU)",orgEmoji:"🌾",type:"Emploi",domain:"Agriculture / Alimentation",location:"Rome / Terrain Afrique & Asie",zone:"Monde",link:"https://www.fao.org/employment",desc:"Conseil aux gouvernements sur les politiques agricoles et de sécurité alimentaire. Expérience terrain exigée."},
  {id:82,title:"Coordonnateur·rice urgences — OMS",org:"OMS (WHO)",orgEmoji:"🏥",type:"Emploi",domain:"Santé / Urgences humanitaires",location:"Genève / Terrain épidémies",zone:"Monde",link:"https://www.who.int/careers",desc:"Coordination des réponses aux urgences sanitaires mondiales (épidémies, catastrophes). Requis : Master santé publique + 7 ans."},
  {id:83,title:"Protection Officer — HCR",org:"HCR (UNHCR)",orgEmoji:"🔵",type:"Emploi",domain:"Protection / Réfugiés",location:"Terrain mondial",zone:"Monde",link:"https://www.unhcr.org/careers",desc:"Protection juridique des réfugiés, demandeurs d'asile, apatrides. Gestion d'équipe locale, liaison avec gouvernements."},
  {id:84,title:"Logisticien·ne / Supply Chain — UNICEF",org:"UNICEF",orgEmoji:"💙",type:"Emploi",domain:"Logistique humanitaire",location:"Monde entier",zone:"Monde",link:"https://www.unicef.org/careers",desc:"Gestion de la chaîne d'approvisionnement pour les programmes enfants (vaccins, nutrition, WASH). Missions terrain."},
  {id:85,title:"Spécialiste éducation — UNESCO",org:"UNESCO",orgEmoji:"🎓",type:"Emploi",domain:"Éducation / Politique",location:"Paris / Délégations UNESCO",zone:"Monde",link:"https://careers.unesco.org",desc:"Développement de politiques éducatives mondiales, programmes d'alphabétisation, éducation inclusive. Master + 5 ans."},
  {id:86,title:"Expert·e programme culture — UNESCO",org:"UNESCO",orgEmoji:"🎓",type:"Emploi",domain:"Culture / Patrimoine",location:"Paris / Terrain",zone:"Monde",link:"https://careers.unesco.org",desc:"Gestion des programmes patrimoine mondial, diversité culturelle, industries créatives. Expérience internationale requise."},
  {id:87,title:"Chargé·e de plaidoyer — UNICEF France",org:"UNICEF France",orgEmoji:"💙",type:"Emploi",domain:"Plaidoyer / Droits de l'enfant",location:"Paris",zone:"France",link:"https://www.unicef.fr/nous-rejoindre",desc:"Plaidoyer auprès du gouvernement et du Parlement pour les droits de l'enfant. Relations institutionnelles, campagnes."},
  // ── EMPLOIS INSTITUTIONS EUROPÉENNES ──
  {id:88,title:"Administrateur·rice — Concours EPSO (EU)",org:"Institutions UE (EPSO)",orgEmoji:"🇪🇺",type:"Emploi",domain:"Administration / RI / Droit / Économie",location:"Bruxelles / Luxembourg / Strasbourg",zone:"Europe",link:"https://epso.europa.eu",desc:"Concours général d'entrée dans les institutions UE (Commission, PE, Conseil). AD5 ou AST. Ouvert tous profils : droit, éco, RI, sciences."},
  {id:89,title:"Agent contractuel — Commission européenne",org:"Commission européenne",orgEmoji:"🇪🇺",type:"Emploi",domain:"Toutes directions",location:"Bruxelles",zone:"Europe",link:"https://epso.europa.eu/en/selection-procedures/cast",desc:"Contrat CAST (Contract Agent Selection Tool). Postes administratifs, juridiques, économiques, communication dans les DG."},
  {id:90,title:"Traducteur·rice / Interprète — UE",org:"Institutions UE",orgEmoji:"🇪🇺",type:"Emploi",domain:"Langues / Traduction",location:"Bruxelles / Luxembourg",zone:"Europe",link:"https://epso.europa.eu",desc:"Postes de traducteurs et interprètes via concours EPSO. Toutes langues officielles. Parlement européen, Commission, CJUE."},
  {id:91,title:"Analyste politique — Conseil de l'UE",org:"Conseil de l'Union européenne",orgEmoji:"🇪🇺",type:"Emploi",domain:"Politique européenne / RI",location:"Bruxelles",zone:"Europe",link:"https://www.consilium.europa.eu/fr/general-secretariat/jobs/",desc:"Analyse et coordination des positions des États membres. Préparation des Conseils européens, suivi des négociations."},
  {id:92,title:"Juriste — Cour de Justice de l'UE",org:"CJUE",orgEmoji:"⚖️",type:"Emploi",domain:"Droit européen",location:"Luxembourg",zone:"Europe",link:"https://curia.europa.eu/jcms/jcms/Jo2_7231/",desc:"Poste de juriste-linguiste ou référendaire. Rédaction d'arrêts, de conclusions d'avocat général, recherche juridique."},
  {id:93,title:"Chargé·e de mission — Parlement européen",org:"Parlement européen",orgEmoji:"🇪🇺",type:"Emploi",domain:"Politique / Législatif",location:"Bruxelles / Strasbourg",zone:"Europe",link:"https://www.europarl.europa.eu/about-parliament/fr/organisation-and-rules/organisation/secretariat/careers",desc:"Postes permanents au sein des directions générales du PE (DG Politiques internes, DG Communication, etc.)."},
  {id:94,title:"Conseiller·ère politique — SEAE",org:"Service européen d'action extérieure",orgEmoji:"🇪🇺",type:"Emploi",domain:"Diplomatie / RI",location:"Bruxelles / Délégations",zone:"Europe",link:"https://www.eeas.europa.eu/eeas/careers_en",desc:"Postes de diplomates européens dans les délégations de l'UE. Analyse géopolitique, relations bilatérales, commerce extérieur."},
  // ── EMPLOIS GOUVERNEMENT FRANÇAIS ──
  {id:95,title:"Conseiller·ère des Affaires étrangères (CAE)",org:"MEAE (France)",orgEmoji:"🇫🇷",type:"Emploi",domain:"Diplomatie",location:"Paris / Ambassades monde",zone:"France",link:"https://www.diplomatie.gouv.fr/fr/le-ministere-et-son-reseau/recruter-au-ministere/concours/",desc:"Corps diplomatique français. Concours externe et interne. Cadres géographiques ou thématiques. ENA/INSP requis ou concours direct."},
  {id:96,title:"Secrétaire des Affaires étrangères (SAE)",org:"MEAE (France)",orgEmoji:"🇫🇷",type:"Emploi",domain:"Diplomatie / Consulaire",location:"France / Postes consulaires",zone:"France",link:"https://www.diplomatie.gouv.fr/fr/le-ministere-et-son-reseau/recruter-au-ministere/concours/",desc:"Postes consulaires et administratifs dans les ambassades. Gestion des visas, affaires consulaires, appui aux Français à l'étranger."},
  {id:97,title:"Chargé·e de mission AFD — Expert·e sectoriel",org:"AFD",orgEmoji:"🌿",type:"Emploi",domain:"Développement / Finance internationale",location:"Paris / Terrain Afrique, Asie",zone:"France",link:"https://www.afd.fr/fr/rejoindre-lafd",desc:"Gestion d'un portefeuille de projets (eau, énergie, éducation, agriculture) dans les pays partenaires. Ingénieur·e ou économiste."},
  {id:98,title:"Administrateur·rice Civil·e — Concours ENA/INSP",org:"Gouvernement français",orgEmoji:"🇫🇷",type:"Emploi",domain:"Administration publique / RI",location:"Paris",zone:"France",link:"https://www.insp.gouv.fr/concours",desc:"Concours d'entrée à l'INSP (ex-ENA). Accès aux grands corps de l'État : Conseil d'État, Cour des comptes, Inspection générale."},
  {id:99,title:"Rédacteur·rice — Assemblée Nationale",org:"Assemblée Nationale",orgEmoji:"🏛️",type:"Emploi",domain:"Politique / Administration",location:"Paris",zone:"France",link:"https://www.assemblee-nationale.fr/recrutement",desc:"Concours de fonctionnaire de l'AN. Postes de rédacteurs, administrateurs, documentalistes. Travail en commissions parlementaires."},
  {id:100,title:"Administrateur·rice — Sénat",org:"Sénat",orgEmoji:"🏛️",type:"Emploi",domain:"Droit / Administration / RI",location:"Paris",zone:"France",link:"https://www.senat.fr/senatrecrutement.html",desc:"Concours d'administrateur du Sénat. Suivi législatif, recherche juridique, commissions (Affaires étrangères, Défense, Europe)."},
  // ── EMPLOIS ONG & THINK TANKS ──
  {id:101,title:"Chargé·e de programme — Amnesty International",org:"Amnesty International",orgEmoji:"🕯️",type:"Emploi",domain:"Droits de l'homme / Plaidoyer",location:"Paris / Londres",zone:"Europe",link:"https://www.amnesty.fr/rejoignez-nous",desc:"Gestion de campagnes sur des thématiques (torture, peine de mort, droits des femmes). Plaidoyer, relations médias, enquête."},
  {id:102,title:"Chargé·e de projet humanitaire — ACTED",org:"ACTED",orgEmoji:"🌍",type:"Emploi",domain:"Gestion de projets / Humanitaire",location:"Terrain (40+ pays)",zone:"Monde",link:"https://www.acted.org/fr/rejoindre-acted/postes/",desc:"Coordination de projets terrain dans les zones de crise. Suivi-évaluation, rapports aux bailleurs (ECHO, USAID). Master + 2 ans."},
  {id:103,title:"Chercheur·se — IFRI",org:"IFRI",orgEmoji:"🔭",type:"Emploi",domain:"Géopolitique / Recherche",location:"Paris",zone:"France",link:"https://www.ifri.org/fr/travailler-chez-lifri",desc:"Poste de chercheur dans un centre thématique IFRI (Russie/NEI, Asie, Énergie, Sécurité). PhD + publications requis."},
  {id:104,title:"Analyste — Institut Montaigne",org:"Institut Montaigne",orgEmoji:"📚",type:"Emploi",domain:"Politiques publiques / Économie",location:"Paris",zone:"France",link:"https://www.institutmontaigne.org/devenez-collaborateur",desc:"Rédaction de rapports politiques, veille internationale, organisation de conférences. Profil Sciences Po / grandes écoles."},
  {id:105,title:"Chargé·e de communication — Greenpeace France",org:"Greenpeace France",orgEmoji:"🌱",type:"Emploi",domain:"Communication / Environnement",location:"Paris",zone:"France",link:"https://www.greenpeace.fr/nous-rejoindre",desc:"Communication digitale et médias sur les campagnes environnementales. Rédaction, vidéo, community management."},
  // ── EMPLOIS DROIT INTERNATIONAL ──
  {id:106,title:"Greffier·ère adjoint·e — CPI",org:"Cour Pénale Internationale",orgEmoji:"⚖️",type:"Emploi",domain:"Droit pénal international",location:"La Haye, Pays-Bas",zone:"Europe",link:"https://www.icc-cpi.int/vacancies",desc:"Soutien administratif et juridique au Greffe de la CPI. Gestion des victimes, témoins, dossiers judiciaires. Master Droit."},
  {id:107,title:"Conseiller·ère juridique — CICR",org:"CICR (ICRC)",orgEmoji:"🔴",type:"Emploi",domain:"Droit international humanitaire",location:"Genève / Délégations",zone:"Monde",link:"https://www.icrc.org/fr/jobs",desc:"Conseil juridique sur l'application du droit international humanitaire. Relations avec les forces armées et les gouvernements."},
  {id:108,title:"Greffier·ère — CEDH",org:"CEDH / Conseil de l'Europe",orgEmoji:"🏛️",type:"Emploi",domain:"Droits de l'homme / Droit",location:"Strasbourg",zone:"Europe",link:"https://www.echr.coe.int/vacancies",desc:"Traitement des requêtes individuelles, rédaction de communications, assistance aux chambres de jugement. Master Droit requis."},
  // ── EMPLOIS ORGANISATIONS RÉGIONALES ──
  {id:109,title:"Analyste politique — OTAN",org:"OTAN",orgEmoji:"🛡️",type:"Emploi",domain:"Défense / Sécurité / RI",location:"Bruxelles",zone:"Europe",link:"https://www.nato.int/cps/en/natohq/85600.htm",desc:"Analyse des menaces, rédaction de documents politiques pour les ambassadeurs OTAN. Requis : Master + expérience sécurité."},
  {id:110,title:"Officier·ère programme — OSCE",org:"OSCE",orgEmoji:"🔶",type:"Emploi",domain:"Sécurité / Démocratie",location:"Vienne / Missions terrain",zone:"Europe",link:"https://www.osce.org/employment",desc:"Gestion de programmes dans les missions OSCE (Ukraine, Balkans, Caucase). Élections, État de droit, droits humains."},
  {id:111,title:"Expert·e — Conseil de l'Europe",org:"Conseil de l'Europe",orgEmoji:"🏛️",type:"Emploi",domain:"Droits de l'homme / Démocratie",location:"Strasbourg",zone:"Europe",link:"https://www.coe.int/en/web/jobs",desc:"Postes dans les directions Droits de l'homme, Démocratie, État de droit. Concours ou recrutement direct selon profil."},
  // ── EMPLOIS FINANCES INTERNATIONALES ──
  {id:112,title:"Économiste — Banque Mondiale",org:"Banque Mondiale",orgEmoji:"🌐",type:"Emploi",domain:"Économie / Développement",location:"Washington DC / Terrain",zone:"Monde",link:"https://www.worldbank.org/en/about/careers",desc:"Analyse économique, politiques de développement, gestion de projets dans les pays à revenu faible et intermédiaire. PhD requis."},
  {id:113,title:"Économiste / Expert·e pays — FMI",org:"FMI",orgEmoji:"💱",type:"Emploi",domain:"Économie / Finance internationale",location:"Washington DC",zone:"Monde",link:"https://www.imf.org/careers",desc:"Surveillance des économies nationales, programmes de soutien financier, rapports Article IV. PhD économie + publications."},
  {id:114,title:"Analyste — OCDE (P2–P4)",org:"OCDE",orgEmoji:"📊",type:"Emploi",domain:"Économie / Politiques publiques",location:"Paris",zone:"France",link:"https://www.oecd.org/careers",desc:"Postes permanents dans toutes les directions de l'OCDE. Analyses comparatives entre pays membres, recommandations politiques."},
  // ── JUSTICE / DROIT ──
  {id:115,title:"Greffier·ère — Tribunal judiciaire",org:"Ministère de la Justice (France)",orgEmoji:"⚖️",type:"Emploi",domain:"Justice / Administration judiciaire",location:"France entière",zone:"France",link:"https://www.metiers.justice.gouv.fr",desc:"Concours de greffier des services judiciaires. Travail dans les tribunaux : gestion des dossiers, audiences, état civil."},
  {id:116,title:"Magistrat·e — École Nationale de la Magistrature",org:"ENM / Ministère Justice",orgEmoji:"⚖️",type:"Emploi",domain:"Justice / Droit",location:"France entière",zone:"France",link:"https://www.enm.justice.fr/concours",desc:"Concours d'entrée à l'ENM. Accès à la magistrature du siège (juge) ou du parquet (procureur). Bac+4 Droit requis."},
  {id:117,title:"Juriste — Conseil d'État",org:"Conseil d'État (France)",orgEmoji:"⚖️",type:"Emploi",domain:"Droit administratif",location:"Paris",zone:"France",link:"https://www.conseil-etat.fr/le-conseil-d-etat/ressources-humaines",desc:"Concours du Conseil d'État (Auditeur). Accès via INSP ou concours externe. Juridiction suprême administrative française."},
  {id:118,title:"Stage CJUE — Droit de l'environnement",org:"CJUE / Tribunal UE",orgEmoji:"⚖️",type:"Stage",domain:"Droit de l'environnement / UE",location:"Luxembourg",zone:"Europe",duration:"5 mois",link:"https://curia.europa.eu/jcms/jcms/Jo2_7008/",desc:"Stage spécialisé en droit de l'environnement, droit social ou droit de la concurrence à la Cour de Justice de l'UE."},
  {id:119,title:"Avocat·e — barreau international (Paris)",org:"Barreau de Paris",orgEmoji:"⚖️",type:"Emploi",domain:"Droit / Arbitrage international",location:"Paris",zone:"France",link:"https://www.avocatparis.org/devenir-avocat/admission-au-barreau",desc:"Exercer au barreau de Paris dans un cabinet d'arbitrage international, droit des affaires, droits de l'homme."},
  // ── ÉCONOMIE / FINANCES ──
  {id:120,title:"Analyste financier·ère — Trésor (France)",org:"Direction Générale du Trésor",orgEmoji:"🇫🇷",type:"Emploi",domain:"Économie / Finance publique",location:"Paris / Postes à l'étranger",zone:"France",link:"https://www.tresor.economie.gouv.fr/recrutement",desc:"Corps des administrateurs du Trésor. Concours INSP ou recrutement direct. Politique économique, relations financières internationales."},
  {id:121,title:"Économiste — Banque de France",org:"Banque de France",orgEmoji:"🏦",type:"Emploi",domain:"Économie / Politique monétaire",location:"Paris",zone:"France",link:"https://www.banque-france.fr/fr/la-banque-de-france/carrieres",desc:"Recherche économique, supervision bancaire, politique monétaire Zone euro. Concours ou recrutement direct. Master/PhD économie."},
  {id:122,title:"Analyste — Autorité des marchés financiers (AMF)",org:"AMF (France)",orgEmoji:"📈",type:"Emploi",domain:"Finance / Régulation",location:"Paris",zone:"France",link:"https://www.amf-france.org/fr/l-amf/l-amf-recrute",desc:"Surveillance des marchés financiers, protection des investisseurs, contrôle des acteurs financiers. Master finance ou droit."},
  {id:123,title:"Stage Banque Centrale Européenne — Économie",org:"BCE (ECB)",orgEmoji:"🇪🇺",type:"Stage",domain:"Économie / Politique monétaire",location:"Francfort, Allemagne",zone:"Europe",duration:"3–6 mois",link:"https://www.ecb.europa.eu/careers/",desc:"Stage à la BCE. Économie quantitative, politique monétaire, stabilité financière. Master/PhD économie ou mathématiques."},
  {id:124,title:"Économiste — BCE (poste permanent)",org:"BCE (ECB)",orgEmoji:"🇪🇺",type:"Emploi",domain:"Économie / Analyse quantitative",location:"Francfort, Allemagne",zone:"Europe",link:"https://www.ecb.europa.eu/careers/",desc:"Postes permanents à la Banque Centrale Européenne. Modélisation macro, politique monétaire, supervision bancaire. PhD requis."},
  {id:125,title:"Chargé·e de mission — Caisse des Dépôts",org:"Caisse des Dépôts (France)",orgEmoji:"🏛️",type:"Emploi",domain:"Finance publique / Développement",location:"Paris",zone:"France",link:"https://www.caissedesdepots.fr/recrutement",desc:"Institution financière publique. Financement des collectivités, logement social, transition écologique. Alternances aussi disponibles."},
  {id:126,title:"Analyste — Fonds Européen d'Investissement (FEI)",org:"FEI (BEI Group)",orgEmoji:"🇪🇺",type:"Emploi",domain:"Finance / Capital-risque",location:"Luxembourg",zone:"Europe",link:"https://www.eif.org/careers",desc:"Financement des PME européennes, capital-risque, garanties. Master finance + expérience financière requise."},
  // ── POLITIQUE / COLLECTIVITÉS TERRITORIALES ──
  {id:127,title:"Attaché·e territorial·e — Concours FPT",org:"Fonction Publique Territoriale",orgEmoji:"🏛️",type:"Emploi",domain:"Administration territoriale",location:"France entière",zone:"France",link:"https://www.cnfpt.fr/offre-de-formation",desc:"Concours d'attaché territorial de catégorie A. Travail dans les communes, départements, régions. Droit, finances locales, RI."},
  {id:128,title:"Alternance — Région Île-de-France (RI & Coopération)",org:"Région Île-de-France",orgEmoji:"🏛️",type:"Alternance",domain:"RI / Coopération décentralisée",location:"Paris",zone:"France",duration:"1–2 ans",link:"https://www.iledefrance.fr/emploi-et-formation",desc:"Alternance dans la direction des Relations Internationales de la Région IDF. Coopération décentralisée, jumelages, Europe."},
  {id:129,title:"Chargé·e de mission Europe — Collectivité",org:"Collectivités territoriales FR",orgEmoji:"🇫🇷",type:"Emploi",domain:"Europe / Fonds structurels",location:"France entière",zone:"France",link:"https://www.emploi-territorial.fr",desc:"Gestion des fonds européens (FEDER, FSE+), coopération transfrontalière, projets Interreg. Communes, métropoles, régions."},
  {id:130,title:"Stage mairie / collectivité — Mission internationale",org:"Mairies & Métropoles",orgEmoji:"🏛️",type:"Stage",domain:"Coopération / Relations internationales",location:"France entière",zone:"France",duration:"3–6 mois",link:"https://www.emploi-territorial.fr",desc:"Stage dans les services RI des grandes villes françaises (Paris, Lyon, Marseille, Bordeaux). Coopération décentralisée, diplomatie des villes."},
  // ── ENSEIGNEMENT / RECHERCHE ──
  {id:131,title:"Enseignant·e-chercheur·se — Universités françaises",org:"Enseignement Supérieur (France)",orgEmoji:"🎓",type:"Emploi",domain:"RI / Science politique / Histoire",location:"France entière",zone:"France",link:"https://www.galaxie.enseignementsup-recherche.gouv.fr",desc:"Maître de conférences ou Professeur des universités. Concours CNU. Disciplines : science politique, droit international, histoire."},
  {id:132,title:"Chercheur·se postdoctorant·e — CNRS",org:"CNRS",orgEmoji:"🔬",type:"Emploi",domain:"Sciences humaines / Géopolitique / Physique",location:"France entière",zone:"France",link:"https://emploi.cnrs.fr",desc:"Postes postdoctoraux et chercheurs permanents CNRS. Sciences humaines et sociales, physique fondamentale, sciences de l'environnement."},
  {id:133,title:"Doctorant·e contractuel·le — Contrats ANR",org:"ANR (France)",orgEmoji:"🔬",type:"Stage",domain:"Recherche / Toutes disciplines",location:"France entière",zone:"France",duration:"3 ans",link:"https://anr.fr/fr/postuler-aux-appels/appels-a-projets/emplois/",desc:"Financement doctoral de l'ANR dans toutes les disciplines. Géopolitique, économie internationale, sciences physiques, philosophie."},
  {id:134,title:"Assistant·e de langue — Programme TAPIF",org:"MEAE / Ministère Éducation",orgEmoji:"🇫🇷",type:"Emploi",domain:"Enseignement / Langues",location:"USA / Canada / Argentine / Allemagne…",zone:"Monde",duration:"7–9 mois",link:"https://www.frenchculture.org/education/tapif",desc:"Enseigner le français dans les écoles primaires ou secondaires à l'étranger. Pour les étudiants français 20–30 ans."},
  {id:135,title:"Professeur·e — Lycées français à l'étranger (AEFE)",org:"AEFE / MEAE",orgEmoji:"🇫🇷",type:"Emploi",domain:"Enseignement",location:"Réseau mondial 560 établissements",zone:"Monde",link:"https://www.aefe.fr/personnels",desc:"Enseigner dans les lycées français à l'étranger (détachement). Toutes disciplines. AEFE gère 560 établissements dans 139 pays."},
  {id:136,title:"Chercheur·se — Institut Pasteur",org:"Institut Pasteur",orgEmoji:"🧬",type:"Emploi",domain:"Sciences / Santé mondiale",location:"Paris / Réseau international",zone:"France",link:"https://www.pasteur.fr/fr/travailler-linstitut-pasteur",desc:"Postes scientifiques à l'Institut Pasteur. Recherche sur les maladies infectieuses, virologie, bactériologie. Réseau international."},
  // ── PHILOSOPHIE / SCIENCES SOCIALES ──
  {id:137,title:"Chargé·e de recherche — Maison des Sciences de l'Homme",org:"MSH / CNRS",orgEmoji:"📚",type:"Emploi",domain:"Sciences sociales / Philosophie",location:"Paris",zone:"France",link:"https://www.msh-paris.fr/emplois",desc:"Postes de recherche en sciences humaines et sociales. Philosophie politique, éthique des RI, sociologie internationale."},
  {id:138,title:"Stage — Comité National d'Éthique (CCNE)",org:"CCNE (France)",orgEmoji:"🧠",type:"Stage",domain:"Éthique / Philosophie / Politique",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.ccne-ethique.fr/fr/page/contact",desc:"Stage au Comité consultatif national d'éthique. Avis sur les questions bioéthiques, intelligence artificielle, enjeux sociaux."},
  {id:139,title:"Directeur·rice de programme — Sciences Po (PSIA)",org:"Sciences Po Paris",orgEmoji:"🎓",type:"Emploi",domain:"RI / Sciences politiques",location:"Paris",zone:"France",link:"https://www.sciencespo.fr/en/research/emplois/",desc:"Postes académiques à Sciences Po. Enseignement et recherche en RI, affaires internationales, développement, sécurité."},
  // ── PHYSIQUE / SCIENCES ──
  {id:140,title:"Chercheur·se — CERN (Organisation européenne)",org:"CERN",orgEmoji:"⚛️",type:"Emploi",domain:"Physique des particules / Sciences",location:"Genève, Suisse",zone:"Europe",link:"https://careers.cern.ch",desc:"Postes scientifiques et techniques au CERN (accélérateur LHC). Physique des hautes énergies, ingénierie, informatique quantique."},
  {id:141,title:"Stage CERN — Physique & Ingénierie",org:"CERN",orgEmoji:"⚛️",type:"Stage",domain:"Physique / Informatique / Ingénierie",location:"Genève, Suisse",zone:"Europe",duration:"4–6 mois",link:"https://careers.cern.ch/students",desc:"Stage au CERN ouvert aux étudiants en physique, informatique, ingénierie. Participation aux expériences LHC (ATLAS, CMS, etc.)."},
  {id:142,title:"Chercheur·se — Agence Spatiale Européenne (ESA)",org:"ESA",orgEmoji:"🚀",type:"Emploi",domain:"Sciences de l'espace / Ingénierie",location:"Paris / Darmstadt / Noordwijk",zone:"Europe",link:"https://www.esa.int/About_Us/Careers_at_ESA",desc:"Postes scientifiques et d'ingénierie à l'ESA. Astronomie, satellites, exploration spatiale, télédétection environnementale."},
  {id:143,title:"Stage ESA — Young Graduate Trainee",org:"ESA",orgEmoji:"🚀",type:"Stage",domain:"Ingénierie / Sciences / Gestion",location:"Paris / Darmstadt / Noordwijk",zone:"Europe",duration:"1 an",deadlineIso:"2026-11-30",deadline:"Clôture : nov. 2026",link:"https://www.esa.int/About_Us/Careers_at_ESA/Young_Graduate_Trainee_YGT_Programme",desc:"Programme YGT de l'ESA pour jeunes diplômés Master. Ingénierie spatiale, sciences, gestion de projets, relations internationales."},
  // ── MEDIA / COMMUNICATION INTERNATIONALE ──
  {id:144,title:"Journaliste — France 24 / RFI",org:"France Médias Monde",orgEmoji:"📡",type:"Emploi",domain:"Journalisme international",location:"Paris",zone:"France",link:"https://www.francemediasmonde.com/emplois",desc:"Journalistes et rédacteurs pour France 24 et RFI. Correspondants à l'étranger, rédaction internationale, reportages. Toutes langues."},
  {id:145,title:"Stage — France 24 / RFI",org:"France Médias Monde",orgEmoji:"📡",type:"Stage",domain:"Journalisme / Communication",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://www.francemediasmonde.com/emplois",desc:"Stage en rédaction internationale à France 24 ou RFI. Reportages, web, multimédia. Anglais ou arabe ou espagnol apprécié."},
  {id:146,title:"Chargé·e de communication — OIT",org:"OIT (ILO)",orgEmoji:"⚖️",type:"Emploi",domain:"Communication internationale",location:"Genève",zone:"Monde",link:"https://www.ilo.org/employment",desc:"Communication institutionnelle, relations médias, production de contenus multilingues pour l'Organisation internationale du travail."},

  // ══════════════════════════════════════════════════════
  // ── PORTAILS OFFICIELS (accès direct aux centaines d'offres en direct) ──
  // ══════════════════════════════════════════════════════
  {id:147,title:"► Portail Carrières ONU — Toutes les offres en direct",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Tous domaines — centaines d'offres actives",location:"New York / Genève / Vienne / Terrain mondial",zone:"Monde",link:"https://careers.un.org",desc:"Portail officiel de l'ONU avec des centaines d'offres actualisées en permanence : officiers politiques, économistes, juristes, humanitaires, communicants, logisticiens, interprètes, analystes, traducteurs, agents administratifs et bien plus. Candidature directe en ligne."},
  {id:148,title:"► Portail Carrières UNESCO — Toutes les offres en direct",org:"UNESCO",orgEmoji:"🎓",type:"Emploi",domain:"Tous secteurs UNESCO — offres actualisées",location:"Paris / Bureaux régionaux monde entier",zone:"Monde",link:"https://careers.unesco.org",desc:"Portail officiel UNESCO avec l'ensemble des vacances de poste dans tous les secteurs (Éducation, Sciences, Culture, Communication, Sciences humaines) et dans les 50+ bureaux régionaux UNESCO sur tous les continents. Candidature directe."},
  {id:149,title:"► INSPIRA — Portail emploi & stages ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Stage",domain:"Tous profils — candidature unifiée",location:"Système onusien mondial",zone:"Monde",link:"https://inspira.un.org",desc:"Plateforme unifiée d'inscription pour les stages, emplois et JPO de l'ensemble du système ONU (ONU, PNUD, UNICEF, UNFPA, PAM, HCR, OMS, UNESCO, FAO, OIT…). Créer un profil unique pour candidater à toutes les agences."},
  {id:150,title:"► UN Women — Carrières & Stages",org:"ONU Femmes (UN Women)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Genre / Droits des femmes",location:"New York / Monde entier",zone:"Monde",link:"https://www.unwomen.org/en/about-us/employment",desc:"Portail emploi d'ONU Femmes. Spécialistes genre, coordination de programmes, plaidoyer, communication. Bureaux dans 90+ pays."},
  {id:151,title:"► PAM — Programme Alimentaire Mondial (Emplois)",org:"PAM (WFP)",orgEmoji:"🌾",type:"Emploi",domain:"Aide alimentaire / Logistique / Terrain",location:"Rome / Terrain mondial (90+ pays)",zone:"Monde",link:"https://www.wfp.org/careers",desc:"Portail emploi du PAM, plus grand organisme humanitaire au monde. Logistique, nutrition, analyse des données, communication, terrain. Prix Nobel de la Paix 2020."},
  {id:152,title:"► UNFPA — Fonds des Nations Unies pour la Population",org:"UNFPA",orgEmoji:"🇺🇳",type:"Emploi",domain:"Santé reproductive / Population",location:"New York / 150+ pays",zone:"Monde",link:"https://www.unfpa.org/careers",desc:"Offres d'emploi au UNFPA. Santé sexuelle et reproductive, populations vulnérables, données démographiques, jeunesse. Présent dans 150+ pays."},

  // ── ONU PAR DÉPARTEMENT ──
  // DPPA — Affaires politiques
  {id:153,title:"Officier·ère des affaires politiques — DPPA",org:"DPPA (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Affaires politiques / Prévention des conflits",location:"New York / Terrain",zone:"Monde",link:"https://careers.un.org",desc:"Département des affaires politiques et de la consolidation de la paix. Analyse politique, médiation, bons offices du SG, prévention des conflits. P2 à P5."},
  {id:154,title:"Officier·ère des droits électoraux — DPPA",org:"DPPA (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Démocratie / Élections",location:"New York / Missions électorales",zone:"Monde",link:"https://careers.un.org",desc:"Appui aux processus électoraux dans les pays en transition. Observation, certification, renforcement des capacités institutionnelles électorales."},
  // DPO — Opérations de paix
  {id:155,title:"Officier·ère des opérations de paix — DPO",org:"DPO (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Opérations de maintien de la paix",location:"Missions terrain (Afrique, Moyen-Orient, Haïti…)",zone:"Monde",link:"https://careers.un.org",desc:"Département des opérations de paix de l'ONU. Coordination des missions (MINUSCA, MONUSCO, UNIFIL, UNDOF, UNMISS…). Civils, policiers, militaires."},
  {id:156,title:"Officier·ère affaires civiles — Missions ONU",org:"ONU Missions (DPO)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Affaires civiles / Gouvernance locale",location:"Terrain (zones post-conflit)",zone:"Monde",link:"https://careers.un.org",desc:"Travail dans les missions de maintien de la paix. Liaison avec les autorités locales, appui à la gouvernance, réintégration des communautés."},
  {id:157,title:"Conseiller·ère État de droit — Missions ONU",org:"ONU Missions (DPO)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Justice / État de droit",location:"Terrain post-conflit",zone:"Monde",link:"https://careers.un.org",desc:"Renforcement du système judiciaire et pénitentiaire dans les pays sortant de conflit. Master Droit + expérience terrain requis."},
  // OCHA
  {id:158,title:"Officier·ère humanitaire — OCHA",org:"OCHA (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Coordination humanitaire",location:"Genève / New York / Terrain crises",zone:"Monde",link:"https://www.unocha.org/career-opportunities",desc:"Coordination des acteurs humanitaires dans les crises. Clusters, appels consolidés, coordination inter-agences. OCHA présent dans 60+ pays."},
  {id:159,title:"Stage OCHA — Coordination humanitaire",org:"OCHA (ONU)",orgEmoji:"🇺🇳",type:"Stage",domain:"Humanitaire / Coordination",location:"Genève / New York",zone:"Monde",duration:"3–6 mois",link:"https://www.unocha.org/career-opportunities",desc:"Stage dans les divisions d'OCHA : appels humanitaires, fonds (CERF), coordination des clusters, reporting."},
  // OLA — Affaires juridiques
  {id:160,title:"Juriste — OLA (Bureau des affaires juridiques ONU)",org:"OLA (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Droit international public",location:"New York",zone:"Monde",link:"https://careers.un.org",desc:"Bureau des affaires juridiques de l'ONU. Droit des traités, droit de la mer, droit commercial international, contentieux ONU."},
  {id:161,title:"Officier·ère des affaires des traités — ONU",org:"ONU (OLA)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Droit international / Traités",location:"New York",zone:"Monde",link:"https://careers.un.org",desc:"Gestion de la collection des traités ONU (plus de 560 traités multilatéraux). Enregistrement, publication, conseil aux États membres."},
  // DESA
  {id:162,title:"Économiste / Analyste politiques — DESA",org:"DESA (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Économie du développement",location:"New York",zone:"Monde",link:"https://careers.un.org",desc:"Département des affaires économiques et sociales. Analyse macro-économique mondiale, ODD, forums politiques de haut niveau."},
  {id:163,title:"Statisticien·ne — Division statistiques ONU",org:"ONU (DESA)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Statistiques / Données mondiales",location:"New York",zone:"Monde",link:"https://careers.un.org",desc:"Collecte et harmonisation des statistiques mondiales. Indicateurs ODD, comptes nationaux, classifications internationales."},
  {id:164,title:"Officier·ère Population — Division population ONU",org:"ONU (DESA)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Démographie / Population",location:"New York",zone:"Monde",link:"https://careers.un.org",desc:"Estimations et projections de population mondiale, migrations, vieillissement démographique, bases de données mondiales."},
  // DGC — Communication
  {id:165,title:"Officier·ère d'information publique — DGC",org:"DGC (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Communication / Information publique",location:"New York / Genève",zone:"Monde",link:"https://careers.un.org",desc:"Département de la communication globale de l'ONU. Médias, campagnes, partenariats avec sociétés civiles, centres d'information nationaux."},
  {id:166,title:"Stage DGC — Communication numérique",org:"DGC (ONU)",orgEmoji:"🇺🇳",type:"Stage",domain:"Communication digitale",location:"New York",zone:"Monde",duration:"3–6 mois",link:"https://careers.un.org/internship",desc:"Stage dans la direction communication de l'ONU. Réseaux sociaux, production de contenus multimédia, couverture des événements onusiens."},
  // OHCHR
  {id:167,title:"Officier·ère droits de l'homme — OHCHR P3",org:"OHCHR (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Droits de l'homme",location:"Genève / Terrain missions",zone:"Monde",link:"https://www.ohchr.org/en/get-involved/opportunities",desc:"Haut-Commissariat aux droits de l'homme. Rapporteurs spéciaux, organes conventionnels, Conseil des droits de l'homme, missions de terrain."},
  {id:168,title:"Officier·ère procédures spéciales — OHCHR",org:"OHCHR (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Droits de l'homme / Procédures spéciales",location:"Genève",zone:"Monde",link:"https://www.ohchr.org/en/get-involved/opportunities",desc:"Appui aux Rapporteurs spéciaux et Groupes de travail de l'ONU (torture, discrimination, droit à l'alimentation, etc.)."},
  // Services linguistiques
  {id:169,title:"Traducteur·rice français·e — Conférence ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Traduction / Langues",location:"New York / Genève / Vienne / Nairobi",zone:"Monde",link:"https://careers.un.org",desc:"Concours de traducteur francophone ONU. Traduction de documents officiels de et vers le français. Une seconde langue officielle requise."},
  {id:170,title:"Interprète de conférence — ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Interprétation de conférence",location:"New York / Genève / Vienne / Nairobi",zone:"Monde",link:"https://careers.un.org",desc:"Concours d'interprète ONU. Interprétation simultanée dans les 6 langues officielles (EN, FR, ES, AR, ZH, RU). Niveau C expert requis."},
  {id:171,title:"Éditeur·rice / Réviseur·se — Documents ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Édition / Langues",location:"New York / Genève",zone:"Monde",link:"https://careers.un.org",desc:"Révision et édition des documents officiels onusiens. Maîtrise parfaite du français et anglais. Normes de publication ONU."},
  // Administratif/Finance ONU
  {id:172,title:"Officier·ère finances — ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Finance / Comptabilité",location:"New York / Genève / Terrain",zone:"Monde",link:"https://careers.un.org",desc:"Gestion financière des programmes et missions ONU. Budgétisation, contrôle des coûts, rapports financiers. CPA/CFA ou Master Finance."},
  {id:173,title:"Officier·ère achats — ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Achats / Logistique",location:"New York / Copenhague / Terrain",zone:"Monde",link:"https://careers.un.org",desc:"Marchés publics et logistique de l'ONU. Appels d'offres internationaux, gestion des contrats fournisseurs, normes UNCITRAL."},
  {id:174,title:"Officier·ère RH — ONU",org:"Nations Unies",orgEmoji:"🇺🇳",type:"Emploi",domain:"Ressources humaines",location:"New York / Genève",zone:"Monde",link:"https://careers.un.org",desc:"Gestion des ressources humaines du système ONU. Recrutement, classification des postes, gestion des carrières, droit du personnel."},
  {id:175,title:"Officier·ère sécurité — UNDSS",org:"UNDSS (ONU)",orgEmoji:"🇺🇳",type:"Emploi",domain:"Sécurité internationale",location:"Terrain mondial",zone:"Monde",link:"https://careers.un.org",desc:"Service de sécurité ONU. Gestion de la sécurité des personnels onusiens en zones de crise. Expérience militaire/police + formation sécurité."},

  // ── UNESCO PAR SECTEUR ──
  // Éducation (ED)
  {id:176,title:"Spécialiste programme éducation — Alphabétisation",org:"UNESCO (Éducation)",orgEmoji:"🎓",type:"Emploi",domain:"Éducation / Alphabétisation",location:"Paris / Bureaux régionaux",zone:"Monde",link:"https://careers.unesco.org",desc:"Programmes d'alphabétisation des adultes et d'éducation tout au long de la vie. UNESCO Institut de l'UNESCO pour l'apprentissage tout au long de la vie (UIL)."},
  {id:177,title:"Spécialiste enseignement supérieur — UNESCO",org:"UNESCO (Éducation)",orgEmoji:"🎓",type:"Emploi",domain:"Éducation / Universités",location:"Paris",zone:"Monde",link:"https://careers.unesco.org",desc:"Politiques d'enseignement supérieur, reconnaissance des diplômes (Conventions de Lisbonne), mobilité étudiante, qualité universitaire."},
  {id:178,title:"Spécialiste éducation inclusive — UNESCO",org:"UNESCO (Éducation)",orgEmoji:"🎓",type:"Emploi",domain:"Éducation inclusive / Handicap",location:"Paris / Terrain",zone:"Monde",link:"https://careers.unesco.org",desc:"Promotion de l'éducation inclusive pour les personnes handicapées, les réfugiés, les filles. Renforcement des capacités des ministères."},
  {id:179,title:"Spécialiste curriculum & manuels — UNESCO",org:"UNESCO (Éducation)",orgEmoji:"🎓",type:"Emploi",domain:"Curriculum / Développement éducatif",location:"Paris / Terrain Afrique",zone:"Monde",link:"https://careers.unesco.org",desc:"Développement de curricula scolaires, manuels scolaires inclusifs et de qualité. Appui technique aux ministères de l'éducation."},
  {id:180,title:"Spécialiste éducation en situations d'urgence",org:"UNESCO (Éducation)",orgEmoji:"🎓",type:"Emploi",domain:"Éducation / Crises humanitaires",location:"Paris / Terrain crises",zone:"Monde",link:"https://careers.unesco.org",desc:"Maintien de l'éducation dans les crises (conflits, catastrophes). Cluster Éducation, espaces temporaires d'apprentissage, psychosocial."},
  {id:181,title:"Spécialiste données éducation — ISU",org:"ISU (UNESCO)",orgEmoji:"🎓",type:"Emploi",domain:"Statistiques éducation / Données",location:"Montréal, Canada",zone:"Monde",link:"https://careers.unesco.org",desc:"Institut de statistiques de l'UNESCO à Montréal. Collecte des données éducatives mondiales, indicateurs ODD4, rapports mondiaux."},
  {id:182,title:"Stage UNESCO — Éducation 2030",org:"UNESCO (Éducation)",orgEmoji:"🎓",type:"Stage",domain:"Politique éducative / ODD4",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://careers.unesco.org",desc:"Stage dans la division Éducation 2030 de l'UNESCO. Suivi des objectifs mondiaux, rapport mondial sur l'éducation, coordination inter-agences."},
  // Sciences naturelles (SC)
  {id:183,title:"Spécialiste sciences de l'eau — UNESCO IHP",org:"UNESCO (Sciences)",orgEmoji:"🎓",type:"Emploi",domain:"Sciences hydrologiques / Eau",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Programme hydrologique international (IHP). Politiques de l'eau, gestion durable des ressources en eau, coopération scientifique internationale."},
  {id:184,title:"Spécialiste sciences de l'océan — UNESCO COI",org:"UNESCO (COI)",orgEmoji:"🎓",type:"Emploi",domain:"Océanographie / Sciences marines",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Commission océanographique intergouvernementale (COI/IOC). Décennie des sciences océaniques, tsunamis, changement climatique marin."},
  {id:185,title:"Spécialiste Open Science — UNESCO",org:"UNESCO (Sciences)",orgEmoji:"🎓",type:"Emploi",domain:"Science ouverte / Politique scientifique",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Mise en œuvre de la Recommandation UNESCO sur la science ouverte (2021). Accès libre aux publications, données de recherche, éthique scientifique."},
  {id:186,title:"Spécialiste biodiversité — UNESCO MAB",org:"UNESCO (Sciences)",orgEmoji:"🎓",type:"Emploi",domain:"Biodiversité / Réserves biosphère",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Programme Man and the Biosphere (MAB). Réseau mondial des réserves de biosphère (738 sites, 134 pays). Conservation et développement durable."},
  {id:187,title:"Stage UNESCO — Sciences naturelles",org:"UNESCO (Sciences)",orgEmoji:"🎓",type:"Stage",domain:"Sciences / Politique scientifique",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://careers.unesco.org",desc:"Stage dans le secteur des sciences naturelles. Eau, océans, biodiversité, géosciences, science ouverte. Profil ingénieur ou sciences de l'environnement."},
  // Culture (CLT)
  {id:188,title:"Spécialiste patrimoine mondial — UNESCO",org:"UNESCO (Culture)",orgEmoji:"🎓",type:"Emploi",domain:"Patrimoine mondial / Conservation",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Gestion de la Convention du Patrimoine mondial (1972). 1199 sites inscrits. Processus d'inscription, reporting des États, conservation préventive."},
  {id:189,title:"Spécialiste patrimoine immatériel — UNESCO",org:"UNESCO (Culture)",orgEmoji:"🎓",type:"Emploi",domain:"Patrimoine immatériel / PCI",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Convention pour la sauvegarde du patrimoine culturel immatériel (2003). Listes, plans de sauvegarde, renforcement des capacités."},
  {id:190,title:"Spécialiste diversité culturelle — UNESCO",org:"UNESCO (Culture)",orgEmoji:"🎓",type:"Emploi",domain:"Diversité culturelle / Industries créatives",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Convention sur la diversité des expressions culturelles (2005). Industries créatives, commerce culturel, politiques culturelles nationales."},
  {id:191,title:"Spécialiste musées — UNESCO / ICOM",org:"UNESCO (Culture)",orgEmoji:"🎓",type:"Emploi",domain:"Musées / Patrimoine",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Développement des musées, restitution des biens culturels, trafic illicite d'antiquités, numérisation du patrimoine."},
  {id:192,title:"Stage UNESCO — Culture & Patrimoine",org:"UNESCO (Culture)",orgEmoji:"🎓",type:"Stage",domain:"Patrimoine / Culture",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://careers.unesco.org",desc:"Stage dans le secteur culture de l'UNESCO. Patrimoine mondial, immatériel, diversité culturelle, industries créatives."},
  // Sciences humaines et sociales (SHS)
  {id:193,title:"Spécialiste éthique de l'IA — UNESCO",org:"UNESCO (SHS)",orgEmoji:"🎓",type:"Emploi",domain:"Éthique IA / Sciences humaines",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Mise en œuvre de la Recommandation UNESCO sur l'éthique de l'IA (2021). Outil d'évaluation de l'état de préparation, gouvernance de l'IA."},
  {id:194,title:"Spécialiste sports & développement — UNESCO",org:"UNESCO (SHS)",orgEmoji:"🎓",type:"Emploi",domain:"Sport / Développement humain",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Convention internationale contre le dopage dans le sport (2005), Convention sur la manipulation des compétitions sportives (2021). Politique sportive internationale."},
  {id:195,title:"Spécialiste transformations sociales — UNESCO",org:"UNESCO (SHS)",orgEmoji:"🎓",type:"Emploi",domain:"Sciences sociales / Transformations",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Programme MOST (Management of Social Transformations). Politiques fondées sur la science, inclusion sociale, migrations."},
  {id:196,title:"Stage UNESCO — Sciences humaines & Éthique IA",org:"UNESCO (SHS)",orgEmoji:"🎓",type:"Stage",domain:"Éthique / Sciences sociales",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://careers.unesco.org",desc:"Stage dans le secteur sciences humaines de l'UNESCO. Éthique de l'IA, sport, transformations sociales. Profil philosophie, sociologie, RI."},
  // Communication et information (CI)
  {id:197,title:"Spécialiste liberté de la presse — UNESCO",org:"UNESCO (CI)",orgEmoji:"🎓",type:"Emploi",domain:"Liberté de la presse / Médias",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Programme IPDC (Développement de la communication). Sécurité des journalistes, indicateurs de développement des médias, lutte contre la désinformation."},
  {id:198,title:"Spécialiste information & démocratie — UNESCO",org:"UNESCO (CI)",orgEmoji:"🎓",type:"Emploi",domain:"Infodémie / Médias / Démocratie",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Maîtrise de l'information et des médias (MIL), lutte contre la désinformation, régulation des plateformes, journalisme de qualité."},
  {id:199,title:"Spécialiste transformation numérique — UNESCO",org:"UNESCO (CI)",orgEmoji:"🎓",type:"Emploi",domain:"Numérique / Inclusion",location:"Paris",zone:"France",link:"https://careers.unesco.org",desc:"Inclusion numérique, gouvernance de l'internet, Intelligence artificielle et éducation, fracture numérique Nord-Sud."},
  {id:200,title:"Stage UNESCO — Communication & Information",org:"UNESCO (CI)",orgEmoji:"🎓",type:"Stage",domain:"Médias / Communication",location:"Paris",zone:"France",duration:"3–6 mois",link:"https://careers.unesco.org",desc:"Stage dans le secteur communication de l'UNESCO. Liberté de presse, médias, numérique, maîtrise de l'information."},
  // Bureaux régionaux UNESCO
  {id:201,title:"Chargé·e de programme — UNESCO Dakar (BREDA)",org:"UNESCO Dakar",orgEmoji:"🎓",type:"Emploi",domain:"Éducation / Culture / Afrique de l'Ouest",location:"Dakar, Sénégal",zone:"Monde",link:"https://careers.unesco.org",desc:"Bureau régional UNESCO pour l'Afrique de l'Ouest. Programmes éducatifs, patrimoine, alphabétisation dans 13 pays francophones."},
  {id:202,title:"Chargé·e de programme — UNESCO Le Caire",org:"UNESCO Le Caire",orgEmoji:"🎓",type:"Emploi",domain:"Culture / Sciences / Monde arabe",location:"Le Caire, Égypte",zone:"Monde",link:"https://careers.unesco.org",desc:"Bureau UNESCO pour l'Égypte. Éducation, culture, sciences dans le monde arabe. Coordination avec les États membres de la région."},
  {id:203,title:"Chargé·e de programme — UNESCO Bangkok",org:"UNESCO Bangkok (PROAP)",orgEmoji:"🎓",type:"Emploi",domain:"Éducation / Asie-Pacifique",location:"Bangkok, Thaïlande",zone:"Monde",link:"https://careers.unesco.org",desc:"Bureau régional UNESCO pour l'Asie-Pacifique (PROAP). 46 États membres. Éducation, culture, sciences en Asie du Sud-Est et Pacifique."},
  {id:204,title:"Chargé·e de programme — UNESCO Nairobi",org:"UNESCO Nairobi",orgEmoji:"🎓",type:"Emploi",domain:"Sciences / Afrique de l'Est",location:"Nairobi, Kenya",zone:"Monde",link:"https://careers.unesco.org",desc:"Bureau UNESCO pour l'Afrique orientale et australe. Sciences naturelles, éducation, eau, écosystèmes, jeunesse."},
  {id:205,title:"Chargé·e de programme — UNESCO Beyrouth",org:"UNESCO Beyrouth",orgEmoji:"🎓",type:"Emploi",domain:"Culture / Patrimoine / Moyen-Orient",location:"Beyrouth, Liban",zone:"Monde",link:"https://careers.unesco.org",desc:"Bureau UNESCO pour les États arabes. Patrimoine culturel, éducation en situation d'urgence, droits culturels au Moyen-Orient."},
  {id:206,title:"Stage UNESCO — Bureau régional (Afrique / Asie)",org:"UNESCO (Terrain)",orgEmoji:"🎓",type:"Stage",domain:"Coopération / Développement",location:"Dakar / Bangkok / Nairobi / Le Caire…",zone:"Monde",duration:"3–6 mois",link:"https://careers.unesco.org",desc:"Stages dans les 50+ bureaux régionaux de l'UNESCO. Possibilité en Afrique, Asie, Amérique latine, États arabes, Europe. Profil généraliste RI."},
];


// ── OPPORTUNITIES SCREEN ──────────────────────────────────────
function OpportunitiesScreen({T}:{T:Theme}) {
  const [typeFilter,setTypeFilter] = useState("Tout");
  const [zoneFilter,setZoneFilter] = useState("Tout");
  const [search,setSearch] = useState("");
  const [showExpired,setShowExpired] = useState(false);
  const [lastRefresh,setLastRefresh] = useState(()=>new Date());
  const [saved,setSaved] = useState<Set<number>>(()=>{
    if(typeof window==="undefined") return new Set();
    try{return new Set(JSON.parse(localStorage.getItem("nexus_saved_opps")||"[]"));}catch{return new Set();}
  });

  useEffect(()=>{
    const t=setInterval(()=>setLastRefresh(new Date()),24*60*60*1000);
    return()=>clearInterval(t);
  },[]);

  const today=lastRefresh.toISOString().slice(0,10);
  const daysUntil=(iso:string)=>Math.round((new Date(iso).getTime()-new Date(today).getTime())/86400000);

  const toggleSave=(id:number)=>{
    setSaved(s=>{
      const ns=new Set(s);
      ns.has(id)?ns.delete(id):ns.add(id);
      localStorage.setItem("nexus_saved_opps",JSON.stringify([...ns]));
      return ns;
    });
  };

  // Professional 2-letter org badge derived from name
  const orgInitials=(org:string)=>{
    const w=org.replace(/[()]/g,"").split(/[\s\/\-\.&]+/).filter(Boolean);
    if(w.length>=2) return (w[0][0]+(w[1][0]||"")).toUpperCase();
    return org.slice(0,2).toUpperCase();
  };
  const orgBadgeColor=(org:string)=>{
    const palette=[T.blueB,"#7C3AED","#0891B2","#BE185D","#16A34A","#D97706","#64748B","#E03535"];
    return palette[org.charCodeAt(0)%palette.length];
  };

  const types=["Tout","Stage","Alternance","Emploi","Bénévolat","JPO"];
  const zones=["Tout","France","Europe","Monde"];
  const typeColors:Record<string,string>={Stage:T.blueB,Alternance:"#7C3AED",Emploi:"#16A34A",Bénévolat:"#D97706",JPO:"#E03535"};
  const zoneCode:Record<string,string>={France:"FR",Europe:"UE",Monde:"INT"};

  const q=search.toLowerCase();
  const matchFilters=(o:Opportunity)=>{
    if(typeFilter!=="Tout"&&o.type!==typeFilter) return false;
    if(zoneFilter!=="Tout"&&o.zone!==zoneFilter) return false;
    if(q&&!o.title.toLowerCase().includes(q)&&!o.org.toLowerCase().includes(q)&&!o.domain.toLowerCase().includes(q)) return false;
    return true;
  };
  const isExpired=(o:Opportunity)=>!!o.deadlineIso&&o.deadlineIso<today;

  const allMatch=OPPORTUNITIES_DATA.filter(matchFilters);
  const active=allMatch.filter(o=>!isExpired(o));
  const expired=allMatch.filter(isExpired);
  const savedActive=active.filter(o=>saved.has(o.id));
  const unsavedActive=active.filter(o=>!saved.has(o.id));
  const display=[...savedActive,...unsavedActive,...(showExpired?expired:[])];

  const fmtDate=(iso:string)=>{const d=new Date(iso);return d.toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"});};

  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div>
          <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Carrières &amp; Engagement</p>
          <h1 style={{fontFamily:"'Inter',system-ui,sans-serif",fontSize:24,fontWeight:800,color:T.text,marginBottom:4}}>Opportunités</h1>
          <p style={{color:T.textD,fontSize:12}}>Stages · Alternances · Emplois · Bénévolat</p>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <p style={{color:T.muted,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Actualisé le</p>
          <p style={{color:T.textD,fontSize:11,fontWeight:700}}>{lastRefresh.toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"})}</p>
          <p style={{color:T.muted,fontSize:10,marginTop:2}}>{active.length} offres actives</p>
        </div>
      </div>
      {/* Search */}
      <div style={{position:"relative"}}>
        <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",display:"flex"}}><Ic n="search" s={14} c={T.muted}/></span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Poste, organisation, domaine…" style={{width:"100%",padding:"9px 12px 9px 34px",borderRadius:10,border:`1px solid ${T.b1}`,background:T.bg2,color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
      </div>
      {/* Type filters */}
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
        {types.map(t=>{
          const col=typeColors[t]||T.blueB;
          const active2=typeFilter===t;
          return <button key={t} onClick={()=>setTypeFilter(t)} style={{padding:"5px 13px",borderRadius:6,border:`1px solid ${active2?col:T.b1}`,background:active2?col:"transparent",color:active2?"#fff":T.textD,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit",transition:"all .15s",letterSpacing:.3}}>{t}</button>;
        })}
      </div>
      {/* Zone filters */}
      <div style={{display:"flex",gap:6,overflowX:"auto"}}>
        {zones.map(z=>{
          const active2=zoneFilter===z;
          return(
            <button key={z} onClick={()=>setZoneFilter(z)} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${active2?T.blueB:T.b1}`,background:active2?T.blueG:"transparent",color:active2?T.blueB:T.textD,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit",transition:"all .15s",display:"flex",alignItems:"center",gap:5}}>
              {z!=="Tout"&&<span style={{fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:3,background:active2?T.blueB+"22":T.b1,color:active2?T.blueB:T.muted,letterSpacing:.5}}>{zoneCode[z]}</span>}
              {z}
            </button>
          );
        })}
      </div>
      {/* Count + expired toggle */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
        <p style={{color:T.muted,fontSize:11}}>{display.length} résultat{display.length>1?"s":""}{saved.size>0?<span style={{color:T.amber,fontWeight:700}}> · {savedActive.length} sauvegardé{savedActive.length>1?"s":""}</span>:""}</p>
        {expired.length>0&&(
          <button onClick={()=>setShowExpired(s=>!s)} style={{fontSize:11,fontWeight:600,color:T.muted,background:"none",border:`1px solid ${T.b1}`,borderRadius:6,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
            <Ic n="lock" s={11} c={T.muted}/>
            {showExpired?"Masquer":"Voir"} {expired.length} expirée{expired.length>1?"s":""}
          </button>
        )}
      </div>
      {/* Cards */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {display.length===0&&<div style={{textAlign:"center",padding:40}}><p style={{color:T.muted,fontSize:14}}>Aucune opportunité pour ces filtres</p></div>}
        {display.map(o=>{
          const col=typeColors[o.type]||T.blueB;
          const isSaved=saved.has(o.id);
          const exp=isExpired(o);
          const days=o.deadlineIso?daysUntil(o.deadlineIso):null;
          const urgent=days!==null&&days>=0&&days<=30;
          const badgeColor=orgBadgeColor(o.org);
          return(
            <div key={o.id} style={{background:T.card,border:`1px solid ${exp?T.b1:isSaved?col+"40":T.b1}`,borderLeft:`3px solid ${exp?"#9CA3AF":col}`,borderRadius:10,padding:14,display:"flex",flexDirection:"column",gap:8,opacity:exp?0.55:1}}>
              {/* Expired notice */}
              {exp&&<div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:5,background:T.bg2,border:`1px solid ${T.b1}`,alignSelf:"flex-start"}}><Ic n="lock" s={10} c={T.muted}/><span style={{color:T.muted,fontSize:10,fontWeight:700,letterSpacing:.3}}>CLÔTURÉ — {fmtDate(o.deadlineIso!)}</span></div>}
              {/* Org + title row */}
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                {/* Org initial badge */}
                <div style={{width:36,height:36,borderRadius:8,background:`${badgeColor}18`,border:`1px solid ${badgeColor}30`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:11,fontWeight:900,color:badgeColor,letterSpacing:.5}}>{orgInitials(o.org)}</span>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,flexWrap:"wrap"}}>
                    <span style={{color:T.textD,fontSize:11,fontWeight:600}}>{o.org}</span>
                    <span style={{width:3,height:3,borderRadius:"50%",background:T.muted,display:"inline-block"}}/>
                    <span style={{fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:3,background:`${col}15`,color:col,border:`1px solid ${col}25`,letterSpacing:.5,textTransform:"uppercase"}}>{o.type}</span>
                    <span style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,background:T.bg2,color:T.muted,border:`1px solid ${T.b1}`,letterSpacing:.5}}>{zoneCode[o.zone]||o.zone}</span>
                  </div>
                  <p style={{color:T.text,fontSize:13,fontWeight:700,lineHeight:1.35,margin:0}}>{o.title}</p>
                </div>
                {/* Save button */}
                <button onClick={()=>toggleSave(o.id)} style={{background:"none",border:"none",cursor:"pointer",padding:4,flexShrink:0,opacity:isSaved?1:0.4}} title={isSaved?"Retirer des favoris":"Sauvegarder"}>
                  <Ic n="star" s={16} c={isSaved?T.amber:T.muted}/>
                </button>
              </div>
              {/* Description */}
              <p style={{color:T.textD,fontSize:11,lineHeight:1.55,margin:0}}>{o.desc}</p>
              {/* Meta row */}
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <Ic n="map" s={11} c={T.muted}/>
                  <span style={{color:T.muted,fontSize:11}}>{o.location}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <Ic n="brief" s={11} c={T.muted}/>
                  <span style={{color:T.muted,fontSize:11}}>{o.domain}</span>
                </div>
                {o.duration&&<div style={{display:"flex",alignItems:"center",gap:4}}>
                  <Ic n="cal" s={11} c={T.muted}/>
                  <span style={{color:T.muted,fontSize:11}}>{o.duration}</span>
                </div>}
              </div>
              {/* Deadline bar */}
              {o.deadline&&!exp&&(
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:6,background:urgent?`${T.red}08`:`${T.amber}08`,border:`1px solid ${urgent?T.red+"30":T.amber+"30"}`}}>
                  <Ic n="bell" s={11} c={urgent?T.red:T.amber}/>
                  <span style={{color:urgent?T.red:T.amber,fontSize:11,fontWeight:700}}>{o.deadline}</span>
                  {days!==null&&days>=0&&<span style={{color:urgent?T.red:T.amber,fontSize:11,opacity:.8}}>— J-{days}</span>}
                </div>
              )}
              {/* CTA */}
              <a href={o.link} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"9px 14px",borderRadius:7,border:`1px solid ${exp?T.b1:col}`,background:exp?"transparent":`${col}08`,color:exp?T.muted:col,fontSize:12,fontWeight:700,textDecoration:"none",fontFamily:"inherit",letterSpacing:.3,transition:"all .15s"}}>
                {exp?"Consulter (offre clôturée)":"Accéder à l'offre"}
                {!exp&&<Ic n="chevR" s={13} c={col}/>}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── EVENTS SCREEN ─────────────────────────────────────────────
function EventsScreen({T}:{T:Theme}) {
  const [subTab,setSubTab] = useState<"events"|"opps">("events");
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
  // ev.mode contient des emojis dans les données — on filtre par inclusion du mot clé
  const modeLabels=["En ligne","Hybride","Présentiel"];
  const filtered=filter==="Tout"?allEvents:modeLabels.includes(filter)?allEvents.filter(e=>e.mode?.includes(filter)):allEvents.filter(e=>e.type===filter);
  const sorted=userLoc?[...filtered].sort((a,b)=>haversine(userLoc.lat,userLoc.lng,a.lat,a.lng)-haversine(userLoc.lat,userLoc.lng,b.lat,b.lng)):filtered;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      <div style={{display:"flex",borderBottom:`1px solid ${T.b1}`,background:T.card}}>
        {([["events","Agenda"],["opps","Opportunités"]] as [string,string][]).map(([id,label])=>(
          <button key={id} onClick={()=>setSubTab(id as "events"|"opps")} style={{flex:1,padding:"13px 8px",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,color:subTab===id?T.blueB:T.textD,borderBottom:subTab===id?`2px solid ${T.blueB}`:"2px solid transparent",transition:"all .2s"}}>
            {label}
          </button>
        ))}
      </div>
      {subTab==="opps"&&<OpportunitiesScreen T={T}/>}
      {subTab==="events"&&<div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
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
          {!userLoc&&<p style={{color:T.muted,fontSize:11}}>Activez la géolocalisation pour que l&apos;événement soit localisé correctement</p>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setShowAdd(false)} style={{flex:1,padding:10,borderRadius:8,border:`1px solid ${T.b1}`,background:"transparent",color:T.textD,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Annuler</button>
            <button onClick={addEvent} disabled={!newTitle||!newLoc||!newDate} style={{flex:2,padding:10,borderRadius:8,border:"none",background:newTitle&&newLoc&&newDate?T.blueB:T.b1,color:newTitle&&newLoc&&newDate?"#fff":T.muted,fontSize:12,fontWeight:800,cursor:newTitle&&newLoc&&newDate?"pointer":"not-allowed",fontFamily:"inherit"}}>Publier l&apos;événement</button>
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
        {(["Tout","En ligne","Hybride","Présentiel","Conférence","Forum","Sommet","Webinaire","Simulation","Concours","Commémoration"] as const).map(f=>{
          const isModeFilter=["En ligne","Hybride","Présentiel"].includes(f);
          const modeColor=f==="En ligne"?"#3B82F6":f==="Hybride"?"#F59E0B":f==="Présentiel"?"#10B981":T.blueB;
          const active=filter===f;
          return(
            <button key={f} onClick={()=>setFilter(f)} style={{padding:"5px 13px",borderRadius:6,border:`1px solid ${active?(isModeFilter?modeColor:T.blueB):T.b1}`,background:active?(isModeFilter?modeColor:T.blueB):"transparent",color:active?"#fff":T.textD,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit",transition:"all .15s",display:"flex",alignItems:"center",gap:5}}>
              {isModeFilter&&<span style={{width:6,height:6,borderRadius:"50%",background:active?"#ffffff80":modeColor,display:"inline-block",flexShrink:0}}/>}
              {f}
            </button>
          );
        })}
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
                {ev.mode&&(()=>{
                  const isOnline=ev.mode.includes("ligne");
                  const isHybrid=ev.mode.includes("Hybride");
                  const col=isOnline?"#3B82F6":isHybrid?"#F59E0B":"#10B981";
                  const label=isOnline?"En ligne":isHybrid?"Hybride":"Présentiel";
                  const icon=isOnline?"globe":isHybrid?"globe":"users";
                  return(
                    <div style={{marginBottom:6,display:"inline-flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:5,background:`${col}10`,border:`1px solid ${col}25`}}>
                      <span style={{width:6,height:6,borderRadius:"50%",background:col,display:"inline-block",flexShrink:0}}/>
                      <Ic n={icon} s={11} c={col}/>
                      <span style={{fontSize:11,fontWeight:700,color:col,letterSpacing:.2}}>{label}</span>
                    </div>
                  );
                })()}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                  <span style={{color:T.muted,fontSize:11}}>
                    {dist!==null?<><Ic n="map" s={10} c={T.muted}/> {fmtDist(dist)} · </>:""}{ev.attendees} inscrit{ev.attendees>1?"s":""}
                  </span>
                  <div style={{display:"flex",gap:6}}>
                    {ev.link&&!reg.has(ev.id)&&(
                      <a href={ev.link} target="_blank" rel="noopener noreferrer" style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${T.blueB}50`,background:T.blueG,color:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
                        <Ic n="globe" s={12} c={T.blueB}/>Suivre en ligne
                      </a>
                    )}
                    <button onClick={()=>{
                      const wasReg=reg.has(ev.id);
                      setReg(s=>{const ns=new Set(s);ns.has(ev.id)?ns.delete(ev.id):ns.add(ev.id);return ns;});
                      if(!wasReg&&ev.link) window.open(ev.link,"_blank","noopener,noreferrer");
                    }} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${reg.has(ev.id)?T.green:T.blueB}`,background:reg.has(ev.id)?`${T.green}15`:T.blueG,color:reg.has(ev.id)?T.green:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                      {reg.has(ev.id)?<><Ic n="check" s={12} c={T.green}/>Inscrit</>:"S'inscrire"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>}
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
            <div style={{width:28,height:28,borderRadius:7,background:"#E8854020",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n="zap" s={14} c="#E88540"/></div>
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
            <div style={{width:28,height:28,borderRadius:7,background:"#7C3AED20",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n="mic" s={14} c="#7C3AED"/></div>
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
  // ── PREMIUM DISCOURS ─────────────────────────────────────────
  {id:41,premium:true,title:"Discours du Congrès de Tours",speaker:"Jean Jaurès",year:"1903",country:"🇫🇷",theme:"Socialisme",excerpt:"Le socialisme, c'est l'humanité qui prend conscience d'elle-même et qui veut s'organiser conformément à sa raison et à sa justice.",techniques:["Universalisme","Logos humaniste","Vision progressiste","Éthos du tribun"]},
  {id:42,premium:true,title:"Défense de la République",speaker:"Léon Gambetta",year:"1870",country:"🇫🇷",theme:"République",excerpt:"Nous avons, nous qui sommes les enfants de la Révolution, contracté l'obligation de défendre et de transmettre à nos fils l'héritage de nos pères.",techniques:["Filiation historique","Pathos patriotique","Urgence nationale","Métaphore de l'héritage"]},
  {id:43,premium:true,title:"Discours sur la misère",speaker:"Victor Hugo",year:"1849",country:"🇫🇷",theme:"Justice sociale",excerpt:"Je vous demande l'abolition de la misère. La misère est le vol que font les institutions aux hommes. Il faut que cette société soit changée.",techniques:["Accusation morale","Pathos de l'indignation","Logos social","Impératif moral"]},
  {id:44,premium:true,title:"J'accuse",speaker:"Émile Zola",year:"1898",country:"🇫🇷",theme:"Justice",excerpt:"J'accuse le lieutenant-colonel du Paty de Clam d'avoir été l'ouvrier diabolique de l'erreur judiciaire. J'accuse le général Mercier d'avoir été complice, par faiblesse d'esprit, d'une des plus grandes iniquités du siècle.",techniques:["Anaphore accusatoire","Courage civil","Logos judiciaire","Pathos de la vérité"]},
  {id:45,premium:true,title:"Discours de guerre totale",speaker:"Joseph Goebbels",year:"1943",country:"🇩🇪",theme:"Propagande",excerpt:"Vous voulez la guerre totale ? Si nécessaire, voulez-vous une guerre plus totale et plus radicale que tout ce que nous pouvons même imaginer aujourd'hui ?",techniques:["Manipulation de foule","Question rhétorique","Catharsis collective","Démagogie"]},
  {id:46,premium:true,title:"Ich bin ein Berliner",speaker:"John F. Kennedy",year:"1963",country:"🇺🇸",theme:"Liberté",excerpt:"Il y a deux mille ans, la fierté suprême était de dire civis Romanus sum. Aujourd'hui, dans le monde libre, la fierté suprême est de dire Ich bin ein Berliner.",techniques:["Référence historique","Solidarité transculturelle","Gradation","Climax identitaire"]},
  {id:47,premium:true,title:"Discours d'Addis-Abeba",speaker:"Haïlé Sélassié",year:"1963",country:"🇪🇹",theme:"Panafricanisme",excerpt:"Jusqu'à ce que la couleur d'un homme ne soit plus plus importante que la couleur de ses yeux, la guerre ne cessera pas.",techniques:["Prophétie morale","Vision universelle","Pathos de la dignité","Reggae prophecy"]},
  {id:48,premium:true,title:"Discours de Pékin - Tiananmen",speaker:"Zhao Ziyang",year:"1989",country:"🇨🇳",theme:"Démocratie",excerpt:"Nous sommes venus trop tard. Nous sommes venus trop tard pour vous. Vous ne nous en voudrez pas.",techniques:["Confession publique","Pathos de la défaite","Courage politique","Éthos du sacrifice"]},
  {id:49,premium:true,title:"Discours des femmes de Liberia",speaker:"Leymah Gbowee",year:"2003",country:"🇱🇷",theme:"Paix",excerpt:"Nous n'en pouvons plus des guerres. Nos corps et les corps de nos enfants sont le champ de bataille. Nous exigeons la paix.",techniques:["Voix collective","Pathos corporel","Revendication directe","Sororité politique"]},
  {id:50,premium:true,title:"Blood, Toil, Tears and Sweat",speaker:"Winston Churchill",year:"1940",country:"🇬🇧",theme:"Guerre",excerpt:"Je n'ai rien à offrir que du sang, du labeur, des larmes et de la sueur. Vous demandez : quelle est notre politique ? Je répondrai : la guerre.",techniques:["Gravitas maximale","Honnêteté brutale","Gradation dramatique","Mobilisation nationale"]},
  {id:51,premium:true,title:"Discours de Bandung",speaker:"Jawaharlal Nehru",year:"1955",country:"🇮🇳",theme:"Non-alignement",excerpt:"L'Asie et l'Afrique ne se laisseront plus gouverner par l'Europe. Nous traçons notre propre voie, conformément à nos traditions et à nos intérêts.",techniques:["Émancipation collective","Identité continentale","Rupture avec le colonialisme","Vision tiers-mondiste"]},
  {id:52,premium:true,title:"Discours du Mur de Berlin",speaker:"Ronald Reagan",year:"1987",country:"🇺🇸",theme:"Liberté",excerpt:"Monsieur Gorbatchev, ouvrez cette porte ! Monsieur Gorbatchev, abattez ce mur !",techniques:["Interpellation directe","Impératif symbolique","Pathos de la liberté","Image mémorable"]},
  {id:53,premium:true,title:"La force de la paix",speaker:"Rigoberta Menchú",year:"1992",country:"🇬🇹",theme:"Droits autochtones",excerpt:"Ma victoire est une victoire pour les peuples autochtones du monde entier. C'est une reconnaissance de la valeur de l'héritage de l'humanité.",techniques:["Représentation collective","Éthos du peuple autochtone","Universalisme culturel","Dignité réparée"]},
  {id:54,premium:true,title:"Discours sur l'apartheid",speaker:"Desmond Tutu",year:"1984",country:"🇿🇦",theme:"Réconciliation",excerpt:"Nous sommes tous les enfants de Dieu. Notre fraternité ne peut être défaite par aucune loi d'apartheid. Le mal est condamné à échouer.",techniques:["Fondement religieux","Logos moral","Résistance non-violente","Inéluctabilité éthique"]},
  {id:55,premium:true,title:"Discours de la libération de Paris",speaker:"Charles de Gaulle",year:"1944",country:"🇫🇷",theme:"Libération",excerpt:"Paris ! Paris outragé ! Paris brisé ! Paris martyrisé ! Mais Paris libéré !",techniques:["Anaphore géographique","Climax émotionnel","Gradation victoire","Pathos national"]},
  {id:56,premium:true,title:"Discours de Santiago",speaker:"Salvador Allende",year:"1973",country:"🇨🇱",theme:"Socialisme",excerpt:"Je ne me rendrai pas. À coups de fusil, ils peuvent réduire un homme au silence. Mais ils ne peuvent écraser les idées que portent des millions de personnes.",techniques:["Martyre politique","Idées immortelles","Éthos du combattant","Pathos de la mort annoncée"]},
  {id:57,premium:true,title:"Discours de Moscou - Glasnost",speaker:"Mikhaïl Gorbatchev",year:"1988",country:"🇷🇺",theme:"Réforme",excerpt:"Nous avons besoin d'une démocratie pour le socialisme, pas d'un socialisme sans démocratie. La glasnost signifie l'ouverture et la transparence.",techniques:["Réforme depuis l'intérieur","Paradoxe socialiste","Légitimité institutionnelle","Rhétorique de l'ouverture"]},
  {id:58,premium:true,title:"Discours de Lagos - Nigeria",speaker:"Chinua Achebe",year:"1988",country:"🇳🇬",theme:"Identité africaine",excerpt:"L'Afrique ne manque pas de ressources. Elle manque de leaders qui placent l'intérêt général avant le leur. Jusqu'au jour où nous l'aurons compris, nous stagnerons.",techniques:["Critique interne","Logos institutionnel","Éthos de l'intellectuel","Responsabilité collective"]},
  {id:59,premium:true,title:"Discours inaugural - ANC",speaker:"Oliver Tambo",year:"1969",country:"🇿🇦",theme:"Résistance",excerpt:"Notre lutte n'est pas contre des hommes blancs. Notre lutte est contre le système. Et ce système doit être détruit.",techniques:["Distinction peuple/système","Clarté rhétorique","Éthos de l'exil","Appel à la résistance"]},
  {id:60,premium:true,title:"Discours de Libreville - Unité africaine",speaker:"Félix Houphouët-Boigny",year:"1965",country:"🇨🇮",theme:"Politique africaine",excerpt:"La paix, c'est la richesse suprême. Un peuple sans paix ne peut ni travailler ni construire ni espérer.",techniques:["Pacifisme pragmatique","Logos économique","Éthos du père de la nation","Simplicité efficace"]},
  {id:61,premium:true,title:"Discours de l'Élysée - Construction européenne",speaker:"Jacques Delors",year:"1985",country:"🇫🇷",theme:"Europe",excerpt:"L'Europe n'est pas seulement un espace économique. C'est un espace politique, culturel et social. C'est un projet de civilisation.",techniques:["Élargissement de vision","Logos institutionnel","Éthos du constructeur","Identité européenne"]},
  {id:62,premium:true,title:"Discours de Gdansk - Solidarność",speaker:"Lech Wałęsa",year:"1980",country:"🇵🇱",theme:"Liberté du travail",excerpt:"Nous ne réclamons pas la lune. Nous réclamons du pain. Nous réclamons de la dignité. Nous réclamons le droit de nous réunir librement.",techniques:["Gradation des revendications","Éthos ouvrier","Pathos de la dignité","Sobriété percutante"]},
  {id:63,premium:true,title:"Discours pour la réconciliation irlandaise",speaker:"Mary Robinson",year:"1990",country:"🇮🇪",theme:"Réconciliation",excerpt:"En tant que présidente élue de tous les Irlandais, je tends la main à ceux qui ont été exclus, marginalisés et opprimés.",techniques:["Inclusion politique","Rhétorique de la main tendue","Éthos féminin pionnier","Vision nationale inclusive"]},
  {id:64,premium:true,title:"Discours à l'ONU sur le désarmement",speaker:"Olof Palme",year:"1982",country:"🇸🇪",theme:"Paix",excerpt:"La course aux armements est en elle-même une forme de guerre. Chaque rouble dépensé en armements est un rouble volé aux peuples pauvres du monde.",techniques:["Syllogisme moral","Logos économique de la paix","Éthos nordique","Réinterprétation du conflit"]},
  {id:65,premium:true,title:"Discours du retour - De Gaulle",speaker:"Charles de Gaulle",year:"1958",country:"🇫🇷",theme:"Cinquième République",excerpt:"Jadis j'ai dit que la France faisait l'histoire. Je le dis encore. Et je suis venu ici pour l'accompagner une fois encore.",techniques:["Continuité historique","Éthos de la mission","Vision providentialiste","Sobriété solennelle"]},
  {id:66,premium:true,title:"Discours Willy Brandt à Varsovie",speaker:"Willy Brandt",year:"1970",country:"🇩🇪",theme:"Réconciliation",excerpt:"[Il s'agenouille devant le mémorial du ghetto de Varsovie sans prononcer un mot.] Le geste parle à la place des mots.",techniques:["Éthos corporel","Silence éloquent","Réparation symbolique","Diplomatie du repentir"]},
  {id:67,premium:true,title:"Déclaration d'indépendance du Zimbabwe",speaker:"Robert Mugabe",year:"1980",country:"🇿🇼",theme:"Indépendance",excerpt:"Si hier je vous regardais comme un ennemi, aujourd'hui je vous tends la main en ami. Bâtissons ensemble une nation libre et juste.",techniques:["Retournement politique","Rhétorique de la réconciliation","Transition rhétorique","Vision inclusive post-coloniale"]},
  {id:68,premium:true,title:"Discours de Bandung II",speaker:"Soekarno",year:"1965",country:"🇮🇩",theme:"Tiers-monde",excerpt:"Les nations nouvelles d'Asie et d'Afrique ne seront jamais les pions d'un jeu qui n'est pas le leur. Nous sommes debout.",techniques:["Autonomisation collective","Identité post-coloniale","Logos géopolitique","Détermination souveraine"]},
  {id:69,premium:true,title:"Discours Nobel - Chimamanda Adichie",speaker:"Chimamanda Ngozi Adichie",year:"2015",country:"🇳🇬",theme:"Féminisme africain",excerpt:"Le problème du genre, c'est qu'il prescrit comme doit être une personne plutôt que de reconnaître qui cette personne est réellement.",techniques:["Redéfinition conceptuelle","Éthos de l'écrivaine","Universalisme féministe","Précision analytique"]},
  {id:70,premium:true,title:"Discours à l'Assemblée nationale - Jaurès",speaker:"Jean Jaurès",year:"1914",country:"🇫🇷",theme:"Antimilitarisme",excerpt:"Je vois la nuit se faire sur l'Europe. J'entends les canons. Je demande : pourquoi ? Contre qui ? Pour quoi ?",techniques:["Prophétie tragique","Interrogation rhétorique","Pathos pacifiste","Urgence morale"]},
  {id:71,premium:true,title:"Discours du Coup d'État - Fidel Castro",speaker:"Fidel Castro",year:"1953",country:"🇨🇺",theme:"Révolution",excerpt:"L'histoire m'absoudra. Je suis convaincu que ma condamnation sera une sentence de gloire. Le sort des causes justes est d'être victorieuses.",techniques:["Confiance prophétique","Éthos du martyr","Logos de l'histoire","Conviction révolutionnaire"]},
  {id:72,premium:true,title:"Discours à l'ONU sur la dette",speaker:"Fidel Castro",year:"1979",country:"🇨🇺",theme:"Économie mondiale",excerpt:"Trois cents millions d'enfants dans le monde meurent de faim. Si cet argent était utilisé pour l'alimentation, la médecine et l'éducation, personne ne mourrait de faim.",techniques:["Logos chiffré","Pathos de l'enfance","Accusation systémique","Rhétorique redistributive"]},
  {id:73,premium:true,title:"Discours de l'OUA - Unité",speaker:"Julius Nyerere",year:"1963",country:"🇹🇿",theme:"Panafricanisme",excerpt:"L'Afrique doit s'unir ou mourir. Non pas comme une métaphore, mais comme une réalité géopolitique que nous devrons affronter.",techniques:["Dilemme binaire","Urgence existentielle","Logos géopolitique","Vision continentale"]},
  {id:74,premium:true,title:"Discours pour l'égalité des genres - ONU",speaker:"Hillary Clinton",year:"1995",country:"🇺🇸",theme:"Droits des femmes",excerpt:"Les droits des femmes sont les droits de l'homme. Et les droits de l'homme sont les droits des femmes. Qu'on cesse de se poser la question.",techniques:["Équation rhétorique","Universalisme des droits","Concision percutante","Logos inclusif"]},
  {id:75,premium:true,title:"Discours de Nuremberg - Défense",speaker:"Hans Frank",year:"1946",country:"🇩🇪",theme:"Justice internationale",excerpt:"Je n'ai aucune justification à offrir. Ce qui a été fait sous mon autorité en Pologne était criminel. Je mérite la punition.",techniques:["Aveu total","Éthos de la capitulation morale","Pathos de la honte","Acte rhétorique de repentance"]},
  {id:76,premium:true,title:"Discours de la Marche des femmes",speaker:"Angela Davis",year:"2017",country:"🇺🇸",theme:"Résistance",excerpt:"Nos résistances sont si multiples que nous avons besoin de construire des mouvements qui puissent les contenir toutes.",techniques:["Intersectionnalité","Logos militant","Appel à la diversité","Vision coalitionnaire"]},
  {id:77,premium:true,title:"Discours de Davos",speaker:"Greta Thunberg",year:"2020",country:"🇸🇪",theme:"Climat",excerpt:"Notre maison brûle. Je veux que vous agissiez comme si la maison brûlait. Parce qu'elle brûle.",techniques:["Métaphore d'urgence","Impératif radical","Pathos jeunesse","Répétition insistante"]},
  {id:78,premium:true,title:"Discours sur la désobéissance civile",speaker:"Aung San Suu Kyi",year:"1988",country:"🇲🇲",theme:"Démocratie",excerpt:"La peur est la tentation de trouver des excuses pour ne pas agir. La démocratie exige que nous surmontions cette peur.",techniques:["Psychologie de la résistance","Logos moral","Éthos du courage","Défi à l'oppression"]},
  {id:79,premium:true,title:"Discours de Vienne sur les droits humains",speaker:"José Ayala-Lasso",year:"1993",country:"🇺🇳",theme:"Droits humains",excerpt:"Les droits de l'homme ne sont pas la propriété de l'Occident. Ils sont l'héritage de l'humanité entière, forgé dans la souffrance universelle.",techniques:["Universalisme des droits","Réfutation de l'ethnocentrisme","Pathos de la souffrance","Vision inclusive"]},
  {id:80,premium:true,title:"Discours du Mahatma Gandhi à Dandi",speaker:"Mahatma Gandhi",year:"1930",country:"🇮🇳",theme:"Désobéissance civile",excerpt:"Nous partons marcher pour le sel. Et par cette marche, nous montrerons au monde que nous pouvons défaire un empire sans tirer un coup de feu.",techniques:["Symbolisme du sel","Défi non-violent","Logos de la résistance","Grandeur de la simplicité"]},
  {id:81,premium:true,title:"Discours de la réunification allemande",speaker:"Helmut Kohl",year:"1990",country:"🇩🇪",theme:"Réunification",excerpt:"Ce que nous accomplissons aujourd'hui, c'est une page parmi les plus belles de l'histoire allemande. Deux peuples redevenus un seul.",techniques:["Historicisation du moment","Éthos du chancelier",  "Vision nationale","Émotion sobre"]},
  {id:82,premium:true,title:"Discours de l'independence du Mozambique",speaker:"Samora Machel",year:"1975",country:"🇲🇿",theme:"Indépendance",excerpt:"Pour que le Mozambique vive, l'impérialisme doit mourir. Notre indépendance n'est pas un cadeau. C'est le fruit de notre lutte.",techniques:["Antagonisme politique","Éthos révolutionnaire","Logos de la lutte armée","Rejet de la dépendance"]},
  {id:83,premium:true,title:"Discours aux Nations Unies - Nasser",speaker:"Gamal Abdel Nasser",year:"1956",country:"🇪🇬",theme:"Nationalisation",excerpt:"Le canal de Suez appartient à l'Égypte. Et nous l'exploiterons au service de tous les peuples d'Égypte, non au service des actionnaires étrangers.",techniques:["Souveraineté économique","Rupture nationaliste","Ethos du dirigeant fort","Simplification populiste"]},
  {id:84,premium:true,title:"Discours de Kinshasa - Ali vs Foreman",speaker:"Muhammad Ali",year:"1974",country:"🇺🇸",theme:"Identité et sport",excerpt:"Je ne cours pas. Je ne me cache pas. Je suis Muhammad Ali, et je vais démontrer que la grandeur n'est pas réservée à ceux qui ont de la chance.",techniques:["Affirmation identitaire","Éthos sportif","Défi direct","Pathos de la fierté"]},
  {id:85,premium:true,title:"Discours de Cancún - G77",speaker:"Indira Gandhi",year:"1981",country:"🇮🇳",theme:"Développement",excerpt:"Le fossé entre les nations riches et les nations pauvres n'est pas une loi naturelle. C'est un crime que nous avons le pouvoir de corriger.",techniques:["Réfutation du fatalisme","Logos de la justice distributive","Éthos du Sud global","Appel à l'action internationale"]},
  {id:86,premium:true,title:"Discours de l'élection présidentielle",speaker:"Nicolas Sarkozy",year:"2007",country:"🇫🇷",theme:"Politique française",excerpt:"Le peuple français a choisi de changer le cours des choses. Ce soir, la France a décidé de revenir dans la compétition mondiale.",techniques:["Légitimité populaire","Rhétorique de la compétition","Vision modernisatrice","Pathos de la victoire"]},
  {id:87,premium:true,title:"Discours de François Hollande au Vel d'Hiv",speaker:"François Hollande",year:"2012",country:"🇫🇷",theme:"Mémoire",excerpt:"La France a commis l'irréparable en participant à la déportation des Juifs. Je reconnais, au nom de la France, la responsabilité de l'État.",techniques:["Reconnaissance mémorielle","Éthos présidentiel","Rupture avec le mythe gaulliste","Pathos de la honte partagée"]},
  {id:88,premium:true,title:"Discours de Varsovie - Droit international",speaker:"Boutros Boutros-Ghali",year:"1992",country:"🇺🇳",theme:"Paix internationale",excerpt:"Un Agenda pour la Paix n'est pas un programme de rêve. C'est une architecture réaliste pour réduire la violence organisée dans le monde.",techniques:["Pragmatisme institutionnel","Logos diplomatique","Éthos onusien","Vision architecturale"]},
  {id:89,premium:true,title:"Discours de Stanford - Steve Jobs",speaker:"Steve Jobs",year:"2005",country:"🇺🇸",theme:"Innovation et vie",excerpt:"Restez affamés. Restez fous. Ne vous laissez pas piéger par le dogme, c'est-à-dire par les résultats de la pensée des autres.",techniques:["Ethos d'entrepreneur visionnaire","Appel à l'individualisme","Ironie profonde","Mise en récit de sa vie"]},
  {id:90,premium:true,title:"Discours Nobel de la paix",speaker:"Aung San Suu Kyi",year:"1991",country:"🇲🇲",theme:"Démocratie",excerpt:"Le désir de paix en Birmanie commence par le désir d'entendre la vérité. Je demande aux nations libres d'écouter le peuple birman.",techniques:["Voix du peuple silencieux","Éthos du combat","Logos de la vérité","Appel international"]},
  {id:91,premium:true,title:"Discours de l'Union africaine - Rwanda",speaker:"Paul Kagame",year:"2000",country:"🇷🇼",theme:"Reconstruction",excerpt:"Le Rwanda n'a pas été tué par des machettes. Il a été tué par la haine. Et la haine peut être défaite par la réconciliation.",techniques:["Diagnostic moral","Réinterprétation du génocide","Éthos de survivant","Vision réparatrice"]},
  {id:92,premium:true,title:"Discours inaugural du Sénégal",speaker:"Léopold Sédar Senghor",year:"1960",country:"🇸🇳",theme:"Négritude",excerpt:"Je suis Negro-Africain — Sénégalais — et je suis fier de l'être. Ma race et ma culture ne sont pas un fardeau. Ce sont mes richesses.",techniques:["Affirmation identitaire","Renversement de la honte","Poésie politique","Éthos intellectuel"]},
  {id:93,premium:true,title:"Discours sur la laïcité à l'Assemblée",speaker:"Aristide Briand",year:"1905",country:"🇫🇷",theme:"Laïcité",excerpt:"La loi de séparation ne supprime ni la croyance ni la pratique religieuse. Elle libère l'État. Elle libère aussi la religion de l'État.",techniques:["Double libération","Logos juridique","Clarté définitionnelle","Apaisement politique"]},
  {id:94,premium:true,title:"Discours sur les réfugiés - UNHCR",speaker:"Filippo Grandi",year:"2022",country:"🇺🇳",theme:"Migration",excerpt:"110 millions de personnes déplacées dans le monde — un record. Nous avons tous une responsabilité dans ce chiffre et dans sa réduction.",techniques:["Chiffre comme accusation","Logos humanitaire","Responsabilité partagée","Urgence silencieuse"]},
  {id:95,premium:true,title:"Discours de l'Assemblée de la jeunesse africaine",speaker:"Alpha Condé",year:"2011",country:"🇬🇳",theme:"Jeunesse africaine",excerpt:"L'Afrique ne sera développée que par les Africains. Pas par les ONG. Pas par la Banque mondiale. Par vous, la jeunesse d'Afrique.",techniques:["Responsabilisation de la jeunesse","Rupture avec l'aide","Éthos du dirigeant","Appel à l'autonomie"]},
  {id:96,premium:true,title:"Discours d'acceptation - Prix Nobel Littérature",speaker:"Toni Morrison",year:"1993",country:"🇺🇸",theme:"Langage & pouvoir",excerpt:"Le langage peut être une oppression subtile et profonde. Il peut aussi être la résistance. Le choix appartient à ceux qui le parlent.",techniques:["Philosophie du langage","Éthos d'écrivaine noire","Pathos culturel","Vision libératrice"]},
  {id:97,premium:true,title:"Discours Evo Morales à l'ONU",speaker:"Evo Morales",year:"2006",country:"🇧🇴",theme:"Ressources naturelles",excerpt:"Les ressources naturelles de la Bolivie appartiennent au peuple bolivien. Et à ce peuple, nous allons les rendre.",techniques:["Nationalisme des ressources","Éthos indigène","Logos redistributif","Promesse solennelle"]},
  {id:98,premium:true,title:"Discours sur les droits autochtones",speaker:"Rigoberta Menchú",year:"2012",country:"🇬🇹",theme:"Droits autochtones",excerpt:"Nous existons depuis des millénaires. Nous avons notre langue, notre culture, notre territoire. Que signifie le développement si nous perdons tout cela ?",techniques:["Logos de la longue durée","Remise en question du développement","Éthos autochtone","Pathos de la perte culturelle"]},
  {id:99,premium:true,title:"Discours de démission - Nixon",speaker:"Richard Nixon",year:"1974",country:"🇺🇸",theme:"Chute du pouvoir",excerpt:"J'ai toujours essayé de faire ce qui était le mieux pour la nation. Je me suis trompé. Et j'en paie le prix.",techniques:["Aveu indirect","Éthos de la dignité préservée","Logos auto-critique","Chute politique"]},
  {id:100,premium:true,title:"Discours pour la paix - ONU",speaker:"Kofi Annan",year:"2001",country:"🇺🇳",theme:"Paix mondiale",excerpt:"La paix n'est pas un morceau de papier signé. C'est l'absence de peur dans les yeux d'un enfant. C'est cela que nous devons construire.",techniques:["Redéfinition concrète","Pathos de l'enfance","Vision humaniste","Éthos du secrétaire général"]},
  {id:101,premium:true,title:"Discours de Nairobi - Environnement",speaker:"Wangari Maathai",year:"2004",country:"🇰🇪",theme:"Écologie",excerpt:"Quand les femmes plantent des arbres, elles plantent l'avenir. Chaque arbre est un acte de foi, une déclaration que demain existera.",techniques:["Métaphore végétale","Féminisme écologique","Vision concrète","Éthos de l'activiste"]},
  {id:102,premium:true,title:"Discours au Parlement européen - Brexit",speaker:"Nigel Farage",year:"2020",country:"🇬🇧",theme:"Souveraineté",excerpt:"Vous n'avez jamais voulu que nous soyons là. Et maintenant nous partons. Et la plupart d'entre nous sont souriant.",techniques:["Provocation délibérée","Ironie triomphante","Éthos anti-establishment","Rupture symbolique"]},
  {id:103,premium:true,title:"Discours de Tripoli - Révolution",speaker:"Mouammar Kadhafi",year:"1969",country:"🇱🇾",theme:"Révolution",excerpt:"Le peuple libyen prend maintenant son destin en main. Fini le roi. Fini les traîtres. Vive la révolution libyenne.",techniques:["Proclamation révolutionnaire","Rupture simple","Pathos de la libération","Rhétorique de rupture"]},
  {id:104,premium:true,title:"Discours pour la justice climatique",speaker:"Kumi Naidoo",year:"2019",country:"🇿🇦",theme:"Justice climatique",excerpt:"Le changement climatique n'est pas une question d'environnement. C'est une question de justice. Les plus pauvres paient pour la pollution des plus riches.",techniques:["Réencadrement politique","Logos de l'injustice","Éthos militant","Culpabilité transférée"]},
  {id:105,premium:true,title:"Discours sur la liberté — Tocqueville",speaker:"Alexis de Tocqueville",year:"1848",country:"🇫🇷",theme:"Démocratie",excerpt:"Les peuples qui veulent à la fois la liberté et l'égalité dans la servilité ne méritent ni l'une ni l'autre.",techniques:["Paradoxe politique","Logos libéral","Avertissement moral","Éthos de l'observateur"]},
  {id:106,premium:true,title:"Discours de la victoire - Lula",speaker:"Luiz Inácio Lula da Silva",year:"2002",country:"🇧🇷",theme:"Démocratie sociale",excerpt:"Ce n'est pas moi, fils de pauvres, qui suis élu président. C'est la voix de ceux qui ont faim qui a pris le pouvoir. Je suis leur porte-parole.",techniques:["Personnification populaire","Éthos du travailleur","Délégation symbolique","Pathos de la misère résolue"]},
  {id:107,premium:true,title:"Discours de la honte - Tshisekedi",speaker:"Étienne Tshisekedi",year:"1990",country:"🇨🇩",theme:"Démocratie congolaise",excerpt:"On ne peut plus nous faire taire. L'histoire jugera ce régime. Et cette fois-ci, l'histoire sera de notre côté.",techniques:["Prophétie de l'histoire","Éthos du résistant","Courage politique","Confiance dans le jugement"]},
  {id:108,premium:true,title:"Discours à l'Assemblée - Mohamed Bouazizi",speaker:"Anonyme / Représentant",year:"2011",country:"🇹🇳",theme:"Révolution arabe",excerpt:"[En hommage à Mohamed Bouazizi] Un jeune homme qui vendait des légumes a mis le feu à une dictature. Voilà la vraie puissance.",techniques:["Symbole du simple","Métaphore du feu","Pathos du martyr ordinaire","Pouvoir de l'exemple"]},
  {id:109,premium:true,title:"Discours de Berlin - Olaf Scholz",speaker:"Olaf Scholz",year:"2022",country:"🇩🇪",theme:"Sécurité européenne",excerpt:"L'invasion russe de l'Ukraine marque un Zeitenwende — un tournant dans l'histoire. L'Allemagne doit répondre à sa responsabilité historique.",techniques:["Mot allemand comme concept","Rupture historique","Éthos institutionnel","Appel à la responsabilité"]},
  {id:110,premium:true,title:"Discours au Parlement rwandais",speaker:"Kagame Paul",year:"2004",country:"🇷🇼",theme:"30 ans après le génocide",excerpt:"Nous ne commémorons pas la mort. Nous commémorons notre survie. Et nous nous promettons : plus jamais.",techniques:["Inversion de la commémoration","Promesse collective","Éthos de survivant","Formule universelle"]},
  {id:111,premium:true,title:"Discours de Genève - Droits humains",speaker:"Shirin Ebadi",year:"2003",country:"🇮🇷",theme:"Droits humains Islam",excerpt:"L'Islam et les droits de l'homme ne sont pas contradictoires. C'est une interprétation de l'Islam qui opprime les femmes, pas l'Islam lui-même.",techniques:["Distinction religion/interprétation","Logos théologique","Éthos de femme musulmane","Réfutation apologétique"]},
  {id:112,premium:true,title:"Discours de Bruxelles - Sécurité cyber",speaker:"Ursula von der Leyen",year:"2023",country:"🇪🇺",theme:"Cybersécurité",excerpt:"L'Europe doit maîtriser ses propres données, ses propres infrastructures numériques. La souveraineté numérique est désormais une question de sécurité nationale.",techniques:["Souveraineté numérique","Urgence sécuritaire","Logos technologique","Éthos institutionnel"]},
  {id:113,premium:true,title:"Discours de jeunesse - Mandela",speaker:"Nelson Mandela",year:"1944",country:"🇿🇦",theme:"Militantisme",excerpt:"Notre génération ne peut pas accepter l'injustice comme un état naturel. L'accepter serait une trahison de tous ceux qui ont souffert avant nous.",techniques:["Solidarité générationnelle","Obligation morale","Pathos de la filiation","Urgence d'agir"]},
  {id:114,premium:true,title:"Discours de la réconciliation - Mandela",speaker:"Nelson Mandela",year:"1993",country:"🇿🇦",theme:"Réconciliation",excerpt:"La mort de Chris Hani ne doit pas être utilisée pour la haine. Elle doit être transformée en élan pour la paix.",techniques:["Transformation du deuil","Logos pacifiste","Maîtrise rhétorique","Leadership moral"]},
  {id:115,premium:true,title:"Discours de la colère juste - Zuma",speaker:"Jacob Zuma",year:"2009",country:"🇿🇦",theme:"Politique sud-africaine",excerpt:"La révolution n'est pas finie. Les disparités économiques de l'apartheid persistent. Le travail d'émancipation économique continue.",techniques:["Continuité révolutionnaire","Critique économique","Éthos post-apartheid","Mobilisation de la base"]},
  {id:116,premium:true,title:"Discours de la liberté - Haïti",speaker:"Jean-Bertrand Aristide",year:"1994",country:"🇭🇹",theme:"Démocratie haïtienne",excerpt:"Je reviens en Haiti non pas comme un président en exil mais comme la voix d'un peuple qui n'a jamais renoncé à la démocratie.",techniques:["Retour symbolique","Éthos du peuple","Résistance ininterrompue","Pathos du retour"]},
  {id:117,premium:true,title:"Discours de Dakar - Mitterrand",speaker:"François Mitterrand",year:"1990",country:"🇫🇷",theme:"Démocratie en Afrique",excerpt:"Il n'y aura pas de développement sans démocratie. Et la France liera sa coopération au chemin parcouru vers la liberté.",techniques:["Conditionnalité rhétorique","Logos de la coopération","Engagement diplomatique","Universalisme républicain"]},
  {id:118,premium:true,title:"Discours de Strasbourg - Droits des peuples",speaker:"Jacques Chirac",year:"1997",country:"🇫🇷",theme:"Diversité culturelle",excerpt:"La diversité culturelle est une richesse de l'humanité, pas une menace. La mondialisation ne doit pas se faire au prix de l'effacement des cultures.",techniques:["Réencadrement culturel","Logos de la diversité","Éthique de la préservation","Ethos gaulliste"]},
  {id:119,premium:true,title:"Discours de Washington - Terrorisme",speaker:"George W. Bush",year:"2001",country:"🇺🇸",theme:"Antiterrorisme",excerpt:"Soit vous êtes avec nous, soit vous êtes avec les terroristes. Il n'y a pas de zone grise dans cette guerre.",techniques:["Faux dilemme délibéré","Logique binaire","Rhétorique de guerre","Mobilisation internationale"]},
  {id:120,premium:true,title:"Discours de Kobayé - Sacrifice",speaker:"Thomas Sankara",year:"1986",country:"🇧🇫",theme:"Sacrifice et développement",excerpt:"Un soldat sans formation politique et idéologique n'est qu'un criminel en puissance. La révolution doit être dans les esprits avant d'être dans les actes.",techniques:["Idéologie comme condition","Éthos révolutionnaire","Logos de la formation","Vision de la conscience"]},
  {id:121,premium:true,title:"Discours de l'accession - Macron",speaker:"Emmanuel Macron",year:"2017",country:"🇫🇷",theme:"Politique française",excerpt:"Je serai le président de tous les Français — ceux qui ont voté pour moi et ceux qui ont voté contre moi. Ma seule ambition est de servir la France.",techniques:["Inclusion nationale","Promesse d'unité","Éthos de rupture","Universalisme républicain"]},
  {id:122,premium:true,title:"Discours de Yaoundé - Néocolonialisme",speaker:"Ahmadou Ahidjo",year:"1961",country:"🇨🇲",theme:"Indépendance économique",excerpt:"L'indépendance politique ne vaut rien sans l'indépendance économique. Nous avons obtenu la première. Maintenant nous luttons pour la seconde.",techniques:["Distinction politique/économique","Éthos du chef d'État","Logos du développement","Continuité de la lutte"]},
  {id:123,premium:true,title:"Discours de la solidarité nationale",speaker:"Angela Merkel",year:"2020",country:"🇩🇪",theme:"Covid-19",excerpt:"Nous vivons l'épreuve la plus difficile depuis la Seconde Guerre mondiale. Mais si nous agissons ensemble, nous traverserons cette crise. Ensemble.",techniques:["Analogie historique","Appel à l'unité","Éthos de rigueur","Pathos de l'espoir"]},
  {id:124,premium:true,title:"Discours de Pretoria - Mandela 1990",speaker:"Nelson Mandela",year:"1990",country:"🇿🇦",theme:"Liberté retrouvée",excerpt:"Mes amis, camarades et compatriotes sud-africains, je vous salue tous au nom de la paix, de la démocratie et de la liberté pour tous.",techniques:["Triple invocation","Éthos du prisonnier libéré","Solennité simple","Rassemblement symbolique"]},
  {id:125,premium:true,title:"Discours d'acceptation - Barack Obama",speaker:"Barack Obama",year:"2012",country:"🇺🇸",theme:"Démocratie",excerpt:"La démocratie peut être bruyante et désordonnée. Elle est parfois frustrante. Mais elle fonctionne. Et tant qu'elle fonctionnera, nous serons libres.",techniques:["Défense de la démocratie imparfaite","Logos pragmatique","Pathos libéral","Éthos présidentiel"]},
];
const RHETORIC_DATA=[
  {id:1,icon:"award",title:"Éthos, Pathos, Logos",desc:"La triade d'Aristote",content:"ÉTHOS — Crédibilité de l'orateur\nAristote définit l'éthos comme la crédibilité que l'orateur projette. Elle repose sur trois composantes : la compétence (phronesis), la vertu morale (arété) et la bienveillance envers l'audience (eunoia). Votre expertise doit être visible, votre probité indiscutable, votre souci du bien commun manifeste.\n→ Technique : citez votre expérience directe, vos erreurs passées (humilité), vos engagements réels.\n→ Piège à éviter : l'éthos imposé ('je suis expert donc croyez-moi') suscite la méfiance. L'éthos doit être montré, pas déclaré.\n\nPATHOS — L'émotion au service de la conviction\nLe pathos ne signifie pas manipuler émotionnellement mais créer une résonance affective avec votre audience. Les neurosciences confirment (Damasio) que les décisions sont d'abord émotionnelles, puis rationalisées. Sans connexion émotionnelle, le logos reste abstrait.\n→ Technique : commencez par une anecdote concrète, un témoignage, un cas particulier avant les chiffres globaux.\n→ Hiérarchie des émotions persuasives : l'espoir > la peur > la colère > la honte. L'espoir mobilise, la peur paralyse.\n\nLOGOS — La logique comme armature\nLe logos comprend les preuves factuelles (statistiques, études, textes), les raisonnements déductifs et inductifs, et la cohérence interne du discours. Sans logos, le discours est éphémère. Sans éthos ni pathos, le logos est inaudible.\n→ Structure logique : prémisse majeure + prémisse mineure = conclusion (syllogisme). Ou : observation + généralisation (induction).\n→ Règle des 3 arguments : au-delà de 3 arguments principaux, la mémorisation chute de 60%. Sélectionner, hiérarchiser, ne pas accumuler.\n\nSYNERGIE — Comment les trois s'articulent\nLes grands orateurs maîtrisent les trois registres simultanément. King commençait par le logos historique (les promesses non tenues), passait au pathos de la douleur vécue, puis culminait avec l'éthos prophétique du rêve. L'ordre optimal : éthos (crédibilité d'abord), puis logos (démonstration), puis pathos (émotion finale pour l'action)."},
  {id:2,icon:"send",title:"Figures de style avancées",desc:"20 outils du discours puissant",content:"ANAPHORE — Répétition en début de phrase pour créer un rythme hypnotique.\n→ «Je refuse. Je refuse. Je refuse.» / «I have a dream...» (King, 8 fois)\n\nÉPIPHORE — Répétition en fin de phrase (effet d'insistance finale).\n→ «Le gouvernement du peuple, par le peuple, pour le peuple» (Lincoln)\n\nCHIASME — Inversion croisée de deux éléments (symétrie mémorable).\n→ «Ne demandez pas ce que votre pays peut faire pour vous, demandez ce que vous pouvez faire pour votre pays» (JFK)\n\nMÉTAPHORE FILÉE — Image développée sur plusieurs phrases.\n→ «Un rideau de fer est descendu... derrière ce rideau... dans ce secteur...» (Churchill)\n\nHYPERBOLE — Amplification délibérée pour frapper les esprits.\n→ «Nous combattrons sur les plages, dans les champs, dans les rues, nous ne nous rendrons jamais» (Churchill)\n\nLITOTE — Dire moins pour suggérer plus.\n→ «Ce n'est pas sans émotion» = je suis profondément touché.\n\nANTITHÈSE — Opposition de deux idées pour créer un contraste saisissant.\n→ «Liberté, égalité, fraternité» vs «Oppression, inégalité, division»\n\nGRADATION — Montée progressive en intensité (climax).\n→ «Du sang, de la sueur, des larmes» (Churchill — ordre croissant de gravité)\n\nAPOSTROPHE — Interpellation directe de l'audience ou d'une entité absente.\n→ «Vous, jeunes de France...» / «Ô liberté, que de crimes...»\n\nSYLLEPSE — Alliance inattendue de sens propre et figuré.\n→ «Sèche tes pleurs» (physique) et «sèche ta peine» (moral) simultanément.\n\nOXYMORE — Alliance de mots opposés créant une tension productive.\n→ «Obscure clarté» (Corneille) / «Douce violence» / «Liberté sous surveillance»\n\nPROSOPOPÉE — Faire parler une chose abstraite ou absente.\n→ «La France vous dit : relevez-vous !» / «L'histoire nous jugera»\n\nÉNUMÉRATION ASYNDÈTE — Liste sans connecteurs pour créer un effet d'accumulation.\n→ «Veni, vidi, vici» — «Je suis venu, j'ai vu, j'ai vaincu» (César)\n\nEUPHÉMISME — Atténuer une réalité difficile (à utiliser avec parcimonie).\n→ «Nettoyer ethniquement» au lieu de «massacrer» — attention : peut masquer des crimes.\n\nALLUSION — Référence implicite à un texte, événement ou personnage connu.\n→ Citer le Coran devant une audience musulmane (Obama au Caire) = geste d'inclusion.\n\nPARISOS — Deux propositions de même longueur rythmique créant un équilibre.\n→ «La paix n'est pas l'absence de guerre ; la liberté n'est pas l'absence de contrainte»\n\nINTERROGATION RHÉTORIQUE — Question sans réponse attendue pour impliquer l'audience.\n→ «Qu'est-ce que le 4 juillet pour l'esclave américain ?» (Douglass)\n\nCONCESSION-RÉFUTATION — Accorder un point adverse pour mieux le dépasser.\n→ «Certes, la mondialisation crée des inégalités. Mais supprimer les échanges ne les résoudrait pas.\"\n\nRÉPÉTITION SYNONYMIQUE — Répéter une idée avec des mots différents pour ancrer.\n→ «Nous voulons la paix, la concorde, la réconciliation, l'harmonie entre les peuples»\n\nCHUTE ÉPIPHANIQUE — Dernière phrase du discours qui synthétise et frappe définitivement.\n→ «Je suis prêt à mourir pour cet idéal» (Mandela) — silence assuré après."},
  {id:3,icon:"info",title:"Architectures du discours",desc:"5 structures éprouvées",content:"1. STRUCTURE CLASSIQUE EN 5 ACTES (Discours politique)\nAccroche → Contexte → Développement (3 arguments) → Réfutation → Appel à l'action\n→ Quand l'utiliser : discours formel, débat préparé, plaidoirie.\n→ Durée recommandée : 10-20 minutes avec cette structure.\n→ Piège : ne pas passer plus de 40% du temps sur le développement — l'accroche et la conclusion sont décisives.\n\n2. MÉTHODE PREP (Improvisation et débat)\nP — Point : affirmez votre position en une phrase.\nR — Reason : donnez la raison principale.\nE — Example : illustrez avec un cas concret.\nP — Point : revenez à votre affirmation pour ancrer.\n→ Quand l'utiliser : oral de concours, réponse rapide, grand oral.\n→ Durée : 90 secondes à 3 minutes — idéal pour les questions flash.\n\n3. STRUCTURE NARRATIVE (Storytelling)\nSituation initiale stable → Événement perturbateur → Tension et enjeux → Résolution → Moral ou leçon.\n→ Quand l'utiliser : discours d'inauguration, TED Talk, oral de motivation.\n→ Clé : le personnage de l'histoire ne doit pas être vous-même — faites-le être l'audience.\n→ Exemples : Obama commence souvent par 'Je pense à une personne que j'ai rencontrée...'\n\n4. STRUCTURE PAS-AGITATION-SOLUTION (Advocacy)\nProblème → Amplification du problème → Solution concrète\n→ Quand l'utiliser : plaidoyer, discours de campagne, argumentaire politique.\n→ Clé : le temps consacré au problème doit être ≥ 50% — l'audience doit ressentir la douleur avant de vouloir la solution.\n→ Erreur courante : présenter la solution avant que l'audience soit convaincue de l'urgence.\n\n5. STRUCTURE SOCRATIQUE (Débat philosophique)\nQuestion → Thèse → Antithèse → Synthèse dépassante\n→ Quand l'utiliser : grand oral de philo, Sciences Po, ENS.\n→ Clé : la synthèse ne doit pas être un 'juste milieu' mou — elle doit élever le débat à un niveau supérieur.\n→ Exemple : «La liberté est-elle une illusion ?» → Non (libre-arbitre) → Si (déterminismes) → Les deux (liberté comme conquête sur les déterminismes)."},
  {id:4,icon:"star",title:"Persuasion & Influence",desc:"8 leviers psychologiques",content:"1. PREUVE SOCIALE (Cialdini)\n«80% des Français pensent que...» — L'humain calque ses comportements sur le groupe. Citez des études, des sondages, des consensus d'experts.\n→ Attention : la majorité peut avoir tort. Associez toujours la preuve sociale à un logos indépendant.\n\n2. AUTORITÉ LÉGITIME\n«Selon l'ONU, le GIEC, l'OMS...» — Déléguer l'autorité à une source reconnue renforce votre position sans paraître arrogant.\n→ Technique avancée : citez des autorités qui contredisent votre camp pour montrer votre honnêteté intellectuelle.\n\n3. RÉCIPROCITÉ SYMBOLIQUE\nConcéder un point à l'adversaire crée une obligation psychologique de réciprocité. L'audience perçoit votre honnêteté et est plus réceptive à vos arguments suivants.\n→ Formule : «Mon contradicteur a raison sur X. Mais cela renforce encore plus ma position sur Y, car...»\n\n4. COHÉRENCE-ENGAGEMENT\nRappelez à l'audience ses propres valeurs déclarées. Les humains agissent pour rester cohérents avec leurs déclarations publiques.\n→ «Vous avez tous dit que vous vouliez plus d'égalité. Voici ce que cette valeur implique concrètement...»\n\n5. RARETÉ ET URGENCE\n«C'est peut-être la dernière chance de...» — La perspective de perte est psychologiquement 2x plus motivante que la perspective de gain (Kahneman).\n→ À utiliser avec parcimonie : une urgence permanente perd son effet.\n\n6. APPARTENANCE ET IDENTITÉ TRIBALE\nRelier l'argument à l'identité collective de l'audience. Les gens défendent plus farouchement leurs croyances que leurs intérêts.\n→ «En tant que Français, en tant qu'Européens, en tant que citoyens du monde...\"\n\n7. VISUALISATION CONCRÈTE\nAider l'audience à imaginer précisément le futur voulu ou craint. La vivacité de l'image mentale détermine l'intensité de la réponse émotionnelle.\n→ Technique : «Imaginez que dans 10 ans, votre enfant vous demande ce que vous avez fait quand...»\n\n8. ANCRAGE COMPARATIF\nProposer d'abord une option extrême pour rendre l'option raisonnable plus acceptable.\n→ En négociation : demandez plus que ce que vous voulez. En politique : cadrez le débat autour de votre position."},
  {id:5,icon:"mic",title:"La voix et le corps",desc:"Loi de Mehrabian et techniques",content:"LOI DE MEHRABIAN (1967) — La règle des 3V\nUne communication en face à face se décompose ainsi :\n- 7% : les mots (contenu verbal)\n- 38% : la voix (ton, rythme, volume, timbre)\n- 55% : le corps (posture, gestes, regard, expressions)\n→ Attention : cette règle s'applique spécifiquement aux communications émotionnelles. Pour un exposé technique, le poids des mots est plus élevé. Mais pour la persuasion politique, le non-verbal domine.\n\nLA VOIX — 6 paramètres maîtrisables\n1. Volume : variez entre fort et doux selon l'émotion. Le chuchotement attire souvent plus que le cri.\n2. Débit : ralentissez sur les points clés (100 mots/minute pour solennité vs 180 pour enthousiasme).\n3. Hauteur (pitch) : montez pour l'émotion, descendez pour l'autorité. Ne montez JAMAIS à la fin d'une affirmation (intonation montante = doute).\n4. Timbre : travaillez la résonance thoracique par des exercices de respiration abdominale.\n5. Pauses : le silence vaut de l'or. 3 secondes de silence après une phrase forte en décuple l'impact.\n6. Articulation : articulez exagérément en répétition, normalement à la tribune — votre articulation se réduit sous le stress.\n\nLE CORPS — Posture et gestuelle\n1. Position des pieds : pieds écartés à la largeur des épaules, légèrement ouverts vers l'audience. C'est la position de puissance.\n2. Regard : balayage systématique de la salle (3 zones : gauche, centre, droite), contact oculaire de 2-3 secondes par personne.\n3. Gestes ouverts : paumes visibles = honnêteté. Évitez bras croisés, mains dans les poches, gestes nerveux.\n4. Espace : occupez l'espace (bouger = vivacité), mais ne pace pas (agitation = anxiété).\n5. Expression faciale : synchronisez votre expression avec votre contenu. Un visage neutre sur un contenu passionné rompt la crédibilité.\n\nEXERCICES PRATIQUES\n- Enregistrez-vous en vidéo 3 minutes par jour et regardez sans le son : que dit votre corps ?\n- Pratiquez le 'power pose' (Amy Cuddy) avant de parler : 2 minutes en posture de puissance réduit le cortisol de 25%."},
  {id:6,icon:"heart",title:"Gestion du trac",desc:"Techniques immédiates et long terme",content:"COMPRENDRE LE TRAC\nLe trac est une réponse physiologique normale (adrénaline, cortisol) face à une évaluation sociale. Il n'est pas un signe de faiblesse mais une préparation biologique à la performance. Les plus grands orateurs (Churchill, Mandela) ont souffert de trac intense.\n→ Redéfinition cognitive : le trac n'est pas de la peur mais de l'excitation. Dites-vous 'je suis excité' plutôt que 'j'ai peur' — la physiologie est identique, le sens change.\n\nTECHNIQUES IMMÉDIATES (avant de parler)\n1. Respiration 4-7-8 : inspirez 4 secondes, retenez 7, expirez 8. Trois cycles suffisent pour activer le système parasympathique.\n2. Respiration diaphragmatique : main sur le ventre, gonflez le ventre à l'inspiration (pas la poitrine).\n3. Power pose : 2 minutes debout, mains sur les hanches, regard horizontal — réduit le cortisol et augmente la testostérone.\n4. Réchauffement vocal : vocalises, lecture à voix haute, humming (fredonner) pour décontracter les cordes vocales.\n5. Visualisation positive : imaginez-vous réussir — pas l'audience qui applaudit, mais vous qui ressentez la fluidité.\n\nTECHNIQUES PENDANT LE DISCOURS\n1. Regardez les visages bienveillants : identifiez 2-3 personnes qui hochent la tête et adressez-vous à eux en premier.\n2. Ralentissez : le trac accélère le débit. Ralentir délibérément réduit le stress et améliore la compréhension.\n3. Pause stratégique : si vous vous perdez, buvez une gorgée d'eau, regardez vos notes. Le public perçoit rarement l'hésitation comme une erreur.\n4. Ancrage physique : sentez le sol sous vos pieds. Le contact physique avec le sol réduit l'anxiété de performance.\n\nSTRATÉGIE LONG TERME\n1. Méthode de l'exposition graduée : commencez par parler à 1 personne, puis 5, puis 20, puis 100. Chaque succès réduit le seuil de trac pour la prochaine fois.\n2. Improvisation théâtrale : 8 semaines de cours d'impro développent la tolérance à l'imperfection.\n3. Journal de progression : notez après chaque prise de parole ce qui s'est bien passé (pas ce qui a mal tourné).\n4. Régularité : le trac diminue avec la fréquence. Visez une prise de parole publique par semaine minimum."},
  {id:7,icon:"zap",title:"L'improvisation maîtrisée",desc:"PREP, OUI-ET, questions",content:"MYTHE DE L'IMPROVISATION\nL'improvisation n'est pas l'absence de préparation mais la maîtrise de structures que l'on peut activer en temps réel. Les grands improvisateurs (debaters, politiques en conférence de presse) ont intégré des schémas narratifs qui se déclenchent automatiquement.\n\nMÉTHODE PREP — Structure express en 90 secondes\nP — Position (5 sec) : «Je pense que X parce que Y»\nR — Reason (20 sec) : «La raison principale est que...»\nE — Example (40 sec) : «Par exemple, en 2024, [cas concret]...»\nP — Point (10 sec) : «C'est pourquoi je maintiens que X»\n→ Exercice : pratiquez avec n'importe quel sujet tiré au sort. 10 sujets par jour pendant 30 jours.\n\nMÉTHODE OUI-ET (théâtre d'improvisation)\nJamais dire 'non' ou 'mais' — toujours 'oui, et...'\nQuelqu'un dit : «Mais votre politique a échoué.»\nRéponse : «Vous avez raison que les résultats n'ont pas été à la hauteur dans ce secteur, ET c'est précisément pour cela que nous proposons maintenant...»\n→ L'acceptation de la critique suivie d'un rebond offensif est rhétoriquement bien plus forte que la dénégation.\n\nTECHNIQUE DES PONTS\nLorsque vous ne connaissez pas la réponse ou voulez éviter une question :\n1. Accusé réception : «C'est une question importante.»\n2. Réponse partielle honnête : «Ce que je peux vous dire c'est que...»\n3. Pont vers votre message : «Et ce qui est essentiel, c'est que...»\n→ Exemples de ponts : «Ce qui me semble plus fondamental c'est...» / «Mais la vraie question est...» / «Permettez-moi de replacer cela dans le contexte...\"\n\nGESTION DES QUESTIONS HOSTILES\n1. Respirez avant de répondre (2 secondes de silence = maîtrise de soi visible).\n2. Reformulez la question à votre avantage : «Si je comprends bien, vous demandez si X. La question que je me pose moi, c'est Y.»\n3. Ne jamais répéter une attaque en la réfutant : «Ce discours n'est pas populiste» dit 'populiste' deux fois.\n4. Utilisez la concession stratégique : «Vous avez tout à fait raison sur ce point. Cela renforce d'autant plus mon argument que...\"\n\nEXERCICE DES 30 CERCLES\nChaque matin, prenez n'importe quel objet. En 1 minute, trouvez 10 façons différentes de le relier à l'actualité politique. Cela développe la flexibilité associative nécessaire à l'improvisation."},
  {id:8,icon:"shield",title:"Le débat contradictoire",desc:"Stratégies offensives et défensives",content:"PSYCHOLOGIE DU DÉBAT\nUn débat se joue à deux niveaux : le contenu (logos) et la perception (éthos+pathos). On peut gagner sur le fond et perdre aux yeux de l'audience. La règle d'or : ne jamais laisser l'adversaire définir les termes du débat.\n\nSTRATÉGIES OFFENSIVES\n1. Attaque du prémisse : ne répondez pas à l'argument, questionnez son fondement.\n→ «Votre argument repose sur l'idée que X. Or X est précisément ce qui est contesté.»\n2. Réduction à l'absurde : poussez l'argument adverse jusqu'à ses conséquences logiques absurdes.\n→ «Si l'on suit votre logique jusqu'au bout, cela implique que...»\n3. Retournement de preuve : utilisez les exemples de l'adversaire pour prouver le contraire.\n→ «Vous citez le cas de X pour montrer Y. Mais ce même exemple montre en réalité Z.»\n4. Question socratique : posez des questions apparemment innocentes qui démolissent l'argumentation.\n→ «Comment définissez-vous exactement X ?» (souvent, l'adversaire ne peut pas)\n\nSTRATÉGIES DÉFENSIVES\n1. Distinction : «Il faut distinguer deux choses que vous confondez...»\n2. Contextualisation : «Dans le contexte de 2024, cet argument serait valide. Mais ici...»\n3. Concession-limitation : «Vous avez raison sur le cas particulier, mais cette exception ne invalide pas la règle générale.»\n4. Substitution de question : «La vraie question n'est pas X mais Y.»\n\nSOPHISMES COURANTS À IDENTIFIER\n- Ad hominem : attaquer la personne, pas l'argument. («Vous dites ça parce que vous êtes...»)\n- Homme de paille : réfuter une version caricaturale de l'argument adverse.\n- Faux dilemme : présenter seulement deux options alors qu'il en existe d'autres.\n- Pente glissante : supposer qu'une chose mène inévitablement à une autre.\n- Appel à la nature : «C'est naturel donc c'est bien» (ou «C'est artificiel donc c'est mauvais»)\n- Généralisation hâtive : tirer une règle générale d'un ou deux cas.\n- Corrélation vs causalité : confondre 'se passe en même temps' et 'l'un cause l'autre'.\n\nSTRUCTURE DE RÉFUTATION EN 4 TEMPS\n1. Reformulation : «Si je comprends bien, vous affirmez que X.»\n2. Concession partielle : «Je concède que dans le cas Y, cela peut sembler vrai.»\n3. Réfutation principale : «Cependant, cela ne tient pas parce que...»\n4. Contre-attaque : «Et cela révèle en réalité la faiblesse de votre position sur Z.\""},
  {id:9,icon:"info",title:"Storytelling politique",desc:"Arcs narratifs et anecdotes",content:"POURQUOI LES HISTOIRES PERSUADENT\nLes neurosciences confirment (Paul Zak) que les récits bien construits libèrent de l'ocytocine — l'hormone de l'empathie et de la confiance. Une histoire est mémorisée 22 fois mieux qu'un fait isolé. Les politiques qui gagnent des élections sont systématiquement ceux qui racontent la meilleure histoire.\n\nLES 3 ARCS NARRATIFS DU DISCOURS POLITIQUE\n1. L'arc héroïque (Joseph Campbell)\nSituation initiale → Appel → Refus → Acceptation → Épreuves → Transformation → Retour victorieux\n→ Exemple : Mandela (oppression → résistance → prison → libération → président)\n→ Utilisation : discours de campagne, discours d'investiture, témoignages personnels.\n\n2. L'arc de menace (tragédie évitée)\nMonde stable → Menace émergente → Conséquences catastrophiques si inaction → Solution → Monde sauvé\n→ Exemple : Churchill en 1940 (Europe libre → nazisme → extinction de la civilisation → résistance)\n→ Utilisation : discours d'urgence, plaidoyers pour une cause, discours sur le climat.\n\n3. L'arc de transformation collective\nNous souffrions → Nous avons compris → Nous avons agi → Nous avons changé\n→ Exemple : discours de réconciliation (Mandela 1994, Havel 1990)\n→ Utilisation : discours post-crise, discours de commémoration.\n\nÉLÉMENTS D'UNE ANECDOTE EFFICACE\n1. Un personnage spécifique (pas 'une femme' mais 'Marie, 47 ans, ouvrière à Lyon...')\n2. Un moment précis dans le temps et l'espace\n3. Une tension ou un obstacle concret\n4. Une résolution ou une leçon claire\n5. Un lien explicite avec votre argument politique\n→ Durée idéale : 60-90 secondes. Au-delà, l'audience perd le fil politique.\n\nTECHNIQUE DU MIROIR\nFaites que le héros de votre histoire soit votre audience, pas vous-même. «Imaginez que vous êtes Marie, que vous rentrez du travail et que...» — l'identification est totale, la résistance s'effondre."},
  {id:10,icon:"globe",title:"Rhétorique interculturelle",desc:"Adapter son discours au contexte culturel",content:"DIMENSIONS CULTURELLES DE HOFSTEDE\nLe sociologue Geert Hofstede a identifié 6 dimensions culturelles qui varient selon les pays et affectent directement la communication persuasive :\n\n1. Individualisme vs Collectivisme\n→ USA, France : rhétorique des droits individuels, de l'accomplissement personnel.\n→ Chine, Japon, Afrique : rhétorique de la communauté, de l'harmonie, de la responsabilité collective.\n\n2. Distance hiérarchique\n→ France (forte) : l'autorité hiérarchique est attendue dans les discours — les citations d'autorité pèsent lourd.\n→ Pays nordiques (faible) : l'orateur doit montrer qu'il est au même niveau que son audience.\n\n3. Évitement de l'incertitude\n→ Cultures à fort évitement (France, Allemagne) : structurez avec des plans clairs, des preuves multiples.\n→ Cultures à faible évitement (USA, UK) : l'improvisation visible et la spontanéité sont valorisées.\n\nSTYLES RHÉTORIQUES COMPARÉS\nSTYLE FRANÇAIS — Déductif, abstrait, universel.\nOn part du principe général pour aller vers le cas particulier. Le cadre théorique précède l'exemple. Les grandes idées (liberté, égalité) sont citées avant les faits concrets.\n→ Atout : cohérence intellectuelle, profondeur.\n→ Risque : incompréhension à l'international si l'on reste dans l'abstrait.\n\nSTYLE ANGLO-SAXON — Inductif, concret, pragmatique.\nOn part de l'anecdote concrète pour aller vers la règle générale. Les faits précèdent la théorie. 'Show, don't tell'.\n→ Atout : immédiatement accessible, mémorable.\n→ Risque : peut sembler superficiel ou anecdotique.\n\nSTYLE ASIATIQUE — Contextuel, allusif, indirect.\nLe sens se construit dans le contexte et l'implicite. Les références culturelles communes (confucianisme, harmonie) créent une communauté de sens sans être explicitées.\n→ Clé : le silence et l'allusion peuvent être plus forts que l'affirmation directe.\n\nRÈGLES D'OR DE L'ADAPTATION INTERCULTURELLE\n1. Commencez toujours par identifier les valeurs centrales de votre audience.\n2. Citez des autorités reconnues localement (et non seulement occidentales).\n3. Adaptez votre niveau de formalité au contexte hiérarchique local.\n4. Évitez l'humour dans les premières interventions — l'humour est la compétence interculturelle la plus difficile."},
  {id:11,icon:"scale",title:"La plaidoirie",desc:"Structure, techniques et grands avocats",content:"QU'EST-CE QU'UNE PLAIDOIRIE ?\nLa plaidoirie est l'art de plaider en faveur d'un accusé ou d'une cause devant un tribunal. Elle diffère du discours politique par ses contraintes formelles (règles de procédure, contradictoire) et son enjeu concret (liberté, argent, honneur d'un client).\n\nSTRUCTURE CLASSIQUE EN 5 TEMPS\n1. L'entrée en matière — Ne pas attaquer immédiatement. Établissez le contexte humain.\n2. Le fait justificatif — Exposez les faits de manière favorable sans mentir.\n3. L'argumentation juridique — Citez les textes, la jurisprudence, la doctrine.\n4. La réfutation du ministère public — Analysez et démolissez les arguments adverses.\n5. La péroraison — Fin émotionnelle qui appelle à la clémence ou à la justice.\n\nTECHNIQUES DES GRANDS AVOCATS\nJacques Vergès — La rupture de ban : refuser les règles du jeu et mettre le tribunal en accusation (procès Klaus Barbie). Risquée mais mémorable.\nRobert Badinter — La sobriété absolue : aucun artifice rhétorique, seulement la force des faits et du droit. Efficace face à des jurés éduqués.\nHervé Temime — La proximité humaine : faire du client une personne, pas un dossier. Chaque client a une histoire que le jury doit entendre.\n\nERREURS FATALES À ÉVITER\n1. Mentir sciemment (faute déontologique et efficacité nulle — les juges le voient).\n2. Attaquer personnellement la partie adverse (suscite la sympathie pour l'adversaire).\n3. Trop parler : une plaidoirie de 2 heures est moins efficace qu'une de 30 minutes bien construite.\n4. Ignorer les éléments à charge : il vaut mieux les aborder et les contextualiser que de sembler les esquiver.\n5. Confondre la salle d'audience avec un théâtre : les effets trop visibles nuisent à la crédibilité.\n\nCAS HISTORIQUES\n→ Zola dans J'accuse (1898) : plaidoirie publique dans la presse — élargissement du tribunal.\n→ Défense de Mandela à Rivonia (1964) : le prévenu plaide lui-même, transformant son procès en tribune politique.\n→ Nuremberg (1945-1946) : construction du droit pénal international par la plaidoirie."},
  {id:12,icon:"star",title:"Les 7 principes de l'éloquence",desc:"Les lois universelles de la parole",content:"PRINCIPE 1 — LA CLARTÉ AVANT TOUT\nUne idée floue dans l'esprit de l'orateur sera doublement floue pour l'audience. Testez votre maîtrise : pouvez-vous expliquer votre argument à un enfant de 10 ans ? Si non, vous ne le maîtrisez pas encore.\n→ Règle : une idée par phrase. Une thèse par discours.\n\nPRINCIPE 2 — L'AUTHENTICITÉ EST IRREMPLAÇABLE\nLes audiences modernes ont un détecteur de faux extrêmement développé. Un orateur qui parle de ce qu'il a vécu, croit réellement, souffert sera toujours plus convaincant qu'un acteur parfait jouant un rôle.\n→ Ne pas essayer d'imiter les grands orateurs — trouver sa propre voix.\n\nPRINCIPE 3 — LA RÉPÉTITION EST LA CLÉ\nHermann Ebbinghaus (1885) a montré que 70% d'un contenu est oublié dans les 24 heures sans répétition. Un grand discours dit la même chose 3 fois : en l'annonçant, en le développant, en le résumant.\n→ Maxime : «Dites ce que vous allez dire. Dites-le. Dites ce que vous avez dit.\"\n\nPRINCIPE 4 — L'ÉCONOMIE DES MOTS\nCicéron disait : «Si j'avais eu plus de temps, j'aurais écrit une lettre plus courte.» La concision est le signe de la maîtrise. Chaque mot superflu affaiblit les mots essentiels.\n→ Exercice : prenez votre discours de 10 minutes et réduisez-le à 5 sans perdre aucune idée.\n\nPRINCIPE 5 — L'ÉCOUTE ACTIVE DE L'AUDIENCE\nUn grand orateur est d'abord un grand lecteur de salle. Observer les regards, la posture, les murmures permet d'adapter en temps réel. L'éloquence n'est pas un monologue mais un dialogue.\n→ Technique : regarder l'audience dans les yeux, pas ses notes.\n\nPRINCIPE 6 — LA TENSION NARRATIVE\nTout discours doit créer et maintenir une tension : une question sans réponse, un problème sans solution visible, un mystère non résolu. La tension maintient l'attention. Résolvez-la au moment le plus fort.\n→ Technique : posez la question centrale dès le début et n'y répondez qu'à la fin.\n\nPRINCIPE 7 — LE COURAGE RHÉTORIQUE\nDire à une audience ce qu'elle a besoin d'entendre plutôt que ce qu'elle veut entendre. La flatterie est le contraire de l'éloquence. Les discours historiques ont toujours demandé quelque chose de difficile.\n→ Exemples : Badinter en 1981, Mandela à Rivonia, Churchill en 1940. Tous ont dit la vérité difficile devant des audiences hostiles ou craintives."},
  // ── PREMIUM RHÉTORIQUE ────────────────────────────────────────
  {id:13,premium:true,icon:"mic",title:"L'élocution parfaite",desc:"Voix, diction et articulation",content:"LA VOIX COMME INSTRUMENT\nL'élocution (du latin elocutio : art de l'expression) désigne la qualité de la parole dans ses dimensions phonétiques, rythmiques et prosodiques. Contrairement à l'idée reçue, une belle voix n'est pas un don naturel : c'est le résultat d'un travail régulier.\n\nLES 6 DÉFAUTS À CORRIGER EN PRIORITÉ\n1. La voix de gorge (laryngée) : produit une voix tendue, sèche, peu portée. Corriger par la respiration diaphragmatique — la voix doit venir du ventre, pas de la gorge.\n2. Le débit trop rapide : signe de stress. Impose un rythme de 130-150 mots/minute en discours solennel. Lisez un texte à voix haute avec un métronome.\n3. La fin de phrase avalée : fréquent chez les Français. Maintenir la puissance vocale jusqu'au dernier mot — c'est souvent le mot le plus important.\n4. L'intonation montante : transforme toute affirmation en question. S'entendre sur enregistrement et corriger systématiquement.\n5. Les parasites sonores (euh, hm, bon) : remplacer par le silence. Le silence est toujours plus fort qu'un parasite.\n6. L'articulation paresseuse : travailler avec les 'virelangues' (Les chaussettes de l'archiduchesse...) 5 min/jour.\n\nEXERCICES QUOTIDIENS\n→ Humming matinal : fredonner 3 minutes pour déverrouiller les cordes vocales.\n→ Lecture à voix haute de textes difficiles (Racine, Corneille) : exige une articulation parfaite.\n→ Enregistrement quotidien : s'entendre est la seule façon de mesurer ses progrès."},
  {id:14,premium:true,icon:"zap",title:"Mémoriser un discours sans stress",desc:"Techniques mnémotechniques pour l'oral",content:"LE PROBLÈME DE LA MÉMOIRE EN PUBLIC\nLa mémoire est sensible au stress : sous pression, le cortisol bloque l'hippocampe et génère des trous de mémoire. La solution n'est pas de tout mémoriser mot pour mot (trop fragile au stress) mais de maîtriser la structure et les idées clés.\n\nMÉTHODE DU PALAIS DE LA MÉMOIRE\nTechnique utilisée depuis l'Antiquité (Simonide de Céos) : associer chaque point de votre discours à un lieu précis d'un parcours mental familier. Pour raconter : marchez mentalement dans votre maison et retrouvez chaque idée dans la pièce correspondante.\n→ Exercice : définissez 5 'salles' de votre palais. Placez votre introduction dans le couloir, vos 3 arguments dans le salon, la salle à manger et la cuisine, votre conclusion dans la chambre.\n\nMÉTHODE DE L'HISTOIRE\nConvertir chaque argument en image narrative. Les images incongrues se mémorisent mieux que les concepts abstraits.\n→ 'Soft power' → imaginez la main d'un diplomate tenant un microphone de chanteur pop devant la Maison Blanche.\n\nRÈGLES PRATIQUES\n1. Apprenez le plan, pas le texte — la structure guide l'improvisation.\n2. 3 répétitions espacées (Ebbinghaus) valent mieux qu'un marathon de révision la veille.\n3. Récitez en marchant : le mouvement ancre la mémoire corporellement.\n4. La première phrase et la dernière phrase se mémorisent intégralement — elles encadrent tout le reste."},
  {id:15,premium:true,icon:"award",title:"Préparer un oral en 10 minutes",desc:"La méthode express pour les situations d'urgence",content:"QUAND VOUS N'AVEZ PAS LE TEMPS\nParfois, une prise de parole s'impose sans préparation. La bonne nouvelle : 10 minutes suffisent si vous suivez une méthode stricte.\n\nLES 10 MINUTES CHRONO\n[Minutes 1-2] Décidez votre unique message principal. Un seul. Pas trois. Notez-le en une phrase.\n[Minutes 3-4] Trouvez 2-3 exemples concrets qui illustrent ce message. Prenez des exemples récents et précis.\n[Minutes 5-6] Rédigez votre accroche (une anecdote, un chiffre, une question) et votre chute (qui revient à votre message).\n[Minutes 7-8] Anticipez la question la plus probable et préparez une réponse PREP.\n[Minutes 9-10] Répétez mentalement la structure : accroche → message → exemple 1 → exemple 2 → message + chute.\n\nSTRUCTURE MINIMALE VIABLE\nAccroche (30 secondes) → Message central (15 secondes) → 2 exemples (60 secondes) → Conclusion = reprise du message (20 secondes)\nDurée totale : ~2 minutes 15. Court, dense, mémorable.\n\nERREURS À ÉVITER SOUS PRESSION\n→ Essayer de tout dire : vous ne direz rien de mémorable.\n→ Lire ses notes : perdez le contact avec l'audience.\n→ S'excuser de ne pas être préparé : l'audience ne le sait pas, ne le dites pas."},
  {id:16,premium:true,icon:"shield",title:"Parler face à une audience hostile",desc:"Techniques de résistance et retournement",content:"LA PSYCHOLOGIE DE L'HOSTILITÉ\nUne audience hostile n'est pas un ennemi mais une ressource. Sa résistance vous force à clarifier, à approfondir, à convaincre plus rigoureusement. Les meilleurs discours historiques ont été prononcés devant des audiences hostiles (Badinter en 1981, Churchill en 1940, Mandela à Rivonia).\n\nSTRATÉGIES DE DÉSAMORÇAGE\n1. L'accueil de l'hostilité : «Je sais que certains d'entre vous ne partagent pas ma position. C'est légitime. Laissez-moi vous expliquer pourquoi j'en suis venu à cette conviction.» — Désarme immédiatement l'agressivité.\n2. La concession stratégique : accorder quelque chose sur le fond, pas sur les valeurs. «Vous avez raison que ce dossier est complexe. C'est précisément pourquoi il faut en parler avec rigueur.\"\n3. L'humour auto-dérisoire : rire de soi avant que l'autre le fasse. Désamorce la tension et humanise l'orateur.\n4. La question retournée : «Quelle serait votre solution ?\" — Déplace la charge de la preuve.\n\nQUAND ON SIFFLE OU ON INTERPELLE\n→ Pause de 5 secondes : le silence maîtrisé impressionne plus que la réponse précipitée.\n→ Ne jamais hausser le ton : baisser le volume force l'audience à se taire pour entendre.\n→ Regarder les siffleurs dans les yeux, sans hostilité : l'attention directe désarme souvent mieux que le débat.\n\nFRAMING PRÉVENTIF\nSi vous savez que votre sujet est controversé, anticipez l'hostilité dans votre accroche : «Je suis conscient que ce que je vais dire ne plaira peut-être pas à tout le monde. C'est précisément pourquoi il faut le dire.»"},
  {id:17,premium:true,icon:"info",title:"La conclusion parfaite",desc:"Terminer sur une note inoubliable",content:"POURQUOI LA CONCLUSION EST CAPITALE\nL'effet de primauté et l'effet de récence (primacy-recency effect, psychologie cognitive) montrent que l'audience retient mieux le début et la fin que le milieu. Une conclusion médiocre annule 40% de l'impact d'un excellent développement.\n\nTYPES DE CONCLUSIONS EFFICACES\n1. La chute prophétique : terminer sur une vision du futur. «Dans 20 ans, vous vous souviendrez de ce moment. Vous vous demanderez ce que vous avez fait. Je vous dis aujourd'hui ce qu'il faut faire.»\n2. Le retour à l'accroche : boucler avec l'anecdote ou l'image du début. Donne un sentiment de complétude et d'architecture.\n3. La formule mémorable : une phrase destinée à vivre au-delà du discours. (« Ich bin ein Berliner. » « Je suis prêt à mourir pour cet idéal. »)\n4. L'appel à l'action : terminer par un verbe d'action à l'impératif. «Votez. Agissez. Choisissez.»\n5. La question ouverte : laisser l'audience réfléchir. Fonctionne en contexte académique, moins en contexte militant.\n\nSTRUCTURE DE LA CONCLUSION PARFAITE\n1. Synthèse des idées clés (15-20 secondes) — sans répéter mot pour mot\n2. Retour au fil narratif (si vous avez commencé par une anecdote)\n3. Formule mémorable (1-2 phrases)\n4. Silence final (3 secondes) — ne pas détruire l'effet par une formule de politesse immédiate\n\nERREUR FATALE\nDire «En conclusion, je voulais juste dire que...» — l'adverbe 'juste' annule la solennité. Dites directement : «En conclusion :»"},
  {id:18,premium:true,icon:"send",title:"Les connecteurs logiques en discours",desc:"Articuler son raisonnement avec précision",content:"POURQUOI LES CONNECTEURS FONT LA DIFFÉRENCE\nUn discours sans connecteurs logiques est une liste de phrases. Avec des connecteurs bien choisis, c'est un raisonnement. Les connecteurs signalent à l'audience comment interpréter la relation entre les idées.\n\nCATÉGORIES ET EXEMPLES\nADDITION : De plus / En outre / Par ailleurs / Qui plus est / S'ajoute à cela\n→ Usage : ajouter un argument de même valeur au précédent.\n\nOPPOSITION FORTE : Cependant / Néanmoins / Or / Pourtant / En dépit de cela\n→ Usage : introduire une réfutation ou une nuance qui relativise le précédent.\n\nCONSÉQUENCE : Ainsi / C'est pourquoi / Il s'ensuit que / De ce fait / Par conséquent\n→ Usage : connecter une cause à son effet logique.\n\nILLUSTRATION : Par exemple / C'est notamment le cas de / À titre d'exemple / Prenons le cas de\n→ Usage : ancrer une idée abstraite dans le concret.\n\nINTRODUCTION DE THÈSE : Il convient de / Force est de constater que / On ne saurait nier que\n→ Usage : présenter sa position avec nuance.\n\nCONCESSION : Certes / Sans doute / Il est vrai que... mais / Même si l'on admet que...\n→ Usage : concéder un point adverse avant de le dépasser.\n\nSYNTHÈSE : En définitive / Au total / En somme / Pour conclure / Il apparaît donc que\n→ Usage : rassembler les fils avant de conclure.\n\nPIÈGES À ÉVITER\n→ «Donc» toutes les 3 phrases : devient un tic, perd son sens.\n→ «En conclusion» au milieu d'un développement : désorienter l'audience.\n→ Les connecteurs faux (confondre 'car' causal et 'mais' concessif)."},
  {id:19,premium:true,icon:"users",title:"La conférence de presse",desc:"Répondre aux journalistes avec maîtrise",content:"LE JEU DES QUESTIONS-RÉPONSES\nUne conférence de presse n'est pas un exposé mais une danse. Le journaliste cherche l'erreur, la contradiction, l'inattendu. Votre objectif n'est pas de tout dire mais de maîtriser votre message tout en semblant répondre à tout.\n\nRÈGLES D'OR\n1. La règle des 3 messages : avant toute conférence de presse, identifiez 3 messages que vous voulez que les journalistes retiennent. Revenez à ces messages quoi qu'on vous demande.\n2. La technique du pont : répondre brièvement à la question puis 'ponter' vers votre message. «Oui, c'est une vraie question. Et ce qu'il faut comprendre dans ce contexte, c'est que...»\n3. Le refus poli : «Ce n'est pas le sujet d'aujourd'hui, mais je suis disponible pour en parler séparément.» Jamais de «Sans commentaire» — ça fait fuir les journalistes.\n\nGESTION DES QUESTIONS PIÈGES\n→ Question hypothétique : «Supposez que vous êtes élu...» — Répondez sur votre vision, pas sur l'hypothèse.\n→ Question à double sens : «Êtes-vous pour X ou contre Y ?» — Refusez le cadre : «Ce n'est pas la bonne façon de poser la question.\"\n→ Question agressive : marquez une pause, respirez, répondez calmement. La maîtrise de soi est visible et valorisée.\n→ Question sur une déclaration passée : «C'est exact, et laissez-moi vous expliquer l'évolution de ma position...\" (jamais nier, recontextualiser).\n\nLE BODY LANGUAGE EN CONF DE PRESSE\n→ Regardez le journaliste qui pose la question, puis l'audience entière pour répondre.\n→ Ne croisez jamais les bras : position fermée = message défensif.\n→ Parlez lentement : la caméra et le micro amplifient la précipitation."},
  {id:20,premium:true,icon:"globe",title:"Le discours de crise",desc:"Communiquer sous la pression maximale",content:"QUAND LA CRISE FRAPPE\nUn discours de crise est prononcé dans des conditions de stress maximal : l'information est incomplète, l'audience est anxieuse, les médias attendent la moindre erreur. Trois erreurs classiques à éviter absolument : le silence (perçu comme de la culpabilité), la sur-communication (saturation et confusion), et les promesses non tenues (perte de crédibilité irréversible).\n\nSTRUCTURE DU DISCOURS DE CRISE\n1. Reconnaissance (30 secondes) : «Je prends la pleine mesure de la gravité de la situation.» Reconnaître AVANT d'expliquer.\n2. Empathie (30 secondes) : «Mes premières pensées vont aux victimes.» Toujours avant les faits.\n3. Faits (2-3 minutes) : état de la situation, ce qu'on sait, ce qu'on ne sait pas encore. L'honnêteté sur l'incertitude renforce la confiance.\n4. Actions (2-3 minutes) : ce qui est fait maintenant, ce qui sera fait. Concret, mesurable, daté si possible.\n5. Disponibilité (20 secondes) : «Nous tiendrons la presse informée à mesure que nous en saurons plus.» Fixer le prochain rendez-vous.\n\nGESTION DU TEMPS\nLes premières 2 heures sont cruciales : la première communication définit le cadre narratif. Si vous n'occupez pas ce cadre, vos adversaires le feront.\n\nCAS D'ÉCOLE : Johnson & Johnson (Tylenol, 1982)\nRetrait immédiat de 31 millions de flacons, transparence totale, communication fréquente → restauration complète de la confiance en 6 mois. Le modèle absolu de gestion de crise par la communication."},
  {id:21,premium:true,icon:"video",title:"Parler face à une caméra",desc:"Présence télévisuelle et maîtrise de l'image",content:"LA CAMÉRA CHANGE TOUT\nParler à une caméra est contre-intuitif : vous parlez à un objectif froid pour atteindre des millions d'inconnus. Trois différences majeures avec le discours en salle : 1) le regard caméra est l'équivalent du contact oculaire, 2) les micro-expressions sont amplifiées, 3) le silence est perçu différemment (comme une hésitation plutôt que comme de la maîtrise).\n\nRÈGLES DES PROFESSIONNELS\n1. Regardez l'objectif, pas l'écran de retour : regarder sa propre image projette l'insécurité.\n2. Réduisez les gestes de 50% : la caméra amplifie le mouvement, les grands gestes semblent théâtraux.\n3. Souriez légèrement même sur des sujets sérieux : le visage neutre à la caméra paraît sévère ou maussade.\n4. Parlez légèrement plus lentement qu'en présentiel : les silences permettent les coupes et les sous-titres.\n5. Soignez l'arrière-plan : un fond encombré distrait. Un fond sobre (bibliothèque, mur uni) renforce le sérieux.\n\nPOUR LES INTERVIEWS TÉLÉVISÉES\n→ Ne pas répondre 'oui' à la première question : ça coupe net l'échange. Développez toujours.\n→ Finissez vos phrases : les journalistes n'attendent souvent que l'hésitation pour couper.\n→ Gérez vos mains : sur un bureau = professionnel. Dans vos poches = désinvolte. Croisées = défensif.\n\nPOUR LES CONTENUS VIDÉO EN LIGNE\n→ Les 5 premières secondes sont décisives : formulez votre message principal immédiatement.\n→ La règle des 2/3 : regardez légèrement au-dessus de l'objectif pour un regard naturel.\n→ L'éclairage compte autant que le contenu : face à une fenêtre = exposition naturelle parfaite."},
  {id:22,premium:true,icon:"award",title:"Réussir le Grand Oral du Bac",desc:"Méthode et stratégie pour le Grand Oral",content:"QU'EST-CE QUE LE GRAND ORAL ?\nÉpreuve terminale du Baccalauréat depuis 2021. 20 minutes au total : 5 min de préparation + 5 min d'exposé + 10 min de Q&R. Coefficient : 14 (voie générale), 10 (voie technologique). Note sur 20.\n\nLES 3 PHASES\nPHASE 1 — L'exposé (5 min)\nPartez d'une question choisie par le jury parmi vos 2 propositions. Structure obligatoire : introduction (problématique + annonce) + développement (2-3 parties) + conclusion. Pas de notes autorisées après la préparation.\n\nPHASE 2 — Échange sur le sujet (5 min)\nLe jury peut questionner, approfondir, contester. Restez sur le sujet, défendez vos positions, reconnaissez les limites de votre travail.\n\nPHASE 3 — Projet d'orientation (5 min)\nComment votre question s'articule à votre projet ? Soyez authentique mais structuré.\n\nCE QUE LE JURY ÉVALUE (grille officielle)\n→ Clarté des propos et cohérence de la démarche (8 points)\n→ Maîtrise des connaissances et argumentation (8 points)\n→ Expression orale et communication (4 points)\n\nERREURS FATALES\n→ Lire ses notes sur l'estrade (autorisées en préparation mais pas à l'oral)\n→ Réciter son cours sans problématisation\n→ Refuser de défendre sa position face aux questions du jury"},
  {id:23,premium:true,icon:"scale",title:"Réussir l'oral de Sciences Po Paris",desc:"Méthode pour l'entretien de personnalité",content:"FORMAT DE L'ÉPREUVE\nOral de personnalité : 30 minutes dont 5 min de présentation libre puis 25 min de Q&R devant un jury de 2-3 personnes. Coefficient important dans la sélection finale. Évaluation : culture générale, cohérence du projet, qualité oratoire.\n\nLA PRÉSENTATION EN 5 MIN\nStructure recommandée : 1) Parcours scolaire et engagements extrascolaires (1 min) → 2) Ce qui vous a amené à vous intéresser aux questions politiques/internationales (1,5 min) → 3) Votre projet (1 min) → 4) Une expérience fondatrice ou une conviction forte (1,5 min). Finir sur une ouverture, pas sur la liste de vos notes.\n\nCULTURE GÉNÉRALE — CE QU'ILS ATTENDENT\n→ Connaître l'actualité : au moins 5 sujets internationaux récents maîtrisés en profondeur (pas juste les titres).\n→ Avoir des positions argumentées, nuancées mais assumées. «Je ne sais pas» sur un sujet important est acceptable si suivi d'une réflexion.\n→ Connaître l'histoire politique récente (depuis 1945) : décolonisation, Guerre froide, construction européenne, grands discours.\n\nATTITUDE\n→ Curiosité affichée : poser une question au jury sur un sujet abordé montre de la vraie curiosité intellectuelle.\n→ Cohérence entre vos opinions et votre parcours : le jury cherche l'authenticité.\n→ Ne pas prétendre à une expertise que vous n'avez pas : la mauvaise foi est immédiatement repérée."},
  {id:24,premium:true,icon:"brief",title:"Les concours administratifs — oral",desc:"Entretien devant jury : concours ENA/INSP, IEP, Préfet",content:"SPÉCIFICITÉS DES CONCOURS ADMINISTRATIFS\nLes concours administratifs (INSP, attaché territorial, IEP, administrateur de l'État) ont des oraux spécifiques : 15-30 minutes, jury composé de hauts fonctionnaires, professeurs et représentants syndicaux. L'évaluation porte sur le raisonnement, le comportement face à l'adversité, la connaissance de l'administration.\n\nMATIÈRES À MAÎTRISER POUR L'ORAL\n→ L'organisation administrative française (État central, collectivités, établissements publics)\n→ Droit administratif de base (principe de légalité, hiérarchie des normes, acte administratif)\n→ Les grandes politiques publiques actuelles\n→ L'actualité institutionnelle (réformes récentes, projet de loi en cours)\n→ Les enjeux européens qui touchent votre corps\n\nSTRUCTURE DE RÉPONSE RECOMMANDÉE\nPour toute question : 1) Reformulation (montre que vous avez compris) → 2) Analyse (pas de réponse binaire, nuances) → 3) Examples concrets (un cas réel récent) → 4) Position assumée et défendable.\n\nATTITUDE\n→ Pas d'affirmations définitives sur des questions politiquement sensibles (avortement, immigration, etc.) : les jurys cherchent le raisonnement, pas la position.\n→ Acceptez la contradiction : «C'est un point intéressant, laissez-moi y réfléchir» vaut mieux qu'une réponse précipitée.\n→ Posture physique : dos droit, regard direct, mains sur la table ou sur les cuisses."},
  {id:25,premium:true,icon:"heart",title:"Le discours d'éloge funèbre",desc:"Rendre hommage avec dignité et vérité",content:"L'ART DÉLICAT DE L'ÉLOGE FUNÈBRE\nL'éloge funèbre (oraison funèbre) est le discours prononcé lors de funérailles ou cérémonies commémoratives pour honorer le défunt. C'est l'un des exercices rhétoriques les plus difficiles : il doit à la fois consoler, rendre hommage et aider les vivants à trouver un sens au deuil.\n\nSTRUCTURE RECOMMANDÉE\n1. L'ancrage dans le présent douloureux (1 minute) : reconnaître la perte sans la minimiser.\n2. La vie dans sa singularité (3-5 minutes) : une ou deux anecdotes spécifiques qui révèlent l'humanité du défunt. Pas une liste de mérites mais une présence.\n3. L'héritage (1-2 minutes) : ce qu'il ou elle laisse aux vivants : une façon d'être, une valeur, un exemple.\n4. La consolation (1 minute) : sans mensonge ni platitude. «Nous ne l'oublierons pas» vaut plus que «Il est dans un endroit meilleur».\n5. L'adieu direct (30 secondes) : une phrase adressée directement au défunt, en son nom, de la part de tous.\n\nCE QU'IL FAUT ÉVITER\n→ Les généralités vides : «C'était quelqu'un de bien» ne dit rien.\n→ Les anecdotes embarrassantes : l'humour peut aider à alléger, mais doit être consensuel.\n→ L'excessive longeur : 8-10 minutes maximum. La douleur du deuil rend les longues cérémonies épuisantes.\n\nMODÈLES HISTORIQUES\n→ Discours de Kennedy à la mort de Robert Kennedy (1968) — simplicité bouleversante.\n→ Oraison funèbre de Bossuet pour Henriette d'Angleterre (1670) — maîtrise rhétorique absolue."},
  {id:26,premium:true,icon:"star",title:"Maîtriser la métaphore en politique",desc:"L'image comme outil de conviction",content:"POURQUOI LA MÉTAPHORE GOUVERNE LA POLITIQUE\nGeorge Lakoff (Metaphors We Live By, 1980) a démontré que nous pensons fondamentalement en métaphores. Les grandes métaphores politiques ne décrivent pas la réalité : elles la construisent. 'Le Rideau de fer' (Churchill), 'La main invisible du marché' (Smith), 'La guerre contre la pauvreté' (Johnson), 'Make America Great Again' — ces métaphores ont façonné des politiques entières.\n\nTYPES DE MÉTAPHORES POLITIQUES\n1. La métaphore guerrière : 'Combattre le chômage', 'vaincre le cancer', 'lutter contre la pauvreté'. Mobilise mais peut mener à des décisions excessives.\n2. La métaphore de la navigation : 'Redresser le cap', 'naviguer dans les eaux troubles'. Suggère la maîtrise technique.\n3. La métaphore corporelle : 'Le corps social', 'l'économie est malade', 'le tissu social'. Crée une empathie naturelle.\n4. La métaphore familiale : 'La nation comme famille'. Produit de la cohésion mais exclut quiconque ne rentre pas dans le modèle.\n5. La métaphore architecturale : 'Construire l'Europe', 'les fondations de la démocratie'. Sugère la durabilité et l'effort.\n\nCOMPOSER UNE BONNE MÉTAPHORE\n→ Elle doit être cohérente sur toute la durée du discours (ne pas mélanger les registres)\n→ Elle doit être comprise par tous : éviter les métaphores culturellement spécifiques à l'international\n→ Elle doit avoir une logique : si l'Europe est une maison, on peut y parler de fondations, de fenêtres, de chantiers — pas de moteurs ou de météo."},
  {id:27,premium:true,icon:"info",title:"L'intelligence émotionnelle en rhétorique",desc:"Lire son audience et s'adapter en temps réel",content:"DÉFINITION\nL'intelligence émotionnelle (Goleman, 1995) comprend 4 compétences : conscience de soi émotionnelle, gestion de ses émotions, empathie (lecture des émotions des autres), gestion des relations. Pour un orateur, les 2 dernières sont décisives.\n\nLIRE L'AUDIENCE EN TEMPS RÉEL\nSignaux d'engagement positif : hochements de tête, corps légèrement inclinés vers vous, regard direct.\nSignaux de décrochage : regards sur téléphone, posture affaissée, chuchotements, bras croisés.\nSignaux de résistance active : expressions faciales tendues, sourires sarcastiques, questions hostiles.\n\nADAPTATION EN TEMPS RÉEL\nSi l'audience décroche :\n→ Accélérez temporairement le rythme\n→ Posez une question directe à un membre de l'audience\n→ Changez de registre : si vous étiez sur le logos, passez au pathos\n→ Insérez une anecdote courte et concrète\n\nSi l'audience est hostile :\n→ Ralentissez : la vitesse est perçue comme de l'agressivité\n→ Montrez de l'humilité : 'C'est une question légitime, je comprends la position'\n→ Nommez l'émotion dans la salle : 'Je sens qu'il y a une inquiétude ici, et je veux y répondre directement'\n\nGESTION DE SES PROPRES ÉMOTIONS\nAngoisse : respiration 4-7-8 avant de prendre le micro\nColère ou frustration : pause de 3 secondes avant de répondre\nÉmotion intense (témoignage personnel) : prévoyez une 'ancre émotionnelle' — un geste, une phrase, un objet qui vous ramène à la maîtrise"},
  {id:28,premium:true,icon:"trending",title:"La rhétorique des réseaux sociaux",desc:"Persuader dans l'espace numérique",content:"LES RÈGLES DIFFÉRENTES DU NUMÉRIQUE\nLe discours numérique obéit à des règles différentes du discours traditionnel : fragmentation de l'attention (scroll rapide), polylogie (millions de conversations simultanées), viralité (le contenu émotionnel propage x10 le contenu informatif).\n\nLES 4 FORMATS QUI FONCTIONNENT\n1. Le format thread (fil Twitter/X) : argument principal + 5-10 preuves développées en sous-tweets. La navigation séquentielle force l'engagement.\n2. La citation extraite : une phrase forte de 140 caractères, une vérité directe. Les meilleures citations sont paradoxales, contre-intuitives ou universelles.\n3. La vidéo courte (30-90 secondes) : message unique, accroche en 3 premières secondes, conclusion mémorable.\n4. L'infographie argumentative : transforme la complexité en lisibilité. Les données deviennent des arguments.\n\nÉTHIQUE DE LA RHÉTORIQUE NUMÉRIQUE\n→ La désinformation virale : comprendre que les émotions (indignation, peur, humour) propagent x3 les informations vraies et x5 les informations fausses (étude MIT, 2018).\n→ La chambre d'écho : les algorithmes d'amplification n'exposent l'audience qu'à des visions confirmant les siennes — l'orateur numérique doit activement aller vers les opinions différentes.\n→ La responsabilité de la virality : un contenu simplifié à l'extrême peut être plus influent qu'un contenu nuancé mais moins engageant."},
  {id:29,premium:true,icon:"flag",title:"La rhétorique syndicale et sociale",desc:"Mobiliser un collectif de travail",content:"SPÉCIFICITÉS DE LA RHÉTORIQUE SYNDICALE\nLe discours syndical s'adresse à des travailleurs qui partagent une situation commune mais n'ont pas nécessairement la même analyse politique. L'unité est l'enjeu rhétorique central : comment parler à la fois au technicien, à l'ouvrier, au cadre intermédiaire qui se retrouvent dans la même structure mais avec des intérêts parfois divergents ?\n\nLES RESSORTS DE LA MOBILISATION COLLECTIVE\n1. L'identification commune : avant tout argument, ancrez dans le quotidien partagé. «Nous connaissons tous ces fins de mois difficiles / ces réunions absurdes / cette charge de travail impossible.»\n2. La narration du tort subi : nommer clairement l'injustice, sans abstraction. Pas 'la restructuration', mais 'la fermeture du site de Rennes, 340 emplois supprimés sans consultation'.\n3. L'alternative crédible : proposer une sortie, pas seulement une critique. Le pessimisme démobilise ; la perspective réaliste mobilise.\n4. L'appel à la dignité : les revendications de dignité (respect, reconnaissance) mobilisent plus que les revendications économiques seules.\n\nERREURS À ÉVITER\n→ Le jargon militant : 'lutte des classes', 'contradictions du capitalisme' — aliène immédiatement les non-convaincus.\n→ L'attaque personnelle du management intermédiaire : crée des solidarités protectrices.\n→ L'exagération : une fois prise en défaut, toute l'argumentation est discréditée."},
  {id:30,premium:true,icon:"mic",title:"Discours de mariage et toasts",desc:"Parler avec émotion et légèreté",content:"L'ART DU DISCOURS FESTIF\nLe discours de mariage est l'un des plus difficiles de la vie quotidienne : il doit être à la fois personnel et universel, émouvant et léger, bref et mémorable. La plupart des discours de mariage échouent pour trois raisons : ils sont trop longs, trop sentimentaux ou trop techniques (liste de mérites).\n\nSTRUCTURE RECOMMANDÉE (5-7 minutes max)\n1. L'accroche légère (30 secondes) : une anecdote courte ou une observation légèrement humoristique sur la situation.\n2. Comment vous avez connu les mariés (1 minute) : spécifique, une scène précise, un moment révélateur.\n3. Ce que ce couple vous a appris (1,5 minute) : sur l'amour, la vie, vous-même. La sincérité prime.\n4. Un voeu direct aux mariés (1 minute) : pas 'vous serez heureux' (platitude) mais une qualité spécifique que vous leur souhaitez de cultiver.\n5. Le toast (30 secondes) : lever son verre, regarder les mariés dans les yeux, phrase mémorable.\n\nTOAST PARFAIT — FORMULE\n«À [prénom] et [prénom] — que votre amour soit aussi solide que [chose concrète que vous partagez avec eux] et aussi léger que [image positive qui les définit]. Santé !\"\n\nCE QU'IL NE FAUT JAMAIS FAIRE\n→ Mentionner un ex\n→ Révéler une information privée\n→ Dépasser 8 minutes sous peine de perdre l'audience"},
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
  // ── ÉCONOMIE ─────────────────────────────────────────────────
  {term:"PIB",def:"Produit Intérieur Brut : somme des valeurs ajoutées de tous les biens et services produits sur un territoire pendant une période donnée. Principal indicateur de la richesse économique nationale. Limites : ne mesure pas le bien-être (pollution, inégalités, travail non rémunéré). Alternatives proposées : IDH (ONU), BNB (Bhoutan), Indice de progrès véritable (GPI). PIB mondial 2024 : ~110 000 milliards de dollars."},
  {term:"Inflation",def:"Hausse générale et durable du niveau des prix, entraînant une perte du pouvoir d'achat de la monnaie. Mesurée par l'IPC (Indice des Prix à la Consommation). Causes : demande excédentaire (inflation par la demande), coûts de production (inflation par les coûts), création monétaire excessive (monétarisme). Inflation française 2024 : ~2,2%. Hyperinflation historique : Allemagne 1923 (millions %) ; Zimbabwe 2008 (79 milliards %)."},
  {term:"Déflation",def:"Baisse générale et durable du niveau des prix, opposée à l'inflation. Dangereuse car elle crée une spirale récessive : les consommateurs diffèrent leurs achats en anticipant des prix encore plus bas, ce qui réduit la production et les investissements. Le Japon a connu une 'décennie perdue' déflationniste (1991-2001). La BCE a maintenu des taux négatifs (2014-2022) précisément pour éviter ce risque en zone euro."},
  {term:"Stagflation",def:"Situation économique paradoxale combinant stagnation (faible croissance + chômage élevé) et forte inflation, théoriquement incompatibles selon la courbe de Phillips. Phénomène apparu dans les années 1970 lors des chocs pétroliers (1973, 1979). A réfuté le keynésianisme simple et favorisé l'essor du monétarisme (Friedman). Réapparition en 2022 : flambée des prix de l'énergie post-Ukraine + ralentissement économique."},
  {term:"Taux d'intérêt directeur",def:"Taux fixé par les banques centrales (BCE, Fed) pour le refinancement des banques commerciales. Instrument principal de politique monétaire. Hausse des taux → crédit plus cher → frein à la consommation et l'investissement → réduction de l'inflation. Baisse des taux → crédit bon marché → stimulation économique. La Fed a relevé ses taux de 0% à 5,5% entre 2022 et 2023 pour combattre l'inflation post-Covid."},
  {term:"Quantitative Easing",def:"Politique monétaire non conventionnelle : la banque centrale crée de la monnaie pour acheter massivement des actifs financiers (obligations d'État, titres privés), augmentant la liquidité dans le système financier. Pratiqué par la BCE (Mario Draghi, 2015-2022 : 5 000 milliards €) et la Fed (2008-2022). Controversé : risque de bulles d'actifs, d'inflation importée, d'inégalités patrimoniales et de dépendance des États au financement monétaire."},
  {term:"Récession",def:"Période de contraction économique caractérisée par deux trimestres consécutifs de croissance négative du PIB (définition technique). Indicateurs accompagnateurs : hausse du chômage, baisse de la consommation et de l'investissement, dégradation de la confiance des entreprises. Grande Récession (2008-2009) : -4% du PIB mondial ; récession Covid (2020) : -3,5% ; la France a évité la récession en 2023 mais la croissance a été quasi nulle (+0,9%)."},
  {term:"Balance commerciale",def:"Différence entre les exportations et les importations de biens d'un pays. Un excédent (exportations > importations) signale la compétitivité industrielle ; un déficit (importations > exportations) peut révéler une dépendance structurelle. France : déficit commercial record de 164 milliards € en 2022. Allemagne : excédent de 200 milliards € en 2024. La distinction entre balance commerciale (biens) et balance des paiements courants (biens + services + revenus) est importante."},
  {term:"Parité de pouvoir d'achat",def:"Méthode de comparaison internationale qui ajuste les PIB en fonction du niveau des prix locaux plutôt qu'aux taux de change nominaux. En PPA, la Chine dépasse les États-Unis comme première économie mondiale depuis 2014. La PPA est pertinente pour comparer les niveaux de vie réels (1 dollar achète plus en Inde qu'aux États-Unis). Utilisée par le FMI pour ses statistiques comparatives mondiales."},
  {term:"Inégalités économiques",def:"Disparités dans la répartition des revenus et des patrimoines au sein d'une population. Mesuré par le coefficient de Gini (0 = égalité parfaite, 1 = inégalité absolue). Causes : mondialisation (délocalisations), révolution technologique (polarisation du marché du travail), désindustrialisation, fiscalité. La part du 1% dans le revenu mondial est passée de 11% (1980) à 20% (2024). Théorie du ruissellement (trickle-down) réfutée empiriquement par l'OCDE (2015)."},
  {term:"Coefficient de Gini",def:"Indicateur statistique mesurant les inégalités de distribution d'un revenu ou d'un patrimoine dans une population. Varie de 0 (égalité parfaite) à 1 (inégalité absolue). Pays les plus égalitaires : Pays-Bas (0,285), Danemark (0,29). Pays les plus inégaux : Afrique du Sud (0,63), Brésil (0,53). France : 0,307. Limite : compare les revenus actuels sans capturer la mobilité sociale inter-générationnelle."},
  {term:"IDH",def:"Indice de Développement Humain : indicateur composite créé par le PNUD en 1990 (Amartya Sen, Mahbub ul Haq) combinant espérance de vie à la naissance, niveau d'éducation (durée de scolarisation) et revenu par habitant (PIB/habitant en PPA). Varie de 0 à 1. Pays au IDH très élevé (>0,900) en 2023 : Norvège (1er), Suisse, Islande, Hong Kong. France : 0,910 (26e). Innové par l'ajout de l'IDHI (ajusté des inégalités)."},
  {term:"Bulle spéculative",def:"Phénomène économique dans lequel le prix d'un actif s'écarte fortement et durablement de sa valeur fondamentale en raison d'anticipations excessivement optimistes. Cycles classiques (Minsky) : déplacement → expansion → euphorie → détresse → panique → crash. Bulles historiques : tulipes hollandaises (1637), Mississippi (1720), Internet (2000), immobilier américain (2008), crypto (2021). L'éclatement de la bulle immobilière américaine (subprimes) a provoqué la crise financière mondiale de 2008."},
  {term:"Oligopole",def:"Structure de marché dans laquelle quelques entreprises (oligopole) ou une seule (monopole) dominent l'offre. Dans un oligopole, les prix se fixent en tenant compte des réactions des concurrents (interdépendance stratégique, théorie des jeux). GAFAM : quasi-oligopoles sur leurs marchés respectifs (Google : 90% de la recherche mondiale, Apple+Google : 98% des OS mobiles). Régulation : droit antitrust (UE/USA), amendes pour pratiques anticoncurrentielles."},
  {term:"Externalité",def:"Conséquence non prise en compte dans le prix d'un bien ou service, subie par un tiers non partie à la transaction. Externalité négative : pollution industrielle, émissions carbone. Externalité positive : vaccination (protection collective). Le problème des externalités justifie l'intervention de l'État : taxes Pigouiennes (taxe carbone), réglementation (normes d'émissions), subventions aux externalités positives. La valeur de la tonne de CO2 devrait être de 80-200 € pour internaliser les dommages climatiques (GIEC)."},
  // ── DROIT ET JUSTICE ─────────────────────────────────────────
  {term:"Habeas Corpus",def:"Garantie fondamentale du droit anglo-saxon (Magna Carta 1215, loi de 1679) selon laquelle toute personne arrêtée doit être présentée devant un juge dans un délai défini. Protège contre la détention arbitraire sans contrôle judiciaire. Équivalent en droit français : le contrôle de plein droit de la détention provisoire (article 144 CPP). Principe universel repris dans l'article 9 du PIDCP et l'article 5 de la CEDH."},
  {term:"Intime conviction",def:"Principe fondamental du droit pénal français selon lequel les juges et jurés apprécient les preuves librement, selon leur conscience, sans règle de preuve légale préétablie (article 353 du Code de procédure pénale). Né de la Révolution (1791) en réaction aux règles de preuve rigides de l'Ancien Régime. Implique qu'un acquittement fondé sur le doute raisonnable est toujours possible même face à des preuves solides. Distinct du 'beyond reasonable doubt' américain."},
  {term:"Double peine",def:"Principe juridique du non bis in idem (ne pas être jugé deux fois pour la même infraction) garanti par l'article 4 du Protocole 7 de la CEDH et l'article 14-7 du PIDCP. En France, inclus à l'article 50 de la Charte des droits fondamentaux de l'UE. Débat : la 'double peine' désignait aussi l'expulsion des résidents étrangers condamnés pénalement, abolie en partie par la loi Sarkozy de 2003 pour les étrangers ayant des liens forts avec la France."},
  {term:"Amnistie",def:"Mesure législative effaçant rétroactivement l'infraction et ses conséquences pénales pour une catégorie de faits ou de personnes. En France, seule une loi peut amnistier (article 34 de la Constitution). Distinguer : amnistie (effacement de l'infraction), grâce (remise de la peine), prescription (extinction de l'action publique par l'écoulement du temps). Loi d'amnistie traditionnellement adoptée après chaque élection présidentielle jusqu'à 2002 (dernière en 1995 sous Chirac)."},
  {term:"Extradition",def:"Procédure par laquelle un État remet à un autre État une personne poursuivie ou condamnée sur son territoire. Régie par des conventions bilatérales ou multilatérales (Convention européenne d'extradition de 1957). Dans l'UE, remplacée par le Mandat d'arrêt européen (2002) : procédure simplifiée entre États membres. Limites : un État peut refuser si la peine de mort est applicable dans l'État requérant, si les faits sont politiques, ou si la peine prévue est disproportionnée."},
  {term:"Imprescriptibilité",def:"Absence de délai de prescription pour certains crimes, permettant de les poursuivre et les juger quelle que soit l'ancienneté des faits. En France, crimes imprescriptibles depuis 1964 : génocide, crimes contre l'humanité. Crimes de guerre depuis 2010. Justification : la gravité extrême de ces crimes ne peut être effacée par l'écoulement du temps. Tension avec le droit à la sécurité juridique et la difficultés d'administration de la preuve après plusieurs décennies."},
  {term:"Jurisprudence",def:"Ensemble des décisions rendues par les juridictions, formant une source de droit interprétative. En droit français, la jurisprudence n'est pas formellement source de droit (tradition civiliste, article 5 du Code civil) mais les tribunaux suivent en pratique les précédents des hautes juridictions (Cour de cassation, Conseil d'État, Conseil constitutionnel). Dans les systèmes de Common Law (UK, USA), la jurisprudence (case law, stare decisis) est source formelle et contraignante."},
  {term:"Contrôle de constitutionnalité",def:"Mécanisme vérifiant la conformité des lois à la Constitution. En France : contrôle a priori (avant promulgation) par le Conseil constitutionnel depuis 1958, et contrôle a posteriori via la QPC (Question Prioritaire de Constitutionnalité) depuis 2010. Deux modèles : concentré (juridiction spécialisée — France, Allemagne) ou diffus (tout juge peut écarter une loi inconstitutionnelle — USA depuis Marbury v. Madison, 1803)."},
  {term:"Ombudsman",def:"Institution de contrôle et de médiation chargée de recevoir et d'examiner les plaintes des citoyens contre l'administration. Concept suédois (1809, riksdag). En France : Défenseur des droits (ancien Médiateur de la République) depuis 2011, doté de pouvoirs étendus. Au niveau européen : Médiateur européen. Rôle : recommander, suggérer, publier. Faiblesse : absence de pouvoir de contrainte — ses recommandations ne sont pas obligatoires."},
  // ── PHILOSOPHIE ──────────────────────────────────────────────
  {term:"Dialectique",def:"Méthode de raisonnement par confrontation d'arguments contraires (thèse-antithèse) pour parvenir à une synthèse dépassante. Chez Platon : dialogue philosophique entre Socrate et ses interlocuteurs. Chez Hegel : dialectique de l'Esprit (Geschichte) où chaque moment se nie pour être conservé dans le suivant (Aufhebung). Chez Marx : dialectique matérialiste (lutte des classes comme moteur de l'histoire). La dialectique reste la méthode de base des dissertations de philosophie."},
  {term:"Épistémologie",def:"Branche de la philosophie qui étudie la nature, les limites et la validité de la connaissance. Questions centrales : Peut-on connaître? Comment? Jusqu'où? Qu'est-ce qu'une vérité scientifique? Courants : rationalisme (Descartes — la raison fonde la connaissance), empirisme (Hume, Locke — l'expérience est la source), criticisme (Kant — synthèse : la connaissance résulte de la rencontre de la raison et de l'expérience). Enjeux contemporains : falsifiabilité (Popper), paradigmes scientifiques (Kuhn)."},
  {term:"Utilitarisme",def:"Théorie éthique selon laquelle la valeur morale d'un acte se mesure à son utilité, c'est-à-dire à sa capacité à maximiser le bonheur (plaisir moins souffrance) du plus grand nombre. Fondateurs : Jeremy Bentham ('le plus grand bonheur du plus grand nombre') et John Stuart Mill. Débat avec la déontologie kantienne : pour Kant, la moralité tient à l'intention, pas aux conséquences. Paradoxe du tramway (trolley problem) : illustre les tensions entre utilitarisme et déontologie."},
  {term:"Déontologie",def:"Théorie éthique (Kant) selon laquelle la moralité d'un acte tient à son respect de règles ou principes universels (le devoir), indépendamment des conséquences. Impératif catégorique de Kant : 'Agis uniquement selon la maxime qui fait que tu peux vouloir en même temps qu'elle devienne une loi universelle.' Oppose la pensée conséquentialiste (utilitarisme). Applications concrètes : codes de déontologie des professions (médecins, avocats, journalistes)."},
  {term:"Nihilisme",def:"Doctrine philosophique niant toute valeur, signification ou fondement absolu à l'existence et à la morale. Terme popularisé par Nietzsche pour désigner la crise de valeurs dans l'Europe du XIXe siècle ('Dieu est mort'). Nihilisme passif (résignation) vs nihilisme actif (destruction créatrice pour établir de nouvelles valeurs). Réponse de Nietzsche : la volonté de puissance et la création de nouvelles valeurs ('surhomme'). Influence majeure sur Camus et l'existentialisme."},
  {term:"Existentialisme",def:"Courant philosophique du XXe siècle affirmant que l'existence précède l'essence : l'homme n'a pas de nature prédéterminée, il se définit par ses actes librement choisis. Figures : Sartre ('L'être et le néant', 1943 — 'l'homme est condamné à être libre'), Beauvoir (application féministe), Camus (absurde et révolte), Merleau-Ponty (phénoménologie corporelle), Heidegger (être-dans-le-monde). Influence majeure sur la littérature, le théâtre et la psychologie du XXe siècle."},
  {term:"Stoïcisme",def:"École philosophique grecque (IIIe s. av. J.-C., fondée par Zénon de Kition à Athènes) prônant la vertu comme unique bien, la maîtrise des passions (apatheia) et l'acceptation de ce qui ne dépend pas de nous. Maxime centrale : distinguer ce qui dépend de nous (jugements, désirs) et ce qui n'en dépend pas (corps, richesses, opinions d'autrui). Figures majeures : Épictète, Marc Aurèle ('Pensées pour moi-même'), Sénèque. Renaissance contemporaine : néo-stoïcisme et psychologie cognitive (REBT, CBT s'en inspirent)."},
  {term:"Maïeutique",def:"Méthode philosophique de Socrate consistant à faire accoucher l'interlocuteur de la vérité par une série de questions, l'amenant à prendre conscience de ses propres contradictions. Du grec maïeutikè (art d'accoucher) — Socrate comparait son rôle à celui de sa mère sage-femme. Différente du débat contradictoire : la maïeutique ne vise pas à convaincre mais à révéler. Inspiratrice du questionnement socratique dans les tribunaux et l'enseignement philosophique."},
  {term:"Contrat social",def:"Concept politique désignant un accord (réel ou fictif) entre les individus fondant la société et l'État. Trois versions : Hobbes (contrat dictatorial pour sortir de 'la guerre de tous contre tous'), Locke (contrat limitant l'État pour protéger les droits naturels), Rousseau ('Du Contrat social', 1762 — aliénation totale à la volonté générale, fondement de la démocratie). Rawls (1971) renouvelle la théorie avec le 'voile d'ignorance'. La volonté générale de Rousseau fonde directement la République française."},
  {term:"Idéologie",def:"Système cohérent de représentations, valeurs et croyances qui oriente l'action politique et sociale d'un groupe. Marx : les idéologies sont des 'superstructures' au service des classes dominantes, masquant les rapports de production. Mannheim : sociologue des idéologies (Idéologie et Utopie, 1929) — distingue idéologie (conservatrice, justifiant l'ordre existant) et utopie (transformatrice, dépassant l'ordre existant). Althusser : les 'Appareils Idéologiques d'État' (école, médias, religion) reproduisent les rapports de domination."},
  {term:"Aliénation",def:"Concept philosophique (Marx, Hegel) désignant un état où l'être humain est séparé de son essence, de son travail ou de lui-même. Chez Hegel : l'Esprit s'aliène dans la nature et l'histoire avant de se retrouver. Chez Marx : l'ouvrier est aliéné de son travail (produit étranger), de l'acte de production, de l'espèce humaine et des autres hommes. Aliénation contemporaine : Fromm (personnalité marchande), Debord (spectacle), Baudrillard (simulacre). Reste une grille de lecture centrale pour la critique sociale."},
  // ── ARMÉE ET SÉCURITÉ ────────────────────────────────────────
  {term:"Dissuasion nucléaire",def:"Doctrine stratégique selon laquelle la possession d'armes nucléaires prévient l'agression d'adversaires potentiels par la certitude de représailles dévastatrices (MAD : Mutually Assured Destruction). France : dissuasion du 'faible au fort' fondée sur les deux composantes — sous-marins nucléaires lanceurs d'engins (SNLE) et avions de chasse équipés du missile ASMP-A. Budget : ~6 Mds €/an, soit ~14% du budget défense. Principe de stricte suffisance : capacité minimale mais crédible."},
  {term:"Guerre hybride",def:"Stratégie militaire combinant moyens conventionnels et non-conventionnels : guerre économique, cyberat­taques, désinformation, guerre psychologique, proxies (groupes armés mandatés), opérations d'influence. Caractéristiques : ambiguïté délibérée sur l'attribution, porosité entre guerre et paix. Cas emblématique : annexion de la Crimée (2014) avec des 'petits hommes verts' non identifiés. La Russie a théorisé la guerre hybride (Gerasimov, 2013). Les États hybrides combinent forces armées régulières et milices."},
  {term:"Contre-insurrection (COIN)",def:"Doctrine militaire visant à neutraliser une insurrection en combinant opérations militaires, actions civiles, gouvernance et communication. L'approche américaine 'Clear-Hold-Build' (nettoyer-tenir-construire) a échoué en Afghanistan (2001-2021) faute d'État afghan crédible. La doctrine Galula (officier français, guerre d'Algérie) est l'une des références académiques mondiales. Constat général : les guerres contre-insurrectionnelles sont exceptionnellement difficiles sans légitimité politique locale."},
  {term:"Projection de force",def:"Capacité d'un État à déployer et soutenir ses forces militaires loin de son territoire national. Critères : porte-avions, transport aérien stratégique (C-17, A400M), ravitaillement en vol, bases militaires à l'étranger. Seuls les États-Unis peuvent projeter une force majeure sur plusieurs théâtres simultanément. France : capacité de projection limitée (flotte de porte-avions unique, le Charles de Gaulle) mais reconnue (interventions au Mali, Centrafrique, Tchad). La projection de force distingue les puissances mondiales des puissances régionales."},
  {term:"Guerre asymétrique",def:"Conflit opposant des acteurs aux capacités militaires très inégales, où le plus faible adopte des tactiques non conventionnelles pour neutraliser la supériorité conventionnelle de l'adversaire. Caractéristiques : guérilla, terrorisme, attentats-suicides, IED, embuscades, utilisation de la population civile. Exemples : Vietnam (Viet-Cong vs USA), Afghanistan (Taliban vs coalition OTAN), Hezbollah vs Israël. Défi central : les doctrines militaires classiques sont insuffisantes face aux acteurs non-étatiques."},
  // ── SANTÉ PUBLIQUE ───────────────────────────────────────────
  {term:"Pandémie",def:"Épidémie touchant simultanément plusieurs continents ou la totalité du globe. Distinction OMS : épidémie (diffusion dans une région), pandémie (diffusion mondiale). Covid-19 déclarée pandémie le 11 mars 2020 : 6+ millions de morts officiels, 20+ millions selon les excès de mortalité. Grippe espagnole (1918-1920) : 50-100 millions de morts. La préparation aux pandémies est désormais une question de sécurité nationale (concept One Health — santé humaine, animale, environnementale)."},
  {term:"Immunité collective",def:"Protection d'une population contre une maladie infectieuse lorsqu'une proportion suffisante d'individus est immunisée (par vaccination ou infection antérieure), interrompant la chaîne de transmission. Seuil d'immunité collective dépend du taux de reproduction de base (R0) : pour la rougeole (R0=15), seuil à 93-95% ; pour Covid-19 (R0=2-3), seuil à 60-80%. La vaccination de masse vise à atteindre ce seuil sans que tous soient directement immunisés."},
  {term:"OMS",def:"Organisation Mondiale de la Santé : institution spécialisée de l'ONU fondée en 1948, basée à Genève, réunissant 194 États membres. Missions : normes sanitaires internationales, réponse aux urgences sanitaires, programmes de vaccination, lutte contre les maladies non transmissibles. Critiques : gestion de la pandémie Covid-19 (lenteur de déclaration, dépendance à la Chine), financement insuffisant (3 Mds$/an, inférieur au budget hospitalier d'un grand CHU). Directeur général : Tedros Adhanom Ghebreyesus depuis 2017."},
  {term:"Déterminants sociaux de la santé",def:"Facteurs sociaux, économiques et environnementaux qui influencent la santé des individus et des populations, souvent plus que les soins médicaux. Commission OMS (2008) : revenus, éducation, emploi, logement, alimentation, discrimination, accès aux services. En France, espérance de vie d'un ouvrier non qualifié = 13 ans de moins qu'un cadre supérieur. Concept central de la santé publique moderne : les inégalités sociales se traduisent directement en inégalités de santé."},
  {term:"Antibioresistance",def:"Phénomène d'évolution par lequel des bactéries deviennent résistantes aux antibiotiques utilisés pour les éliminer. Considérée par l'OMS comme l'une des dix menaces mondiales pour la santé. Causes : surconsommation d'antibiotiques chez l'homme et l'animal, mauvaise utilisation (arrêt prématuré du traitement). Projections : 10 millions de morts/an liés à l'antibioresistance d'ici 2050 (O'Neill Report, 2016). Enjeu politique : investissements insuffisants pour développer de nouveaux antibiotiques."},
  {term:"Espérance de vie",def:"Durée de vie moyenne d'une cohorte fictive soumise à la mortalité observée à chaque âge une année donnée. Indicateur clé de développement humain. Espérance de vie mondiale 2024 : 73 ans (femmes 75,4 ans, hommes 70,8 ans). France : 85,1 ans (femmes), 79,3 ans (hommes). Progression spectaculaire du XXe siècle : +30 ans depuis 1900. Facteurs : alimentation, hygiène, antibiotiques, vaccination, systèmes de santé. Menace : obésité, sédentarité, pollution atmosphérique freinent les gains."},
];
const FICHES_DATA=[
  {id:1,title:"Organisation des Nations Unies",icon:"globe",color:"#2B78F5",items:["193 États membres, fondée le 24 octobre 1945 (Charte de San Francisco, 51 États fondateurs)","Conseil de sécurité : 5 membres permanents avec droit de veto (USA, Russie, Chine, France, UK) + 10 membres non permanents élus pour 2 ans","Assemblée générale : 1 État = 1 voix, résolutions non contraignantes — séances plénières annuelles en septembre","Secrétaire général : António Guterres (depuis 2017, réélu 2022-2026, ancien PM du Portugal)","Cour internationale de Justice (CIJ) : siège à La Haye, 15 juges élus pour 9 ans — tranche les différends inter-étatiques","Budget ordinaire 2024 : ~3,59 milliards de dollars — USA sont le premier contributeur (22%)","Opérations de maintien de la paix (OMP) : 12 missions actives, ~87 000 personnels en 2024, coût annuel ~6,4 Mds$","Agences spécialisées : UNESCO (éducation), OMS (santé), FAO (alimentation), PNUD (développement), HCR (réfugiés), UNICEF (enfants), OIT (travail)","Veto utilisé 290 fois depuis 1945 : Russie/URSS (120 fois), USA (82 fois), UK (29 fois), France (16 fois), Chine (17 fois)","Réformes débattues : élargissement du Conseil de sécurité (Inde, Brésil, Allemagne, Japon et Afrique revendiquent un siège permanent)","Déclaration universelle des droits de l'homme : adoptée le 10 décembre 1948, 30 articles, 500 langues de traduction","Prix Nobel de la Paix : ONU et ses agences récompensées 9 fois (ONU 2001, GIEC+Gore 2007, CICR 1944, 1963)","Financement : contributions obligatoires (quotes-parts) + contributions volontaires — 40% du budget vient des contributions volontaires","ONU et les grands défis : changement climatique (CCNUCC), pandémies (OMS), terrorisme (Comité 1267), armes nucléaires (TNP)","Scandales et limites : génocide du Rwanda (1994) sans intervention, Srebrenica (1995), réforme bloquée par les P5","Organisation duale : secrétariat (fonctionnaires internationaux) + États membres (souverains)","Agenda 2030 : 17 ODD adoptés en 2015, bilan mitigé — seulement 15% sur bonne trajectoire selon rapport 2023","ECOSOC : Conseil économique et social, 54 membres, coordination des agences et programmes","Cour pénale internationale (CPI) : distincte de la CIJ, créée par le Statut de Rome (1998), 124 membres","Tribunal international du droit de la mer (TIDM) : siège à Hambourg, compétent sur les conflits maritimes"]},
  {id:2,title:"Union Européenne",icon:"flag",color:"#E03535",items:["27 États membres après le Brexit (31 janvier 2020) — Union fondée sur les Traités de Rome (1957, CEE) et Maastricht (1992)","Traité de Lisbonne (2009) : base juridique actuelle, personnalité juridique de l'UE, Charte des droits fondamentaux contraignante","Parlement européen : 720 sièges (élections juin 2024), co-législateur avec le Conseil de l'UE","Commission européenne : 27 commissaires, droit d'initiative législative — Présidente Ursula von der Leyen (2e mandat 2024-2029)","Conseil de l'UE : 27 ministres des États membres par domaine, vote à la majorité qualifiée ou à l'unanimité","Conseil européen : chefs d'État et de gouvernement, fixe les orientations stratégiques — Président Charles Michel (2019-2024), puis António Costa","BCE (Banque centrale européenne, Francfort) : fixe les taux directeurs pour les 20 pays de la zone euro","Cour de justice de l'UE (CJUE) : Luxembourg, interprète le droit européen, compétence obligatoire pour tous les membres","PIB UE : ~16 700 milliards d'euros (2023), 2e puissance économique mondiale après les USA, 1re avant la Chine","Zone euro : 20 membres (2024) — Bulgarie, Hongrie, Pologne, République tchèque, Roumanie, Suède hors zone euro","Politique agricole commune (PAC) : ~32% du budget UE 2021-2027 — 387 milliards d'euros sur 7 ans","Schengen : 29 pays (25 membres UE + Islande, Norvège, Suisse, Liechtenstein) — libre circulation sans contrôle aux frontières","Budget UE 2021-2027 : 1 074 milliards d'euros + 750 Mds de Next Generation EU (relance post-Covid)","Élargissement : candidats officiels — Ukraine, Moldavie (2022), Géorgie, Balkans occidentaux (Albanie, Macédoine du Nord, Monténégro, Serbie)","Politique étrangère et de sécurité commune (PESC) : limitée par la règle de l'unanimité","PESCO (coopération structurée permanente) : 26 États membres, 60 projets militaires communs","Commissaires aux droits fondamentaux : Charte des droits fondamentaux (50 articles) depuis 2009","Crise de l'État de droit : procédures d'infraction contre Hongrie et Pologne, gel de fonds structurels","Politique commerciale : compétence exclusive de l'UE — premier exportateur mondial de biens et services","Réforme institutionnelle : débat sur le vote à la majorité qualifiée en politique étrangère, assemblée constituante proposée"]},
  {id:3,title:"OTAN",icon:"shield",color:"#7C3AED",items:["32 membres en 2024 (Suède intégrée le 7 mars 2024, Finlande en 2023 — fin de leur neutralité historique de 70 ans)","Fondée le 4 avril 1949 — Traité de Washington — réponse à la menace soviétique post-Seconde Guerre mondiale","Article 5 : attaque contre un membre = attaque contre tous — invoqué une seule fois le 12 septembre 2001 après les attentats du 11/09","Article 4 : consultations entre membres en cas de menace — invoqué 8 fois (dont 3 fois par la Turquie pour la Syrie)","Secrétaire général : Mark Rutte (depuis octobre 2024, ex-Premier ministre des Pays-Bas) — succède à Jens Stoltenberg","Siège : Bruxelles (Belgique) — SHAPE (commandement suprême) à Mons, Belgique","Commandant suprême des forces alliées en Europe (SACEUR) : toujours un général américain depuis 1951","Objectif budgétaire : 2% du PIB — 23 membres atteignent cet objectif en 2024 (vs 9 en 2022) après l'invasion de l'Ukraine","Budget cumulé des membres : +1 350 milliards de dollars en 2024 (USA = 68% du total)","Missions hors-zone : Afghanistan (ISAF 2001-2014, RSM 2014-2021), Kosovo (KFOR depuis 1999), Méditerranée (Sea Guardian)","Sommet de Vilnius (2023) : soutien à l'Ukraine sans adhésion immédiate — Macron annonce une 'aide substantielle'","Sommet de Washington (2024) : 75e anniversaire, renforcement du flanc est, 100 000 soldats américains en Europe","Bouclier antimissile : opérationnel depuis 2016 (Aegis à terre en Roumanie et Pologne) — critiqué par Moscou","Guerre en Ukraine : l'OTAN soutient l'Ukraine en armes (~200 Mds$ depuis 2022) mais refuse l'intervention directe","Force de réaction rapide (NRF) : 40 000 soldats en alerte élevée — doublé depuis 2022 à 300 000","Cyber-défense : cyberespace reconnu comme 5e domaine opérationnel (Varsovie 2016) en plus de la terre, mer, air, espace","Partenariats : Ukraine, Géorgie, Moldavie (aspirants membres), Australie, Japon, Corée du Sud, NZ (IP4 — partenaires Indo-Pacifique)","Russie-OTAN : Conseil OTAN-Russie suspendu depuis 2022, ambassadeurs respectifs expulsés","Armes nucléaires : partage nucléaire avec 6 pays (Belgique, Pays-Bas, Allemagne, Italie, Turquie, USA bases) — ~150 bombes B61","France : réintégrée dans le commandement militaire en 2009 (Sarkozy) après avoir quitté en 1966 (De Gaulle)"]},
  {id:4,title:"Géopolitique 2025",icon:"map",color:"#D97706",items:["Guerre Ukraine-Russie (depuis 24 février 2022) : +700 000 victimes estimées, 6 millions de réfugiés en Europe, 6,5 millions de déplacés internes","Conflit Gaza (depuis 7 octobre 2023) : attaque du Hamas (1 195 morts israéliens, 251 otages), offensive israélienne (+46 000 morts à Gaza selon MSF, crise humanitaire)","Tensions Taïwan : exercices militaires chinois massifs (2022, 2023, 2024) — élections présidentielles janv. 2024, Lai Ching-te élu","Sahel — rupture avec la France : coups d'État au Mali (2021), Burkina Faso (2022), Niger (2023), Gabon (2023) — retrait militaire français, présence Wagner/Africa Corps","Indo-Pacifique — nouvelles alliances : AUKUS (USA-UK-Australie, sous-marins nucléaires), QUAD (USA-Inde-Japon-Australie), I2U2 (USA-Israël-Inde-EAU)","Mer de Chine méridionale : Chine vs Philippines — collisions répétées en 2024, arrêt CPA (2016) ignoré par Pékin","Iran-Israël : échanges de frappes directes en avril et octobre 2024 — première confrontation militaire directe israélo-iranienne de l'histoire","BRICS+ (2024) : Égypte, Éthiopie, Iran, Arabie Saoudite, EAU — représentent désormais 35% du PIB mondial en PPA","Elections 2024 — 'super-année électorale' : 64 pays aux urnes, 4 milliards de votants, Trump réélu aux USA (nov. 2024)","Frontières de l'Arctique : fonte des glaces — nouvelles routes commerciales (passage du Nord-Est), enjeux Russie-Canada-Danemark-USA","Corée du Nord-Russie : accord de coopération militaire (2024) — envoi de soldats nord-coréens en Ukraine confirmé par l'OTAN","Somalie, Éthiopie, Mozambique : conflits persistants — présence d'Al-Shebab, Daech-AOS","Réarmement mondial : dépenses militaires globales = 2 443 milliards de dollars en 2023 (record depuis la Guerre froide)","Rivalité technologique : interdictions américaines sur semi-conducteurs avancés vers la Chine (TSMC, NVIDIA) — contre-mesures chinoises sur gallium, germanium","Dérèglement climatique comme multiplicateur de conflits : sécheresses au Sahel, inondations en Asie du Sud, réfugiés climatiques","Afghanistan (Taliban depuis août 2021) : 97% de la population sous le seuil de pauvreté, retrait des droits des femmes","Syrie : normalisations arabes du régime Assad en 2023 — retour dans la Ligue arabe — chute d'Assad (décembre 2024)","Yemen : guerre civile (Houthis vs coalition saoudienne) depuis 2015 — frappes sur navires en mer Rouge (2024) impactant le commerce mondial","Haïti : État effondré, 80% de la capitale sous contrôle des gangs — mission kényane (2024) autorisée par l'ONU","Caucase du Sud : normalisations Azerbaïdjan-Arménie après la reconquête du Haut-Karabakh (sept. 2023) par Bakou"]},
  {id:5,title:"Institutions françaises",icon:"users",color:"#16A34A",items:["Ve République : Constitution du 4 octobre 1958 (De Gaulle) — 24 révisions constitutionnelles à ce jour","Président de la République : élu au suffrage universel direct depuis 1962 (réforme gaullienne), mandat 5 ans (quinquennat depuis 2000), limité à 2 mandats","Pouvoirs présidentiels : nomination du PM, dissolution de l'Assemblée nationale, référendum (art. 11), état d'exception (art. 16), droit de grâce","Premier ministre : nommé par le président, responsable devant l'Assemblée — peut survivre à une cohabitation (1986-88, 1993-95, 1997-2002)","Gouvernement : responsable devant l'Assemblée nationale — motion de censure (art. 49-3 permet l'adoption sans vote)","Assemblée nationale : 577 députés élus pour 5 ans au scrutin uninominal majoritaire à 2 tours dans 577 circonscriptions","Sénat : 348 sénateurs élus pour 6 ans (renouvelé par moitié tous les 3 ans) par les grands électeurs — chambre conservatrice","Conseil constitutionnel : 9 membres nommés pour 9 ans non renouvelables (3 par le Président, 3 par l'AN, 3 par le Sénat)","QPC (Question prioritaire de constitutionnalité) : depuis 2010, les citoyens peuvent contester la constitutionnalité d'une loi lors d'un procès","Conseil d'État : juridiction administrative suprême + conseil juridique du gouvernement — fondé en 1799 (Napoléon)","Cour de cassation : juridiction judiciaire suprême — contrôle la correcte application de la loi, ne rejuge pas les faits","Tribunal des conflits : départage les conflits de compétence entre ordre judiciaire et administratif","Conseil économique, social et environnemental (CESE) : 233 membres représentant la société civile — rôle consultatif","Défenseur des droits : autorité constitutionnelle indépendante, défend les citoyens contre les mauvaises administrations et discriminations","Cour des comptes : contrôle les finances publiques — publie des rapports annuels d'évaluation des politiques publiques","Collectivités territoriales : 18 régions (dont 5 ultramarines), 101 départements, 35 000 communes — décentralisation depuis la loi Defferre (1982)","Budget de l'État 2025 : ~500 milliards de dépenses, déficit ~5% du PIB, dette publique ~113% du PIB","Haute Autorité pour la transparence de la vie publique (HATVP) : contrôle les déclarations d'intérêts des élus depuis 2013","Parquet national financier (PNF) : créé en 2014, spécialisé dans la grande criminalité financière — affaire Fillon, affaire Sarkozy","Cinquième République en tension : élections législatives 2024 — Assemblée sans majorité absolue, gouvernement de coalition inédit"]},
  {id:6,title:"BRICS & Puissances émergentes",icon:"globe",color:"#16A34A",items:["BRICS acronyme créé par Jim O'Neill (Goldman Sachs, 2001) pour Brésil, Russie, Inde, Chine — Afrique du Sud intégrée en 2010","BRICS+ depuis janvier 2024 : Égypte, Éthiopie, Iran, Arabie Saoudite, Émirats arabes unis — 10 membres au total","PIB combiné BRICS+ (PPA) : ~35% du PIB mondial — dépasse le G7 (~30%) en parité de pouvoir d'achat","Chine : 2e économie mondiale (18 000 Mds$), 1re en PPA — puissance manufacturière (28% de la production industrielle mondiale)","Inde : 5e économie mondiale (~3 700 Mds$), croissance ~7% — passera le Japon et l'Allemagne d'ici 2027","Russie : 11e économie mondiale — sanctionnée mais résiliente grâce aux hydrocarbures et au pivot asiatique","Brésil : 9e économie mondiale, Lula revenu au pouvoir (2023) — puissance agricole (1er exportateur mondial de soja)","Afrique du Sud : seul pays africain, 2e économie du continent — enjeux de représentativité","Nouvelle Banque de Développement (NBD) : siège à Shanghai, capital initial 100 Mds$, alternativeo à la Banque mondiale","Dédollarisation : enjeu central — échanges en yuans, roubles et monnaies locales — part du dollar dans réserves mondiales baisse (60% en 2023 vs 71% en 2001)","Rivalité avec le G7 : les BRICS refusent la conditionnalité des prêts du FMI/BM et prônent une gouvernance mondiale plus représentative","Chine-Afrique : 300 milliards de dollars d'investissements depuis 2000 — 'piège de la dette' selon certains analystes","Inde-Occident : rapprochement stratégique USA-Inde (Quad) tout en maintenant des liens avec Moscou — 'ambiguité stratégique'","Population combinée BRICS+ : ~3,5 milliards de personnes (45% de la population mondiale)","Énergie BRICS : Russie et Arabie Saoudite contrôlent ~25% des exportations mondiales de pétrole — levier géopolitique majeur","Lutte d'influence : concurrence BRICS vs G7 pour influencer les institutions de Bretton Woods (FMI, BM)","Indonésie, Arabie Saoudite, Turquie, Mexique : prochains candidats potentiels à l'adhésion (plus de 40 pays ont exprimé leur intérêt)","Limites internes : rivalités sino-indiennes (frontière himalayenne), idéologies divergentes (démocratie indienne vs autoritarisme chinois)","Forums connexes : G20 (BRICS y pèsent fortement), OCS (Organisation de Coopération de Shanghai) — Russie, Chine, Inde, Pakistan, Iran","Commerce Sud-Sud : +300% en 20 ans — alternative aux chaînes de valeur Nord-Sud traditionnelles"]},
  {id:7,title:"Histoire contemporaine XXe",icon:"cal",color:"#7C3AED",items:["1914-1918 : Première Guerre mondiale — 20 millions de morts, fin des empires austro-hongrois, ottoman, allemand et russe","1917 : Révolution russe (février : chute du tsar ; octobre : prise du pouvoir bolchevique) — naissance de l'URSS en 1922","1919 : Traité de Versailles — 'diktat' pour l'Allemagne, génie de Wilson (SDN) mais refus du Sénat américain","1929 : Krach de Wall Street (24 octobre) — Grande Dépression mondiale, 30% de chômage aux USA, montée des fascismes","1933 : Hitler chancelier — réarmement allemand, lois de Nuremberg (1935), Anschluss (1938), Pacte germano-soviétique (août 1939)","1939-1945 : Deuxième Guerre mondiale — 70-85 millions de morts dont 6 millions de Juifs (Shoah), 27 millions de Soviétiques","1945 : Conférences de Yalta (février) et Potsdam (juillet-août) — partage du monde, création de l'ONU, bombes atomiques sur Hiroshima et Nagasaki","1947 : Plan Marshall (13 Mds$), doctrine Truman (endiguement), Partition de l'Inde (Pakistan), début de la Guerre froide","1948 : Déclaration universelle des droits de l'homme, État d'Israël proclamé (mai 1948), Blocus de Berlin","1949 : OTAN créée, RFA et RDA fondées, Mao proclame la République populaire de Chine (1er octobre)","1950-1953 : Guerre de Corée — 3 millions de morts, armistice à Panmunjeom, péninsule toujours divisée","1955-1962 : Décolonisation accelerée — Conférence de Bandung (1955), Maroc et Tunisie (1956), indépendances africaines en 1960, Algérie (1962)","1961-1972 : Paroxysme de la Guerre froide — mur de Berlin (août 1961), crise des missiles de Cuba (octobre 1962, 13 jours), guerre du Vietnam","1968 : Printemps de Prague (réprimé en août), Mai 68 en France (10 millions de grévistes), assassinats de MLK (avril) et RFK (juin)","1973 : Choc pétrolier (octobre), fin des accords de Bretton Woods (1971), guerre de Kippour, accord de Paris sur le Vietnam","1979 : Révolution iranienne (Khomeini), invasion de l'Afghanistan par l'URSS (décembre), élection de Thatcher (mai)","1989 : Chute du mur de Berlin (9 novembre), place Tiananmen (juin), révolutions en Europe de l'Est","1991 : Dissolution de l'URSS (25 décembre), 15 républiques indépendantes, guerre du Golfe (jan.-fév.), éclatement de la Yougoslavie","1994 : Génocide du Rwanda (800 000 morts en 100 jours), Accord d'Oslo Israël-OLP (1993), Accords du Vendredi saint pour l'Irlande du Nord (1998)","2001 : Attentats du 11 septembre (2 977 morts) — guerre en Afghanistan (2001-2021), Patriot Act, redéfinition de la sécurité mondiale"]},
  {id:8,title:"Économie internationale",icon:"bar",color:"#D97706",items:["Bretton Woods (1944) : système monétaire international fondé sur le dollar lié à l'or (35$/once) — effondrement en 1971 (Nixon)","FMI : 190 membres, prêts conditionnels liés à des plans d'ajustement structurel — DTS (Droits de Tirage Spéciaux) comme monnaie de réserve","Banque mondiale : groupe de 5 institutions, finance le développement — critique persistante sur la conditionnalité néolibérale","OMC (1995) : 164 membres, règlement des différends commerciaux — Ronde de Doha (2001) bloquée, appel ORD paralysé depuis 2020","G7 : 7 pays industrialisés représentant ~45% du PIB mondial nominale — coordination sur sanctions, taux, dette des pays pauvres","G20 : créé en 1999, 85% du PIB mondial et 75% du commerce — forum principal de coordination économique post-2008","PIB mondial 2024 : ~110 000 milliards de dollars — USA (27%), Chine (18%), UE (16%), Japon (4%), Inde (3,5%)","Commerce mondial 2023 : ~31 000 milliards de dollars — biens (23 000 Mds$) + services (7 500 Mds$)","Inflation 2022-2023 : pic à +10% en zone euro (oct. 2022), +9,1% aux USA (juin 2022) — choc énergétique + chaînes d'approvisionnement post-Covid","Politique monétaire : remontée historique des taux directeurs 2022-2024 — BCE de 0% à 4,5%, FED de 0,25% à 5,5%","Dette mondiale 2024 : 313 000 milliards de dollars (FMI) — record absolu, 330% du PIB mondial","Inégalités mondiales : 1% des plus riches possèdent 43% de la richesse mondiale (Oxfam, 2023) — coefficient de Gini mondial en hausse","Transition verte : 5 000 milliards de dollars d'investissements annuels nécessaires pour atteindre la neutralité carbone (AIE)","Inflation Reduction Act (USA, 2022) : 369 Mds$ de subventions vertes — déclenche une guerre de subsidies avec l'UE","Reshoring / nearshoring : retour de la production aux USA et en Europe — semi-conducteurs (CHIPS Act), batteries, médicaments","Économie de plateforme : GAFAM + Alibaba + Tencent = capitalisation cumulée >10 000 Mds$ (2024)","Crypto-monnaies : Bitcoin (capitalisation ~1 000 Mds$, 2024) — ETF Bitcoin approuvé aux USA (janvier 2024), débat sur la régulation","Déflation chinoise : croissance ralentie (~5%), crise immobilière (Evergrande 2021), guerre commerciale, tensions géopolitiques","Afrique : croissance moyenne ~4% mais disparités immenses — Éthiopie, Rwanda, Côte d'Ivoire en tête","Indicateurs alternatifs au PIB : IDH (PNUD), bien-être subjectif (ONU), économie du donut (Kate Raworth)"]},
  {id:9,title:"Droit constitutionnel",icon:"scale",color:"#E03535",items:["Constitution : norme suprême de l'ordre juridique — théorie de la hiérarchie des normes de Hans Kelsen ('pyramide de Kelsen')","Bloc de constitutionnalité français : Constitution 1958 + DDHC 1789 + Préambule 1946 + Charte environnement 2004 + PFRLR","Séparation des pouvoirs : Montesquieu ('De l'esprit des lois', 1748) — exécutif, législatif, judiciaire — checks and balances américains","État de droit (Rechtsstaat) : tout acte du pouvoir public doit avoir un fondement juridique et respecter les droits fondamentaux","Révision constitutionnelle (art. 89) : vote à la majorité des 3/5 du Congrès ou référendum — 24 révisions depuis 1958","QPC (Question prioritaire de constitutionnalité) : depuis 2010, tout citoyen peut contester la constitutionnalité d'une loi applicable à son litige","Contrôle a priori : Conseil constitutionnel saisi avant la promulgation (art. 61) — lois organiques, règlements des assemblées obligatoirement","Article 49-3 : engage la responsabilité du gouvernement sur un texte — si pas de censure dans les 24h, le texte est adopté sans vote","Article 16 : pouvoirs exceptionnels du Président en cas de menace grave sur les institutions — utilisé 5 mois par De Gaulle en 1961","Referendum (art. 11 et 89) : organisé 9 fois depuis 1958 — victoire du Non en 2005 (Traité constitutionnel européen)","Droit de dissolution (art. 12) : le Président peut dissoudre l'Assemblée nationale après consultation des présidents des assemblées — 5 fois","Régime parlementaire rationalisé : la Ve République a renforcé l'exécutif par rapport aux IIIe et IVe Républiques (instabilité ministérielle)","Cohabitation : possible quand le Président et le PM sont de camps opposés — 1986-88 (Chirac-Mitterrand), 1993-95, 1997-2002","Contrôle de constitutionnalité : concentré (Conseil constitutionnel en France) vs diffus (toutes les juridictions, modèle américain)","Droit constitutionnel comparé : systèmes présidentiel (USA), semi-présidentiel (France), parlementaire (UK, Allemagne), fédéral (Allemagne, USA)","Loi constitutionnelle du 23 juillet 2008 : limitation à 2 mandats présidentiels, question du gouvernement en séance, droit de pétition","Conseil d'État : contrôle la légalité des actes réglementaires — excès de pouvoir, détournement, erreur manifeste d'appréciation","DDHC 1789 : 17 articles — liberté, égalité, souveraineté nationale, séparation des pouvoirs, présomption d'innocence","Préambule de 1946 : droits sociaux constitutionnalisés — égalité homme/femme, droit d'asile, droit de grève, liberté syndicale","État d'urgence : cadre légal depuis la loi de 1955 (Algérie), prolongé 2015-2017 (terrorisme), puis état d'urgence sanitaire (2020-2022)"]},
  {id:10,title:"Libertés fondamentales & CEDH",icon:"heart",color:"#2B78F5",items:["CEDH signée à Rome le 4 novembre 1950 — Conseil de l'Europe (46 membres, distinct de l'UE) — ratifiée par 46 États","Cour européenne des droits de l'homme (CEDH) : siège à Strasbourg — 47 juges (un par État) — fondée en 1959","Art. 2 : droit à la vie — interdit la peine de mort (protocoles 6 et 13) — Turquie dernier État en avoir abolie la peine de mort pour adhérer au Conseil","Art. 3 : interdiction absolue de la torture et des traitements inhumains ou dégradants — aucune dérogation possible même en état d'urgence","Art. 5 : droit à la liberté et à la sûreté — interdit les détentions arbitraires — délai raisonnable obligatoire","Art. 6 : droit à un procès équitable — tribunal impartial, délai raisonnable, présomption d'innocence, défense effective","Art. 8 : droit au respect de la vie privée et familiale — source jurisprudentielle majeure (protection des données, regroupement familial, orientation sexuelle)","Art. 9 : liberté de pensée, de conscience et de religion — laïcité française a été jugée compatible avec l'article 9","Art. 10 : liberté d'expression — inclut les médias, artistes, journalistes — soumise à des restrictions proportionnées","Art. 11 : liberté de réunion et d'association — protection des syndicats et partis politiques","Art. 14 : interdiction de la discrimination dans la jouissance des droits garantis — protocole 12 : interdiction générale de discrimination","Protocole 1, art. 3 : droit à des élections libres — premier traité international protégeant spécifiquement le droit de vote","France condamnée ~85-100 fois par an par la CEDH — principalement pour durée excessive des procédures et conditions de détention","Arrêts historiques : Handyside (1976, liberté expression), Klass (1978, surveillance), Soering (1989, extradition vers la peine de mort)","Déclaration universelle des droits de l'homme (ONU, 10 décembre 1948) — 30 articles — 500 langues — non contraignante juridiquement","Pacte international relatif aux droits civils et politiques (1966) : traité ONU contraignant — Comité des droits de l'homme à Genève","Charte africaine des droits de l'homme et des peuples (1981, Banjul) — Cour africaine à Arusha (Tanzanie)","Charte des droits fondamentaux de l'UE (2000/2009) : 50 articles contraignants depuis le Traité de Lisbonne","Convention contre la torture (CAT, 1984) : Comité contre la torture à Genève — 173 États parties","Droits de 3e génération : droit au développement (Déclaration ONU 1986), droit à l'environnement, droit à la paix — encore non contraignants","Dignité humaine : fondement philosophique de tous les droits fondamentaux (Kant) — consacrée en art. 1 de la Charte UE"]},
  {id:11,title:"Climat & Accords internationaux",icon:"globe",color:"#16A34A",items:["Accord de Paris (12 décembre 2015, COP21) : 196 parties signataires, limite le réchauffement à +1,5°C vs préindustriel","Mécanisme NDC : contributions nationales déterminées, révisées à la hausse tous les 5 ans — insuffisantes pour atteindre 1,5°C","GIEC (créé 1988) : 195 pays membres, rapports d'évaluation scientifique tous les ~6 ans — AR6 (2021-2022) : code rouge pour l'humanité","Émissions mondiales CO2 (2023) : 36,8 gigatonnes — record historique malgré les accords climatiques","Températures 2024 : +1,54°C au-dessus des niveaux préindustriels — premier franchissement annuel du seuil de +1,5°C","Principaux émetteurs : Chine (27%), USA (14%), UE (8%), Inde (7%), Russie (5%) — les 5 représentent 61% des émissions","COP27 (Sharm el-Sheikh, 2022) : création du Fonds pour les pertes et dommages — pays vulnérables — accord historique mais montants insuffisants","COP28 (Dubaï, décembre 2023) : première mention de la 'sortie des combustibles fossiles' — présidé par sultan Al Jaber (directeur d'Abu Dhabi National Oil Company)","COP29 (Bakou, novembre 2024) : financement climat 300 Mds$ annuels pour les pays en développement d'ici 2035 — critiqué comme insuffisant","Pacte vert européen (Green Deal) : neutralité carbone UE en 2050, -55% d'émissions en 2030 vs 1990 — loi européenne sur le climat","Mécanisme d'ajustement carbone aux frontières (MACF) : en vigueur depuis 2026, sur acier, aluminium, ciment, engrais, électricité","Finance verte : 1 000 milliards de dollars d'obligations vertes émises en 2023 — risque de greenwashing","Energies renouvelables : solaire + éolien = 30% de la production d'électricité mondiale (2023) — coût du solaire divisé par 90% en 10 ans","Points de basculement (tipping points) : dégel du permafrost, effondrement de la calotte glaciaire antarctique, mort des récifs coralliens","Biodiversité : Accord de Kunming-Montréal (COP15 Biodiversité, déc. 2022) — 30% des terres et mers protégées d'ici 2030","Désertification : Sahel — 100 millions de personnes menacées — frontière de désert avance de 48 km/an","Eau : 3,6 milliards de personnes en zones de pénurie d'eau au moins 1 mois/an — 5 milliards d'ici 2050","Litiges climatiques : plus de 2 500 procès climatiques dans 65 pays — arrêt CEDH vs Suisse (2024) : obligation de protéger contre le changement climatique","Inégalités climatiques : les 1% les plus riches émettent autant que les 66% les plus pauvres (Oxfam, 2023)","Réfugiés climatiques : 21,5 millions de personnes déplacées par des catastrophes météorologiques chaque année — pas de statut juridique"]},
  {id:12,title:"Organisations africaines",icon:"globe",color:"#D97706",items:["Union Africaine (UA) : 55 membres (tous les États africains, Maroc réintégré en 2017), fondée en 2002 à Durban (succède à l'OUA de 1963)","Commission de l'UA : siège à Addis-Abeba (Éthiopie), Présidente Moussa Faki Mahamat jusqu'en 2025 — équivalent de la Commission européenne","Conseil de paix et de sécurité (CPS) de l'UA : 15 membres, peut autoriser des interventions militaires — doctrine 'non-indifférence'","AMISOM/ATMIS : mission de l'UA en Somalie contre Al-Shebab depuis 2007 — transition vers forces somaliennes en 2022","Agenda 2063 : vision africaine 'L'Afrique que nous voulons' — intégration continentale, industrialisation, démocratie","CEDEAO (ECOWAS) : 15 États d'Afrique de l'Ouest, fondée en 1975, siège à Abuja — libre circulation des personnes","CEDEAO en crise : Mali, Burkina Faso, Niger se retirent en 2024 pour former l'Alliance des États du Sahel (AES) — défi existentiel","SADC : 16 États d'Afrique australe, siège à Gaborone — zone de libre-échange partielle, mission en Mozambique (Cabo Delgado)","EAC (Communauté d'Afrique de l'Est) : 7 membres (Kenya, Tanzanie, Ouganda, Rwanda, Burundi, Soudan du Sud, RDC) — intégration économique","IGAD : 8 États de la Corne de l'Afrique — médiateur dans les conflits (Soudan, Éthiopie, Somalie)","ZLECAf (Zone de libre-échange continentale africaine) : opérationnelle depuis 2021 — marché de 1,4 Md de personnes, 3 400 Mds$ de PIB","Banque africaine de développement (BAD) : siège à Abidjan, capital de 250 Mds$, finance les projets d'infrastructure","Population africaine : 1,4 milliard (2023), sera 2,5 milliards en 2050 — 60% ont moins de 25 ans — dividende démographique","PIB africain : ~3 000 milliards de dollars — Nigeria (440 Mds$) + Égypte (400 Mds$) + Afrique du Sud (380 Mds$) = 40% du PIB continental","Francophonie africaine : 30 des 54 États africains sont membres de l'OIF — influence française en recul post-2020 dans le Sahel","Présence chinoise en Afrique : 300 Mds$ d'investissements depuis 2000, Forum Chine-Afrique (FOCAC) tous les 3 ans","Présence russe : Wagner/Africa Corps au Mali, Burkina, Niger, Libye, Centrafrique — offre sécuritaire alternative à la France","Défi de gouvernance : 54 des 195 États les plus fragiles au monde sont africains (Fragile States Index, 2024)","Transition énergétique africaine : Afrique subsaharienne émet 3% des GES mondiaux mais subit le plus les effets — justice climatique","Initiative africaine du continent numérique : ambition de 'smart cities', fintech (MPesa au Kenya), internet par satellite"]},
  {id:13,title:"Numérique, IA & Gouvernance",icon:"zap",color:"#7C3AED",items:["IA générative : ChatGPT lancé le 30 novembre 2022 — 100 millions d'utilisateurs en 2 mois (record absolu de croissance)","Règlement européen sur l'IA (AI Act) : adopté en mars 2024, entré en vigueur août 2024 — premier cadre juridique mondial contraignant sur l'IA","AI Act : approche par niveaux de risque — risque inacceptable (biométrie en temps réel, manipulation), haut risque (emploi, justice), faible risque","RGPD (2018) : protection des données personnelles — amendes jusqu'à 4% du chiffre d'affaires mondial — modèle exporté mondialement","GAFAM : Google, Apple, Facebook/Meta, Amazon, Microsoft — capitalisation cumulée ~12 000 milliards de dollars (2024)","Digital Services Act (DSA, 2022) : régulation des contenus illicites en ligne, responsabilité des plateformes — très grandes plateformes (VLOPs)","Digital Markets Act (DMA, 2022) : régulation des 'gatekeepers' numériques — concurrence, interopérabilité — amende possible de 10% du CA","Cybersécurité : 26 000 attaques par heure dans le monde (2024) — NotPetya (2017, 10 Mds$ de dégâts), SolarWinds (2020), pipeline Colonial (2021)","Guerre de l'IA : USA vs Chine — NVIDIA (puces H100 interdites d'exportation), Huawei (puce 910B maison), rivalité sur LLM (GPT-4 vs Ernie, Qwen)","Fracture numérique : 2,6 milliards de personnes sans accès à internet (2024) — concentration en Afrique subsaharienne et Asie du Sud","Gouvernance d'internet : ICANN (noms de domaine), IGF (Forum de gouvernance de l'internet) — modèle multi-acteurs vs modèle intergouvernemental chinois","Starlink (SpaceX) : 6 000 satellites en orbite basse, couverture mondiale — utilisé en Ukraine — révolution géopolitique de la connectivité","IA et démocratie : deepfakes électoraux (élections 2024 au Bangladesh, Taiwan, USA), génération de désinformation à grande échelle","IA Act applicabilité : des amendes de 35 millions d'euros (risque inacceptable) ou 15 millions (risque élevé)","ChatGPT, Gemini, Claude, Mistral : course aux grands modèles de langage — Mistral (France) comme 'champion européen'","Reconnaissance faciale : interdite dans l'espace public par l'AI Act européen (avec exceptions policières encadrées)","Metavers et Web3 : ralentissement après euphorie 2021-2022 — blockchain, NFT, crypto en crise de confiance (FTX, 2022)","Algorithmes et biais : discriminations raciales dans les logiciels de reconnaissance faciale (MIT Media Lab, 2018) — exigence d'explicabilité","Quantum computing : IBM, Google, Chine — ordinateurs quantiques qui pourraient casser les chiffrement RSA actuels d'ici 2030","Souveraineté numérique : cloud européen (Gaia-X), PINE, stratégie française — dépendance aux GAFAM comme enjeu de sécurité nationale"]},
  {id:14,title:"Commerce international & OMC",icon:"brief",color:"#E03535",items:["GATT (1947) : Accord général sur les tarifs douaniers et le commerce — 23 membres fondateurs, réductions progressives des droits de douane","OMC fondée le 1er janvier 1995 (succède au GATT) — 164 membres (95% du commerce mondial) — siège à Genève","Fonctions OMC : négociation commerciale, surveillance des politiques commerciales, règlement des différends (ORD)","Organe de règlement des différends (ORD) : 'tribunal du commerce mondial' — 600 différends depuis 1995 — appel paralysé depuis 2020 (blocage USA)","Ronde de Doha (2001-) : lancée après le 11/09 pour intégrer les pays en développement — agriculture bloquée par USA/UE — de facto morte","Accord de Bali (2013) : premier accord multilatéral OMC conclu — facilitation des échanges (simplification douanière)","Guerre commerciale USA-Chine : tarifs Trump (2018-2019), Biden maintient les tarifs + nouveaux (VE, batteries 2024) — 370 Mds$ de biens affectés","Commerce de services : 7 500 milliards de dollars (2023) — tourisme, finance, numérique, assurance en forte croissance","Chaînes de valeur mondiales (CVM) : 70% du commerce — une BMW fabriquée avec des pièces de 30 pays — fragmentation de la production","Accord de libre-échange Asie-Pacifique RCEP (2022) : 15 pays, 30% du PIB mondial — le plus grand accord commercial de l'histoire","CETA (2017) : accord UE-Canada — 40% des droits supprimés — modèle controversé (ISDS, tribunaux d'arbitrage investisseurs-États)","Brexit commercial : -15% sur les échanges UK-UE (FMI) — nouvelle barrière non-tarifaires, frictions douanières","Protectionnisme vert : politiques industrielles nationales — IRA américain (369 Mds$), CHIPS Act (52 Mds$), NZI européen — 'course aux subventions'","Démondialisation partielle : pandémie + guerre Ukraine = relocalisation des productions stratégiques (semi-conducteurs, médicaments, batteries)","Exportations mondiales de biens 2023 : ~23 000 milliards de dollars — Chine premier exportateur (14%), USA 2e (8%), Allemagne 3e (7%)","Accords bilatéraux : plus de 350 accords de libre-échange en vigueur dans le monde — spaghetti bowl (enchevêtrement d'accords)","Commerce des matières premières : pétrole, gaz, minerais — géopolitique des ressources, 'malédiction des ressources naturelles'","Dumping social et environnemental : firmes délocalisent vers des pays à faibles standards — taxe carbone aux frontières (MACF) comme réponse","Règles d'origine : déterminent si un produit peut bénéficier des préférences tarifaires — complexité croissante des accords","Commerce et développement : les pays pauvres exportent des matières premières, importent des produits manufacturés — 'termes de l'échange défavorables' (Prebisch-Singer)"]},
  {id:15,title:"Droits de l'homme & ONG",icon:"users",color:"#2B78F5",items:["Amnesty International : fondée en 1961 (Peter Benenson), 10 millions de membres dans 150 pays — prix Nobel de la Paix 1977 — rapport annuel sur la torture","Human Rights Watch : fondée en 1978 à New York — rapports d'investigation sur violations — rapporteurs sur place dans les zones de conflit","CICR (Comité international de la Croix-Rouge) : fondé en 1863 (Henri Dunant), gardien du DIH — accès aux prisonniers de guerre — prix Nobel 1917, 1944, 1963","Médecins Sans Frontières (MSF) : fondée en 1971, présente dans 70 pays — prix Nobel de la Paix 1999 — 'témoignage' comme principe d'action","Transparency International : fondée en 1993 — indice de perceptions de la corruption (IPC) — 180 pays classés annuellement","Reporters sans frontières (RSF) : classement annuel de la liberté de la presse — 180 pays — France : 21e en 2024","Oxfam : fondée en 1942 (Oxford Committee for Famine Relief) — rapports annuels sur les inégalités mondiales au Forum de Davos","Greenpeace : fondée en 1971 à Vancouver — actions directes non-violentes — campagnes sur le nucléaire, les baleines, le plastique","WWF (Fonds mondial pour la nature) : fondé en 1961 — plus grande ONG environnementale, 5 millions de membres, panda comme symbole","Human Rights Council (Conseil des droits de l'homme ONU) : 47 membres élus par l'AG, créé en 2006 (remplace la CDH) — siège à Genève","Rapporteurs spéciaux ONU : experts indépendants bénévoles nommés par le CDH sur des thèmes ou des pays — 44 mandats thématiques en 2024","Haut-Commissariat aux droits de l'homme (HCDH) : bureau ONU depuis 1993 — Haut-Commissaire : Volker Türk (depuis 2022)","Cour pénale internationale (CPI) : créée par le Statut de Rome (1998), opérationnelle depuis 2002, 124 États membres — La Haye","Mandats d'arrêt CPI : Poutine (2023, déportation enfants), Netanyahou et Gallant (2024, Gaza), Kony, Kadhafi, Kagamé (toujours en fuite)","Universal Periodic Review (UPR) : mécanisme ONU de révision par les pairs de tous les États tous les 4 ans sur les droits de l'homme","Défenseurs des droits de l'homme : 300+ tués chaque année dans le monde selon Front Line Defenders","Traités ONU sur les droits de l'homme : 9 traités principaux (PIDCP, PIDESC, CEDEF, CRC, CAT, ICERD, CMW, CRPD, CPED) + Comités","Accès humanitaire : article 70 de la Charte — refus d'accès = violation du DIH — Syrie, Yemen, Gaza : obstacles systématiques aux ONG","Financement ONG : méfiance des États autoritaires (loi ONG 'agent étranger' en Russie 2012, Hongrie 2017) — enjeu de l'espace civique","Histoire récente : procès Nuremberg (1945-46) = acte fondateur, Tribunal Rwanda et ex-Yougoslavie (1993-94) = préfigurent la CPI"]},
  {id:16,title:"Relations USA-Chine",icon:"globe",color:"#E03535",items:["Rivalité systémique : affrontement entre les deux premières économies mondiales et puissances militaires — Thucydide Trap (G. Allison)","PIB comparé : USA ~27 000 Mds$ vs Chine ~18 000 Mds$ (nominal) — Chine 1e en PPA depuis 2014","Commerce bilatéral : 690 milliards de dollars en 2023 malgré les tensions — interdépendance paradoxale et dangereuse","Guerre commerciale Trump (2018) : tarifs sur 370 Mds$ de biens chinois — Biden a maintenu et renforcé (semi-conducteurs 2022, VE 2024)","Semiconducteurs : restriction américaine sur les puces avancées vers la Chine (NVIDIA H100) — Chine investit massivement dans son propre secteur","Taïwan : ligne rouge de Pékin, 'garant de fait' américain — loi sur les relations avec Taïwan (1979) — Taïwan = 90% des puces avancées mondiales (TSMC)","Mer de Chine méridionale : îles artificielles chinoises, revendications de 80% de la zone — collisions sino-philippines en 2024","AUKUS (2021) : sous-marins nucléaires pour l'Australie — rupture avec la France — interprété comme endiguement maritime de la Chine","Détroit de Malacca : 80% des importations pétrolières chinoises y transitent — vulnérabilité stratégique majeure de Pékin","Initiatives chinoises : Nouvelles Routes de la Soie (2013, 140 pays, 1 000 Mds$), AIIB, Ceinture polaire (Chine 'État quasi-arctique')","Initiatives américaines : Indo-Pacific Economic Framework (IPEF), Partenariat pour l'infrastructure mondiale (PGI) — alternative aux RSdS","Espionnage et cyber : ballons espions (février 2023), hacks des agences fédérales USA (Salt Typhoon, 2024), vols de propriété intellectuelle","Fentanyl : crise des opioïdes aux USA (100 000 morts/an) — précurseurs chimiques venant de Chine — enjeu bilatéral","Hong Kong : loi sur la sécurité nationale (2020) — fin du 'un pays deux systèmes' — démantèlement de l'opposition démocratique","Xinjiang et Ouïghours : 1 million de détenus dans des 'camps de rééducation' (accusation USA) — accusation de génocide culturel","Tibet : occupation depuis 1950, répression de 1959 — Dalaï Lama en exil à Dharamsala — enjeu de légitimité internationale","Coopération persistante : climat (accord Sunnylands, nov. 2023), contrôle des narcotiques, non-prolifération nucléaire — 'coopétition'","Scénarios 2025-2030 : Taïwan comme étincelle potentielle — Biden puis Trump, Kamala Harris... positionnement américain incertain","Guerre économique des normes : standards 5G (Huawei vs Ericsson/Nokia), normes IA, règles du commerce numérique","Opinion publique : 83% d'opinions défavorables à la Chine aux USA (Pew, 2023) — 79% d'opinions défavorables aux USA en Chine"]},
  {id:17,title:"Moyen-Orient contemporain",icon:"globe",color:"#D97706",items:["Conflit israélo-palestinien : 1948 (Nakba), 1967 (Six Jours, occupation), Oslo (1993), Intifadas, Gaza (2007 Hamas), 7 oct. 2023 (+46 000 morts)","Question palestinienne : deux États (position internationale) vs annexion (droite israélienne) — colonisation en Cisjordanie (750 000 colons en 2024)","Iran : Révolution islamique (1979), programme nucléaire (accord JCPOA 2015, dénoncé par Trump 2018), frappes directes Iran-Israël (avril-oct. 2024)","Arabie Saoudite : pétromonarchie, Vision 2030 (diversification économique, MBS), normalisation avec Israël en cours (accord Abraham 2020 avec EAU, Bahreïn, Maroc)","Syrie : guerre civile (2011-), 500 000 morts, 6 millions de réfugiés — Assad soutenu par Russie-Iran — chute de Damas (décembre 2024) — HTS au pouvoir","Yémen : guerre Houthis (Ansar Allah, proira­nien) vs coalition saoudo-émiranienne (2015-) — 400 000 morts, famine — attaques en mer Rouge 2024","Liban : Hezbollah (mouvement chiite pro-Iran), crise économique (2019-), explosion de Beyrouth (2020), guerre Israël-Hezbollah (2024)","Irak post-2003 : invasion USA, Daech (2013-2019), milices pro-iraniennes, gouvernement fragile — Iran première puissance d'influence réelle","Turquie : membre OTAN mais achète S-400 russes, médiation Ukraine-Russie, question kurde (PKK), aspirant à l'OCS, Erdogan depuis 2003","Kurdistans : Kurdes = 4e peuple du Monde-Orient sans État — Irak (KRI autonome), Syrie (Rojava-FDS), Turquie (PKK), Iran","Qatar : financement Hamas (controverse), Al Jazeera, médiateur dans les conflits (Gaza négociations), Coupe du Monde 2022","Émirats arabes unis : diversification économique réussie (Dubaï), accords Abraham avec Israël (2020), investissements mondiaux","Pétrole et gaz : Arabie Saoudite (1er producteur OPEP), Iran (sanctions), Irak, Koweït, Qatar (GNL) — 40% des réserves prouvées mondiales","OPEP+ : Arabie Saoudite et Russie coopèrent sur les prix du pétrole — politique de restriction de l'offre","Eau : ressource rare — Nil (Éthiopie vs Égypte vs Soudan), aquifères surexploités, désertification croissante","Réformes sociales Arabie Saoudite : femmes au volant (2018), cinémas ouverts, concerts — 'soft power' de Vision 2030","Printemps arabes (2010-2012) : Tunisie (seule 'réussite' fragile), Égypte (coup d'État Sissi 2013), Libye (guerre civile), Syrie (guerre civile)","Enjeu nucléaire régional : Israël (arsenal non déclaré, ~90 têtes), Iran (enrichissement à 60%), menace de prolifération chez les voisins","Migrations méditerranéennes : 5 millions de Syriens au Liban, Turquie, Jordanie — départ vers l'Europe (Lesbos, Lampedusa)","Conflits de légitimité : chiites vs sunnites (Iran vs Arabie Saoudite), nationalisme arabe vs islamisme politique vs laïcisme militaire"]},
  {id:18,title:"Guerre en Ukraine",icon:"shield",color:"#7C3AED",items:["Contexte : Ukraine indépendante en 1991, mémorandum de Budapest (1994, renonce aux armes nucléaires en échange de garanties), révolution Maïdan (2014)","Annexion de la Crimée : 27 février 2014 — référendum non reconnu internationalement — premier changement de frontière en Europe depuis 1945","Donbass 2014-2022 : guerre dans l'est, accords de Minsk I (sept. 2014) et II (fév. 2015) — 14 000 morts en 8 ans","Invasion à grande échelle : 24 février 2022 — 190 000 soldats russes, objectif : Kiev en 3 jours — Résistance ukrainienne surprenante","Bilan humain estimé 2022-2025 : Ukraine (100 000 tués militaires) + Russie (200 000+ tués militaires selon estimations OTAN), millions de civils déplacés","Aide militaire occidentale : +200 milliards de dollars depuis 2022 — USA (75 Mds$), UE (60 Mds$), Allemagne (17 Mds$) — chars, HIMARS, F-16","Sanctions contre la Russie : plus de 16 500 sanctions individuelles et sectorielles — gel de 300 Mds$ de réserves russes","Résilience économique russe : économie en guerre (+3,6% croissance 2023), revenus pétroliers maintenus via Inde et Chine, pivot économique asiatique","Soutiens de la Russie : Chine (aide économique), Corée du Nord (munitions, soldats), Iran (drones Shahed) — multilatéralisme anti-occidental","Théâtres d'opérations : Kherson (reconquis oct. 2022), Kharkiv, Zaporijia (centrale nucléaire), Bakhmout (2023), Avdiïvka (fév. 2024), Kursk (incursion ukrainienne, août 2024)","Centrale nucléaire de Zaporijia : plus grande d'Europe, sous occupation russe depuis mars 2022 — menace nucléaire permanente selon AIEA","Crimes de guerre : procureur CPI (Karim Khan) — mandat d'arrêt contre Poutine (17 mars 2023, déportation d'enfants) — documentation en cours","Grain Initiative : accord Ukraine-Russie (juillet 2022, médiation ONU-Turquie) permettant exportations céréalières — dénoncé par Russie (juillet 2023)","Impact alimentaire mondial : Ukraine = 'grenier de l'Europe' — 25% du blé mondial, 15% du maïs, 50% de l'huile de tournesol — crise alimentaire mondiale","Reconstruction : estimée à 486 milliards de dollars (Banque mondiale, 2023) — débat sur utilisation des avoirs russes gelés","Zelensky : communication exceptionnelle — discours quotidiens en vidéo depuis le début, contacts avec 180 Parlements, Prix de l'An de Time","Négociations : refus ukrainien de tout cessez-le-feu impliquant une concession territoriale — plan de paix en 10 points","Trump et Ukraine : crainte d'un accord forcé défavorable à l'Ukraine après la réélection de Trump (novembre 2024) — conditionnalité de l'aide","OTAN et Ukraine : promesse d'adhésion 'quand les conditions seront réunies' (Vilnius 2023, Washington 2024) — pas de calendrier","Impact géopolitique : réarmement européen massif, Finlande et Suède rejoignent l'OTAN, fin de la neutralité, relance de l'industrie de défense UE"]},
  {id:19,title:"Amérique latine contemporaine",icon:"globe",color:"#16A34A",items:["Géographie politique : 33 États indépendants, 660 millions d'habitants, PIB cumulé ~6 000 milliards de dollars — Brésil = 50% du PIB régional","Cycle rose actuel : Lula (Brésil, réélu 2022), Petro (Colombie, 2022), Boric (Chili, 2022), Fernández puis Milei (Argentine, 2023), Sheinbaum (Mexique, 2024)","Milei et l'hyperlibéralisme argentin : président libertarien élu nov. 2023 — dollarisation, tronçonneuse du budget, -70% de l'État — résultats contrastés","Venezuela : régime de Maduro, hyperinflation (2018 : 1 000 000%), 7 millions d'émigrés (2e exode le plus important au monde après Syrie)","Cuba : embargo américain depuis 1962, régime communiste, libéralisation économique partielle — Raúl puis Díaz-Canel","Crime organisé : cartels mexicains (Sinaloa, CJNG), gangs au Brésil (PCC, CV), MS-13/Barrio 18 en Amérique centrale — homicides les plus élevés au monde","Équateur 2024 : État en 'conflit armé interne' contre gangs — assassinat candidat présidentiel (2023) — militarisation","Migration vers les USA : 2 millions d'interpellations à la frontière (2023) — record absolu — cause électorale majeure aux USA","Ressources naturelles : Amazonie (60% Brésil, poumons de la planète), lithium (Chili, Argentine, Bolivie = Triangle du lithium), pétrole (Venezuela, Équateur)","Triangle du lithium : 58% des réserves mondiales de lithium — enjeu géopolitique de la transition énergétique — tensions sur la souveraineté","Déforestation Amazonie : Bolsonaro (2018-2022) = +75% de déforestation — Lula : objectif zéro déforestation en 2030 — résultats positifs en 2023","CELAC (2010) : alternative à l'OEA sans USA et Canada — 33 membres — divisée entre gauche et droite","Mercosur : accord avec l'UE (2019, signé 2024) — bloqué par France (agriculture, déforestation) — 260 millions de consommateurs","Alliance du Pacifique : Chili, Colombie, Mexique, Pérou — modèle libre-échangiste, pro-occidental","Influence chinoise : principal partenaire commercial de la plupart des pays — Route de la Soie, Huawei, investissements portuaires","Influence russe : Venezuela, Cuba, Nicaragua — alliance contre-hégémonique","Haiti : État effondré depuis le tremblement de terre (2010) + assassination de Moïse (2021) — 80% de la capitale contrôlée par gangs","Mexique : premier exportateur vers les USA (supplanté la Chine en 2023) — nearshoring bénéfique mais violence des cartels","Bolivie : réserves de gaz nationalisées, tensions ethniques, putsch raté (2024) contre Arce — ressources de lithium comme enjeu d'avenir","Droits des peuples autochtones : Cour suprême du Brésil, constitution bolivienne (plurinationalité), CIRDI et mines sur terres ancestrales"]},
  {id:20,title:"Philosophie politique",icon:"star",color:"#2B78F5",items:["Contrat social : Hobbes (Léviathan, 1651 — état de nature 'guerre de tous contre tous', État absolu), Locke (état de nature paisible, État limité), Rousseau (volonté générale, souveraineté populaire)","Libéralisme politique : Locke, Constant, Mill — liberté individuelle primordiale, État minimal, droits naturels, tolérance — 'harm principle' de Mill","Républicanisme : Machiavel, Montesquieu, Arendt — liberté comme non-domination, vertu civique, participation à la vie publique","Démocratie : Athènes (Clisthène, 508 av. J.-C.) — direct vs représentatif — Tocqueville ('tyranie de la majorité'), Schumpeter ('démocratie procédurale')","Justice distributive : Rawls ('Théorie de la justice', 1971) — voile d'ignorance, principe de différence (les inégalités ne sont justes que si elles profitent aux plus défavorisés)","Libertarisme : Nozick ('Anarchie, État et utopie', 1974) — État minimal, droits de propriété absolus — critique de Rawls","Socialisme : Marx (analyse du capitalisme, dictature du prolétariat), social-démocratie (réforme graduée), communisme (collectivisation des moyens de production)","Communitarisme : MacIntyre, Sandel, Taylor — critique du libéralisme — l'individu n'existe pas sans sa communauté d'appartenance","Féminisme politique : 1e vague (droits civiques, Wollstonecraft 1792), 2e vague (liberation, Beauvoir 1949), 3e vague (intersectionnalité, 1990s), 4e vague (numérique, #MeToo)","Post-colonialisme : Fanon ('Les damnés de la terre', 1961), Spivak, Mbembe ('Nécropolitique') — critique de la colonialité du savoir et du pouvoir","Nationalisme et cosmopolitisme : opposition entre appartenance nationale (communauté de destin) et citoyenneté mondiale (Nussbaum, Singer)","Démocratie délibérative : Habermas — raison communicationnelle, espace public — les décisions légitimes émergent d'une délibération rationnelle ouverte","Réalisme politique : Machiavel, Hobbes, Morgenthau — les États poursuivent leurs intérêts, la morale est secondaire en politique internationale","Bien commun : Aristote, Aquin, catholicisme social — la politique vise le bien de tous, pas seulement des individus ou groupes","Autorité et légitimité : Weber (trois types — traditionnelle, charismatique, légale-rationnelle) — la légitimité comme fondement du pouvoir","Populisme (théorie) : Laclau ('La raison populiste', 2005) — le peuple comme construction rhétorique contre l'élite — ni droite ni gauche","Ecologie politique : Jonas ('Principe responsabilité', 1979), Latour (Gaïa) — obligation envers les générations futures, démocratie élargie au vivant","Bioéthique et politique : vie, mort, Corps — euthanasie, avortement, transhumanisme — convergence entre éthique et législation","Démocratie et vérité : Arendt ('La crise de la culture') — distinctions entre vérité factuelle, opinion politique et mensonge — fake news comme danger existentiel","Figures majeures à connaître : Platon, Aristote, Machiavel, Hobbes, Locke, Rousseau, Montesquieu, Kant, Mill, Marx, Rawls, Habermas, Arendt"]},
  {id:21,title:"Sociologie & Société",icon:"users",color:"#16A34A",items:["Fondateurs de la sociologie : Auguste Comte (positivisme, 1839), Émile Durkheim (faits sociaux, anomie, solidarité), Max Weber (rationalisation, compréhension), Karl Marx (lutte des classes)","Durkheim : 'Le Suicide' (1897) — taux de suicide social (non individuel) — anomie, suicide égoïste, altruiste, fataliste — méthode sociologique empirique","Bourdieu : capital économique, social, culturel, symbolique — habitus (dispositions incorporées), champ (espace de luttes), reproduction sociale ('Les héritiers', 1964)","Classes sociales : Marx (bourgeoisie vs prolétariat), Weber (statut + classe + parti), Bourdieu (espace social multidimensionnel) — débat sur la 'mort des classes'","Inégalités sociales France : coefficient de Gini de 0,29 (avant redistribution 0,52) — top 10% = 50% du patrimoine, 1% = 25%","Mobilité sociale : ascendante (enfants mieux que parents) vs descendante (préoccupation croissante, classe moyenne) — 'société bloquée' ou dynamique ?","Famille et genre : modèle traditionnel → diversification (familles monoparentales 25%, recomposées, homoparentales légalisées en France 2013 avec le mariage pour tous)","Racisme systémique : discrimination à l'embauche (CV expériences par Petit, 2007), dans le logement, dans les contrôles policiers — débat sur les statistiques ethniques en France","Laïcité et religions : catholicisme déclinant (38% de pratiquants 1960 → 5% 2023), islam 2e religion (5-6 millions), sécularisation globale mais résurgences religieuses","Numérique et société : 4,6 heures de temps d'écran/jour en France — réseaux sociaux et polarisation (chambre d'écho, biais de confirmation)","Jeunesse et politique : abstention électorale des 18-34 ans (~60%) — désaffection des partis traditionnels — engagement associatif et causes environnementales","Vieillissement démographique : 20% de la population française a plus de 65 ans (2023) → 25% en 2040 — financement des retraites (réforme 2023, 64 ans)","Immigration et intégration : 10% de la population française est étrangère ou enfants d'étrangers — modèle républicain assimilationniste vs multiculturalisme","Pauvreté en France : 9 millions de personnes sous le seuil de pauvreté (60% du revenu médian = 1 120 €/mois) — RSA, CAF, logement social","Travail et emploi : taux de chômage ~7% (2024), CDI vs ubérisation/auto-entrepreneuriat, question du sens au travail (Grande Démission, quiet quitting)","Santé et inégalités : espérance de vie en France = 82 ans (8e mondiale) — écart de 13 ans entre un ouvrier et un cadre supérieur","Éducation et reproduction sociale : 'Les héritiers' (Bourdieu-Passeron, 1964) — le mérite scolaire cache la reproduction — réformes : mixité sociale, réseau REP+","Médias et opinion : concentration (Bolloré, Arnault, Bouygues possèdent 90% des médias) — enjeu de pluralisme démocratique","Mouvement sociaux contemporains : Nuits debout (2016), Gilets Jaunes (2018-2019), Extinction Rebellion, ZAD, #MeToo — nouvelles formes d'action collective","Communautarisme et antisémitisme : hausse des actes antisémites (+300% après 7 oct. 2023), islamophobie, racisme — rapport annuel CNCDH"]},
  {id:22,title:"Économie française",icon:"flag",color:"#2B78F5",items:["PIB France 2024 : ~2 800 milliards d'euros, 7e économie mondiale, 3e européenne — croissance +1,1% en 2024","Structure économique : services (78% du PIB), industrie (16%), agriculture (2%), bâtiment (4%) — désindustrialisation depuis 1970s","Budget de l'État 2025 : 493 milliards de dépenses — principaux postes : éducation nationale (60 Mds), défense (47 Mds), dette (55 Mds)","Dette publique : 113% du PIB (3 200 Mds€) — au-dessus des 60% du Pacte de stabilité — 3e pays le plus endetté de la zone euro","Déficit public 2024 : ~6% du PIB — objectif de 3% repoussé à 2029 — procédure de déficit excessif ouverte par la Commission","Inflation française 2024 : ~2,2% — retour à la normale après les pics de 2022 (6%) — baisse du pouvoir d'achat persistante pour les ménages modestes","Chômage : 7,3% (T3 2024) — jeunes : 17% — chômage de longue durée (>1 an) : 2,8% — France au-dessus de la moyenne UE (6%)","Retraites : réforme 2023 (64 ans), système par répartition, déficit projeté de 14 Mds€ en 2030 — alternatives : capitalisation, points","CAC 40 : indice boursier des 40 premières capitalisations françaises — LVMH (400 Mds€), TotalEnergies, Hermès, L'Oréal — capitalisation cumulée ~2 500 Mds€","LVMH (Bernard Arnault) : 1er groupe mondial de luxe, 75 maisons, 79 Mds€ de CA — soft power économique français mondial","Exportations françaises : ~580 milliards d'euros (2023) — aéronautique (Airbus), luxe, agroalimentaire, pharmacie, défense — balance commerciale déficitaire de 100 Mds€","Secteurs en difficulté : industrie automobile (reconversion VE), distribution (Amazon), presse, agriculture (coûts de production)","Secteurs dynamiques : aérospatial (Airbus, Safran), défense (Thales, MBDA, Dassault), énergie nucléaire (EDF), luxe, tourisme (100M de visiteurs/an)","France France-Startup Nation : 36 licornes françaises en 2024 — écosystème Station F (Paris) — French Tech internationale","Fiscalité : taux de prélèvements obligatoires = 45% du PIB (2e plus haut OCDE) — impôt sur le revenu, TVA (150 Mds€/an), IS, CSG","Politique industrielle : France 2030 (54 Mds€ d'investissements publics, hydrogène, VE, semi-conducteurs, nucléaire, IA, biomédicaments)","Énergie : nucléaire (70% de l'électricité), objectif 50% en 2035 — 56 réacteurs, relance de 6 nouveaux EPR2 (2023) — EDF renationalisé (2022)","Modèle social : dépenses sociales = 32% du PIB (plus élevé OCDE) — retraites (14%), santé (8%), famille (2%), chômage (2%), logement (2%)","Géographie économique : Île-de-France = 30% du PIB national — déserts industriels (Nord, Centre), dynamisme Aix-Marseille-Nice, Bordeaux, Toulouse","Histoire économique : trente glorieuses (1945-1975, +5%/an), chocs pétroliers, désindustrialisation, chômage structurel depuis 1975"]},
  {id:23,title:"Droit pénal international",icon:"scale",color:"#E03535",items:["Nuremberg (1945-1946) : acte fondateur du droit pénal international — 24 accusés, 12 condamnés à mort — principe : les individus répondent de leurs crimes même sous ordre","Crimes jugés à Nuremberg : crimes contre la paix (guerre d'agression), crimes de guerre, crimes contre l'humanité — principe de responsabilité individuelle","TPIY (Tribunal pénal international pour l'ex-Yougoslavie, 1993-2017) : La Haye — 161 mises en examen dont Milosevic, Karadzic, Mladic — génocide de Srebrenica reconnu","TPIR (Tribunal pénal international pour le Rwanda, 1994-2015) : Arusha — 93 condamnations — génocide reconnu officiellement — premier tribunal à condamner pour viol comme crime contre l'humanité","CPI (Cour pénale internationale) : Statut de Rome (1998), opérationnelle 2002, 124 États membres (USA, Russie, Chine, Inde = non-membres)","Compétence CPI : génocide, crimes contre l'humanité, crimes de guerre, crime d'agression (ajouté en 2017) — compétence complémentaire (États en premier)","Mandats CPI 2024 : Poutine (déportation d'enfants), Netanyahou et Gallant (Gaza), Omar el-Béchir (Soudan, en fuite), Kony (LRA, Ouganda, en fuite)","Génocide (Convention de 1948) : intention de détruire un groupe national, ethnique, racial ou religieux — Shoah, Rwanda (1994), Srebrenica (1995)","Crimes contre l'humanité : actes graves et systématiques contre des civils — extermination, esclavage, déportation, torture, viol, apartheid — imprescriptibles","Crime de guerre : violation grave du DIH en conflit armé — cibler des civils, torture, pillage, utilisation d'armes chimiques — Conventions de Genève","Principe de complémentarité : la CPI n'intervient que si les États sont 'incapables ou n'ont pas la volonté' de poursuivre — primauté des juridictions nationales","Justice transitionnelle : réconciliation après conflits — Commission Vérité et Réconciliation (Afrique du Sud, 1996-2003), Gacaca (Rwanda), TRC","Immunités : question non résolue — immunité des chefs d'État en exercice vs compétence universelle — affaire Pinochet (Royaume-Uni, 1998)","Compétence universelle : certains États (Belgique jusqu'en 2003, Espagne) se sont arrogé le droit de juger des crimes universels commis ailleurs","Droit de Genève vs droit de La Haye : Droit de Genève (protection victimes de guerre, CICR) vs Droit de La Haye (limitations des méthodes de guerre)","Conventions de Genève (1949) : 4 conventions + 3 protocoles — statut des prisonniers, des blessés, des civils — ratifiées par 196 États (universalité)","Convention contre la torture (CAT, 1984) : 173 États parties — interdiction absolue, compétence universelle pour les poursuites","R2P et CPI : tension entre responsabilité de protéger (potentielle intervention) et compétence de la CPI (poursuite des responsables)","Financement CPI : 170 millions d'euros/an — dépendance aux contributions des États membres — fragilité institutionnelle","Limites du droit pénal international : sélectivité politique (USA, Russie, Chine exemptés de facto), lenteur des procès (20 ans pour certains), difficulté d'exécution des mandats"]},
  {id:24,title:"Religions & Géopolitique",icon:"heart",color:"#D97706",items:["Cartographie religieuse mondiale : christianisme (2,4 Mds, 31%), islam (1,9 Mds, 24%), hindouisme (1,2 Mds, 15%), bouddhisme (500 M, 7%), judaïsme (14 M, 0,2%)","Islam : sunnites (87-90%) vs chiites (10-13%) — fracture géopolitique structurante — Iran (chiite) vs Arabie Saoudite (sunnite) — conflit par procuration au Yémen, Syrie, Liban","Chiisme et Iran : révolution islamique (1979, Khomeini) — République islamique — projet d'hégémonie régionale chiite — 'axe de résistance' (Hezbollah, Hamas, Houthis)","Islamisme politique : des Frères musulmans (Égypte, 1928) au salafisme jihadiste (Al-Qaïda, Daech) — Islam politique modéré (AKP turc, Ennahda tunisien) vs radical","Christianisme et géopolitique : Catholicisme (1,3 Mds, Vatican) — influence dans les organisations internationales — question de l'avortement aux USA (Roe v. Wade 2022)","Protestantisme évangélique américain : 80% ont voté Trump (2016, 2020, 2024) — lobbying pro-israélien, anti-avortement, pro-armes — 'bible belt'","Vatican et diplomatie : Saint-Siège a statut d'observateur permanent à l'ONU — diplomatie de médiation (Cuba-USA 2015, Colombie) — pape François et les migrants","Orthodoxie russe : l'Église orthodoxe russe soutient la guerre en Ukraine ('monde russe') — Kirill vs Bartholomée (Constantinople) — schisme de 2018","Hindouisme et nationalisme : BJP (Modi) — 'Hindutva' (suprématie hindoue), tensions avec minorité musulmane (200 millions), violence intercommunautaire","Bouddhisme et politique : Birmanie (nationalisme bouddhiste, génocide Rohingyas) vs Thaïlande (monarchie bouddhiste) vs Tibet (Dalaï Lama, exil)","Antisémitisme : hausse de 300% en Europe après le 7 octobre 2023 — Holocaust denial — mémoire de la Shoah comme enjeu de politique intérieure","Islamophobie : attentats de Charlie Hebdo (2015), Nice (2016), Christchurch (2019) — législations nationales sur le voile, l'abaya, la construction de mosquées","Laïcité française : modèle jacobin de séparation stricte vs multiculturalisme anglo-saxon — loi 1905, voile à l'école (2004), charte de la laïcité (2013)","Jérusalem : ville sainte pour les trois monothéismes — revendiquée comme capitale par Israël (reconnue par USA en 2017) — enjeu du processus de paix","Conflit hindou-musulman : Inde-Pakistan — Cachemire — nationalisme religieux des deux côtés — risque nucléaire","Populisme religieux : Orbán se réclame de la civilisation chrétienne, Erdogan de l'islam sunnite ottoman, Modi de l'hindouisme — instrumentalisation politique","Liberté de religion : art. 18 DUDH, art. 9 CEDH — persécutions des Ouïghours (Chine), des chrétiens d'Irak et Syrie (Daech), des Rohingyas (Birmanie)","Réforme protestante (1517) et démocratie : Weber ('L'éthique protestante et l'esprit du capitalisme') — lien entre protestantisme et développement démocratique-capitaliste","Sécularisation : recul de la pratique religieuse en Europe occidentale — mais renouveau religieux en Afrique (pentecôtisme), en Asie (islam), en Amérique latine (évangélisme)","Dialogue interreligieux : ONU décret 2000 sur la 'décennie pour la promotion d'une culture de la paix' — rôle des institutions religieuses dans la résolution des conflits"]},
  {id:25,title:"Médias & Démocratie",icon:"video",color:"#7C3AED",items:["Quatrième pouvoir : la presse comme contre-pouvoir démocratique — liberté de la presse garantie par l'art. 10 CEDH et l'art. 11 DDHC 1789","Concentration des médias en France : Bolloré (CNews, C8, BFM, RMC), Niel (Le Monde), Arnault (Le Parisien, Les Échos), Bouygues (TF1, LCI) — 90% des grands médias","Indice RSF 2024 : Norvège 1ère, France 21e, USA 55e, Turquie 158e, Russie 162e, Chine 172e, Corée du Nord 177e (sur 180)","Fake news et désinformation : rapport Mueller (2019) sur interférences russes élection USA 2016 — 126 millions d'Américains exposés à des contenus russes sur Facebook","Réseaux sociaux et démocratie : l'algorithme favorise les contenus polarisants (engagement > vérité) — 'bulle de filtre' (Pariser), 'chambre d'écho'","DSA (Digital Services Act, 2022) : obligation de transparence algorithmique, retrait des contenus illicites — très grandes plateformes (100M d'utilisateurs) soumises à audit","Presse et journaux : crise du modèle économique (chute de la publicité imprimée) — mutations vers le numérique — mécénat (Le Monde, Le Figaro)","TF1, France Télévisions : service public audiovisuel (France Télévisions) vs chaînes privées — redevance supprimée (2022), budget via TVA","Radio et podcast : 82% des Français écoutent la radio — essor des podcasts natifs numériques — Spotify, Deezer comme nouvelles plateformes","Al Jazeera : fondée en 1996 au Qatar, en arabe puis anglais — révolution dans les médias du monde arabe — accusée de partialité pro-Hamas","RT (Russia Today) : outil de soft power russe — interdite en Europe depuis mars 2022 après l'invasion de l'Ukraine — désinformation active","TikTok et IA : 1,7 milliard d'utilisateurs — algorithme opaque — loi américaine visant l'interdiction (2024) pour raisons sécuritaires","Journalistes tués : 100+ journalistes tués en 2023 (RSF) — Palestine premier pays de décès (dont Shireen Abu Akleh, Al Jazeera, 2022)","Whistleblowers : Snowden (NSA, 2013), Manning (documents militaires, 2010), WikiLeaks (Assange, poursuivi 2019-2024) — tension transparence vs sécurité nationale","L'affaire Cambridge Analytica (2018) : données de 87 millions d'utilisateurs Facebook exploitées pour cibler des électeurs — Trump 2016, Brexit","Médias et populisme : CNews soutenu par Bolloré = augmentation du vote RN selon plusieurs études — 'Fox News effect' aux USA","Service public à l'ère numérique : BBC (UK), France Télévisions, ARD/ZDF (All.) — légitimité contestée, financement en débat, concurrence SVOD","Deepfakes électoraux : détection des fausses vidéos (Elections Act en cours aux USA et UE) — ingérence électorale via deepfakes en 2024 (Slovaquie)","Droit à l'oubli (RGPD art. 17) : possibilité de demander la suppression de résultats de recherche — Google doit supprimer les liens — enjeu de mémoire numérique","Pluralisme médiatique et démocratie : la concentration médiatique menace l'indépendance éditoriale — Arcom surveille le pluralisme en France — question d'un financement public stable"]},
  {id:26,premium:true,title:"Guerre froide 1947-1991",icon:"shield",color:"#7C3AED",items:["Origines : méfiance USA-URSS dès 1945 — doctrine Truman (mars 1947, endiguement) et plan Marshall (juin 1947) marquent le début officiel","Deux blocs : OTAN (1949) vs Pacte de Varsovie (1955) — bombe atomique soviétique (1949), hydrogène USA (1952), URSS (1953)","Berlin : blocus soviétique (1948-49), pont aérien américain (1,5 million de tonnes), mur construit le 13 août 1961 — chute le 9 novembre 1989","Crises majeures : Corée (1950-53), Suez (1956), Cuba (octobre 1962, 13 jours à la limite du nucléaire), Vietnam (1965-1975)","Compétition spatiale : Spoutnik (octobre 1957), Gagarine (1961), Apollo 11 (1969) — la 'course à l'espace' comme enjeu de prestige","Détente (1969-1979) : Ostpolitik de Brandt, SALT I (1972), Helsinki (1975), normalisation Nixon-Chine (1972)","Deuxième Guerre froide (1979-1985) : invasion Afghanistan, boycott JO Moscou, Pershing II en Europe, SDI de Reagan","Fin de la Guerre froide : réformes de Gorbatchev (glasnost, perestroïka), révolutions de velours 1989, dissolution de l'URSS (25 déc. 1991)","Bilan : ~50 guerres par procuration, 20-30 millions de morts dans les conflits liés, 50 000 têtes nucléaires au pic, 44 ans de tension permanente","Héritage : OTAN maintenu, élargissement à l'est, dette de la Russie à l'URSS, modèle de la 'paix nucléaire' remis en question en 2022"]},
  {id:27,premium:true,title:"Décolonisation et post-colonialisme",icon:"globe",color:"#D97706",items:["Vagues de décolonisation : Asie (1945-1955), Afrique (1956-1965, apogée 1960 — 17 indépendances en un an), Caraïbes et Pacifique (1960-1980)","Conférence de Bandung (1955) : 29 pays d'Asie et d'Afrique — naissance du Mouvement des non-alignés (NAM) — Nasser, Nehru, Sukarno, Zhou Enlai","Décolonisation violente : Algérie (1954-1962, 500 000 morts), Kenya (Mau Mau 1952-60), Madagascar (1947, 90 000 morts), Indochine (1945-1954)","Décolonisation négociée : Ghana (1957, Nkrumah), Nigeria (1960), Tanzanie (Nyerere, 1961) — modèles de transition pacifique","Apartheid Afrique du Sud : politique officielle 1948-1994, ANC de Mandela, sanctions internationales, transition 1990-1994 — Vérité et Réconciliation","Néocolonialisme (concept de Nkrumah, 1965) : indépendance politique mais dépendance économique persistante — franc CFA, dettes, firmes multinationales","Post-colonialisme théorique : Edward Saïd ('Orientalisme', 1978), Frantz Fanon ('Les damnés de la terre', 1961), Achille Mbembe — déconstruction du regard occidental","DOM-TOM français : France maintient 13 territoires ultramarins — 2,7 millions de citoyens — enjeux d'égalité républicaine et d'autodétermination","Traité de Lisbon (OUA→UA) : Organisation de l'unité africaine (1963) → Union africaine (2002) — 'ne pas remettre en cause les frontières héritées de la colonisation'","Réparations et mémoire : débat mondial sur les excuses et réparations pour l'esclavage et la colonisation — France : loi Taubira (2001) reconnaît l'esclavage comme crime contre l'humanité"]},
  {id:28,premium:true,title:"Droits des femmes",icon:"heart",color:"#E03535",items:["Suffrage féminin : Nouvelle-Zélande 1re (1893), France 1944, Suisse 1971, Arabie Saoudite 2015 (élections locales) — inégalités persistantes","Droits reproductifs : droit à l'avortement (IVG en France 1975, constitutionnalisé 2024), contraception, maternité — remis en cause aux USA (Dobbs 2022)","Conventions internationales : CEDEF (1979, Comité CEDAW) — 189 États parties — discriminations dans la loi, l'éducation, l'emploi, la famille","Parité en politique : France loi 2000 sur la parité — 39% de femmes à l'Assemblée nationale (2022) vs 5% en 1981 — sous-représentation persistante au niveau exécutif","Inégalités salariales : écart de rémunération de 16,8% dans l'UE (2023) — temps partiel subi, plafond de verre, secteurs féminisés moins valorisés","Violences faites aux femmes : 1 femme tuée tous les 3 jours par son partenaire en France — Grenelle des violences conjugales (2019), bracelet électronique","#MeToo (2017) : Harvey Weinstein, mouvement mondial de dénonciation des violences sexuelles — libération de la parole, avancées légales","Éducation des filles : 130 millions de filles non scolarisées dans le monde (UNICEF) — Malala Yousafzai, prix Nobel de la Paix 2014","Index d'égalité de genre (WEF) : Islande 1re depuis 14 ans — France 16e — Yémen dernier (146e) — progrès très lents au rythme actuel","Intersectionnalité (Kimberlé Crenshaw, 1989) : les discriminations se cumulent — être femme + noire + pauvre = discriminations multiples et spécifiques"]},
  {id:29,premium:true,title:"Terrorisme et contre-terrorisme",icon:"shield",color:"#E03535",items:["Définition : acte de violence intentionnel contre des civils pour des fins politiques, idéologiques ou religieuses — aucun consensus juridique international","Al-Qaïda : Oussama ben Laden, fondée en 1988 en Afghanistan — 11 septembre 2001 (2 977 morts) — réseaux décentralisés post-2001","Daech / État islamique : proclamation du 'califat' en juin 2014 (Mossoul) — 40 000 combattants étrangers dont 2 000 Français — chute territoriale en 2019","Attentats en France : Charlie Hebdo et Hyper Cacher (jan. 2015), Bataclan et Paris (13 nov. 2015, 130 morts), Nice (14 juil. 2016, 86 morts)","Réponse française : état d'urgence (2015-2017), Opération Sentinelle (10 000 soldats), Plan Vigipirate (URGENCE ATTENTAT permanent)","Cadre juridique antiterroriste : loi de 2017 (SILT) intégrant mesures de l'état d'urgence dans le droit commun — FIPN, RAID, BRI, GIGN","Radicalisation : processus progressif — processus 3N (Kruglanski) : besoins, récit, réseau — sortie de radicalisation (UPRA, centres de déradicalisation)","Opération Barkhane (2014-2022) : 5 500 soldats français au Sahel contre les groupes jihadistes — retrait après les coups d'État au Mali et au Niger","FATF (GAFI) : Groupe d'action financière, 39 membres — lutte contre le financement du terrorisme — liste noire des pays non coopératifs","Terrorisme d'extrême droite : attentat de Christchurch (NZ, 2019, 51 morts), Halle (Allemagne, 2019), Buffalo (USA, 2022) — en hausse selon Europol"]},
  {id:30,premium:true,title:"Migrations internationales",icon:"users",color:"#2B78F5",items:["Chiffres mondiaux : 281 millions de migrants internationaux en 2020 (OIM) soit 3,6% de la population mondiale — 80 millions de réfugiés et déplacés (record UNHCR)","Causes : économiques (70%), conflits (20%), changement climatique (10% et en hausse) — distinction réfugié (persécution) vs migrant économique (droit international)","Convention de Genève (1951) : définition du réfugié — persécution pour raison de race, religion, nationalité, appartenance à un groupe social ou opinion politique","HCR/UNHCR : agence ONU pour les réfugiés — 125 millions de personnes relevant de son mandat en 2024 — 90% des réfugiés accueillis dans des pays en développement","Crise méditerranéenne : plus de 27 000 morts en mer depuis 2014 (OIM) — 'cimetière maritime' — tensions entre États membres de l'UE sur la répartition","Pacte de Marrakech (2018) : pacte mondial non contraignant sur les migrations — refus de certains États (USA sous Trump, Hongrie)","Pacte européen sur la migration (2024) : 5 ans de négociations — solidarité obligatoire, procédures aux frontières accélérées, externalisation vers les pays tiers","Remises de fonds (remittances) : 857 milliards de dollars envoyés par les migrants à leurs familles (2023) — dépassent l'aide publique au développement","Immigration en France : 3,9 millions d'étrangers (6% de la population) — 272 000 titres de séjour délivrés en 2022 — loi Asile-Immigration 2024","Xénophobie et droits : montée des discours antimigrants — Méditerranée comme espace de violations des droits humains selon Amnesty International"]},
  {id:31,premium:true,title:"Sécurité alimentaire mondiale",icon:"globe",color:"#16A34A",items:["Chiffres de la faim : 733 millions de personnes en situation d'insécurité alimentaire sévère (FAO, 2023) — 2,8 milliards ne peuvent s'offrir une alimentation saine","ODD 2 : 'Faim zéro' d'ici 2030 — objectif hors de portée selon les tendances actuelles — régression depuis 2015 à cause du Covid, conflits, climat","Grenier mondial : USA, Russie, Australie, Canada, UE = 60% des exportations céréalières — Ukraine = 12% du blé, 15% du maïs, 50% tournesol","Crise 2022 : invasion russe de l'Ukraine → blocage des ports de la mer Noire → +40% prix du blé → 50 pays en situation critique, famines au Yémen, Corne de l'Afrique","PAM (Programme Alimentaire Mondial) : plus grande organisation humanitaire — nourrit 150 millions de personnes dans 120 pays — prix Nobel de la Paix 2020","FAO : Organisation des Nations unies pour l'alimentation et l'agriculture — siège Rome, 194 membres — publie l'indice SOFI annuel","Révolution verte 1.0 : Norman Borlaug (prix Nobel 1970) — variétés à haut rendement, engrais chimiques — doublement de la production asiatique (1960-80)","Agriculture et climat : le secteur agricole émet 23% des GES mondiaux — déforestation, élevage intensif (méthane) vs solutions : agroécologie, protéines alternatives","Pertes et gaspillages alimentaires : 1/3 de la production mondiale jetée (1,3 milliard de tonnes/an, FAO) — enjeu environnemental et économique majeur","Droits à l'alimentation : reconnu dans le PIDESC (art. 11) — rapporteur spécial ONU — opposition entre souveraineté alimentaire (Via Campesina) et libéralisation (OMC)"]},
  {id:32,premium:true,title:"Armée française",icon:"shield",color:"#7C3AED",items:["Forces armées 2024 : 203 000 militaires d'active + 75 000 réservistes — budget défense 47 milliards d'euros (2024) → 2% PIB en 2025","Dissuasion nucléaire : 290 têtes nucléaires — triade aérienne (ASMP-A) + navale (SNLE M51) — dogme de l'indépendance nationale (hors OTAN intégré pour le nucléaire)","Opérations extérieures (OPEX) : 7 000 soldats déployés dans le monde — Sahel (post-Barkhane), Liban (FINUL), Roumanie (OTAN), Irak-Syrie (Chammal)","LPM 2024-2030 : Loi de Programmation Militaire — 413 milliards d'euros — rééquipement : chars Leclerc remplacés, avions A400M, frégates FDI, drones MALE","Armée de Terre : 77 000 hommes — SCORPION (système de combat connecté), char EMBT franco-allemand en développement","Marine nationale : porte-avions Charles de Gaulle (unique en Europe non américain) + 2 PHA, 6 frégates multi-missions (FREMM), 4 SNLE","Armée de l'Air et de l'Espace : 250 avions de combat (Rafale) — Commandement de l'Espace (CDE) créé en 2019 — CERES (satellites d'écoute)","Industrie de défense : Thalès, MBDA, Dassault, Naval Group, Safran — France 3e exportateur mondial d'armes (après USA et Russie) — Rafale (73 pays clients)","Réforme 2023 : Service National Universel (SNU) en développement — débat sur le retour au service militaire obligatoire post-Ukraine","Doctrine française : autonomie stratégique, 'puissance d'équilibres', capacité d'entrée en premier (tier one) — débat sur la 'guerre de haute intensité'"]},
  {id:33,premium:true,title:"Histoire de France XXe siècle",icon:"flag",color:"#E03535",items:["IIIe République (1870-1940) : Affaire Dreyfus (1894-1906), loi de séparation Église-État (1905), Grande Guerre (1914-18), Front populaire (1936, Blum)","Vichy (1940-1944) : régime de Pétain — collaboration, lois anti-juives (statuts des Juifs, oct. 1940), rafle du Vél d'Hiv (juil. 1942, 13 000 arrestations)","Résistance et Libération : CNR (Conseil National de la Résistance), De Gaulle à Londres (appel du 18 juin 1940), débarquement de Normandie (6 juin 1944)","IVe République (1946-1958) : instabilité (21 gouvernements en 12 ans), guerre d'Indochine (1945-54), début de la guerre d'Algérie (1954)","Ve République (depuis 1958) : Constitution gaullienne, élection directe du Président depuis 1962, 5 présidents en 66 ans","Trente Glorieuses (1945-1975) : croissance annuelle de +5%, plein emploi, État-providence, baby-boom, urbanisation, consommation de masse","Mai 68 : révolte étudiante (Nanterre-Sorbonne) + grève générale (10 millions de grévistes) — ébranlement des autorités — accords de Grenelle","Chocs pétroliers (1973, 1979) : fin des Trente Glorieuses, chômage de masse, stagflation — tournant vers les politiques d'austérité","Cohabitations (1986-88, 1993-95, 1997-2002) : test institutionnel inédit de la Ve République — Chirac-Mitterrand, puis Chirac-Jospin","Présidences récentes : Sarkozy (2007-12), Hollande (2012-17), Macron (depuis 2017) — mouvement des Gilets Jaunes (2018-19), réforme des retraites (2023)"]},
  {id:34,premium:true,title:"Politique étrangère française",icon:"globe",color:"#2B78F5",items:["Tradition gaulliste : indépendance nationale, grandeur de la France, équidistance entre blocs — sortie du commandement intégré OTAN (1966), retour en 2009","Axes permanents : droit international, multilatéralisme, siège permanent au Conseil de sécurité de l'ONU (P5), franco-allemand comme moteur européen","'Chèque en blanc' : France seul pays en Europe à disposer de la dissuasion nucléaire — débat sur un 'parapluie nucléaire européen'","Françafrique : réseau d'influence en Afrique subsaharienne — accords de défense avec ~15 pays — sous pression depuis les coups d'État au Sahel 2021-2024","OPEX : 7 000 soldats déployés à l'étranger — Barkhane (retrait 2022), FINUL Liban, Chammal Irak-Syrie, Daman, présence en Roumanie (OTAN)","Macron et la diplomatie : 'mort cérébrale' de l'OTAN (2019), autonomie stratégique européenne, dialogue avec Poutine puis rupture (2022), ambiguïté Taïwan-Chine","Partenariat franco-allemand : Traité de l'Élysée (1963), Traité d'Aix-la-Chapelle (2019) — moteur de la construction européenne mais divergences croissantes","Relations franco-britanniques : tensions post-Brexit (pêche, migrants Manche), AUKUS (2021, sous-marins Australie, exclusion de la France) — coopération défense (Lancaster House 2010)","Sahel post-Barkhane : retrait militaire de Mali, Burkina, Niger — présence maintenue au Tchad, Côte d'Ivoire, Sénégal (accord de défense renégocié)","Diplomatie culturelle : OIF (Organisation internationale de la Francophonie), réseau des Alliances françaises (835 dans 132 pays), TV5 Monde — soft power linguistique"]},
  {id:35,premium:true,title:"Terrorisme et radicalisation (approfondissement)",icon:"zap",color:"#E03535",items:["Radicalisation : processus de transition vers des positions extrémistes — modèles explicatifs : pyramide de Moghaddam, modèle 3N de Kruglanski","Facteurs de risque : sentiment de discrimination, crise identitaire, rupture sociale, vide existentiel, rencontre avec un 'recruteur', endoctrinement en ligne","Filières syro-irakiennes : 1 900 Français partis combattre pour Daech — 300+ revenus — rapatriements d'enfants de combattants — procès massifs","UCLAT (Unité de coordination de la lutte antiterroriste) : coordination des services français — DGSI (intérieur), DGSE (extérieur), DRSD (armée)","Plan de prévention de la radicalisation 2023-2027 : détection précoce, prise en charge, désengagement — CPRAF dans chaque département","Terrorisme en prison : 400+ détenus radicalisés — quartiers spécifiques (QER), suivi, programme UPRA","Terrorisme solitaire ('loup solitaire') : Samuel Paty (oct. 2020) — 'terrorisme d'atmosphère' — impossibilité de surveillance exhaustive","Financement du terrorisme : cryptocurrency, hawala (transferts informels), trafic de biens culturels — GAFI comme organe de contrôle","Europe et terrorisme : Europol — 750+ arrestations liées au terrorisme en 2022 — extrémisme de droite en hausse (40% des arrestations)","Déradicalisation : bilan mitigé des programmes — centre de Pontourny (fermé 2017) — modèles étrangers : Aarhus (Danemark), EXIT (Suède)"]},
  {id:36,premium:true,title:"Justice et système judiciaire",icon:"scale",color:"#7C3AED",items:["Dual ordre juridictionnel : ordre judiciaire (Cour de cassation au sommet) vs ordre administratif (Conseil d'État) — Tribunal des conflits pour les litiges de compétence","Tribunaux judiciaires (1e instance), cours d'appel (35), Cour de cassation — contrôle de la correcte application de la loi, ne juge pas les faits","Juridictions pénales : tribunal de police (contraventions), tribunal correctionnel (délits), cour d'assises (crimes, jury populaire depuis 2011 en formation d'assises simplifiée)","Cour d'assises : 3 magistrats + 6 jurés populaires — décisions à la majorité qualifiée (6/9) — appel devant une autre cour d'assises","Présomption d'innocence : principe fondamental — art. 9 DDHC, art. 6 CEDH — violation par la presse (médiatisation des suspects)","Garde à vue : 24h prolongeable à 48h, 96h pour terrorisme — droit à l'avocat dès le début (réforme 2011, arrêt CEDH Salduz 2008)","Parquet national financier (PNF) : créé 2014 — grande délinquance financière — affaire Sarkozy (condamné 3 ans ferme en 2023), Fillon","Prison : 77 000 détenus pour 60 000 places (surpopulation carcérale de 28%) — taux de récidive à 60% — débat sur les peines alternatives","Aide juridictionnelle : pour les plus modestes — seuils de revenus — coûts pour l'État (600 millions/an) — qualité variable du service rendu","Réforme de la justice : loi Dupond-Moretti (2019-2021), numérisation des procédures, cours criminelles départementales (sans jury)"]},
  {id:37,premium:true,title:"Système éducatif français",icon:"award",color:"#16A34A",items:["Structure : maternelle (3-6 ans) → primaire (6-11) → collège (11-15) → lycée (15-18) → supérieur — obligation scolaire de 3 à 16 ans (depuis 2019)","Budget : 60 milliards d'euros, premier poste budgétaire de l'État — 870 000 enseignants — 12 millions d'élèves en primaire et secondaire","Baccalauréat : réforme 2021 — spécialités (abandon de la filière L/ES/S) — grand oral — contrôle continu (40%) + épreuves finales (60%)","PISA 2022 : France 26e sur 37 pays OCDE en mathématiques, 18e en lecture — 'reproduction sociale' par le système scolaire (Bourdieu)","Grandes Écoles : ENA → INSP, Polytechnique, ENS, HEC, Sciences Po Paris — voie d'élite — classes préparatoires (CPGE)","Université : accès post-bac via Parcoursup — 2,7 millions d'étudiants — frais d'inscription modestes (170€/an) — selectivité croissante en master","APB → Parcoursup (2018) : algorithme de sélection — contestation des bacheliers professionnels, opacité des critères, stress de l'orientation","Réforme Blanquer (2018-2022) : dédoublement des classes de CP-CE1 en REP+, bac réformé, protocoles sanitaires Covid","Éducation prioritaire : REP+ (250 000 élèves), REP (1,1 million) — dotations supplémentaires — résultats encore très en retrait","Décrochage scolaire : 60 000 jeunes sans diplôme ni emploi par an — MOOC, école de la deuxième chance, garantie jeunes — enjeu social majeur"]},
  {id:38,premium:true,title:"Système de santé français",icon:"heart",color:"#E03535",items:["Modèle français : remboursement à l'acte (Assurance Maladie) + complémentaires santé — couverture universelle via PUMA (2016, ex-CMU)","Budget santé : 250 milliards d'euros/an (11,1% du PIB) — ONDAM (tranche annuelle votée au Parlement) — déficit structurel de l'assurance maladie","Hôpital public : 3 000 établissements — crise hospitalière chronique (manque de lits, sous-effectif, salaires insuffisants) — fermetures de services d'urgence","Déserts médicaux : 8 millions de Français sans médecin traitant — 45% de médecins généralistes ont plus de 55 ans — refus de secteur géographique obligatoire","Numerus clausus → numerus apertus (2020) : fin de la limitation stricte du nombre d'étudiants en médecine — effets attendus en 2030","Covid-19 en France : 161 000 morts officiels — 8 millions de personnes infectées — gestion critiquée (masques, vaccins, pass sanitaire, couvre-feux)","Espérance de vie : 82 ans (8e mondial) — écart de 13 ans entre un ouvrier et un cadre supérieur — inégalités sociales de santé majeures","Maladies chroniques : 12 millions d'ALD (Affections longue durée) — diabète (4 millions), cancer (400 000 nouveaux cas/an), maladie de l'obésité (17%)","Prévention : plan national nutrition santé, vaccinations obligatoires (11 depuis 2018), campagnes anti-tabac — tabagisme 1re cause de décès évitable","Enjeux futurs : vieillissement de la population, maladies émergentes (mpox), résistance antibiotiques, IA dans le diagnostic, financement des EPHAD"]},
  {id:39,premium:true,title:"Énergie mondiale et géopolitique",icon:"zap",color:"#D97706",items:["Mix énergétique mondial : pétrole (31%), charbon (27%), gaz naturel (23%), nucléaire (5%), hydraulique (7%), solaire+éolien (7%) — transition en cours mais fossiles dominants","OPEP+ : 13 membres OPEP + Russie + alliés = 40% de la production mondiale de pétrole — décisions de coupes de production comme levier géopolitique","Peak Oil demand : AIE prévoit un pic de la demande pétrolière avant 2030 — transition mais 100 millions de barils/jour consommés encore en 2024","Gaz naturel liquéfié (GNL) : révolution des terminaux flottants — USA 1er exportateur mondial depuis 2023 — remplace partiellement le gaz russe","Crise énergétique européenne 2022 : rupture avec le gaz russe (Nord Stream sabotage, sept. 2022) — prix du gaz ×10 — plan d'urgence UE — résilience retrouvée en 2023","Nucléaire : 440 réacteurs dans 33 pays — France (70% électricité), USA (19%), Chine (5% mais programme d'expansion majeur) — sécurité (Fukushima 2011)","Renouvelables : coût du solaire divisé par 90% en 10 ans — 4 900 GW installés en 2023 — intermittence et stockage comme défis majeurs","Minéraux critiques : lithium (VE), cobalt (batteries), terres rares (éoliennes, puces) — Chine contrôle 60% de la production et 85% du raffinage mondial","Hydrogène vert : solution d'avenir pour décarboner l'industrie lourde — coûts encore 3x supérieurs à l'hydrogène fossile — stratégie européenne","Transition énergétique : 5 000 milliards d'euros d'investissements annuels nécessaires selon l'AIE — fossiles encore subventionnés à hauteur de 7 000 Mds$ (FMI, 2023)"]},
  {id:40,premium:true,title:"Populisme et démocraties illibérales",icon:"vote",color:"#E03535",items:["Définition populisme (Laclau) : construction rhétorique d'un 'peuple vertueux' contre une 'élite corrompue' — ni droite ni gauche intrinsèquement","Populisme de droite : anti-immigration, nationalisme, euroscepticisme, conservatisme des mœurs — Trump (USA), Meloni (Italie), Le Pen (France), Orbán (Hongrie)","Populisme de gauche : anti-austérité, critique du capital financier, souveraineté populaire — Podemos (Espagne), La France Insoumise, Syriza (Grèce)","Démocratie illibérale (Fareed Zakaria, 1997) : élections libres + érosion des contre-pouvoirs — Orbán en Hongrie comme modèle théorisé","Hongrie sous Orbán : médias sous contrôle, justice dépendante, rejet des ONG, loi 'anti-LGBTQ', frontières fermées — procédure d'infraction UE (art. 7)","Pologne PiS (2015-2023) : réforme judiciaire controversée, contrôle des médias publics, politique anti-migrants — renversement par Tusk (2023)","Brésil sous Bolsonaro (2019-2022) : déforestation augmentée, attaque des institutions, déni du Covid, choc Jan. 2023 (assaut du Parlement)","Trump et les institutions américaines : 4 inculpations, tentative de renversement du 6 janvier 2021, réélection 2024 — test du système des checks and balances","Populisme et réseaux sociaux : amplification des discours simplistes, désinformation, bulle de filtre — Facebook et polarisation politique","Résistance démocratique : Espagne (Podemos intégré sans érosion), France (système de partis qui résiste), UE (mécanismes de conditionnalité budgétaire)"]},
  {id:41,premium:true,title:"Mondialisation et inégalités",icon:"globe",color:"#2B78F5",items:["Mondialisation définie : intégration économique mondiale via les échanges de biens, services, capitaux, personnes et idées — accélération depuis 1990","Mesure des inégalités : coefficient de Gini (0 = parfaite égalité, 1 = inégalité absolue) — mondial : ~0,70 (très inégalitaire) — France : ~0,29 après redistribution","1% vs 99% : Oxfam 2023 — le 1% le plus riche mondial possède 43% de la richesse — les 5 hommes les plus riches ont doublé leur fortune depuis 2020","Gagnants : pays émergents (Chine, Inde, Asie du SE) — réduction de la pauvreté extrême de 35% (1990) à 9% (2019) — classe moyenne mondiale","Perdants relatifs : classes ouvrières des pays développés — délocalisations industrielles, stagnation des salaires, 'rouille industrielle'","Globalisation financière : 5 500 milliards de dollars échangés par jour sur les marchés des changes — flux de capitaux 100x supérieurs aux échanges commerciaux","Paradis fiscaux : 10 000 milliards de dollars hors du circuit fiscal mondial (Zucman, 2015) — OCDE (BEPS) et règle de l'impôt minimum à 15% (2023, 140 pays)","Commerce et développement : thèse du 'commerce comme moteur' (BM, OMC) vs critique de l'exploitation des pays pauvres (Dépendance, Wallerstein)","Covid et inégalités : les 1 000 milliardaires ont récupéré leurs pertes en 9 mois — 100 millions de personnes replongées dans la pauvreté extrême","Backlash contre la mondialisation : protectionnisme Trump, Brexit, défiance envers les accords commerciaux (CETA, TTIP) — retour des politiques industrielles nationales"]},
  {id:42,premium:true,title:"Droit européen",icon:"flag",color:"#D97706",items:["Primauté du droit UE : arrêt Van Gend en Loos (CJUE, 1963) et Costa c. ENEL (1964) — le droit communautaire prime sur le droit national même constitutionnel","Effet direct : les particuliers peuvent invoquer les règlements et directives claires devant leurs tribunaux nationaux — principe Van Gend en Loos","Sources du droit UE : droit primaire (traités, protocoles, Charte des droits fondamentaux) + droit dérivé (règlements, directives, décisions)","Règlement vs directive : règlement directement applicable dans tous les États ; directive impose un objectif mais laisse le choix des moyens (transposition)","CJUE (Luxembourg) : interprète le droit européen — renvoi préjudiciel (art. 267 TFUE) — arrêts contraignants pour les 27 États","Commission : gardienne des traités — peut lancer des procédures d'infraction — recours en manquement — astreintes (Espagne, Grèce condamnées)","Marché intérieur : 4 libertés (marchandises, services, capitaux, personnes) — 450 millions de consommateurs — premier marché unique au monde","Concurrence : interdiction des ententes (art. 101) et des abus de position dominante (art. 102) — contrôle des concentrations (fusions) — Google, Apple, Amazon condamnés","Aides d'État : interdiction des subventions qui faussent la concurrence — exceptions (R&D, services d'intérêt général) — tension avec les politiques industrielles","Subsidiarité (art. 5 TUE) : l'UE n'agit que si l'objectif peut mieux être atteint au niveau européen qu'au niveau national — principe de proportionnalité"]},
  {id:43,premium:true,title:"Renseignement et espionnage",icon:"shield",color:"#7C3AED",items:["Services français : DGSE (extérieur, ~7 000 agents), DGSI (intérieur, contre-espionnage, contre-terrorisme), DRSD (armée), DNRED (douanes), TRACFIN (finances)","NSA et PRISM (révélations Snowden, 2013) : surveillance massive des communications mondiales par les USA — 70 000 pages de documents révélés — Snowden en exil à Moscou","Five Eyes : alliance de renseignement anglophone (USA, UK, Canada, Australie, NZ) — partage d'informations en temps réel — infrastructure mondiale de surveillance SIGINT","HUMINT vs SIGINT : renseignement humain (agents sur le terrain, infiltration) vs renseignement électronique (écoutes, satellites, cyberespionnage)","Opération Barkhane et renseignement : drones Reaper pour la surveillance, ROEM (renseignement d'origine électromagnétique) au Sahel","Cyberespionnage : Stuxnet (USA-Israël vs Iran, 2010) — APT29 (Fancy Bear russe) — opérations en cours contre les infrastructures critiques","Loi Renseignement française (2015) : surveillance élargie sans contrôle judiciaire a priori — CNCTR (Commission nationale de contrôle) — bilan critique de la CNCDH","Services étrangers : CIA (USA), MI6 (UK), Mossad (Israël), FSB et SVR (Russie), MSS (Chine) — réseaux d'agents dans les ambassades, entreprises, universités","Assassinats ciblés : doctrine américaine (drones en Irak, Afghanistan, Syrie) — Israël (ingénieurs nucléaires iraniens) — légalité internationale très contestée","Contre-espionnage : affaires de taupes (Aldrich Ames CIA 1994, Robert Hanssen FBI 2001) — opérations d'influence (ingérence électorale, fake news)"]},
  {id:44,premium:true,title:"Géopolitique de l'eau",icon:"globe",color:"#2B78F5",items:["Ressource rare : 97% de l'eau terrestre est salée — 2,5% eau douce dont 70% gelée dans les glaciers — 1% disponible pour les besoins humains","Stress hydrique : 4 milliards de personnes vivent dans des zones de stress hydrique sévère au moins 1 mois par an (ONU) — 5 milliards d'ici 2050","Conflits de l'eau : 'les guerres de l'eau du XXIe siècle' — Nil (Éthiopie-Égypte-Soudan, barrage GERD), Jourdain (Israël-Jordanie-Palestine), Indus (Inde-Pakistan)","Barrage de la Renaissance éthiopien (GERD) : plus grand barrage d'Afrique — Éthiopie vs Égypte et Soudan — impasse diplomatique depuis 2011","Aquifères fossiles : nappe phréatique du Sahara (Système Aquifère des Grès de Nubie), Ogallala (USA) — extraction non renouvelable","Privatisation de l'eau : Suez et Veolia (France) — controverses sur la marchandisation d'un bien commun — Cochabamba (Bolivie, 2000) comme symbole de résistance","Droit humain à l'eau : reconnu par l'ONU en 2010 (résolution 64/292) mais non contraignant — 2 milliards sans eau potable à domicile (OMS-UNICEF)","Désalinisation : solution technique mais coûteuse et énergivore — Arabie Saoudite, Émirats, Israël — avantages des pays pétroliers","Changement climatique : modification du cycle de l'eau — sécheresses plus longues, pluies torrentielles, fonte des glaciers alpins (eau stockée)","Solutions de gouvernance : ONU-Eau, traités bilatéraux sur 276 bassins transfrontaliers partagés — Commission internationale des fleuves comme modèle"]},
  {id:45,premium:true,title:"Diplomatie multilatérale",icon:"users",color:"#16A34A",items:["ONU et ses organes : Assemblée générale (1 État = 1 voix), Conseil de sécurité (P5 + 10 élus), ECOSOC, CIJ, CPI, Secrétariat — 193 membres","G7 : 7 pays les plus industrialisés (USA, UK, France, Allemagne, Italie, Japon, Canada) + UE — 45% du PIB mondial nominale — coordination sur économie, sécurité, sanctions","G20 : créé en 1999, 85% du PIB mondial — forum principal depuis la crise 2008 — Inde présidence 2023 (New Delhi), Brésil présidence 2024","Négociations climatiques : COP (Conférence des Parties à la CCNUCC) — 196 parties — Accord de Paris (2015) — mécanisme NDC et bilan mondial","OMC et règlement des différends : Organe de règlement des différends — procédures de panels et d'appel — appel paralysé depuis 2020","Organisations régionales : UA, UE, ASEAN, OEA, LA, OTAN, OCS — multiplication des forums régionaux","Diplomatie économique : BRI (Initiative de la ceinture et la route) — FMI (conditionnalité) — Banque mondiale — institutions de Bretton Woods réformables","Sanctions internationales : unilatérales (USA, UE) ou multilatérales (CS ONU) — Iran, Russie, Corée du Nord — efficacité et contournement","Traités multilatéraux : TNP (non-prolifération nucléaire), Ottawa (mines antipersonnel), Rome (CPI) — USA non parties à de nombreux traités","Avenir du multilatéralisme : fragmentation Nord-Sud, BRICS vs G7, blocage par le veto au CS — réforme des institutions internationales en débat depuis 2005"]},
  {id:46,premium:true,title:"Démocratie comparée",icon:"vote",color:"#2B78F5",items:["Systèmes électoraux : proportionnel (Pays-Bas, Israël) — majoritaire uninominal à 2 tours (France) — mixte (Allemagne, Japon) — effets sur la représentativité et la gouvernabilité","Régimes politiques : présidentiel (USA — séparation stricte), semi-présidentiel (France), parlementaire (UK, Allemagne), fédéral (USA, Allemagne)","Westminster vs modèle continental : bipartisme britannique (FPTP) vs proportionnalité et coalitions (Allemagne, Pays-Bas, Belgique)","Fédéralisme : USA (10e amendement), Allemagne (Bundesrat), Suisse (cantons), Inde (États) — dévolution des pouvoirs aux entités subnationales","Démocraties consolidées : Scandinavie en tête de l'Indice de Démocratie (EIU) — critères : élections libres, libertés civiles, fonctionnement du gouvernement, participation","Recul démocratique mondial : Freedom House — 2023 : 17e année consécutive de recul des libertés dans le monde — Turquie, Hongrie, Inde dégradées","Démocraties directes : Suisse (référendums fréquents), initiative citoyenne (Italie, Allemagne) — France : RIP (référendum d'initiative partagée) peu utilisé","Participation politique : abstention en hausse (France : 54% aux législatives 2022) — nouvelles formes (pétitions, manifestations, hacktivisme)","Systèmes hybrides : élections formelles mais non compétitives — Russie, Chine, Iran — 'démocratie de façade' selon les ONG","Financement des partis : public (France : montant proportionnel aux voix) — privé (USA : super PAC, lobbies) — risque de corruption et de capture"]},
  {id:47,premium:true,title:"Relations franco-africaines",icon:"globe",color:"#D97706",items:["Héritage colonial : France colonise l'AOF (Afrique occidentale française), AEF, Madagascar, Maghreb — 1960 : année des indépendances (17 États)","Françafrique : réseau politico-économique post-indépendances — Jacques Foccart conseiller de De Gaulle — soutien aux régimes amis (Houphouët-Boigny, Bongo)","Accords de défense : France maintient des bases militaires dans 8 pays africains — Dakar, Abidjan, Libreville, N'Djamena, Djibouti — 6 000 soldats","Franc CFA : deux zones monétaires (UEMOA et CEMAC) — 15 pays — arrimage à l'euro — débat sur la souveraineté monétaire — réforme annoncée avec l'Éco (report sine die)","Opérations militaires : Serval (Mali 2013) → Barkhane (2014-2022) → retrait suite aux coups d'État — retrait de toutes les bases au Sahel d'ici 2025","Crise des coups d'État : Mali (2021), Guinée (2021), Burkina Faso (2022), Niger (2023), Gabon (2023) — tournant anti-français dans l'opinion publique africaine","Nouveau partenariat : discours Macron de Ouagadougou (2017) puis Kinshasa (2022) — 'partenariat d'égal à égal' — rejet par les juntes sahéliennes","AFD (Agence française de développement) : 14 milliards d'euros d'engagements/an — aide au développement comme instrument de soft power","Compétition des influences : Russie (Wagner/Africa Corps), Chine (FOCAC, investissements), Turquie (armement), EAU (ports) — départ de la France","Diasporas africaines en France : 1,5 million de personnes d'origine africaine subsaharienne — transferts financiers (17 Mds€/an) > aide publique au développement"]},
  {id:48,premium:true,title:"Sciences politiques — théories",icon:"star",color:"#7C3AED",items:["Relations Internationales : réalisme (Morgenthau, Waltz) vs libéralisme (Kant, Nye) vs constructivisme (Wendt) vs école critique (Cox, Gramsci)","Réalisme : les États sont les acteurs centraux, anarchie internationale, intérêt national, puissance comme objectif — 'l'homme est un loup pour l'homme' (Hobbes)","Libéralisme internationaliste : interdépendance, institutions, paix démocratique (les démocraties ne se font pas la guerre) — Kant ('La paix perpétuelle', 1795)","Constructivisme (Wendt, 1992) : 'l'anarchie est ce que les États en font' — les identités et normes construisent les intérêts — culture stratégique","Néoréalisme (Waltz, 1979) : structure du système international (distribution des capacités) détermine le comportement des États — bipolarité vs multipolarité","Théorie de la transition de puissance (Organski, 1958) : guerres résultent du rattrapage d'une puissance montante sur la puissance dominante — Thucydide Trap","Analyse des politiques publiques : cycle des politiques publiques (agenda, formulation, décision, mise en œuvre, évaluation) — acteurs, institutions, idées","Gouvernance globale : régimes internationaux (Krasner) — règles, normes, principes — régimes climatiques, commerciaux, financiers","Méthodes en sciences politiques : quantitatif (statistiques électorales), qualitatif (études de cas), comparatif (Mill — variable dépendante/indépendante)","Grands auteurs à connaître : Aristote, Machiavel, Hobbes, Locke, Rousseau, Montesquieu, Marx, Weber, Rawls, Habermas, Waltz, Morgenthau, Keohane, Nye"]},
  {id:49,premium:true,title:"Cybersécurité et guerre numérique",icon:"zap",color:"#E03535",items:["Cyberespace : 5e domaine opérationnel militaire (OTAN, 2016) après la terre, la mer, l'air et l'espace — 26 000 cyberattaques/heure dans le monde","Types d'attaques : DDoS (déni de service), ransomware, phishing, espionnage APT, sabotage des infrastructures critiques (SCADA)","Attaques majeures : Stuxnet (2010, centrales nucléaires iraniennes), NotPetya (2017, Maersk, 10 Mds$), SolarWinds (2020, agences US), Colonial Pipeline (2021)","Acteurs étatiques : APT28/Fancy Bear et APT29/Cozy Bear (Russie), APT41 (Chine), Lazarus Group (Corée du Nord) — attribution difficile","ANSSI : Agence nationale de la sécurité des systèmes d'information — protection des OIV (Opérateurs d'importance vitale) — ~400 incidents traités/an","Droit international du cyberespace : Tallinn Manual (OTAN, 2013-2017) — tentative d'application du droit international humanitaire au cyberespace","Ransomware : logiciel malveillant chiffrant les données, rançon en cryptomonnaie — hôpitaux (Dax 2021, centre hospitalier de Versailles 2022), collectivités","Guerre cognitive/informationnelle : manipulation de l'information, désinformation, opérations d'influence — Russie (IRA, Internet Research Agency) — élections","IA et cybersécurité : génération automatique de malwares, deepfakes, hallucinations des modèles — mais aussi détection automatisée des anomalies","Régulation : NIS2 (directive européenne 2022) — obligations pour les entités essentielles et importantes — certification, notification d'incidents sous 24h"]},
  {id:50,premium:true,title:"Histoire de la construction européenne",icon:"flag",color:"#2B78F5",items:["Origines : réconciliation franco-allemande après 3 guerres en 70 ans — vision de Schuman, Monnet, Adenauer — Déclaration Schuman (9 mai 1950)","CECA (1951) : Communauté européenne du charbon et de l'acier — mise en commun des industries de guerre — 6 membres fondateurs (France, Allemagne, Italie, Benelux)","Traité de Rome (25 mars 1957) : CEE (marché commun) + Euratom — objectif : 'union sans cesse plus étroite' — entré en vigueur 1er jan. 1958","Crises et progrès : chaise vide de De Gaulle (1965-66), compromis de Luxembourg (unanimité maintenue) — premier élargissement (UK, Irlande, Danemark, 1973)","Acte Unique Européen (1986) : achèvement du marché intérieur — vote à la majorité qualifiée élargi — programme '1992'","Traité de Maastricht (1992) : création de l'UE (3 piliers), euro, PESC, citoyenneté européenne — ratification difficile (Danemark Non, France 51% Oui)","Euro : décision 1992, convergence 1993-1998, billets et pièces jan. 2002 — 12 puis 20 membres — BCE à Francfort","Traité de Lisbonne (2009) : abandon de la Constitution (Non français et néerlandais en 2005) — Haute représentante pour les affaires étrangères, personnalité juridique","Crises de l'UE : crise de la zone euro (2010-2015), crise des réfugiés (2015-16), Brexit (2016-2020), Covid (divergences puis NGEU), Ukraine (réponse unifiée)","Élargissements : de 6 à 27 membres (Grèce 81, Espagne+Portugal 86, Autriche+Finlande+Suède 95, est et centre 2004-2007, Bulgarie+Roumanie 2007, Croatie 2013, Brexit -1 2020)"]},
  {id:51,premium:true,title:"Environnement et biodiversité",icon:"globe",color:"#16A34A",items:["6e extinction de masse : taux d'extinction actuel 100 à 1 000x plus élevé qu'avant l'ère industrielle — 1 million d'espèces menacées (IPBES 2019)","Biodiversité mondiale : ~8,7 millions d'espèces identifiées sur ~1 milliard estimées — forêts tropicales hébergent 50% des espèces terrestres","Causes de l'érosion : destruction des habitats (agriculture, urbanisation), surexploitation (pêche, chasse), espèces invasives, pollution, changement climatique","Accord de Kunming-Montréal (COP15 Biodiversité, déc. 2022) : 30x30 (30% des terres et mers protégées en 2030) — 196 parties — financement des pays du Sud","Océans : récifs coralliens (50% détruits depuis 1950), zones mortes (+700), microplastiques (5 000 milliards de particules en mer), acidification (+30% depuis 1750)","Forêts tropicales : Amazonie (60% au Brésil), Bassin du Congo (2e poumon), Bornéo — déforestation pour l'agriculture, l'élevage, le soja, le palmier à huile","Sols : 33% dégradés dans le monde — érosion, salinisation, imperméabilisation — 1 cm de sol fertile = 100 ans de formation","Pollinisateurs : -30% d'abeilles et de bourdons en Europe depuis 1990 — menace sur 75% des cultures alimentaires mondiales — néonicotinoïdes","Solutions : aires marines protégées, corridors écologiques, agriculture régénératrice, rewilding, paiements pour services environnementaux","France et biodiversité : stratégie nationale pour la biodiversité 2030, Office français de la biodiversité (OFB), zones Natura 2000 (13% du territoire)"]},
  {id:52,premium:true,title:"Sociologie des organisations",icon:"users",color:"#7C3AED",items:["Bureaucratie (Weber, 1922) : autorité légale-rationnelle, hiérarchie, règles formelles, spécialisation — modèle dominant des grandes organisations modernes","Taylorisme (1911) : organisation scientifique du travail — décomposition des tâches, contrôle des temps — application à Ford (fordisme, chaîne de montage 1913)","École des relations humaines : Elton Mayo (expériences de Hawthorne, 1927-1932) — la productivité dépend aussi des relations sociales, pas seulement des conditions physiques","Théorie des organisations : Fayol (fonctions de l'entreprise), Mintzberg (6 configurations organisationnelles), Crozier (acteur et système)","Crozier et Friedberg ('L'Acteur et le Système', 1977) : les acteurs organisationnels ont des stratégies propres — zones d'incertitude — jeux de pouvoir","Entreprise et société : RSE (Responsabilité sociale des entreprises) — reporting extra-financier (ESG) — stakeholder theory (Freeman, 1984) vs shareholder primacy","New Public Management (NPM) : réformes des années 1980-2000 — transposer les méthodes du privé au secteur public — LOLF, indicateurs de performance, agences","Organisations en réseau et plateforme : nouveau modèle de gouvernance — Uber, Amazon — externalisation, indépendants, algorithme comme manager","Culture organisationnelle : valeurs, rites, mythes, symboles — Hofstede (dimensions culturelles) — impact sur les performances et les fusions-acquisitions","Nouvelles formes de travail : télétravail (30% des emplois compatibles), flex office, management agile, holocratie — transformations post-Covid"]},
  {id:53,premium:true,title:"Éthique et philosophie morale",icon:"star",color:"#D97706",items:["Grandes théories éthiques : déontologie (Kant — impératif catégorique), conséquentialisme/utilitarisme (Bentham, Mill — maximiser le bonheur), vertu (Aristote — eudaimonia)","Impératif catégorique (Kant) : 'Agis uniquement d'après la maxime grâce à laquelle tu peux vouloir en même temps qu'elle devienne une loi universelle'","Utilitarisme (Bentham, 1789) : le plus grand bonheur du plus grand nombre — calcul hédoniste — critique des droits individuels sacrifiés à la majorité","Éthique de la vertu (Aristote) : les vertus (courage, prudence, justice, tempérance) s'acquièrent par la pratique — phronesis (sagesse pratique)","Éthique du care (Gilligan, 1982, Noddings) : attention aux relations, à la vulnérabilité, à la responsabilité envers autrui — féministe — alternative aux éthiques universalistes","Bioéthique : enjeux éthiques de la médecine et des biotechnologies — 4 principes de Beauchamp et Childress (autonomie, bienfaisance, non-malfaisance, justice)","Éthique environnementale : Hans Jonas ('Le Principe responsabilité', 1979) — 'agis de façon que les effets de ton action soient compatibles avec la permanence d'une vie humaine authentique'","Éthique appliquée : IA et responsabilité algorithmique, CRISPR et modification du génome, euthanasie (légalisée en France par la loi sur la fin de vie 2024), peine de mort","Relativisme moral vs universalisme : les normes sont-elles universelles (DUDH) ou culturellement relatives (anthropologie culturelle) ? — tension ONU vs États souverains","Éthique des affaires : corruption, conflits d'intérêts, responsabilité des dirigeants — affaires Enron (2001), Dieselgate (2015), scandales financiers comme cas d'école"]},
  {id:54,premium:true,title:"Économie du développement",icon:"bar",color:"#16A34A",items:["Indicateurs : PIB par habitant (croissance économique) vs IDH (Indice de Développement Humain : longévité, éducation, revenu) vs MPI (pauvreté multidimensionnelle)","Pays les moins avancés (PMA) : 46 pays selon l'ONU — critères : revenu, vulnérabilité humaine, capacités humaines — accès préférentiel aux marchés et à l'aide","Théories du développement : modernisation (Rostow, 5 stades) vs dépendance (Prebisch, Frank, Wallerstein) — le développement du Tiers-Monde serait entravé par le Nord","Aide publique au développement (APD) : 204 milliards de dollars en 2023 (OCDE) — objectif ONU : 0,7% du RNB — France : 0,56% en 2022","Consensus de Washington (1989) : privatisation, libéralisation, rigueur budgétaire — critiqué après les crises asiatiques (1997) et latino-américaines","Microfinance : Muhammad Yunus, Grameen Bank — prix Nobel de la Paix 2006 — accès au crédit pour les plus pauvres — bilan nuancé","Trappe à pauvreté : les plus pauvres n'ont pas accès aux ressources pour s'en sortir — interventions à grande échelle nécessaires (Sachs) vs doutes sur l'efficacité (Easterly)","Expérimentation (RCT) : Esther Duflo et Abhijit Banerjee, prix Nobel d'économie 2019 — évaluation rigoureuse des politiques de développement","Transition démographique : les pays pauvres passent d'une forte natalité/mortalité à une faible natalité/mortalité — 'dividende démographique' si bien géré","Chine et développement : modèle de croissance par les exportations, rôle de l'État — sort 800 millions de personnes de la pauvreté en 40 ans — modèle ou exception ?"]},
  {id:55,premium:true,title:"Droit international humanitaire",icon:"heart",color:"#E03535",items:["Origines : Henri Dunant (fondateur CICR) — Bataille de Solférino (1859) — 1re Convention de Genève (1864) — protection des blessés de guerre","Conventions de Genève (1949) : 4 conventions + 3 protocoles additionnels (1977, 2005) — ratifiées par 196 États — application universelle","Convention I : blessés et malades armées de terre","Convention II : blessés, malades et naufragés armées de mer","Convention III : prisonniers de guerre (POW) — interdiction de la torture, droit aux informations minimales, visite du CICR","Convention IV : protection des civils en temps de guerre — occupation militaire, internement, interdiction des punitions collectives","Droit de La Haye (moyens et méthodes de guerre) vs Droit de Genève (protection des victimes) — convergence progressive","Protocoles additionnels : Protocole I (conflits internationaux, protection civils), Protocole II (conflits internes), Protocole III (emblème cristal rouge)","Violations courantes : ciblage délibéré de civils, hôpitaux, journalistes — boucliers humains — armes à sous-munitions, mines antipersonnel","CICR : mandataire du DIH — accès aux prisonniers, aide humanitaire, rôle de médiateur — statut d'observateur permanent à l'ONU — neutralité absolue"]},
  {id:56,premium:true,title:"Partis politiques français",icon:"vote",color:"#2B78F5",items:["Système actuel : fragmenté — pas de bipartisme stable depuis 2017 — 3 blocs (gauche NUPES/NFP, centre LREM/Ensemble, droite RN+LR)","La France Insoumise (Mélenchon, 2016) : programme de rupture, sortie de l'UE remplacée par 'désobéissance', retraite à 60 ans, 6e République","Parti Socialiste : fondé 1969 (congrès d'Épinay 1971, Mitterrand) — 2 mandats présidentiels (1981-95, 2012-17) — affaibli depuis 2017 (6% aux législatives 2022)","Les Écologistes/EELV : fondé 1984 (Génération Verte) — Jadot (12% présidentielle 2022) — coalition avec LFI (NUPES) — enjeu : autonomie ou fusion de la gauche","Parti communiste français (PCF) : fondé 1920 (Tours) — 20% dans les années 1950 → 2,3% en 2022 — maintient des élus locaux et des députés","Renaissance (ex-LREM) : parti d'Macron fondé 2016 — centre libéral-social — 2 présidences (2017, 2022) — base parlementaire en baisse","MoDem (Bayrou, 2007) et Horizons (Philippe, 2021) : alliés du centre — coalition Ensemble — appoints au groupe présidentiel","Les Républicains (LR) : héritiers du gaullisme via RPR — Sarkozy (2007-12) — 5% aux présidentielles 2022 — scission (Ciotti vers RN 2024)","Rassemblement National (ex-FN, refondé 2018) : Le Pen → Marine Le Pen → Bardella — 1er parti en voix aux législatives 2022 et 2024 — cordons sanitaires","Nouveau Front Populaire (2024) : union de la gauche (LFI, PS, PCF, EELV) — 193 sièges — premier groupe à l'Assemblée nationale — tension interne autour du PM"]},
  {id:57,premium:true,title:"Élections et systèmes électoraux",icon:"vote",color:"#7C3AED",items:["Scrutin uninominal majoritaire à 2 tours : France (législatives, présidentielle) — fort en circonscriptions, déformation entre voix et sièges — favorise les grands partis","Scrutin proportionnel : Pays-Bas, Israël, Espagne — représentativité maximale — tend à produire des coalitions — risque d'instabilité","Scrutin mixte (MMP) : Allemagne — proportionnelle personnalisée — 299 circonscriptions + 299 listes — résultat proportionnel avec ancrage local","Présidentielle française : 2 tours — 1er tour pluraliste, 2e tour duel — 'vote utile' dès le 1er tour — cohabitation possible","Financement des partis en France : aide publique (1re fraction : résultats aux législatives ; 2e : élus) + dons plafonnés + prêts — CNCCFP contrôle","Participation : abstention structurelle (plus forte chez les jeunes, pauvres, non-diplômés) — vote obligatoire (Belgique, Australie) : +20% de participation","Fraude électorale : bourrage d'urnes, achats de votes, gerrymandering (USA) — OSCE surveille les élections dans 50 pays","Référendum : consultatif (UK Brexit 2016) vs contraignant — quorum, seuil de validité — risque de plébiscite personnel (de Gaulle 1969)","Élections numériques : vote par internet (Estonie 25% des voix en ligne) — risques cybersécurité — débat sur fiabilité vs accessibilité","Règle électorale et représentation des femmes : quotas (France, parité depuis 2000), sièges réservés (Rwanda : 61% de femmes au Parlement) — impact sur la représentativité"]},
  {id:58,premium:true,title:"Économie comportementale",icon:"bar",color:"#D97706",items:["Origines : Kahneman et Tversky ('Prospect Theory', 1979) — les individus ne sont pas rationnels — biais cognitifs dans les décisions économiques","Système 1 vs Système 2 (Kahneman, 'Thinking, Fast and Slow', 2011) : pensée rapide/automatique/intuitive vs lente/délibérée/rationnelle","Biais d'ancrage : la première information reçue influence les jugements ultérieurs — exemple : prix de départ lors d'une négociation","Aversion à la perte : la douleur d'une perte est 2x plus forte que le plaisir d'un gain équivalent — impact sur les décisions financières et d'investissement","Effet de dotation : on surestime ce qu'on possède — expériences avec des tasses (Thaler) — implication pour le statu quo","Nudge (Thaler et Sunstein, 2008) : 'coup de pouce' — modification de l'architecture du choix sans contrainte — don d'organes (opt-out), cafétérias scolaires","Thaler (prix Nobel 2017) : nudge, comptabilité mentale, plan d'épargne retraite automatique (SAVE MORE TOMORROW) aux USA","Prix Nobel comportementaux : Simon (1978, rationalité limitée), Kahneman (2002), Thaler (2017), Akerlof-Spence-Stiglitz (2001, asymétrie d'info)","Applications politiques : malus fiscaux vs nudge anti-tabac, assiette végane par défaut dans les cantines, formulaires de déclaration d'impôts pré-remplis","Limites : manipulation ? — débat éthique sur le paternalisme libertarien — les biais peuvent être exploités par le marketing et la propagande"]},
  {id:59,premium:true,title:"Francophonie",icon:"globe",color:"#16A34A",items:["Le français dans le monde : 321 millions de locuteurs quotidiens — 5e langue la plus parlée — officielle dans 32 États — 2e langue la plus apprise au monde","OIF (Organisation internationale de la Francophonie) : créée en 1970 (Niamey) — 88 États membres et observateurs — secrétaire général Louise Mushikiwabo (Rwanda, depuis 2019)","Sommets de la Francophonie : biennaux — Djerba 2022 — culture, démocratie, économie numérique comme thèmes prioritaires","Géographie : Afrique subsaharienne (50% des francophones), Maghreb (20%), Europe (25%), Amériques (5%) — croissance africaine majeure","TV5 Monde : 1re chaîne mondiale en français — 370 millions de foyers — financée par 6 gouvernements francophones","Institut français : réseau culturel officiel français — 26 pays (complétant les Alliances françaises dans d'autres)","Francophonie économique : la zone francophone représente ~16% du PIB mondial — échanges préférentiels","Enjeux : concurrence de l'anglais (sciences, affaires, internet) — plurilinguisme vs uniformisation — français comme langue de l'ONU et de l'UE","Francophonie politique : promotion de la démocratie et des droits de l'homme — mécanisme de suivi des Déclarations de Bamako (2000) et de Saint-Boniface (2006)","Débat sur la lingua franca : le français comme 'langue de la liberté et des droits de l'homme' vs l'anglais comme langue pragmatique internationale — bataille symbolique"]},
  {id:60,premium:true,title:"Russie contemporaine",icon:"globe",color:"#E03535",items:["Dissolution de l'URSS (1991) : 15 républiques indépendantes — Boris Eltsine — thérapie de choc économique — chaos des années 1990","Poutine au pouvoir : 2000 (1er mandat) — 2008-2012 (PM avec Medvedev) — 2012-2018 (2e et 3e mandat) — 2018-2024 (4e mandat, à vie depuis 2020)","Économie : hydrocarbures = 40% des recettes fédérales, 60% des exportations — PIB ~2 000 milliards de dollars (comparable à l'Espagne ou l'Italie) — malédiction des ressources","Gouvernance : élections non compétitives, médias contrôlés (RT, TASS, 1er Canal), société civile réprimée (loi 2012 sur les 'agents étrangers'), opposition muselée (Navalny)","Navalny : principal opposant — empoisonné au Novichok (2020) — condamné à 19 ans — décès en prison (fév. 2024) — mobilisation internationale","Politique étrangère poutinienne : restauration de la grandeur russe, zone d'influence post-soviétique (étranger proche), rejet de l'expansion OTAN","Annexions : Crimée (2014, 20 000 km², 2,4M habitants), Donbass auto-proclamé (2014), 4 régions ukrainiennes (septembre 2022, partiellement contrôlées)","Instruments de puissance : énergie (gazoduc Nord Stream), désinformation (IRA, Fancy Bear), armes (OTAN-Russie : -30% de l'export mondial pour Moscou), nucléaire","Économie de guerre (2023-2025) : PIB militaire dépasse 7% du budget — secteur des armements tire la croissance — mais pénuries de main-d'œuvre et inflation","Opposition interne : coup d'État Wagner (Prigojine, juin 2023, 24h) — mort suspecte de Prigojine (août 2023) — fragilités du système poutinien"]},
  {id:61,premium:true,title:"Inde, puissance émergente",icon:"globe",color:"#D97706",items:["Données : 1,44 milliard d'habitants (1e mondial depuis 2023) — superficie 3,3 millions km² — 28 États fédérés — 22 langues officielles — hindi + anglais","Économie : 5e mondiale (3 700 Mds$) — croissance +7%/an — passera Japon et Allemagne d'ici 2027 — secteur services dominant (IT, pharmacie, finance)","Politique : la plus grande démocratie au monde — système parlementaire fédéral — BJP de Narendra Modi (réélu 2024 en coalition) — Hindutva (nationalisme hindou)","Technologies : hub mondial de l'IT (Bangalore) — 1 million de développeurs formés/an — 'inde numérique' (UPI, Aadhar, DigiLocker) — licornes tech (>100)","Agriculture : 55% de la population (secteur primaire) — 1ère producteur de lait, 2e de riz et blé — dépendance aux moussons — sécurité alimentaire","Armée : 4e budget militaire mondial — forces nucléaires (150-160 têtes) — programme spatial (ISRO : sonde lunaire Chandrayaan-3, 2023 — 1ère sur le pôle sud lunar)","Relations extérieures : 'autonomie stratégique' — membre fondateur du Mouvement des non-alignés — BRICS + QUAD + OCS + G20 — équilibre USA-Russie","Caste et discrimination : 200 millions de Dalits (intouchables) — discrimination malgré les lois — réservations (25% des postes) — violences croissantes sous BJP","Inde-Chine : frontière himalayenne de 3 500 km — affrontements à Galwan (2020, 20 soldats indiens tués) — hostilité croissante","Inde-Pakistan : partition de 1947, 3 guerres, nucléaire des deux côtés, Cachemire divisé — tensions persistantes mais pas de guerre totale depuis 1971"]},
  {id:62,premium:true,title:"Chine, puissance mondiale",icon:"globe",color:"#E03535",items:["Données : 1,4 milliard d'habitants — 2e économie mondiale (18 000 Mds$) — 1e en PPA — superficie 9,6 millions km² — régime parti unique (PCC)","Xi Jinping : secrétaire général depuis 2012 — Président de la République depuis 2013 — reconduction sans terme (2022) — pensée de Xi inscrite dans la Constitution","Économie : modèle État + marché — investissements publics massifs — export-led growth — crise immobilière (Evergrande, 2021) — ralentissement post-Covid","Armée populaire de libération (APL) : 2 millions de soldats actifs — 3e budget militaire mondial (300 Mds$/an) — modernisation vers une 'armée de classe mondiale' en 2049","BRI (Belt and Road Initiative, Routes de la Soie, 2013) : 140 pays — 1 000 milliards investis — influence géopolitique et économique","Surveillance numérique : 700 millions de caméras — système de crédit social — filtrage internet (Grand Firewall) — contrôle de TikTok, WeChat","Xinjiang et Tibat : 1 million de Ouïghours dans des 'camps de rééducation' (USA parle de génocide) — restriction des droits religieux et culturels","Taïwan : ligne rouge absolue — 'réunification pacifique ou par la force' — exercices militaires massifs — 1re économie de semi-conducteurs (TSMC)","Relations USA-Chine : interdépendance commerciale (690 Mds$/an) + rivalité stratégique — Thucydide Trap — semi-conducteurs, IA, marine","Agenda 2049 : centenaire de la RPC — ambitions : première économie mondiale, armée la plus puissante, influence normative internationale — 'rêve chinois'"]},
  {id:63,premium:true,title:"Géopolitique spatiale",icon:"zap",color:"#7C3AED",items:["Course à l'espace 2.0 : après la rivalité USA-URSS, nouvelle compétition USA-Chine — 12 pays ont des capacités de lancement en 2024","Artemis Program (NASA) : retour sur la Lune (2025-2026) — objectif d'établir une présence permanente — coalition de 43 pays signataires des Accords Artemis","Programme lunaire chinois : Chang'e 5 (retour d'échantillons, 2020) — Chandrayaan-3 indien (pôle sud, 2023) — base lunaire sino-russe en projet","SpaceX (Elon Musk) : révolution des lanceurs réutilisables — Falcon 9 (5e lanceur mondial par fiabilité) — Starship (plus grande fusée jamais construite)","Starlink : 6 000 satellites en orbite basse — couverture mondiale d'internet — utilisé en Ukraine — révolution géopolitique de la connectivité","Droit spatial : Traité de l'Espace extra-atmosphérique (1967) — 'province de l'humanité' — pas de souveraineté nationale — lacunes sur l'exploitation des ressources","Militarisation de l'espace : OTAN reconnaît l'espace comme 5e domaine opérationnel (2019) — armes antisatellites (tests russe 2021, chinois 2007, indien 2019)","ISS (Station spatiale internationale) : 25 ans en orbite — coopération USA-Russie-Europe-Japon-Canada — fin prévue en 2030 — successeurs privés","Débris spatiaux : 35 000 objets trackés (+1 million > 1 cm) — risque Kessler (réaction en chaîne de collisions) — déorbitisation obligatoire","Enjeux futurs : extraction de ressources lunaires et astéroïdes (hélium-3, platine) — base permanente sur la Lune — premiers humains sur Mars (2030s selon Musk/NASA)"]},
  {id:64,premium:true,title:"Philosophie du droit",icon:"scale",color:"#2B78F5",items:["Droit naturel vs droit positif : le droit est-il fondé sur des principes moraux universels (Grotius, Locke) ou uniquement sur des normes posées par l'autorité (Kelsen, Hart) ?","Positivisme juridique (Kelsen, 'Théorie pure du droit', 1934) : pyramide des normes — le droit se valide par sa conformité à des normes supérieures — séparation droit/morale","Jusnaturalisme moderne : droits de l'homme comme droits naturels — DDHC 1789, DUDH 1948 — l'individu a des droits inaliénables antérieurs à tout État","École historique (Savigny, XIXe) : le droit exprime l'esprit du peuple (Volksgeist) — critique de la codification napoléonienne comme artificielle","Réalisme américain (Holmes, Llewellyn) : le droit est ce que les juges décident en pratique — importance du contexte social et économique","Herméneutique juridique : interprétation des textes juridiques — méthodes littérale, historique, téléologique, systémique — rôle créateur du juge","Justice formelle vs matérielle : égalité formelle (traiter pareillement des cas similaires) vs égalité réelle (résultats équitables malgré les inégalités de départ)","Droit et légitimité : une loi injuste doit-elle être respectée ? — désobéissance civile (Thoreau, Gandhi, King) — résistance à l'oppression (art. 2 DDHC)","Sanctions et fonctions du droit : rétribution (punir le coupable), dissuasion (prévenir les crimes futurs), réhabilitation (réinsérer) — débat peine de mort","Droit comme système : cohérence, complétude, absence de lacunes — le juge face aux silences de la loi (analogie, principes généraux du droit)"]},
  {id:65,premium:true,title:"Éducation civique et citoyenneté",icon:"users",color:"#16A34A",items:["Citoyenneté française : par le droit du sol (naissance en France) et du sang (filiation) — naturalisation après 5 ans de résidence légale","Droits et devoirs du citoyen : vote (droit-devoir) — impôts — service national (obligatoire jusqu'en 1996, SNU facultatif depuis 2019)","Engagement civique : associations (1,3 million en France) — bénévolat (22 millions de bénévoles) — syndicats (10% de taux de syndicalisation) — partis politiques","Instruction civique à l'école : EMC (Enseignement moral et civique) depuis 2015 — valeurs de la République, laïcité, droits de l'homme, citoyenneté","Démocratie participative : conseils de quartier, budgets participatifs (Paris : 100 millions d'euros/an), consultation publique (CNDP), grand débat national (2019)","Convention citoyenne pour le climat (2020) : 150 citoyens tirés au sort — 149 mesures — partiellement reprises par le gouvernement — modèle de démocratie délibérative","Défenseur des droits : autorité constitutionnelle — défend les usagers contre les administrations, les victimes de discriminations, les droits de l'enfant","Service national universel (SNU) : créé 2019 — séjour de cohésion de 2 semaines + mission d'intérêt général — 60 000 jeunes participants en 2023 — budget 600M€","Nationalité et apatridie : 12 millions d'apatrides dans le monde — Convention de 1954 sur le statut des apatrides — déchéance de nationalité (art. 25 Code civil, encadrée)","Figures de la citoyenneté : Jean Jaurès (citoyenneté sociale), Simone Veil (droits des femmes), Stéphane Hessel ('Indignez-vous !' 2010) — citoyenneté active"]},
  {id:66,premium:true,title:"Géopolitique indo-pacifique",icon:"globe",color:"#D97706",items:["Concept : terme popularisé par l'Inde (Modi, 2015) et les USA (Trump, 2017) — recouvre l'océan Indien + Pacifique Ouest — décentrement de la pensée géopolitique vers l'Asie","Enjeux économiques : 60% du PIB mondial, 65% du commerce mondial transitent dans cette zone — détroit de Malacca (80 000 navires/an), de Lombok, de la Sonde","QUAD (2007, relancé 2021) : USA, Inde, Japon, Australie — partage de renseignements, exercices navals — interprété comme endiguement de la Chine","AUKUS (septembre 2021) : USA, UK, Australie — sous-marins nucléaires pour l'Australie — rupture du contrat Naval Group français — tensions diplomatiques","Chine en Méditerranée indo-pacifique : bases à Djibouti, Port d'Hambantota (Sri Lanka), Gwadar (Pakistan) — collier de perles pour sécuriser les lignes d'approvisionnement","ASEAN : 10 membres, 680 millions d'habitants — 'centralité de l'ASEAN' — refus de choisir entre USA et Chine — forum ARF pour le dialogue de sécurité","Corée du Nord : programme nucléaire (50+ têtes estimées), missiles intercontinentaux (testés à Guam, États-Unis continentaux à portée) — impasse diplomatique","Japon : révision de la Constitution pacifiste (art. 9) en cours — loi de contre-attaque (capacité de frapper le territoire ennemi adoptée 2023) — budget défense doublé","Taiwan Strait : 180 km séparent Taïwan de la Chine continentale — 140 millions de passages de navires/an — TSMC (90% des puces 5nm mondiales)","Stratégie française : présence dans les DROM du Pacifique (Polynésie, Nouvelle-Calédonie, Réunion, Mayotte) — 7 000 militaires — libre navigation"]},
  {id:67,premium:true,title:"Droits numériques",icon:"zap",color:"#7C3AED",items:["RGPD (2018) : Règlement général sur la protection des données — droits des personnes (accès, rectification, effacement, portabilité) — DPO obligatoire pour les grandes organisations","CNIL : Commission nationale de l'informatique et des libertés — autorité de contrôle française — amendes (Google : 150 M€, Facebook : 60 M€)","Surveillance de masse : NSA et PRISM (Snowden 2013) — balayage des métadonnées — arrêt CJUE Schrems II (2020) : invalidation du Privacy Shield USA-UE","Identité numérique : FranceConnect (authentification publique) — eIDAS 2 (identité numérique européenne) — biométrie (empreintes, reconnaissance faciale) et risques","Liberté d'expression en ligne : modération algorithmique vs liberté — Section 230 (USA, immunité des plateformes) vs DSA européen (responsabilité accrue)","Droit à l'oubli : arrêt CJUE Google Spain (2014) — droit de demander la désindexation de résultats de recherche — 3 millions de demandes traitées par Google","Désinformation : DSA (très grandes plateformes — VLOPs > 45M utilisateurs/mois dans l'UE) — audit de risques systémiques, transparence algorithmique","Propriété intellectuelle numérique : droit d'auteur à l'ère du streaming (directive DANUM 2019) — article 17 (anciennement 13) : filtrage automatique des contenus","IA générative et droit : qui est propriétaire du contenu généré par l'IA ? — entraînement sur données protégées — litiges en cours (Getty Images vs Stable Diffusion)","Accès à internet : service d'intérêt économique général selon l'UE — fracture numérique (Nord vs Sud, rural vs urbain) — neutralité du net comme principe fondateur"]},
  {id:68,premium:true,title:"Économie verte et transition",icon:"globe",color:"#16A34A",items:["Économie verte : croissance économique compatible avec la durabilité environnementale — secteur des énergies renouvelables, économie circulaire, écologie industrielle","Taxonomie européenne : classification des activités économiques durables (2020) — financement vert — inclut le nucléaire et le gaz sous conditions ('vert clair')","Inflation Reduction Act (USA, 2022) : 369 milliards de dollars de crédits d'impôts pour les énergies propres — véhicules électriques, solaire, hydrogène — 'éco-protectionnisme'","Pacte vert européen (Green Deal) : neutralité carbone 2050, -55% émissions 2030 — 'Fit for 55' — investissements de 600 milliards d'euros annuels","MACF (Mécanisme d'ajustement carbone aux frontières) : en vigueur depuis 2026 — taxe sur les importations à forte empreinte carbone — acier, aluminium, ciment","Économie circulaire : réduire, réutiliser, recycler — éco-conception, réparabilité obligatoire (indice de réparabilité France depuis 2021) — fast fashion réglementée","Hydrogène vert : électrolyse de l'eau avec de l'électricité renouvelable — décarboner l'acier, le ciment, l'aviation, la chimie — coûts encore 3x trop élevés","Finance verte : 1 000 milliards d'obligations vertes émises en 2023 — labels ESG — greenwashing sous surveillance (AMF, ESMA)","Carbon pricing : taxe carbone (France : 44,6€/tonne CO2) ou marché d'émissions (ETS européen : 60-70€/tonne) — signal-prix pour décarboner","Emplois verts : 13 millions emplois dans les énergies renouvelables mondiales (IRENA, 2023) — transition juste pour les travailleurs des industries fossiles"]},
  {id:69,premium:true,title:"Droits sociaux et État-providence",icon:"heart",color:"#E03535",items:["État-providence : naissance avec Bismarck (Allemagne, 1880s) et Beveridge (UK, 1942) — 5 risques couverts : maladie, vieillesse, chômage, famille, accidents du travail","Modèles welfare (Esping-Andersen, 1990) : libéral (USA, UK — filet de sécurité minimal), social-démocrate (Scandinavie — universel et généreux), conservateur-corporatiste (France, Allemagne)","Sécurité sociale française : fondée 1945 (ordonnances Laroque) — financement par cotisations — assurance maladie, retraite, famille, accidents — partenaires sociaux","Protection sociale française : 33% du PIB — retraites (14%), maladie (8%), famille (2%), chômage (2%), logement (2%), pauvreté (2%)","Retraites 2023 : réforme portant l'âge légal à 64 ans — mobilisation sociale intense (12 journées de grèves) — validée par le Conseil constitutionnel malgré le 49-3","Assurance chômage : réforme 2021 puis 2024 — dégressivité des allocations — conditionnalité liée aux offres d'emploi refusées — taux de chômage 7% en 2024","Minima sociaux : RSA (494 €/mois pour une personne seule) — AAH (allocation adulte handicapé) — ASPA (solidarité personnes âgées) — prime d'activité","Droit au logement : DALO (Droit au logement opposable, 2007) — 91 000 ménages reconnus prioritaires mais non relogés (2023) — logement social : 4,9 millions HLM","Services publics universels : école, hôpital, La Poste, EDF (missions de service public) — tension entre libéralisation européenne et service public à la française","Débat sur le financement : vieillissement de la population — ratio actifs/retraités en baisse — réforme des retraites, capitalisation partielle, épargne salariale"]},
  {id:70,premium:true,title:"Relations Asie du Sud-Est",icon:"globe",color:"#D97706",items:["ASEAN (1967) : 10 membres — 680 millions d'habitants — 3,6 trillions de dollars de PIB — principe de non-ingérence, consensus, 'centralité de l'ASEAN'","Membres : Birmanie, Thaïlande, Laos, Cambodge, Vietnam, Philippines, Malaisie, Brunei, Singapour, Indonésie — tous des régimes très différents","Birmanie/Myanmar : coup d'État militaire (1er fév. 2021) — Aung San Suu Kyi emprisonnée — 2 millions de déplacés internes — génocide Rohingya (2017)","Vietnam : République socialiste mais économie de marché ('Doi Moi' depuis 1986) — hub mondial de l'électronique (Samsung) — +7% de croissance — relations normalisées avec USA (2023)","Philippines (Marcos Jr., 2022) : mer de Chine méridionale (arrêt CPA 2016 ignoré par Chine) — collisions avec des navires chinois en 2024 — rapprochement avec les USA","Indonésie : 4e pays le plus peuplé (280 millions) — 1ère économie ASEAN — Prabowo Subianto élu 2024 — ressources naturelles (nickel, or, huile de palme)","Singapour : cité-État modèle — PIB/habitant = 82 000 $ (8e mondial) — hub financier, logistique, technologique — régime semi-autoritaire","Thaïlande : monarchie constitutionnelle — coups d'état récurrents (2014) — Pita Limjaroenrat disqualifié (2023) — élections de 2023 annulées","Cambodge : Hun Sen (38 ans au pouvoir) → fils Hun Manet (2023) — autocratie héréditaire — relations prochinoises — base navale chinoise à Ream","Mers de Chine méridionale : Chine revendique 80% (9 traits) — îles artificielles militarisées — liberté de navigation USA (FONOP) — tension régionale majeure"]},
  {id:71,premium:true,title:"Politique de défense européenne",icon:"shield",color:"#7C3AED",items:["PESCO (Coopération structurée permanente, 2017) : 26 États membres — 60 projets communs — drone MALE européen, char MGCS, frégate commune","Boussole stratégique (2022) : premier document stratégique de l'UE — force de déploiement rapide (5 000 soldats) — investir dans la défense et la résilience","Fonds européen de défense (FED) : 8 milliards d'euros sur 2021-2027 — financement européen de la R&D militaire — première fois pour l'UE","PSDC (Politique de sécurité et de défense commune) : 21 missions et opérations (Atalante contre la piraterie, EUFOR Mali, formation au Mozambique)","Défense et OTAN : 'pilier européen' de l'OTAN — complémentarité revendiquée — débat sur l'autonomie stratégique (Macron) vs dépendance à l'OTAN (pays de l'Est)","Industrie de défense : relance post-Ukraine — augmentation des budgets en Europe (Allemagne : 100 Mds€ 'Zeitenwende') — EDIRPA (acquisition commune de munitions)","Objectif 2% PIB : 23 membres OTAN atteignent l'objectif en 2024 — Allemagne, France, Espagne y accèdent ou s'en approchent","Ukraine et la défense européenne : test grandeur nature — fabrication de munitions (objectif 1 million d'obus/an) — dépendance aux USA pour la puissance de feu lourde","France : seul pays avec capacité nucléaire, CSNU, armée de 1er rang — propose un cadre de sécurité européen mais méfiance des pays de l'Est","Avenir : armée européenne (sujet tabou dans certains pays) vs coopérations bilatérales (France-Allemagne, Franco-britannique Lancaster House 2010)"]},
  {id:72,premium:true,title:"Gouvernance locale et décentralisation",icon:"users",color:"#16A34A",items:["Décentralisation 1982 (lois Defferre) : transfert de compétences aux régions, départements et communes — suppression de la tutelle préfectorale a priori","Collectivités territoriales : 18 régions (dont 5 outremer) + 101 départements + 35 000 communes + EPCI (intercommunalités) + collectivités à statut particulier","Régions (depuis 1982, renforcées 2004) : développement économique, formation professionnelle, lycées, transports régionaux (TER) — budget moyen 3 Mds€/an","Départements : action sociale (RSA, PMI, aide aux personnes âgées), collèges, routes départementales — budget moyen 1,5 Mds€/an — avenir débattu","Communes : état civil, urbanisme (PLU), voirie, eau, assainissement, crèches, écoles primaires — 35 000 communes (plus que le reste de l'UE réuni)","Métropoles (2014, loi MAPTAM) : 22 métropoles — Grand Paris (Métropole du Grand Paris) — compétences élargies — Aix-Marseille-Provence, Lyon, Bordeaux","Dotation globale de fonctionnement (DGF) : principale dotation de l'État aux communes — 27 milliards d'euros — inégalités entre communes riches et pauvres","Finances locales : 60% des investissements publics sont locaux — autonomie fiscale limitée (suppression taxe d'habitation 2023) — dépendance aux dotations de l'État","Démocratie locale : conseils municipaux, départementaux, régionaux — élus au suffrage universel direct (sauf EPCI) — participation faible aux élections locales (moins de 50%)","Coopération internationale décentralisée : 12 000 partenariats entre collectivités françaises et étrangères — jumelages — aide au développement locale"]},
  {id:73,premium:true,title:"Sociologie des inégalités",icon:"users",color:"#D97706",items:["Inégalités multidimensionnelles : revenus (flux) vs patrimoine (stock) vs inégalités d'accès (santé, éducation, logement, justice) — Piketty ('Le Capital au XXIe siècle', 2013)","Piketty : rendement du capital (r) supérieur à la croissance économique (g) → les inégalités de patrimoine s'accroissent naturellement — impôt mondial sur le capital comme solution","Inégalités de revenus : le décile supérieur capte 25% des revenus en France — 15 fois plus que le décile inférieur — redistribution via impôts et transferts réduit à 6 fois","Inégalités de patrimoine : top 10% possède 50% du patrimoine français, top 1% possède 25% — l'immobilier comme moteur des inégalités","Mobilité sociale ascendante : 40% des fils d'ouvriers restent dans la classe ouvrière (INSEE) — 60% des fils de cadres deviennent cadres — reproduction sociale forte","Inégalités scolaires : Sciences Po, Polytechnique recrutent 70%+ de milieux favorisés — discrimination à l'entrée en CP selon le prénom et l'adresse","Pauvreté relative (60% du revenu médian) vs pauvreté absolue (subsistance) — France : 9 millions de pauvres au seuil relatif — alimentation, logement, santé","Discriminations : CV avec prénom maghrébin a 3x moins de chances d'être rappelé (testing Audit, 2020) — discrimination au logement, aux contrôles de police","Genre et inégalités : écart salarial de 16% (dont 5% inexpliqué = discrimination pure) — temps partiel subi (80% de femmes), plafond de verre","Fiscalité redistributive : impôt progressif sur le revenu, ISF → IFI, impôt sur les successions — comparaison internationale (Scandinavie plus redistributive)"]},
  {id:74,premium:true,title:"Histoire des idées politiques",icon:"star",color:"#7C3AED",items:["Antiquité : Platon ('La République' — philosopher-roi), Aristote ('Politique' — classification des régimes, bien commun, citoyen comme animal politique)","Renaissance : Machiavel ('Le Prince', 1513) — réalisme politique, fin justifie les moyens — rupture avec la tradition morale de la politique","Absolutisme : Bossuet (droit divin des rois), Hobbes ('Léviathan', 1651 — autorité absolue du souverain), Bodin (souveraineté de l'État)","Libéralisme classique : Locke ('Traité du gouvernement civil', 1689 — droits naturels, révolution légitime), Montesquieu ('De l'esprit des lois', 1748 — séparation des pouvoirs)","Rousseau et la démocratie : 'Du contrat social' (1762) — volonté générale, souveraineté populaire, inégalités comme problème politique","Révolutions : Révolution américaine (1776, Paine, Jefferson) et française (1789, DDHC) — deux modèles de révolution libérale","Conservatisme : Edmund Burke ('Réflexions sur la Révolution en France', 1790) — tradition, prudence, héritage — critique de l'abstraction révolutionnaire","Socialisme : Saint-Simon, Fourier (utopistes) → Marx et Engels ('Manifeste', 1848 — analyse scientifique du capitalisme, lutte des classes)","XIXe-XXe : Social-démocratie (Bernstein — réforme progressive), anarchisme (Bakounine, Kropotkine), syndicalisme révolutionnaire (Sorel)","XXe siècle : totalitarismes (fascisme/nazisme, stalinisme) → Arendt ('Les origines du totalitarisme', 1951) — libéralisme politique renforcé (Rawls, Habermas, Sen)"]},
  {id:75,premium:true,title:"Coopération internationale au développement",icon:"globe",color:"#16A34A",items:["APD (Aide publique au développement) : 204 milliards de dollars en 2023 (OCDE/CAD) — objectif ONU de 0,7% du RNB national — USA : premier donateur (absolu), dernier des G7 (en % du RNB)","Historique : plan Marshall (1947-52), Point IV (Truman 1949) — aide bilatérale liée (avantageuse pour le donateur) vs multilatérale","Déclaration de Paris (2005) : principes d'efficacité de l'aide — appropriation, alignement, harmonisation, gestion axée résultats, responsabilité mutuelle","Institutions bilatérales : AFD (France), USAID (USA), GIZ (Allemagne), JICA (Japon), DFID→FCDO (UK) — chacune avec ses priorités géographiques et thématiques","Banques de développement multilatérales : Banque mondiale (BIRD + IDA), FMI, BAfD, BAsD, BERD, IDB, Nouvelle Banque de Développement (BRICS)","ODD (Objectifs du développement durable) : 17 objectifs, 169 cibles, adoptés en 2015, horizon 2030 — bilan 2023 : 15% sur bonne trajectoire — Covid a reculé les progrès","Aide alimentaire et humanitaire : PAM, UNICEF, UNHCR, OCHA — 'nexus humanitaire-développement-paix' — financement insuffisant (besoins 54 Mds$ en 2023, reçu 22 Mds)","Critiques de l'aide : Moyo ('L'aide fatale', 2009) — l'aide crée la dépendance, décourage l'initiative locale, alimente la corruption — contre-exemples asiatiques","Remittances vs aide : 857 milliards de dollars de transferts de migrants (2023) vs 204 milliards d'APD — 4x plus importants — canaux informels et coûts","Nouvelles approches : investissement à impact social, obligations à résultats (development impact bonds), financement mixte (blended finance) — mobiliser le secteur privé"]},
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
function ApprendreScreen({T,onBack,onPremium}:{T:Theme;onBack:()=>void;onPremium:()=>void}){
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
              <button key={d.id} onClick={()=>{if((d as any).premium){onPremium();}else{setSelSpeech(d);}}} style={{padding:16,borderRadius:14,border:`1px solid ${(d as any).premium?T.amber+"40":T.b1}`,background:T.card,cursor:"pointer",textAlign:"left",display:"flex",gap:14,alignItems:"flex-start",position:"relative",opacity:(d as any).premium?.9:1}}>
                <span style={{fontSize:28}}>{d.country}</span>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                    <p style={{color:T.text,fontWeight:800,fontSize:15,flex:1}}>{d.title}</p>
                    <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                      {(d as any).premium&&<Ic n="lock" s={13} c={T.amber}/>}
                      <span style={{color:T.muted,fontSize:11}}>{d.year}</span>
                    </div>
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
              <button key={r.id} onClick={()=>{if((r as any).premium){onPremium();}else{setSelLesson(r);}}} style={{padding:16,borderRadius:14,border:`1px solid ${(r as any).premium?T.amber+"40":T.b1}`,background:T.card,cursor:"pointer",textAlign:"left",display:"flex",gap:14,alignItems:"center",opacity:(r as any).premium?.9:1}}>
                <div style={{width:44,height:44,borderRadius:12,background:`${T.blueB}15`,border:`1px solid ${T.blueB}30`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n={r.icon} s={22} c={T.blueB}/></div>
                <div style={{flex:1}}>
                  <p style={{color:T.text,fontWeight:800,fontSize:15}}>{r.title}</p>
                  <p style={{color:T.textD,fontSize:12,marginTop:2}}>{r.desc}</p>
                </div>
                {(r as any).premium?<Ic n="lock" s={16} c={T.amber}/>:<Ic n="chevR" s={18} c={T.muted}/>}
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
              <button key={f.id} onClick={()=>{if((f as any).premium){onPremium();}else{setSelFiche(f);}}} style={{padding:16,borderRadius:14,border:`1.5px solid ${(f as any).premium?T.amber+"40":f.color+"30"}`,background:`${f.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,opacity:(f as any).premium?.9:1}}>
                <div style={{width:44,height:44,borderRadius:12,background:`${f.color}20`,border:`1px solid ${f.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n={f.icon} s={22} c={f.color}/></div>
                <div style={{flex:1}}>
                  <p style={{color:T.text,fontWeight:800,fontSize:15}}>{f.title}</p>
                  <p style={{color:T.textD,fontSize:12,marginTop:2}}>{f.items.length} points clés</p>
                </div>
                {(f as any).premium?<Ic n="lock" s={16} c={T.amber}/>:<Ic n="chevR" s={18} c={T.muted}/>}
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
        {([{id:"discours",icon:"send",label:"Discours",desc:"Grands discours historiques analysés",color:"#2B78F5"},{id:"rhetori",icon:"award",label:"Rhétorique",desc:"Techniques d'argumentation",color:"#7C3AED"},{id:"dict",icon:"info",label:"Dictionnaire",desc:"Termes diplomatiques expliqués",color:"#16A34A"},{id:"fiches",icon:"check",label:"Fiches de révision",desc:"ONU · UE · OTAN · Géopolitique",color:"#D97706"}] as const).map(s=>(
          <button key={s.id} onClick={()=>setSub(s.id)} style={{padding:18,borderRadius:16,border:`1.5px solid ${s.color}30`,background:`${s.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16,transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${s.color}15`} onMouseLeave={e=>e.currentTarget.style.background=`${s.color}08`}>
            <div style={{width:52,height:52,borderRadius:14,background:`${s.color}20`,border:`1px solid ${s.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n={s.icon} s={26} c={s.color}/></div>
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
      "Dissertation":`Tu es un professeur de classe préparatoire. Pour la dissertation : "${e.sujet}" (matière : ${e.matiere}, concours ${e.annee}), génère le PLAN DU RÉSULTAT en 3 parties : \n\nINTRODUCTION — Que doit contenir l'introduction ? (accroche, définition des termes, contextualisation, problématique, annonce du plan)\n\nCORPS DU DEVOIR — Quels arguments, exemples et idées clés mettre dans chaque partie ? (I → sous-parties A B C avec arguments précis, II → sous-parties A B C, III → sous-parties A B C)\n\nCONCLUSION — Que doit contenir la conclusion ? (bilan, réponse à la problématique, ouverture). Réponds en français, format clair et structuré.`,
      "Note de synthèse":`Tu es un expert en fonction publique. Pour la note de synthèse : "${e.sujet}" (${e.matiere}, ${e.annee}), génère le PLAN DU RÉSULTAT en 3 parties :\n\nINTRODUCTION — Éléments à mettre en introduction (présentation du sujet, enjeux, plan annoncé)\n\nCORPS DE LA NOTE — Plan détaillé en 2 parties avec sous-parties, idées principales et exemples concrets à mobiliser dans chaque section\n\nCONCLUSION — Éléments de conclusion et propositions opérationnelles. Réponds en français.`,
      "Cas pratique":`Tu es un juriste expert. Pour ce cas pratique : "${e.sujet}" (${e.matiere}, ${e.annee}), génère le PLAN DU RÉSULTAT :\n\nINTRODUCTION — Présentation des faits et qualification juridique préliminaire\n\nDÉVELOPPEMENT — Règles de droit applicables (articles, jurisprudence à citer), raisonnement par syllogisme juridique, application au cas concret\n\nCONCLUSION — Solution motivée et réponse précise aux questions posées. Réponds en français.`,
      "Mise en situation":`Tu es un formateur en fonction publique. Pour cette mise en situation : "${e.sujet}" (${e.annee}), génère le PLAN DU RÉSULTAT :\n\nINTRODUCTION — Analyse des enjeux et du contexte à présenter\n\nDÉVELOPPEMENT — Plan d'action structuré (mesures immédiates, moyen terme, long terme), acteurs à mobiliser, cadre réglementaire applicable\n\nCONCLUSION — Synthèse et points de vigilance. Réponds en français.`,
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
        <p style={{color:T.textD,fontSize:13}}>Entre un sujet — Nexus génère un discours structuré prêt à prononcer.</p>
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
        <p style={{color:T.textD,fontSize:13}}>Entre une position — Nexus structure tes arguments pour et contre.</p>
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
              {t==="epreuves"?"Sujets":t==="stats"?"Résultats":"Grilles"}
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
          <div style={{flex:1,overflowY:"auto",minHeight:0,padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
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
                    {loading?"Génération en cours…":open&&corrText?"▲ Masquer le plan":"Plan du résultat · +10 XP"}
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
          <div style={{flex:1,overflowY:"auto",minHeight:0,padding:"12px 16px",display:"flex",flexDirection:"column",gap:12}}>
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
          <div style={{flex:1,overflowY:"auto",minHeight:0,padding:"12px 16px",display:"flex",flexDirection:"column",gap:14}}>
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
        {([{id:"generateur",icon:"send",label:"Générateur de discours",desc:"Discours IA structuré sur n'importe quel sujet",color:"#2B78F5"},{id:"builder",icon:"info",label:"Builder d'arguments",desc:"Structure tes pour/contre instantanément",color:"#7C3AED"},{id:"concours",icon:"award",label:"Prépa concours",desc:"Sciences Po, ENS, Barreau, Fonction publique",color:"#D97706"}] as const).map(s=>(
          <button key={s.id} onClick={()=>setSub(s.id)} style={{padding:18,borderRadius:16,border:`1.5px solid ${s.color}30`,background:`${s.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16,transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${s.color}15`} onMouseLeave={e=>e.currentTarget.style.background=`${s.color}08`}>
            <div style={{width:52,height:52,borderRadius:14,background:`${s.color}20`,border:`1px solid ${s.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n={s.icon} s={26} c={s.color}/></div>
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
  const [showPremiumHub,setShowPremiumHub] = useState(false);

  const launch=(id:"studio"|"sims")=>{
    haptic();
    const key = typeof window!=="undefined"?localStorage.getItem("gemini_key")||"":"";
    if(!key){setPendingView(id);setShowKeySetup(true);return;}
    setView(id);
  };

  if(view==="studio") return <StudioScreen T={T} onPremium={()=>setShowPremiumHub(true)}/>;
  if(view==="sims") return <SimulationScreen T={T}/>;
  if(view==="apprendre") return <ApprendreScreen T={T} onBack={()=>setView("hub")} onPremium={()=>setShowPremiumHub(true)}/>;
  if(view==="carriere") return <CarriereScreen T={T} onBack={()=>setView("hub")}/>;
  if(showPremiumHub) return <PremiumScreen T={T} onBack={()=>setShowPremiumHub(false)}/>;

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
        {([{id:"apprendre",icon:"info",label:"Apprendre",desc:"Discours · Rhétorique · Fiches · Dictionnaire",color:"#2B78F5"},{id:"carriere",icon:"brief",label:"Carrière & Concours",desc:"Générateur de discours · Arguments · Lettre",color:"#16A34A"}] as const).map(c=>(
          <button key={c.id} onClick={()=>{haptic();setView(c.id);}} style={{padding:18,borderRadius:16,border:`1.5px solid ${c.color}30`,background:`${c.color}08`,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16,transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background=`${c.color}15`} onMouseLeave={e=>e.currentTarget.style.background=`${c.color}08`}>
            <div style={{width:52,height:52,borderRadius:14,background:`${c.color}20`,border:`1px solid ${c.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n={c.icon} s={26} c={c.color}/></div>
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
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>HuggingFace TTS <span style={{color:T.green,fontWeight:700,textTransform:"none",letterSpacing:0}}>(gratuit — sans carte bancaire)</span></p>
        <input type="password" value={hfk} onChange={e=>{setHfk(e.target.value);save("hf_token",e.target.value);}} placeholder="hf_…" style={{width:"100%",background:T.bg2,border:`1px solid ${hfk?"#FF6B00":T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>huggingface.co → Settings → Access Tokens → New token (Read) · Gratuit sans carte</p>
      </div>
      <div style={{background:T.card,border:`1px solid ${ek?T.purple:T.b1}`,borderRadius:12,padding:14,transition:"border .2s"}}>
        <p style={{color:T.textD,fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>ElevenLabs <span style={{color:T.muted,fontWeight:400,textTransform:"none",letterSpacing:0}}>(optionnel)</span></p>
        <input type="password" value={ek} onChange={e=>{setEk(e.target.value);save("el_key",e.target.value);}} placeholder="sk_…" style={{width:"100%",background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
        <p style={{color:T.muted,fontSize:11,marginTop:5}}>elevenlabs.io → Profile → API Keys · 10 000 chars/mois gratuit</p>
      </div>
    </div>
  );
}

// ── GENERIC SIMULATION SCREEN ─────────────────────────────────
function GenericSimScreen({title,icon,color,systemPrompt,welcome,voiceGender,T,onBack}:{title:string;icon:string;color:string;systemPrompt:string;welcome:string;voiceGender:"M"|"F";T:Theme;onBack:()=>void}) {
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
        <div style={{width:32,height:32,borderRadius:8,background:`${color}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n={icon} s={16} c={color}/></div>
        <p style={{color:T.text,fontWeight:800,fontSize:15,flex:1}}>{title}</p>
        <button onClick={toggleAudio} style={{background:audioOn?`${color}15`:"transparent",border:`1px solid ${audioOn?color:T.b1}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
          <Ic n="mic" s={14} c={audioOn?color:T.textD}/>
          <span style={{color:audioOn?color:T.textD,fontSize:11,fontWeight:700}}>{audioOn?"AUDIO":"TEXTE"}</span>
        </button>
      </div>
      <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",flexDirection:m.role==="user"?"row-reverse":"row",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:m.role==="user"?T.blueG:`${color}15`,border:`1.5px solid ${m.role==="user"?T.blueB:color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{m.role==="user"?<span style={{color:T.blueB,fontSize:12,fontWeight:800}}>A</span>:<Ic n={icon} s={14} c={color}/>}</div>
            <div style={{maxWidth:"80%",background:m.role==="user"?T.blueG:T.card,border:`1px solid ${m.role==="user"?`${T.blueB}40`:T.b1}`,borderRadius:14,padding:"10px 13px"}}>
              <p style={{color:T.text,fontSize:13,lineHeight:1.6}}>{m.text}</p>
            </div>
          </div>
        ))}
        {loading&&(
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:`${color}15`,border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n={icon} s={14} c={color}/></div>
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
        <div style={{width:32,height:32,borderRadius:8,background:`${T.purple}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n="scale" s={16} c={T.purple}/></div>
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
          <div style={{width:32,height:32,borderRadius:8,background:`${T.blueB}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n="globe" s={16} c={T.blueB}/></div>
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
        {loading&&<div style={{display:"flex",gap:10,alignItems:"flex-start"}}><div style={{width:34,height:34,borderRadius:"50%",background:T.card,border:`1.5px solid ${T.b1}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="globe" s={14} c={T.blueB}/></div><div style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:"12px 16px"}}><div style={{display:"flex",gap:5}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:T.blueB,animation:`pulse 1.2s ${i*0.2}s infinite`}}/>)}</div></div></div>}
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
  const SIM_CONFIGS: Record<string, {title:string;icon:string;color:string;systemPrompt:string;welcome:string;voiceGender:"M"|"F"}> = {
    interview: {
      title:"Entretien RH",icon:"brief",color:T.green,voiceGender:"F",
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
      title:"Soutenance orale",icon:"award",color:"#D97706",voiceGender:"M",
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
      title:"Examen oral",icon:"star",color:"#E03535",voiceGender:"F",
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
      title:"Pitch commercial",icon:"zap",color:"#16A34A",voiceGender:"M",
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
      title:"Ingénierie sociale",icon:"shield",color:"#7C3AED",voiceGender:"M",
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
      title:"Prise de parole publique",icon:"users",color:T.blueB,voiceGender:"F",
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
      title:"Cours magistral",icon:"info",color:"#D97706",voiceGender:"M",
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
    return <GenericSimScreen key={mode} title={cfg.title} icon={cfg.icon} color={cfg.color} systemPrompt={cfg.systemPrompt} welcome={cfg.welcome} voiceGender={cfg.voiceGender} T={T} onBack={()=>setMode("home")}/>;
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
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16,height:"100%",overflowY:"auto",boxSizing:"border-box"}}>
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
          <p style={{color:T.text,fontWeight:700,fontSize:15}}>Choisir votre délégation</p>
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
          <p style={{color:T.text,fontWeight:700,fontSize:15}}>Procès fictif</p>
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
          <p style={{color:T.text,fontWeight:700,fontSize:15}}>Simulation entretien</p>
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
        const info:{[k:string]:{icon:string;color:string;desc:string}} = {
          soutenance:{icon:"award",color:"#D97706",desc:"Le jury vous écoute. Présentez votre sujet et défendez vos choix."},
          examen:{icon:"star",color:"#E03535",desc:"L'examinateur est prêt. Choisissez votre matière et commencez."},
          pitch:{icon:"zap",color:"#16A34A",desc:"L'investisseur vous écoute. Présentez votre projet en 5 minutes."},
          secu:{icon:"shield",color:"#7C3AED",desc:"Session de sensibilisation à l'ingénierie sociale. Cadre éducatif uniquement."},
          prise:{icon:"users",color:T.blueB,desc:"Coaching prise de parole. Présentez votre discours pour l'analyser."},
          tutorat:{icon:"info",color:"#D97706",desc:"Cours magistral personnalisé. Choisissez n'importe quel sujet."},
        };
        const cfg=info[s];
        return(
          <div key={s} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:10,background:`${cfg.color}15`,border:`1px solid ${cfg.color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic n={cfg.icon} s={18} c={cfg.color}/></div>
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
                  <span style={{color:T.muted,fontSize:11,marginLeft:"auto"}}>{timeFromTs(p.id)}</span>
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
  const [showNotifPanel,setShowNotifPanel] = useState(false);
  const [notifRead,setNotifRead] = useState(false);
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
            <button onClick={()=>{haptic();setShowNotifPanel(p=>!p);setNotifRead(true);}} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:9,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",position:"relative"}}>
              <Ic n="bell" s={16} c={T.textD}/>
              {!notifRead&&<div style={{position:"absolute",top:6,right:6,width:8,height:8,borderRadius:"50%",background:T.red,border:`2px solid ${T.surf}`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:8,fontWeight:900,lineHeight:1}}>5</span></div>}
            </button>
            <div onClick={()=>{haptic();switchTab("profile");}} style={{width:34,height:34,borderRadius:"50%",background:T.blueG,border:`1.5px solid ${T.blueB}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:T.blueB,cursor:"pointer",flexShrink:0}}>A</div>
          </div>
        </div>
      )}

      {/* Notification panel */}
      {showNotifPanel&&!showPremium&&(
        <div style={{position:"absolute",top:60,right:12,width:320,maxWidth:"calc(100% - 24px)",background:T.surf,border:`1px solid ${T.b1}`,borderRadius:16,boxShadow:"0 8px 40px rgba(0,0,0,.25)",zIndex:200,animation:"scaleIn .2s ease",maxHeight:420,overflowY:"auto"}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.b1}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:T.text,fontSize:14,fontWeight:800}}>Notifications</span>
            <button onClick={()=>setShowNotifPanel(false)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><Ic n="x" s={16} c={T.muted}/></button>
          </div>
          {NOTIFICATIONS_DATA.map(n=>{
            const notifIcon = n.type==="follow"?"users":n.type==="like"?"heart":n.type==="share"?"share":n.type==="mention"?"bell":"msg";
            return(
              <div key={n.id} style={{padding:"12px 16px",borderBottom:`1px solid ${T.b1}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:n.color+"20",border:`1.5px solid ${n.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:n.color,flexShrink:0}}>{n.profile.slice(0,2)}</div>
                <div style={{flex:1}}>
                  <p style={{color:T.text,fontSize:12,lineHeight:1.5}}>{n.text}</p>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
                    <Ic n={notifIcon} s={11} c={n.color}/>
                    <span style={{color:T.muted,fontSize:10}}>{timeFromTs(n.time)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} style={{flex:1,overflowY:tab==="simulation"?"hidden":"auto",overflowX:"hidden"}}>
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
