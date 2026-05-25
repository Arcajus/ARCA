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
  {id:"fr",flag:"🇫🇷",country:"France",init:"FR",doctrine:"Multilatéralisme, droit d'ingérence humanitaire, autonomie stratégique européenne"},
  {id:"us",flag:"🇺🇸",country:"États-Unis",init:"US",doctrine:"Hégémonie libérale, OTAN, sanctions internationales"},
  {id:"ru",flag:"🇷🇺",country:"Russie",init:"RU",doctrine:"Souveraineté absolue, anti-OTAN, veto systématique"},
  {id:"cn",flag:"🇨🇳",country:"Chine",init:"CN",doctrine:"Non-ingérence, intérêts économiques, Taiwan"},
  {id:"uk",flag:"🇬🇧",country:"Royaume-Uni",init:"UK",doctrine:"Atlantisme, Commonwealth, droits humains"},
];
const UN_TOPICS = ["Cessez-le-feu immédiat en Ukraine","Réforme du droit de veto","Intervention humanitaire en zone de conflit","Régulation internationale de l'IA militaire","Reconnaissance d'un nouvel État indépendant"];
const DEBATE_TOPICS = ["La réforme de l'ONU est-elle inévitable ?","OTAN : pertinence à l'ère multipolaire","IA et souveraineté numérique des États","Diplomatie climatique : succès ou échec ?","Europe : fédération ou désintégration ?","Immigration : politique ou humanitaire ?","Esclavage et réparations : où en est le débat ?","Décolonisation : bilan et mémoire","Institutions françaises : réforme de la Ve République ?","Histoire des peuples : les rébellions oubliées"];
const TRIAL_TOPICS = ["Corruption d'un élu local","Crime financier — blanchiment international","Atteinte à la liberté de la presse","Violation du droit international humanitaire","Discrimination systémique en entreprise","Abus de pouvoir d'un ministre"];
const JOBS = [
  {title:"Chargé de mission diplomatique",co:"Ministère des Affaires étrangères",tags:["Paris","CDI","Bac+5"]},
  {title:"Analyste géopolitique senior",co:"Institut Français des Relations Internationales",tags:["Paris","CDI","Recherche"]},
  {title:"Apprenti coordinateur administratif",co:"Métropole Aix-Marseille-Provence",tags:["Marseille","Apprentissage","Bac+3"]},
  {title:"Conseiller juridique international",co:"Cabinet Gide Loyrette Nouel",tags:["Paris","Droit int."]},
];
const NEWS = [
  {id:1,type:"article",tag:"GÉOPOLITIQUE",tagC:"#E03535",time:"8 min",title:"Sommet G7 : accord fragile sur les sanctions russo-chinoises",hot:true,img:true,likes:342,comments:87,src:"NEXUS World",verified:false},
  {id:2,type:"video",tag:"DIPLOMATIE",tagC:"#2B78F5",time:"22 min",title:"Macron à Washington : conférence de presse — décryptage en direct",hot:false,img:false,likes:891,comments:203,dur:"14:32",src:"NEXUS Live",verified:false},
  {id:3,type:"event",tag:"ÉVÉNEMENT",tagC:"#16A34A",time:"1h",title:"Forum Méditerranée & Diplomatie · 24 mai · Marseille",hot:false,img:false,likes:56,comments:12,src:"NEXUS Agenda",verified:false},
  {id:4,type:"post",tag:"ANALYSE",tagC:"#D97706",time:"2h",title:"La réforme du droit de veto : une nécessité démocratique ?",hot:false,img:false,likes:445,comments:156,src:"Mehdi Kara · Politologue",verified:true},
  {id:5,type:"video",tag:"ÉLECTIONS",tagC:"#E03535",time:"3h",title:"Débat présidentiel virtuel NEXUS — simulation complète 4 candidats IA",hot:false,img:false,likes:1240,comments:387,dur:"48:10",src:"NEXUS Débats",verified:false},
  {id:6,type:"article",tag:"HISTOIRE",tagC:"#7C3AED",time:"4h",title:"Esclavage et mémoire : les rébellions oubliées qui ont changé le monde",hot:false,img:true,likes:328,comments:74,src:"NEXUS Culture",verified:false},
];
const EVENTS_DATA = [
  {id:1,date:"24",month:"MAI",day:"Sam",title:"Forum Méditerranée & Diplomatie",loc:"Palais du Pharo, Marseille",type:"Conférence",dist:"2,3 km",attendees:284},
  {id:2,date:"1",month:"JUN",day:"Dim",title:"Débat public : Europe fédérale, utopie ou nécessité ?",loc:"MuCEM, Marseille",type:"Débat",dist:"3,1 km",attendees:156},
  {id:3,date:"7",month:"JUN",day:"Sam",title:"Rencontres Géopolitiques d'Aix-en-Provence",loc:"Aix-en-Provence",type:"Forum",dist:"29 km",attendees:412},
  {id:4,date:"15",month:"JUN",day:"Dim",title:"Simulation ONU — Session étudiante Sciences Po",loc:"Sciences Po Paris",type:"Simulation",dist:"770 km",attendees:89},
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
          <div><p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Analyse post-débat</p><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,fontWeight:700,color:T.text}}>Score d&apos;éloquence</h2></div>
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
  const [phase,setPhase] = useState<"intro"|"speaking"|"listening"|"waiting"|"cut"|"ended">("intro");
  const [timer,setTimer] = useState(90);
  const [timerOn,setTimerOn] = useState(false);
  const [transcript,setTranscript] = useState<{role:string;name:string;text:string;time:string}[]>([]);
  const [showTx,setShowTx] = useState(false);
  const [loading,setLoading] = useState(false);
  const [liveText,setLiveText] = useState("");
  const [showScore,setShowScore] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const addLine = (role:string,name:string,text:string) => {
    setTranscript(t=>[...t,{role,name,text,time:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}]);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
  };

  useEffect(()=>{
    setTimeout(()=>{
      addLine("journalist",j?.name||"Journaliste",`Bonsoir. Je suis ${j?.name||"votre journaliste"}. Sujet du soir : « ${topic} ». ${publicSide?`Public ${publicSide.label} en salle.`:""} Vous avez 90 secondes. La parole est à vous.`);
      setPhase("speaking");setTimerOn(true);
    },600);
  },[]);// eslint-disable-line

  useEffect(()=>{
    if(timerOn&&timer>0){timerRef.current=setTimeout(()=>setTimer(t=>t-1),1000);}
    else if(timer===0&&timerOn){setTimerOn(false);setPhase("cut");addLine("journalist",j?.name||"Journaliste","Temps écoulé. Je reprends la main.");}
    return()=>{if(timerRef.current)clearTimeout(timerRef.current);};
  },[timerOn,timer]);// eslint-disable-line

  const startMic = ()=>{
    if(typeof window==="undefined")return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if(!SR){alert("Utilisez Chrome pour la reconnaissance vocale.");return;}
    const rec = new SR();
    rec.lang="fr-FR";rec.continuous=true;rec.interimResults=true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>{
      let interim="",final="";
      for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript;}
      setLiveText(interim);
      if(final){setLiveText("");handleUserSpeech(final.trim());}
    };
    rec.start();recRef.current=rec;setPhase("listening");setTimerOn(false);
  };

  const stopMic = ()=>{recRef.current?.stop();setPhase("speaking");setLiveText("");};

  const handleUserSpeech = async(text:string)=>{
    if(!text)return;
    addLine("user","Vous",text);
    setPhase("waiting");setLoading(true);setTimerOn(false);
    try{
      const hist = transcript.map(m=>({role:m.role==="user"?"user":"assistant",content:m.text}));
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":"","anthropic-version":"2023-06-01"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:500,system:`Tu es ${j?.name||"Élise Moreau"}, journaliste TV NEXUS. Débat sur : "${topic}". ${level?`Niveau adversaire : ${level.label}.`:""} Style oral, 2-3 phrases max, incisif. "Je vous coupe" si vague. Français soutenu.`,messages:[...hist,{role:"user",content:text}]})
      });
      const data = await res.json();
      const reply = (data.content as {text:string}[])?.map(c=>c.text).join("")||"Je vous coupe — votre argument manque de précision. Soyez plus direct.";
      addLine("journalist",j?.name||"Journaliste",reply);
      if(reply.toLowerCase().includes("je vous coupe")){setPhase("cut");}
      else{setTimer(90);setTimerOn(true);setPhase("speaking");}
    }catch{
      const fallbacks=["Argument intéressant, mais pas assez précis. Développez.","Je vous coupe — concrètement, quel mécanisme proposez-vous ?","Question du public : est-ce vraiment réaliste dans le contexte actuel ?"];
      const reply=fallbacks[Math.floor(Math.random()*fallbacks.length)];
      addLine("journalist",j?.name||"Journaliste",reply);
      if(reply.includes("coupe")){setPhase("cut");}else{setTimer(90);setTimerOn(true);setPhase("speaking");}
    }
    setLoading(false);
  };

  const timerPct=timer/90;
  const timerCol=timer<=15?T.red:timer<=30?T.amber:T.green;
  const r=40;const circ=2*Math.PI*r;

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:T.bg}}>
      {showScore&&<ScoreModal topic={topic} T={T} onClose={()=>{setShowScore(false);onBack();}}/>}
      <div style={{padding:"12px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${T.b1}`,background:T.surf,flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",padding:4}}><Ic n="chevL" s={22} c={T.textD}/></button>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:T.red,animation:"pulse 1s infinite"}}/>
            <span style={{color:T.red,fontSize:11,fontWeight:800,letterSpacing:2}}>EN DIRECT</span>
            {level&&<span style={{background:T.blueG,color:T.blueB,fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:700}}>{level.label}</span>}
          </div>
          <p style={{color:T.textD,fontSize:12,marginTop:2}}>{topic.slice(0,38)}…</p>
        </div>
        <button onClick={()=>setShowTx(s=>!s)} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:8,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          <span style={{color:T.textD,fontSize:11,fontWeight:700}}>CC</span>
        </button>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20,gap:20}}>
        <div style={{textAlign:"center"}}>
          <div style={{position:"relative",width:96,height:96,margin:"0 auto 14px"}}>
            {phase==="speaking"&&(
              <svg style={{position:"absolute",inset:"-10px",width:116,height:116}} viewBox="0 0 116 116">
                <circle cx="58" cy="58" r={r+8} fill="none" stroke={T.b1} strokeWidth="4"/>
                <circle cx="58" cy="58" r={r+8} fill="none" stroke={timerCol} strokeWidth="4" strokeDasharray={circ+50} strokeDashoffset={(circ+50)*(1-timerPct)} strokeLinecap="round" transform="rotate(-90 58 58)" style={{transition:"stroke-dashoffset .9s linear,stroke .3s"}}/>
              </svg>
            )}
            <div style={{width:96,height:96,borderRadius:"50%",background:phase==="waiting"||phase==="cut"?T.blueG:T.card,border:`2px solid ${T.blueB}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,color:T.blueB,fontFamily:"'Cormorant Garamond',serif",boxShadow:phase==="waiting"?`0 0 30px ${T.blueG}`:"none",transition:"all .3s"}}>{j?.init||"EM"}</div>
          </div>
          <p style={{color:T.text,fontSize:16,fontWeight:700}}>{j?.name||"Journaliste"}</p>
          <p style={{color:T.textD,fontSize:12,marginTop:2}}>{j?.role||"NEXUS Studio"}</p>
        </div>
        <Waveform active={phase==="waiting"||loading} T={T}/>
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
          <div ref={chatRef} style={{width:"100%",maxHeight:180,overflowY:"auto",background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:12,display:"flex",flexDirection:"column",gap:8}}>
            {transcript.map((m,i)=>(
              <div key={i} style={{display:"flex",gap:8,flexDirection:m.role==="user"?"row-reverse":"row",alignItems:"flex-start"}}>
                <Avatar init={m.role==="user"?"A":j?.init||"EM"} size={28} T={T}/>
                <div style={{maxWidth:"80%",background:m.role==="user"?T.blueG:T.bg2,border:`1px solid ${m.role==="user"?T.blueB+"40":T.b1}`,borderRadius:10,padding:"6px 10px"}}>
                  <p style={{fontSize:11,fontWeight:700,color:m.role==="user"?T.blueB:T.textD,marginBottom:2}}>{m.name}</p>
                  <p style={{fontSize:12,color:T.text,lineHeight:1.5}}>{m.text}</p>
                </div>
              </div>
            ))}
            {liveText&&<p style={{fontSize:11,color:T.muted,fontStyle:"italic",textAlign:"right"}}>{liveText}…</p>}
          </div>
        )}
      </div>
      <div style={{padding:"12px 20px 24px",borderTop:`1px solid ${T.b1}`,background:T.surf,flexShrink:0}}>
        <div style={{display:"flex",gap:10,marginBottom:10}}>
          <button onClick={()=>setShowTx(s=>!s)} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${T.b1}`,background:showTx?T.blueG:T.card,color:showTx?T.blueB:T.textD,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Sous-titres</button>
          <button onClick={()=>{setPhase("ended");setShowScore(true);}} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${T.b1}`,background:T.card,color:T.textD,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Terminer</button>
        </div>
        {phase==="cut"?(
          <button onClick={()=>{setPhase("speaking");setTimer(90);setTimerOn(true);addLine("journalist",j?.name||"Journaliste","Je vous redonne la parole.");}} style={{width:"100%",padding:14,borderRadius:12,border:"none",background:T.blueB,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Reprendre la parole</button>
        ):phase==="listening"?(
          <button onClick={stopMic} style={{width:"100%",padding:14,borderRadius:12,border:`2px solid ${T.red}`,background:`${T.red}15`,color:T.red,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
            <Ic n="micOff" s={18} c={T.red}/>Couper le micro
          </button>
        ):(
          <button onClick={startMic} disabled={phase==="waiting"||loading} style={{width:"100%",padding:14,borderRadius:12,border:"none",background:phase==="waiting"||loading?T.muted:T.blueB,color:"#fff",fontSize:14,fontWeight:800,cursor:phase==="waiting"||loading?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,opacity:loading?0.7:1}}>
            <Ic n="mic" s={18} c="#fff"/>{loading?"Journaliste répond…":"Prendre la parole"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── STUDIO SCREEN ─────────────────────────────────────────────
function StudioScreen({T}:{T:Theme}) {
  const [step,setStep] = useState<"home"|"journalist"|"level"|"topic"|"public"|"stage">("home");
  const [journalist,setJournalist] = useState<typeof JOURNALISTS[0]|null>(null);
  const [level,setLevel] = useState<typeof LEVELS[0]|null>(null);
  const [topic,setTopic] = useState("");
  const [publicSide,setPublicSide] = useState<typeof PUBLICS[0]|null>(null);
  const [subMode,setSubMode] = useState<"solo"|"duel-ia"|"duel-ami"|null>(null);
  const [inviteCode,setInviteCode] = useState("");

  if(step==="stage"&&journalist&&level&&topic){
    return <AudioStage config={{journalist,level,topic,publicSide}} T={T} onBack={()=>setStep("home")}/>;
  }

  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
      <div style={{paddingBottom:4}}>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Studio Audio</p>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:800,color:T.text,lineHeight:1.1}}>Débat en direct</h1>
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
      {/* Topic */}
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Sujet du débat</p>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {DEBATE_TOPICS.map(t=>(
            <button key={t} onClick={()=>setTopic(t)} style={{padding:"10px 14px",borderRadius:10,border:`1.5px solid ${topic===t?T.blueB:T.b1}`,background:topic===t?T.blueG:T.card,cursor:"pointer",textAlign:"left",color:topic===t?T.blueB:T.text,fontSize:13,fontWeight:topic===t?700:400,transition:"all .2s",fontFamily:"inherit"}}>{t}</button>
          ))}
        </div>
      </div>
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
      <button onClick={()=>{if(journalist&&level&&topic)setStep("stage");}} disabled={!journalist||!level||!topic} style={{padding:16,borderRadius:14,border:"none",background:journalist&&level&&topic?T.blueB:T.b1,color:journalist&&level&&topic?"#fff":T.muted,fontSize:15,fontWeight:800,cursor:journalist&&level&&topic?"pointer":"not-allowed",fontFamily:"inherit",letterSpacing:.5,marginBottom:8}}>
        Lancer le débat
      </button>
    </div>
  );
}

// ── FEED SCREEN ───────────────────────────────────────────────
function FeedScreen({T,onDebate}:{T:Theme;onDebate:()=>void}) {
  const [filter,setFilter] = useState("Tout");
  const [liked,setLiked] = useState<Set<number>>(new Set());
  const [composed,setComposed] = useState("");

  return(
    <div>
      {/* Breaking news */}
      <div style={{background:`${T.red}12`,borderBottom:`1px solid ${T.red}25`,padding:"8px 20px",display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:T.red,animation:"pulse 1s infinite",flexShrink:0}}/>
        <span style={{color:T.red,fontSize:10,fontWeight:800,letterSpacing:1.5,flexShrink:0}}>BREAKING</span>
        <p style={{color:T.text,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Réunion d&apos;urgence du Conseil de Sécurité ONU — vote sur le cessez-le-feu dans 2h</p>
      </div>
      {/* Compose */}
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${T.b1}`,display:"flex",gap:10,alignItems:"center"}}>
        <Avatar init="A" size={36} T={T}/>
        <div style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:20,padding:"9px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"text"}} onClick={()=>{}}>
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
      {/* Filters */}
      <div style={{padding:"10px 20px",borderBottom:`1px solid ${T.b1}`,display:"flex",gap:8,overflowX:"auto"}}>
        {FILTERS.map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${filter===f?T.blueB:T.b1}`,background:filter===f?T.blueB:"transparent",color:filter===f?"#fff":T.textD,fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit",transition:"all .2s"}}>{f}</button>
        ))}
      </div>
      {/* Posts */}
      <div style={{padding:"12px 20px",display:"flex",flexDirection:"column",gap:12}}>
        {NEWS.map(n=>(
          <div key={n.id} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,overflow:"hidden",animation:"fadeUp .4s ease"}}>
            <div style={{padding:"12px 14px 8px",display:"flex",alignItems:"center",gap:10}}>
              <Avatar init={n.src.slice(0,2)} size={36} T={T}/>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{color:T.text,fontWeight:700,fontSize:13}}>{n.src}</span>
                  {n.verified&&<span style={{background:`${T.blueB}20`,color:T.blueB,fontSize:9,padding:"1px 5px",borderRadius:3,fontWeight:800}}>✓ VÉRIFIÉ</span>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2}}>
                  <Tag label={n.tag} color={n.tagC} small/>
                  <span style={{color:T.muted,fontSize:11}}>· {n.time}</span>
                  {n.hot&&<span style={{background:`${T.red}15`,color:T.red,fontSize:9,padding:"1px 5px",borderRadius:3,fontWeight:800}}>🔥 TENDANCE</span>}
                </div>
              </div>
            </div>
            {n.img&&(
              <div style={{height:140,background:`linear-gradient(135deg,${T.blueG2},${T.blueG})`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                <Ic n="globe" s={40} c={T.blueB}/>
                {n.type==="video"&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:44,height:44,borderRadius:"50%",background:`${T.blueB}cc`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="play" s={18} c="#fff"/></div></div>}
              </div>
            )}
            {n.type==="video"&&!n.img&&(
              <div style={{height:100,background:`linear-gradient(135deg,${T.bg2},${T.card})`,display:"flex",alignItems:"center",justifyContent:"center",borderTop:`1px solid ${T.b1}`,borderBottom:`1px solid ${T.b1}`}}>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <div style={{width:44,height:44,borderRadius:"50%",background:`${T.blueB}cc`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic n="play" s={18} c="#fff"/></div>
                  <div><p style={{color:T.text,fontSize:13,fontWeight:600}}>Vidéo</p><p style={{color:T.muted,fontSize:11}}>{n.dur||"Voir"}</p></div>
                </div>
              </div>
            )}
            <div style={{padding:"10px 14px"}}>
              <p style={{color:T.text,fontSize:14,fontWeight:700,lineHeight:1.5}}>{n.title}</p>
            </div>
            <div style={{padding:"8px 14px 12px",display:"flex",alignItems:"center",borderTop:`1px solid ${T.b1}`}}>
              <button onClick={()=>setLiked(s=>{const ns=new Set(s);ns.has(n.id)?ns.delete(n.id):ns.add(n.id);return ns;})} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:liked.has(n.id)?T.red:T.textD,padding:"0 8px 0 0"}}>
                <Ic n="heart" s={16} c={liked.has(n.id)?T.red:T.textD} w={liked.has(n.id)?2.5:1.6}/>
                <span style={{fontSize:12,fontWeight:600}}>{n.likes+(liked.has(n.id)?1:0)}</span>
              </button>
              <button style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"0 8px"}}>
                <Ic n="comment" s={16} c={T.textD}/><span style={{fontSize:12,fontWeight:600}}>{n.comments}</span>
              </button>
              <button style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:T.textD,padding:"0 8px"}}>
                <Ic n="share" s={16} c={T.textD}/>
              </button>
              <div style={{marginLeft:"auto"}}>
                <button onClick={onDebate} style={{background:T.blueG,border:`1px solid ${T.blueB}40`,borderRadius:8,padding:"5px 12px",color:T.blueB,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Débattre</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── EVENTS SCREEN ─────────────────────────────────────────────
function EventsScreen({T}:{T:Theme}) {
  const [reg,setReg] = useState<Set<number>>(new Set());
  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Agenda</p>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:800,color:T.text}}>Événements</h1>
      </div>
      <div style={{display:"flex",gap:8}}>
        {["Tout","Conférence","Débat","Forum","Simulation"].map(f=>(
          <button key={f} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${T.b1}`,background:f==="Tout"?T.blueB:"transparent",color:f==="Tout"?"#fff":T.textD,fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit"}}>{f}</button>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {EVENTS_DATA.map(ev=>(
          <div key={ev.id} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,display:"flex",gap:14,animation:"fadeUp .4s ease"}}>
            <div style={{width:52,flexShrink:0,textAlign:"center",background:T.blueG,border:`1px solid ${T.blueB}30`,borderRadius:10,padding:"8px 4px"}}>
              <p style={{color:T.blueB,fontSize:20,fontWeight:900,lineHeight:1}}>{ev.date}</p>
              <p style={{color:T.blueB,fontSize:10,fontWeight:800,letterSpacing:1}}>{ev.month}</p>
              <p style={{color:T.muted,fontSize:9,marginTop:2}}>{ev.day}</p>
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:6}}>
                <p style={{color:T.text,fontSize:14,fontWeight:700,lineHeight:1.4}}>{ev.title}</p>
                <Tag label={ev.type} color={T.blueB} small/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                <Ic n="map" s={12} c={T.muted}/><span style={{color:T.textD,fontSize:12}}>{ev.loc}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{color:T.muted,fontSize:11}}>{ev.dist} · {ev.attendees} inscrits</span>
                </div>
                <button onClick={()=>setReg(s=>{const ns=new Set(s);ns.has(ev.id)?ns.delete(ev.id):ns.add(ev.id);return ns;})} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${reg.has(ev.id)?T.green:T.blueB}`,background:reg.has(ev.id)?`${T.green}15`:T.blueG,color:reg.has(ev.id)?T.green:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {reg.has(ev.id)?"✓ Inscrit":"S'inscrire"}
                </button>
              </div>
            </div>
          </div>
        ))}
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

  return(
    <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
      <div>
        <p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Communauté</p>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:800,color:T.text}}>Messages</h1>
      </div>
      <div style={{position:"relative"}}>
        <Ic n="search" s={16} c={T.muted}/>
        <input placeholder="Rechercher une conversation…" style={{width:"100%",background:T.card,border:`1px solid ${T.b1}`,borderRadius:10,padding:"10px 14px 10px 36px",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
        <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic n="search" s={16} c={T.muted}/></div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        {CONVOS.map(c=>(
          <button key={c.id} onClick={()=>setActive(c)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:12,border:"none",background:"transparent",cursor:"pointer",textAlign:"left",transition:"background .2s"}}
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
      <button style={{padding:"14px",borderRadius:12,border:`1.5px dashed ${T.b1}`,background:"transparent",color:T.textD,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <Ic n="plus" s={16} c={T.textD}/>Nouveau groupe ou message
      </button>
    </div>
  );
}

// ── SIMULATION SCREEN ─────────────────────────────────────────
function SimulationScreen({T}:{T:Theme}) {
  const [mode,setMode] = useState<"home"|"un"|"trial"|"interview"|"elections">("home");
  const [unRole,setUnRole] = useState<typeof UN_DEL[0]|null>(null);
  const [unTopic,setUnTopic] = useState("");
  const [unMessages,setUnMessages] = useState<{role:string;flag:string;country:string;text:string}[]>([]);
  const [unInput,setUnInput] = useState("");
  const [trialRole,setTrialRole] = useState<"defense"|"prosecutor"|null>(null);
  const [trialTopic,setTrialTopic] = useState("");
  const [voted,setVoted] = useState<string|null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const sendUNMessage = async()=>{
    if(!unInput.trim()||!unRole)return;
    const text=unInput;setUnInput("");
    const newMsg={role:"user",flag:unRole.flag,country:unRole.country,text};
    setUnMessages(m=>[...m,newMsg]);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
    try{
      const otherDels=UN_DEL.filter(d=>d.id!==unRole.id);
      const responding=otherDels[Math.floor(Math.random()*otherDels.length)];
      await new Promise(r=>setTimeout(r,1200));
      const resp={role:"ai",flag:responding.flag,country:responding.country,text:`${responding.flag} La délégation de ${responding.country} souhaite rappeler sa position : ${responding.doctrine.slice(0,80)}… Nous nous opposons fermement à cette résolution.`};
      setUnMessages(m=>[...m,resp]);
      setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
    }catch{}
  };

  if(mode==="un"&&unRole&&unTopic){
    return(
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <div style={{padding:"10px 16px",background:T.surf,borderBottom:`1px solid ${T.b1}`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button onClick={()=>{setMode("home");setUnMessages([]);setUnRole(null);setUnTopic("");}} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={20} c={T.textD}/></button>
            <span style={{fontSize:24}}>🌐</span>
            <div style={{flex:1}}>
              <p style={{color:T.text,fontSize:13,fontWeight:700}}>Conseil de Sécurité ONU</p>
              <p style={{color:T.textD,fontSize:11}}>{unTopic.slice(0,42)}…</p>
            </div>
          </div>
          <div style={{marginTop:8,display:"flex",gap:4,flexWrap:"wrap"}}>
            {UN_DEL.map(d=><span key={d.id} style={{fontSize:16,opacity:d.id===unRole.id?1:0.45}}>{d.flag}</span>)}
            <span style={{background:T.blueG,color:T.blueB,fontSize:10,padding:"3px 8px",borderRadius:4,fontWeight:700,marginLeft:4}}>Vous : {unRole.flag} {unRole.country}</span>
          </div>
        </div>
        <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
          {unMessages.length===0&&(
            <div style={{textAlign:"center",padding:24}}>
              <p style={{color:T.muted,fontSize:13}}>La séance est ouverte. Prenez la parole pour {unRole.country}.</p>
            </div>
          )}
          {unMessages.map((m,i)=>(
            <div key={i} style={{display:"flex",flexDirection:m.role==="user"?"row-reverse":"row",gap:10,alignItems:"flex-start"}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:T.card,border:`1.5px solid ${T.b1}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{m.flag}</div>
              <div style={{maxWidth:"78%",background:m.role==="user"?T.blueG:T.card,border:`1px solid ${m.role==="user"?T.blueB+"40":T.b1}`,borderRadius:12,padding:"8px 12px"}}>
                <p style={{color:m.role==="user"?T.blueB:T.textD,fontSize:10,fontWeight:800,marginBottom:4}}>{m.country}</p>
                <p style={{color:T.text,fontSize:13,lineHeight:1.5}}>{m.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:"12px 16px 24px",borderTop:`1px solid ${T.b1}`,display:"flex",gap:8,flexShrink:0}}>
          <input value={unInput} onChange={e=>setUnInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendUNMessage()} placeholder={`Parole de ${unRole.country}…`} style={{flex:1,background:T.bg2,border:`1px solid ${T.b1}`,borderRadius:10,padding:"10px 14px",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
          <button onClick={sendUNMessage} style={{width:44,height:44,borderRadius:10,background:T.blueB,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}><Ic n="send" s={16} c="#fff"/></button>
        </div>
      </div>
    );
  }

  if(mode==="elections"){
    const total=CANDIDATES.reduce((a,c)=>a+c.poll,0);
    return(
      <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{setMode("home");setVoted(null);}} style={{background:"none",border:"none",cursor:"pointer"}}><Ic n="chevL" s={22} c={T.textD}/></button>
          <div><p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Simulation</p><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:800,color:T.text}}>Élections virtuelles</h2></div>
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
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:800,color:T.text}}>Simulateur</h1>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[
          {id:"un",icon:"globe",label:"Simulation ONU",sub:"Conseil de Sécurité",color:T.blueB},
          {id:"trial",icon:"scale",label:"Procès fictif",sub:"Avocat ou Procureur",color:T.purple},
          {id:"interview",icon:"brief",label:"Entretien RH",sub:"Coaching carrière",color:T.green},
          {id:"elections",icon:"vote",label:"Élections virtuelles",sub:"Sondage en direct",color:T.red},
        ].map(sim=>(
          <button key={sim.id} onClick={()=>setMode(sim.id as "un"|"trial"|"interview"|"elections")} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:14,padding:16,cursor:"pointer",textAlign:"left",transition:"all .2s",display:"flex",flexDirection:"column",gap:10}}
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
          <button onClick={()=>{if(unRole&&unTopic){setUnMessages([{role:"ai",flag:"🌐",country:"Présidence",text:`La séance est ouverte. Sujet : ${unTopic}. Chaque délégation dispose de 3 minutes. La délégation de ${unRole.country} a la parole.`}]);setMode("un");}}} disabled={!unRole||!unTopic} style={{padding:14,borderRadius:12,border:"none",background:unRole&&unTopic?T.blueB:T.b1,color:unRole&&unTopic?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:unRole&&unTopic?"pointer":"not-allowed",fontFamily:"inherit"}}>Ouvrir la session</button>
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
          <button style={{padding:14,borderRadius:12,border:"none",background:trialRole&&trialTopic?T.purple:T.b1,color:trialRole&&trialTopic?"#fff":T.muted,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Ouvrir l&apos;audience</button>
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
                <button style={{width:"100%",marginTop:10,padding:"8px",borderRadius:8,border:`1px solid ${T.blueB}`,background:T.blueG,color:T.blueB,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>S&apos;entraîner pour ce poste</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PROFILE SCREEN ────────────────────────────────────────────
function ProfileScreen({T,onPremium}:{T:Theme;onPremium:()=>void}) {
  const [activeTab,setActiveTab] = useState<"posts"|"score"|"badges">("posts");
  const scores:{[k:string]:number} = {"Géopolitique":82,"Droit":68,"Diplomatie":75,"Histoire":88,"Institutions":61};

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
          {[["284","Abonnés"],["1,2k","Followers"],["47","Débats"],["82","Score"]].map(([v,l])=>(
            <div key={l} style={{textAlign:"center"}}>
              <p style={{color:T.text,fontWeight:800,fontSize:16}}>{v}</p>
              <p style={{color:T.muted,fontSize:11}}>{l}</p>
            </div>
          ))}
        </div>
        <button onClick={onPremium} style={{width:"100%",marginTop:16,padding:"12px",borderRadius:12,border:`1px solid ${T.amber}50`,background:`${T.amber}10`,color:T.amber,fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
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
            {["La montée du multipolarisme : opportunité ou chaos ?","G20 Afrique : quels enjeux pour la France ?","Réforme de l'ONU — ma simulation complète"].map((post,i)=>(
              <div key={i} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:12,padding:14}}>
                <p style={{color:T.text,fontSize:13,fontWeight:600,lineHeight:1.5}}>{post}</p>
                <div style={{display:"flex",gap:12,marginTop:10}}>
                  <span style={{color:T.muted,fontSize:12,display:"flex",alignItems:"center",gap:4}}><Ic n="heart" s={14} c={T.muted}/>{[124,89,203][i]}</span>
                  <span style={{color:T.muted,fontSize:12,display:"flex",alignItems:"center",gap:4}}><Ic n="comment" s={14} c={T.muted}/>{[32,18,67][i]}</span>
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
        <div><p style={{color:T.muted,fontSize:10,fontWeight:800,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Abonnement</p><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,fontWeight:800,color:T.text}}>Choisir votre plan</h2></div>
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

// ── ROOT APP ──────────────────────────────────────────────────
export default function NexusApp() {
  const [dark,setDark] = useState(true);
  const T = dark ? DARK : LIGHT;
  const [tab,setTab] = useState<"feed"|"studio"|"sim"|"events"|"messages"|"profile">("feed");
  const [showPremium,setShowPremium] = useState(false);

  const NAV = [
    {id:"feed",icon:"feed",label:"ACTU"},
    {id:"studio",icon:"mic",label:"STUDIO"},
    {id:"sim",icon:"globe",label:"SIMUL."},
    {id:"events",icon:"cal",label:"AGENDA"},
    {id:"messages",icon:"msg",label:"MSG"},
    {id:"profile",icon:"user",label:"PROFIL"},
  ];

  return(
    <div style={{background:T.bg,minHeight:"100vh",maxWidth:430,margin:"0 auto",fontFamily:"'DM Sans',sans-serif",position:"relative",overflowX:"hidden",display:"flex",flexDirection:"column",height:"100vh"}}>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        input::placeholder,textarea::placeholder{color:${T.muted};}
      `}</style>

      {!showPremium&&(
        <div style={{padding:"13px 20px 11px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${T.b1}`,background:T.surf,zIndex:100,backdropFilter:"blur(20px)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:33,height:33,borderRadius:9,background:T.blueB,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"#fff",fontSize:17,fontWeight:900,fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>N</span>
            </div>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:800,color:T.text,letterSpacing:1}}>NEXUS</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setDark(d=>!d)} style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:9,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
              <Ic n={dark?"sun":"moon"} s={16} c={T.textD}/>
            </button>
            <button style={{background:T.card,border:`1px solid ${T.b1}`,borderRadius:9,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",position:"relative"}}>
              <Ic n="bell" s={16} c={T.textD}/>
              <div style={{position:"absolute",top:7,right:7,width:7,height:7,borderRadius:"50%",background:T.red,border:`2px solid ${T.surf}`}}/>
            </button>
            <div onClick={()=>setTab("profile")} style={{width:34,height:34,borderRadius:"50%",background:T.blueG,border:`1.5px solid ${T.blueB}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:T.blueB,cursor:"pointer"}}>A</div>
          </div>
        </div>
      )}

      <div style={{flex:1,overflowY:"auto",overflowX:"hidden"}}>
        {showPremium ? (
          <PremiumScreen T={T} onBack={()=>setShowPremium(false)}/>
        ) : (
          <>
            {tab==="feed"&&<FeedScreen T={T} onDebate={()=>setTab("studio")}/>}
            {tab==="studio"&&<StudioScreen T={T}/>}
            {tab==="sim"&&<SimulationScreen T={T}/>}
            {tab==="events"&&<EventsScreen T={T}/>}
            {tab==="messages"&&<MessagesScreen T={T}/>}
            {tab==="profile"&&<ProfileScreen T={T} onPremium={()=>setShowPremium(true)}/>}
          </>
        )}
      </div>

      {!showPremium&&(
        <div style={{background:`${T.surf}F8`,backdropFilter:"blur(24px)",borderTop:`1px solid ${T.b1}`,display:"flex",padding:"8px 0 20px",flexShrink:0,zIndex:100}}>
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>setTab(n.id as typeof tab)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",padding:"5px 0"}}>
              <div style={{width:38,height:38,borderRadius:11,background:tab===n.id?T.blueG:"transparent",border:tab===n.id?`1px solid ${T.blueB}20`:"1px solid transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                <Ic n={n.icon} s={20} c={tab===n.id?T.blueB:T.muted} w={tab===n.id?2:1.6}/>
              </div>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:.5,color:tab===n.id?T.blueB:T.muted,transition:"color .2s"}}>{n.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
