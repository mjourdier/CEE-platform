import { useState, useMemo, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from "recharts";
import * as XLSX from "xlsx";
// ─────────────────────────────────────────────────────────────────────────────
// PARAMS
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://wrpkjlwpxopfzaoerzva.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndycGtqbHdweG9wZnphb2VyenZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MDkwNDksImV4cCI6MjA5MTk4NTA0OX0.YBK0zboO9CEiV8_BsL71o4gBMwSEHe4eqZxGBibWfUs";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PARAMS = {
  CARBURANT: { label:"Carburant (Road Fuel)", kwhc_per_m3:8718,  coeff_precarite:0.364, coeff_correctif:0.847 },
  FOD:       { label:"FOD (Fuel Oil Dom.)",   kwhc_per_m3:11078, coeff_precarite:0.364, coeff_correctif:0.847 },
};

const MONTHS_LIST = ["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06",
                     "2026-07","2026-08","2026-09","2026-10","2026-11","2026-12"];
const TENORS = ["SPOT","S1-26","S2-26","S1-27","S2-27","S1-28","S2-28"];


const MATURITY_DATES = {
  SPOT: "2026-02-01",
  "S1-26": "2026-04-01",
  "S2-26": "2026-10-01",
  "S1-27": "2027-04-01",
  "S2-27": "2027-10-01",
  "S1-28": "2028-04-01",
  "S2-28": "2028-10-01",
  "S1-29": "2029-04-01",
  "S2-29": "2029-10-01",
  "S1-30": "2030-04-01",
  "S2-30": "2030-10-01",
};

const MATURITY_TENORS = Object.keys(MATURITY_DATES);

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const SEED_CURVE = {
  SPOT:    { classique:8.96,  precarite:16.44 },
  "S1-26": { classique:8.96,  precarite:16.05 },
  "S2-26": { classique:8.93,  precarite:15.81 },
  "S1-27": { classique:8.95,  precarite:15.85 },
  "S2-27": { classique:8.93,  precarite:15.08 },
  "S1-28": { classique:8.95,  precarite:15.04 },
  "S2-28": { classique:8.93,  precarite:14.98 },
};

function calcCEE(volume_m3, product) {
  const p = PARAMS[product];
  const base = volume_m3 * p.kwhc_per_m3 / 1e6 * p.coeff_correctif;
  return { classique: base*(1-p.coeff_precarite), precarite: base*p.coeff_precarite, total: base };
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────
const USERS = [
  { id:"u1", name:"Maxime Jourdier", role:"trader",   initials:"MJ" },
  { id:"u2", name:"Lilian Fages",    role:"trader",   initials:"LF" },
  { id:"u3", name:"Eric De Gail",    role:"approver", initials:"EG" },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const N   = (n,d=2) => n==null?"—":n.toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});
const fK  = (n,d=0) => n==null?"—":(n>=0?"+":"")+N(n/1000,d)+" k€";
const fM  = (n,d=1) => n==null?"—":(n>=0?"+":"")+N(n/1000000,d)+" M€";
const uid = ()      => Math.random().toString(36).slice(2,9);
const MO  = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const ML  = m       => { const [y,mo]=m.split("-"); return MO[parseInt(mo)-1]+" "+y; };
const MLS = m       => { const [,mo]=m.split("-"); return MO[parseInt(mo)-1]; };
// Unit convention:
// - trades / obligations stored prices: €/GWhc
// - market prices / forward curve: €/MWhc
// - calculations: €/GWhc
const toGWhc = (priceMWhc) => priceMWhc * 1000;
const toMWhc = (priceGWhc) => priceGWhc / 1000;
const fmtMWhc = (priceGWhc, d = 2) => priceGWhc ? `${N(toMWhc(priceGWhc), d)} €/MWhc` : "—";
const fmtGWhc = (priceGWhc, d = 0) => priceGWhc ? `${N(priceGWhc, d)} €/GWhc` : "—";

function wAvg(trades,ceeType,month=null,pricedOnly=false){
  const b=trades.filter(t=>t.status==="APPROVED"&&t.ceeType===ceeType
    &&(month?t.month===month:true)&&(!pricedOnly||t.priced===true));
  const v=b.reduce((s,t)=>s+t.volume,0);
  return v>0?b.reduce((s,t)=>s+t.price*t.volume,0)/v:0;
}
function sumVol(trades,ceeType,month=null,pricedOnly=false){
  return trades.filter(t=>t.status==="APPROVED"&&t.ceeType===ceeType
    &&(month?t.month===month:true)&&(!pricedOnly||t.priced===true)).reduce((s,t)=>s+t.volume,0);
}
function oblMonth(obligations,month,ceeType,pricedOnly=false){
  return obligations.filter(o=>o.month===month&&(!pricedOnly||o.priced)).reduce((s,o)=>s+(ceeType==="CLASSIQUE"?o.clGwhc:o.prGwhc),0);
}
// avgSellMonth: weighted avg of obligation sell prices (signed volumes, so negative rows reduce total)
// Result is the blended €/GWhc price the client is charged across all priced rows
function avgSellMonth(obligations,month,ceeType){
  const rows=obligations.filter(o=>o.month===month&&o.priced);
  const key=ceeType==="CLASSIQUE"?"priceCl":"pricePr";
  let wv=0,ws=0;
  rows.forEach(o=>{
    const vol=ceeType==="CLASSIQUE"?o.clGwhc:o.prGwhc;
    wv+=vol; ws+=vol*o[key];
  });
  return wv>0?ws/wv:0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATOMS
// ─────────────────────────────────────────────────────────────────────────────
const S  = { fontFamily:"Inter, sans-serif" };
const CG = { fontFamily:"Inter, sans-serif", fontWeight:600 };
const CHART_COLORS = { classique:"#2563eb", precarite:"#d4a843", green:"#34d399", red:"#f87171", gold:"#38bdf8", bg:"#111827", grid:"#1e2d45" };

function Badge({ children, color }) {
  const m={green:"#0f2e1a;#6db87a;#1d4a2a",red:"#2e1010;#c96b6b;#4a1c1c",amber:"#2e2410;#d4a843;#4a3a18",blue:"#101e2e;#6aace8;#1a3050",sky:"#0e2030;#5bc2e7;#1a3848",gray:"#1e1c18;#6b6350;#2e2b24",purple:"#1e1028;#b07ee8;#3a2050",gold:"#2a2010;#b8973a;#3a3020",teal:"#0e2820;#5bd4b4;#1a4838"}[color]||"#1e1c18;#6b6350;#2e2b24";
  const [bg,fg,bc]=m.split(";");
  return <span style={{ display:"inline-flex",alignItems:"center",padding:"2px 7px",borderRadius:"2px",fontSize:"10px",fontWeight:600,border:`1px solid ${bc}`,background:bg,color:fg,...S,letterSpacing:"0.06em" }}>{children}</span>;
}
function KPI({ label, value, sub, color, large }) {
  const c={emerald:"#34d399",rose:"#f87171",sky:"#2563eb",amber:"#d4a843",gold:"#38bdf8",gray:"#3a3428"}[color]||"#3a3428";
  return (
    <div style={{ background:"#111827",border:"1px solid #252219",borderLeft:`2px solid ${c}`,borderRadius:"2px",padding:large?"20px 22px":"15px 18px" }}>
      <p style={{ ...S,fontSize:"9px",color:"#3a5070",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:"5px" }}>{label}</p>
      <p style={{ ...S,fontSize:large?"26px":"20px",fontWeight:500,color:"#e2e8f0" }}>{value}</p>
      {sub&&<p style={{ ...S,fontSize:"10px",color:"#3a5070",marginTop:"3px" }}>{sub}</p>}
    </div>
  );
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(8,7,6,0.9)",backdropFilter:"blur(6px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#111827",border:"1px solid #2e2b24",borderRadius:"2px",width:"100%",maxWidth:wide?"860px":"520px",maxHeight:"92vh",overflowY:"auto",position:"relative" }}>
        <div style={{ position:"absolute",top:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent,#b8973a55,transparent)" }}/>
        <div style={{ padding:"20px 26px 14px",borderBottom:"1px solid #e2e4e8",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <h3 style={{ ...CG,fontSize:"20px",fontWeight:600,color:"#e2e8f0" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#3a5070",fontSize:"20px",cursor:"pointer" }}>×</button>
        </div>
        <div style={{ padding:"18px 26px 22px" }}>{children}</div>
      </div>
    </div>
  );
}
function FL({ children }) { return <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:"5px" }}>{children}</p>; }
function FI({ label, ...p }) { return <div><FL>{label}</FL><input style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#e2e8f0",borderRadius:"2px",padding:"8px 10px",fontSize:"12px",width:"100%",outline:"none" }} {...p}/></div>; }
function FS({ label, children, ...p }) { return <div><FL>{label}</FL><select style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#e2e8f0",borderRadius:"2px",padding:"8px 10px",fontSize:"12px",width:"100%",outline:"none" }} {...p}>{children}</select></div>; }
function GoldBtn({ children, onClick }) { return <button onClick={onClick} style={{ background:"linear-gradient(135deg,#b8973a,#d4af55)",color:"#0a0e1a",border:"none",borderRadius:"2px",...S,fontSize:"11px",fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",padding:"9px 18px",cursor:"pointer" }}>{children}</button>; }
function GhostBtn({ children, onClick }) { return <button onClick={onClick} style={{ background:"transparent",color:"#4a6080",border:"1px solid #2e2b24",borderRadius:"2px",...S,fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase",padding:"8px 14px",cursor:"pointer" }}>{children}</button>; }
function TH({ children }) { return <th style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.1em",padding:"9px 14px",textAlign:"left",whiteSpace:"nowrap",background:"#121110",borderBottom:"1px solid #e2e4e8" }}>{children}</th>; }
function CovBar({ pct }) {
  const c=pct>=100?"#34d399":pct>=70?"#d4a843":"#f87171";
  return <div style={{ display:"flex",alignItems:"center",gap:"8px" }}><div style={{ flex:1,height:"5px",background:"#1e2d45",borderRadius:"1px",overflow:"hidden" }}><div style={{ width:`${Math.min(pct,100)}%`,height:"100%",background:c,borderRadius:"1px" }}/></div><span style={{ ...S,fontSize:"10px",color:c,minWidth:"38px",textAlign:"right" }}>{N(pct,1)}%</span></div>;
}

// Custom chart tooltip
function ChartTip({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  return (
    <div style={{ background:"#0d1526",border:"1px solid #2e2b24",borderRadius:"2px",padding:"10px 14px" }}>
      <p style={{ ...S,fontSize:"10px",color:"#38bdf8",marginBottom:"6px" }}>{label}</p>
      {payload.map(p=>(
        <p key={p.dataKey} style={{ ...S,fontSize:"11px",color:p.color,marginBottom:"2px" }}>{p.name}: {typeof p.value==="number"?N(p.value,p.value>1000?0:2):p.value}</p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTING TAB
// ─────────────────────────────────────────────────────────────────────────────
function Reporting({ trades, obligations, prices, curve }) {
  const [report, setReport] = useState("executive");

  const latestSpot = useMemo(()=>{
    if(!prices.length) return { classique:curve.SPOT?.classique??8.96, precarite:curve.SPOT?.precarite??16.44 };
    const p=[...prices].sort((a,b)=>b.date.localeCompare(a.date))[0];
    return { classique:p.classique, precarite:p.precarite };
  },[prices,curve]);

  // Monthly position data for charts
  const monthlyData = useMemo(()=>MONTHS_LIST.map(month=>{
    const oblCl=oblMonth(obligations,month,"CLASSIQUE"); const oblPr=oblMonth(obligations,month,"PRECARITE");
    const oblClP=oblMonth(obligations,month,"CLASSIQUE",true); const oblPrP=oblMonth(obligations,month,"PRECARITE",true);
    // Achats PRICÉS pour PnL et MtM; achats totaux pour info couverture
    const bClP=sumVol(trades,"CLASSIQUE",month,true); const bPrP=sumVol(trades,"PRECARITE",month,true);
    const bCl=sumVol(trades,"CLASSIQUE",month);        const bPr=sumVol(trades,"PRECARITE",month);
    const aClP=wAvg(trades,"CLASSIQUE",month,true);    const aPrP=wAvg(trades,"PRECARITE",month,true);
    const sCl=avgSellMonth(obligations,month,"CLASSIQUE"); const sPr=avgSellMonth(obligations,month,"PRECARITE");
    // PnL = (sell - avgBuyPricé) × min(boughtPricé, oblPricée)
    const matchCl=Math.min(bClP,oblClP); const matchPr=Math.min(bPrP,oblPrP);
    const pnlCl=(oblClP>0.001&&aClP>0&&sCl>0)?(sCl-aClP)*matchCl:0;
    const pnlPr=(oblPrP>0.001&&aPrP>0&&sPr>0)?(sPr-aPrP)*matchPr:0;
    // MtM = (spot - avgBuyPricé) × position ouverte PRICÉE uniquement
    const openCl=(oblClP>0.001&&bClP>oblClP)?bClP-oblClP:0;
    const openPr=(oblPrP>0.001&&bPrP>oblPrP)?bPrP-oblPrP:0;
    const mtmCl=openCl>0?openCl*(latestSpot.classique*1000-aClP):0;
    const mtmPr=openPr>0?openPr*(latestSpot.precarite*1000-aPrP):0;
    // Couverture pricée
    const covPct=(oblClP+oblPrP)>0?(bClP+bPrP)/(oblClP+oblPrP)*100:0;
    return { month:MLS(month), oblCl:Math.round(oblCl), oblPr:Math.round(oblPr), oblClP:Math.round(oblClP), oblPrP:Math.round(oblPrP),
      bCl:Math.round(bCl), bPr:Math.round(bPr), bClP:Math.round(bClP), bPrP:Math.round(bPrP),
      pnlCl:Math.round(pnlCl/1000), pnlPr:Math.round(pnlPr/1000), pnl:Math.round((pnlCl+pnlPr)/1000),
      mtm:Math.round((mtmCl+mtmPr)/1000), covPct:Math.round(covPct), netPos:Math.round(bClP+bPrP-oblClP-oblPrP) };
  }),[trades,obligations,latestSpot]);

  // Price history for chart
  const priceHistory = useMemo(()=>[...prices].filter(p=>p.classique).sort((a,b)=>a.date.localeCompare(b.date)).map(p=>({ date:p.date.slice(5), cl:p.classique, pr:p.precarite })),[prices]);

  // Vendor breakdown
  const vendorData = useMemo(()=>{
    const m={};
    trades.filter(t=>t.status==="APPROVED").forEach(t=>{ m[t.vendor]=(m[t.vendor]||0)+t.volume; });
    return Object.entries(m).map(([name,vol])=>({ name, vol:Math.round(vol) })).sort((a,b)=>b.vol-a.vol).slice(0,8);
  },[trades]);

  // Cumulative PnL
  const cumPnlData = useMemo(()=>{
    let cum=0;
    return monthlyData.map(d=>{ cum+=d.pnl; return { month:d.month, pnl:d.pnl, cumPnl:cum }; });
  },[monthlyData]);

  // Coverage donut data
  const totalOblP=MONTHS_LIST.reduce((s,m)=>s+oblMonth(obligations,m,"CLASSIQUE",true)+oblMonth(obligations,m,"PRECARITE",true),0);
  const totalBoughtP=sumVol(trades,"CLASSIQUE",null,true)+sumVol(trades,"PRECARITE",null,true);
  const totalBought=sumVol(trades,"CLASSIQUE")+sumVol(trades,"PRECARITE");
  const totalUnpriced=MONTHS_LIST.reduce((s,m)=>s+oblMonth(obligations,m,"CLASSIQUE")+oblMonth(obligations,m,"PRECARITE"),0)-totalOblP;
  const covPct=totalOblP>0?Math.min(totalBoughtP/totalOblP*100,100):0;

  const REPORTS = [
    { id:"executive", label:"Executive Summary" },
    { id:"position",  label:"Position & Couverture" },
    { id:"pnl",       label:"PnL & MtM" },
    { id:"market",    label:"Prix Marché" },
  ];

  const SectionTitle = ({children}) => <p style={{ ...S,fontSize:"9px",color:"#38bdf8",textTransform:"uppercase",letterSpacing:"0.18em",marginBottom:"14px",marginTop:"8px" }}>{children}</p>;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"16px" }}>
      {/* Report selector */}
      <div style={{ display:"flex",gap:"8px",flexWrap:"wrap" }}>
        {REPORTS.map(r=>(
          <button key={r.id} onClick={()=>setReport(r.id)} style={{ ...S,fontSize:"10px",padding:"7px 14px",borderRadius:"2px",border:"1px solid",cursor:"pointer",letterSpacing:"0.08em",textTransform:"uppercase",background:report===r.id?"#38bdf8":"transparent",color:report===r.id?"#0a0e1a":"#3a5070",borderColor:report===r.id?"#38bdf8":"#1e2d45" }}>{r.label}</button>
        ))}
      </div>

      {/* ── EXECUTIVE SUMMARY ── */}
      {report==="executive" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"22px 26px" }}>
            <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"4px" }}>Rapport de Gestion CEE — P6</p>
            <h2 style={{ ...CG,fontSize:"28px",fontWeight:700,color:"#e2e8f0",marginBottom:"2px" }}>Tableau de Bord Exécutif</h2>
            <p style={{ ...S,fontSize:"10px",color:"#3a5070" }}>Au {prices.slice(-1)[0]?.date ?? "2026-03-06"} · Période de référence: 2026 (P6)</p>
          </div>

          {/* Top KPIs */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px" }}>
            <KPI large label="PnL Total Estimé"       value={fM(monthlyData.reduce((s,d)=>s+(d.pnl+d.mtm)*1000,0))} color={monthlyData.reduce((s,d)=>s+d.pnl+d.mtm,0)>=0?"emerald":"rose"} sub="Réalisé + MtM"/>
            <KPI large label="Stock Acheté Total"      value={N(totalBought,0)+" GWhc"} color="sky" sub={`CL: ${N(sumVol(trades,'CLASSIQUE'),0)} · PR: ${N(sumVol(trades,'PRECARITE'),0)}`}/>
            <KPI large label="Couverture Obligation"   value={N(covPct,1)+"%"} color={covPct>=100?"emerald":covPct>=70?"amber":"rose"} sub={`${N(totalOblP,0)} GWhc pricés`}/>
            <KPI large label="À Couvrir (Forward)"     value={N(totalUnpriced,0)+" GWhc"} color="rose" sub="Obligation non pricée restante"/>
          </div>

          {/* Coverage Donut + Waterfall */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 2fr",gap:"16px" }}>
            <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>Couverture Globale 2026</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={[{name:"Couvert",value:Math.round(totalBought)},{name:"Non pricé",value:Math.round(totalUnpriced)},{name:"Découvert",value:Math.max(0,Math.round(totalOblP-totalBought))}]} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    <Cell fill="#34d399"/><Cell fill="#f87171"/><Cell fill="#d4a843"/>
                  </Pie>
                  <Tooltip content={<ChartTip/>}/>
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ ...S,fontSize:"10px",color:"#4a6080" }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>Position Nette Mensuelle (GWhc) — Pricés</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barSize={18}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                  <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={40}/>
                  <Tooltip content={<ChartTip/>}/>
                  <ReferenceLine y={0} stroke="#1e2d45"/>
                  <Bar dataKey="netPos" name="Position nette" fill="#2563eb" radius={[1,1,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* PnL Bar + Cum line */}
          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>PnL Mensuel Réalisé (k€) + Cumulé</SectionTitle>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cumPnlData} barSize={20}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                <YAxis yAxisId="left"  tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={44}/>
                <YAxis yAxisId="right" orientation="right" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<ChartTip/>}/>
                <ReferenceLine yAxisId="left" y={0} stroke="#1e2d45"/>
                <Bar yAxisId="left" dataKey="pnl" name="PnL mensuel (k€)" fill="#34d399" radius={[1,1,0,0]}/>
                <Line yAxisId="right" type="monotone" dataKey="cumPnl" name="Cumulé (k€)" stroke="#38bdf8" strokeWidth={2} dot={false}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Vendor breakdown */}
          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Achats par Vendeur (GWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={vendorData} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" horizontal={false}/>
                <XAxis type="number" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{ ...S,fontSize:9,fill:"#4a6080" }} axisLine={false} tickLine={false} width={170}/>
                <Tooltip content={<ChartTip/>}/>
                <Bar dataKey="vol" name="Volume (GWhc)" fill="#38bdf8" radius={[0,1,1,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── POSITION & COUVERTURE ── */}
      {report==="position" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Obligation vs Achats par Mois (GWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<ChartTip/>}/>
                <Legend iconSize={8} wrapperStyle={{ ...S,fontSize:10,color:"#4a6080" }}/>
                <Bar dataKey="oblClP" name="Oblig. CL Pricée" fill="#1a3848" radius={[1,1,0,0]} stackId="obl"/>
                <Bar dataKey="oblPrP" name="Oblig. PR Pricée" fill="#2e2410" radius={[1,1,0,0]} stackId="obl"/>
                <Bar dataKey="bCl"    name="Acheté CL"        fill="#2563eb" radius={[1,1,0,0]} stackId="buy" fillOpacity={0.85}/>
                <Bar dataKey="bPr"    name="Acheté PR"        fill="#d4a843" radius={[1,1,0,0]} stackId="buy" fillOpacity={0.85}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>% Couverture par Mois</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyData}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={40} unit="%"/>
                <Tooltip content={<ChartTip/>}/>
                <ReferenceLine y={100} stroke="#34d399" strokeDasharray="4 2" label={{ value:"100%",fill:"#34d399",fontSize:9,...S }}/>
                <Area type="monotone" dataKey="covPct" name="Couverture %" stroke="#2563eb" fill="#5bc2e711" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Obligation Non Pricée (Forward) — GWhc à couvrir</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData.map(d=>({ ...d, unpriced:d.oblCl+d.oblPr-d.oblClP-d.oblPrP }))}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<ChartTip/>}/>
                <Bar dataKey="unpriced" name="Non pricé (GWhc)" fill="#f87171" radius={[1,1,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── PNL & MTM ── */}
      {report==="pnl" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px" }}>
            <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>PnL Réalisé Mensuel (k€)</SectionTitle>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData} barGap={3}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                  <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip content={<ChartTip/>}/>
                  <ReferenceLine y={0} stroke="#1e2d45"/>
                  <Bar dataKey="pnlCl" name="PnL Classique (k€)" fill="#2563eb" radius={[1,1,0,0]}/>
                  <Bar dataKey="pnlPr" name="PnL Précarité (k€)" fill="#d4a843" radius={[1,1,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>MtM Open Position Mensuel (k€)</SectionTitle>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                  <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip content={<ChartTip/>}/>
                  <ReferenceLine y={0} stroke="#1e2d45"/>
                  <Bar dataKey="mtm" name="MtM (k€)" fill="#38bdf8" radius={[1,1,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>PnL Cumulé YTD (k€)</SectionTitle>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cumPnlData}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={50}/>
                <Tooltip content={<ChartTip/>}/>
                <ReferenceLine y={0} stroke="#1e2d45"/>
                <Area type="monotone" dataKey="cumPnl" name="PnL cumulé (k€)" stroke="#34d399" fill="#6db87a22" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── PRIX MARCHÉ ── */}
      {report==="market" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Historique Prix C2E Market — Classique vs Précarité (€/MWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                <XAxis dataKey="date" tick={{ ...S,fontSize:8,fill:"#3a5070" }} axisLine={false} tickLine={false} interval={3}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={40} domain={["auto","auto"]}/>
                <Tooltip content={<ChartTip/>}/>
                <Legend iconSize={8} wrapperStyle={{ ...S,fontSize:10,color:"#4a6080" }}/>
                <Line type="monotone" dataKey="cl" name="Classique (€/MWhc)" stroke="#2563eb" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="pr" name="Précarité (€/MWhc)" stroke="#d4a843" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Courbe Forward (€/MWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={TENORS.map(t=>({ tenor:t, cl:curve[t]?.classique, pr:curve[t]?.precarite }))}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false}/>
                <XAxis dataKey="tenor" tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#3a5070" }} axisLine={false} tickLine={false} width={40} domain={["auto","auto"]}/>
                <Tooltip content={<ChartTip/>}/>
                <Legend iconSize={8} wrapperStyle={{ ...S,fontSize:10,color:"#4a6080" }}/>
                <Line type="monotone" dataKey="cl" name="Classique" stroke="#2563eb" strokeWidth={2} dot={{ fill:"#2563eb",r:3 }}/>
                <Line type="monotone" dataKey="pr" name="Précarité" stroke="#d4a843" strokeWidth={2} dot={{ fill:"#d4a843",r:3 }}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION VIEW
// ─────────────────────────────────────────────────────────────────────────────
function PositionView({ trades, obligations, curve, prices }) {
  const [view, setView] = useState("position");

  const latestSpot = useMemo(()=>{
    if(!prices.length) return { classique:(curve.SPOT?.classique??8.96)*1000, precarite:(curve.SPOT?.precarite??16.44)*1000 };
    const p=[...prices].sort((a,b)=>b.date.localeCompare(a.date))[0];
    return { classique:p.classique*1000, precarite:p.precarite*1000 };
  },[prices,curve]);

  const rows = useMemo(()=>MONTHS_LIST.map(month=>{
    const oblClP = oblMonth(obligations,month,"CLASSIQUE",true);
    const oblPrP = oblMonth(obligations,month,"PRECARITE",true);
    const oblClT = oblMonth(obligations,month,"CLASSIQUE");
    const oblPrT = oblMonth(obligations,month,"PRECARITE");

    const bClP = sumVol(trades,"CLASSIQUE",month,true);
    const bPrP = sumVol(trades,"PRECARITE",month,true);
    const bCl  = sumVol(trades,"CLASSIQUE",month);
    const bPr  = sumVol(trades,"PRECARITE",month);

    const aClP = wAvg(trades,"CLASSIQUE",month,true);
    const aPrP = wAvg(trades,"PRECARITE",month,true);

    const aCl  = wAvg(trades,"CLASSIQUE",month);
    const aPr  = wAvg(trades,"PRECARITE",month);

    const sCl = avgSellMonth(obligations,month,"CLASSIQUE");
    const sPr = avgSellMonth(obligations,month,"PRECARITE");

    // ✅ CORRECTION ICI → NET basé sur TOTAL
    const netCl = bCl - oblClT;
    const netPr = bPr - oblPrT;

    // ✅ CORRECTION ICI → couverture sur TOTAL
    const covPct = (oblClT+oblPrT)>0 ? (bCl+bPr)/(oblClT+oblPrT)*100 : 0;

    // PnL (inchangé)
    const matchCl = Math.min(bClP, oblClP);
    const matchPr = Math.min(bPrP, oblPrP);
    const pnlCl = (oblClP>0.001 && aClP>0 && sCl>0) ? (sCl - aClP) * matchCl : 0;
    const pnlPr = (oblPrP>0.001 && aPrP>0 && sPr>0) ? (sPr - aPrP) * matchPr : 0;

    // MtM (inchangé)
    const openCl = (oblClP>0.001 && (bClP-oblClP)>0) ? (bClP-oblClP) : 0;
    const openPr = (oblPrP>0.001 && (bPrP-oblPrP)>0) ? (bPrP-oblPrP) : 0;
    const mtmCl = openCl > 0 ? openCl * (latestSpot.classique - aClP) : 0;
    const mtmPr = openPr > 0 ? openPr * (latestSpot.precarite - aPrP) : 0;

    const oblClU = oblClT - oblClP;
    const oblPrU = oblPrT - oblPrP;

    const bClU = bCl - bClP;
    const bPrU = bPr - bPrP;

    return {
      month,
      oblClP, oblPrP,
      oblClT, oblPrT,
      bCl, bPr,
      bClP, bPrP,
      bClU, bPrU,
      aCl, aPr,
      aClP, aPrP,
      sCl, sPr,
      netCl, netPr,
      covPct,
      pnlCl, pnlPr,
      mtmCl, mtmPr,
      oblClU, oblPrU,
      unpricedBoughtCl:bClU,
      unpricedBoughtPr:bPrU
    };
  }),[trades,obligations,latestSpot]);

  // ✅ TOTAL corrigé
  const tot = useMemo(()=>({
    oblCl:rows.reduce((s,r)=>s+r.oblClT,0),
    oblPr:rows.reduce((s,r)=>s+r.oblPrT,0),
    bCl:rows.reduce((s,r)=>s+r.bCl,0),
    bPr:rows.reduce((s,r)=>s+r.bPr,0),
    pnlCl:rows.reduce((s,r)=>s+r.pnlCl,0),
    pnlPr:rows.reduce((s,r)=>s+r.pnlPr,0),
    mtmCl:rows.reduce((s,r)=>s+r.mtmCl,0),
    mtmPr:rows.reduce((s,r)=>s+r.mtmPr,0),
    oblClU:rows.reduce((s,r)=>s+r.oblClU,0),
    oblPrU:rows.reduce((s,r)=>s+r.oblPrU,0)
  }),[rows]);
  
  const VIEWS=[{id:"position",label:"Position & Couverture"},{id:"pnl",label:"PnL Réalisé & MtM"},{id:"unpriced",label:"Oblig. Non Pricées"}];

  const pc=(v,color)=>v!=null?(<span style={{ ...S,fontSize:"12px",color:v>0?CHART_COLORS.green:v<0?CHART_COLORS.red:"#3a5070",fontWeight:v!==0?600:400 }}>{v>0?"+":""}{N(v,2)}</span>):"—";
  const pk=(v)=>v!=null?(<span style={{ ...S,fontSize:"12px",color:v>0?CHART_COLORS.green:v<0?CHART_COLORS.red:"#3a5070",fontWeight:v!==0?600:400 }}>{fK(v)}</span>):"—";

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ display:"flex",gap:"14px",borderBottom:"1px solid #e2e4e8" }}>
        {VIEWS.map(v=><button key={v.id} onClick={()=>setView(v.id)} style={{ ...S,background:"none",border:"none",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",padding:"10px 0",cursor:"pointer",whiteSpace:"nowrap",color:view===v.id?"#38bdf8":"#3a5070",borderBottom:view===v.id?"1px solid #b8973a":"1px solid transparent" }}>{v.label}</button>)}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px" }}>
        {view==="position" && <><KPI label="Oblig. CL Pricée" value={N(tot.oblCl,0)+" GWhc"} color="sky"/><KPI label="Acheté CL" value={N(tot.bCl,0)+" GWhc"} color="sky"/><KPI label="Oblig. PR Pricée" value={N(tot.oblPr,0)+" GWhc"} color="amber"/><KPI label="Acheté PR" value={N(tot.bPr,0)+" GWhc"} color="amber"/></>}
        {view==="pnl"      && <><KPI label="PnL Réalisé CL" value={fK(tot.pnlCl)} color={tot.pnlCl>=0?"emerald":"rose"}/><KPI label="PnL Réalisé PR" value={fK(tot.pnlPr)} color={tot.pnlPr>=0?"emerald":"rose"}/><KPI label="MtM CL" value={fK(tot.mtmCl)} color={tot.mtmCl>=0?"emerald":"rose"}/><KPI label="MtM PR" value={fK(tot.mtmPr)} color={tot.mtmPr>=0?"emerald":"rose"}/></>}
        {view==="unpriced" && <><KPI label="Non Pricée CL" value={N(tot.oblClU,0)+" GWhc"} color="rose"/><KPI label="Non Pricée PR" value={N(tot.oblPrU,0)+" GWhc"} color="rose"/><KPI label="Total Non Pricé" value={N(tot.oblClU+tot.oblPrU,0)+" GWhc"} color="amber"/></>}
      </div><KPI label="Valeur Spot Estimée" value={fM(tot.oblClU*latestSpot.classique + tot.oblPrU*latestSpot.precarite)} color="gray"/>
      <div style={{ overflowX:"auto",border:"1px solid #1e1c18",borderRadius:"2px" }}>
        <table style={{ width:"100%",borderCollapse:"collapse",minWidth:"900px" }}>
          <thead><tr>
            <TH>Mois</TH>
            {view==="position"&&<><TH>Oblig. CL (GWhc)</TH><TH>Oblig. PR (GWhc)</TH><TH>Acheté CL</TH><TH>Acheté PR</TH><TH>Net CL</TH><TH>Net PR</TH><TH>% Couvert</TH><TH>Avg Achat CL</TH><TH>Avg Vente CL</TH></>}
            {view==="pnl"&&<><TH>Avg Achat CL</TH><TH>Avg Vente CL</TH><TH>PnL CL</TH><TH>Avg Achat PR</TH><TH>Avg Vente PR</TH><TH>PnL PR</TH><TH>MtM CL</TH><TH>MtM PR</TH><TH>Net PnL+MtM</TH></>}
            {view==="unpriced"&&<><TH>Oblig. CL Totale</TH><TH>Non Pricée CL</TH><TH>Oblig. PR Totale</TH><TH>Non Pricée PR</TH><TH>Total Non Pricé</TH><TH>Acheté (non pricé) CL</TH><TH>Position Forward CL</TH><TH>Val. Spot Estimée</TH></>}
          </tr></thead>
          <tbody>
            {rows.map((r,i)=>{
              const bg=i%2===0?"#111827":"#141210";
              const isForecast=r.month>"2026-03";
              return (
                <tr key={r.month} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#0d1526"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                  <td style={{ ...CG,fontSize:"15px",color:"#e2e8f0",padding:"9px 14px",fontWeight:600,whiteSpace:"nowrap" }}>
                    {ML(r.month)}{isForecast&&<span style={{ ...S,fontSize:"8px",color:"#1e2d45",marginLeft:"6px" }}>FCST</span>}
                  </td>
                  {view==="position"&&<>
                    <td style={{ ...S,fontSize:"12px",color:"#2563eb",padding:"9px 14px" }}>{N(r.oblClP,2)}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"9px 14px" }}>{N(r.oblPrP,2)}</td>
                    <td style={{ ...S,fontSize:"12px",color:r.bCl>0?"#e2e8f0":"#3d3830",padding:"9px 14px" }}>{N(r.bCl,2)}</td>
                    <td style={{ ...S,fontSize:"12px",color:r.bPr>0?"#e2e8f0":"#3d3830",padding:"9px 14px" }}>{N(r.bPr,2)}</td>
                    <td style={{ padding:"9px 14px" }}>{pc(r.netCl)}</td>
                    <td style={{ padding:"9px 14px" }}>{pc(r.netPr)}</td>
                    <td style={{ padding:"9px 14px",minWidth:"120px" }}>{(r.oblClP+r.oblPrP)>0?<CovBar pct={r.covPct}/>:<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{fmtMWhc(r.aCl)}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{fmtMWhc(r.sCl)}</td>
                  </>}
                  {view==="pnl"&&<>
                    <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{fmtMWhc(r.aCl)}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{fmtMWhc(r.sCl)}</td>
                    <td style={{ padding:"9px 14px" }}>{r.pnlCl!==0?pk(r.pnlCl):<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{fmtMWhc(r.aPr)}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{fmtMWhc(r.sPr)}</td>
                    <td style={{ padding:"9px 14px" }}>{r.pnlPr!==0?pk(r.pnlPr):<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{r.mtmCl!==0?pk(r.mtmCl):<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{r.mtmPr!==0?pk(r.mtmPr):<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{pk(r.pnlCl+r.pnlPr+r.mtmCl+r.mtmPr)}</td>
                  </>}
                  {view==="unpriced"&&<>
                    <td style={{ ...S,fontSize:"12px",color:"#2563eb",padding:"9px 14px" }}>{N(r.oblClT,2)}</td>
                    <td style={{ padding:"9px 14px" }}>{r.oblClU>0.01?<span style={{ ...S,fontSize:"12px",color:"#f87171",fontWeight:600 }}>{N(r.oblClU,2)}</span>:<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"9px 14px" }}>{N(r.oblPrT,2)}</td>
                    <td style={{ padding:"9px 14px" }}>{r.oblPrU>0.01?<span style={{ ...S,fontSize:"12px",color:"#f87171",fontWeight:600 }}>{N(r.oblPrU,2)}</span>:<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{(r.oblClU+r.oblPrU)>0.01?<span style={{ ...S,fontSize:"12px",color:"#f87171",fontWeight:600 }}>{N(r.oblClU+r.oblPrU,2)}</span>:<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:r.unpricedBoughtCl>0?"#e2e8f0":"#3d3830",padding:"9px 14px" }}>{r.unpricedBoughtCl>0.01?N(r.unpricedBoughtCl,2):"—"}</td>
                    <td style={{ padding:"9px 14px" }}>{(r.oblClU+r.oblPrU)>0.01?pc(r.unpricedBoughtCl+r.unpricedBoughtPr - r.oblClU - r.oblPrU):<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{(r.oblClU+r.oblPrU)>0.01?fK(r.oblClU*latestSpot.classique + r.oblPrU*latestSpot.precarite):"—"}</td>
                  </>}
                </tr>
              );
            })}
            <tr style={{ background:"#1e2d45",borderTop:"1px solid #2e2b24" }}>
              <td style={{ ...S,fontSize:"10px",color:"#38bdf8",padding:"10px 14px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em" }}>Total 2026</td>
              {view==="position"&&<><td style={{ ...S,fontSize:"12px",color:"#2563eb",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblCl,0)}</td><td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblPr,0)}</td><td style={{ ...S,fontSize:"12px",color:"#e2e8f0",padding:"10px 14px",fontWeight:700 }}>{N(tot.bCl,0)}</td><td style={{ ...S,fontSize:"12px",color:"#e2e8f0",padding:"10px 14px",fontWeight:700 }}>{N(tot.bPr,0)}</td><td colSpan={5}/></>}
              {view==="pnl"&&<><td colSpan={2}/><td style={{ padding:"10px 14px" }}>{pk(tot.pnlCl)}</td><td colSpan={2}/><td style={{ padding:"10px 14px" }}>{pk(tot.pnlPr)}</td><td style={{ padding:"10px 14px" }}>{pk(tot.mtmCl)}</td><td style={{ padding:"10px 14px" }}>{pk(tot.mtmPr)}</td><td style={{ padding:"10px 14px" }}>{pk(tot.pnlCl+tot.pnlPr+tot.mtmCl+tot.mtmPr)}</td></>}
              {view==="unpriced"&&<><td/><td style={{ ...S,fontSize:"12px",color:"#f87171",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblClU,0)}</td><td/><td style={{ ...S,fontSize:"12px",color:"#f87171",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblPrU,0)}</td><td style={{ ...S,fontSize:"13px",color:"#f87171",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblClU+tot.oblPrU,0)}</td><td colSpan={3}/></>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOTTER
// ─────────────────────────────────────────────────────────────────────────────
function Blotter({ trades, currentUser, onAdd, onApprove, onReject, onDelete }) {
  const [filter, setFilter] = useState("ALL");
  const [filterMonth, setFilterMonth] = useState("ALL");
  const [filterVendor, setFilterVendor] = useState("ALL");
  const [filterPriced, setFilterPriced] = useState("ALL");
  const [sortKey, setSortKey] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [showModal, setShowModal] = useState(false);

  const blank = { ceeType:"CLASSIQUE", vendor:"", dealType:"Fixed Price", period:"P6", volume:"", price:"", month:"", ranking:"", statut:"Attribué" };
  const [form, setForm] = useState(blank);

  const months = useMemo(
    () => ["ALL", ...new Set(trades.map(t => t.month).filter(Boolean))].sort(),
    [trades]
  );

  const vendors = useMemo(
    () => ["ALL", ...new Set(trades.map(t => t.vendor).filter(Boolean))].sort(),
    [trades]
  );

  const filtered = useMemo(() => {
    let l = [...trades];

    if (filter === "PENDING") l = l.filter(t => t.status === "PENDING");
    if (filter === "APPROVED") l = l.filter(t => t.status === "APPROVED");
    if (filter === "CLASSIQUE") l = l.filter(t => t.ceeType === "CLASSIQUE");
    if (filter === "PRECARITE") l = l.filter(t => t.ceeType === "PRECARITE");

    if (filterMonth !== "ALL") l = l.filter(t => t.month === filterMonth);
    if (filterVendor !== "ALL") l = l.filter(t => t.vendor === filterVendor);
    if (filterPriced !== "ALL") l = l.filter(t => String(t.priced) === filterPriced);

    l.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey];
      const bv = b[sortKey];

      if (sortKey === "volume" || sortKey === "price") {
        return ((av ?? 0) - (bv ?? 0)) * dir;
      }

      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });

    return l;
  }, [trades, filter, filterMonth, filterVendor, filterPriced, sortKey, sortDir]);

  const exportBlotterToExcel = () => {
    const data = filtered.map(t => ({
      ID: t.id,
      Type: t.ceeType,
      Vendeur: t.vendor,
      "Type deal": t.dealType,
      Période: t.period,
      "Volume (GWhc)": t.volume,
      "Prix (EUR/GWhc)": t.price ?? "",
      Mois: t.month,
      Pricé: t.priced ? "Oui" : "Non",
      "Statut contrat": t.statut || "",
      Ranking: t.ranking || "",
      EMMY: t.emmyValidated ? "Validé" : "En attente",
      Approbation: t.status,
      "Créé par": t.createdBy,
      "Approuvé par": t.approvedBy || "",
      "Date création": t.createdAt ? new Date(t.createdAt).toLocaleString("fr-FR") : ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!autofilter"] = { ref: worksheet["!ref"] };
    worksheet["!cols"] = Object.keys(data[0] || { Vide: "" }).map(() => ({ wch: 18 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Blotter");

    XLSX.writeFile(workbook, `CEE_Blotter_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const handleSubmit=()=>{
    if(!form.vendor||!form.volume||!form.price||!form.month) return;
    onAdd({...form,id:"t"+uid(),volume:parseFloat(form.volume),price:parseFloat(form.price),status:"PENDING",createdBy:currentUser.id,approvedBy:null,createdAt:new Date().toISOString(),emmyValidated:false});
    setShowModal(false); setForm(blank);
  };

  const SB=s=>s==="APPROVED"?<Badge color="green">Approuvé</Badge>:s==="PENDING"?<Badge color="amber">En attente</Badge>:<Badge color="red">Rejeté</Badge>;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:"10px" }}>
        <div style={{ display:"flex",flexWrap:"wrap",gap:"5px" }}>
          {["ALL", "PENDING", "APPROVED", "CLASSIQUE", "PRECARITE"].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...S,
                fontSize: "10px",
                padding: "5px 10px",
                borderRadius: "2px",
                border: "1px solid",
                cursor: "pointer",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                background: filter === f ? "#38bdf8" : "transparent",
                color: filter === f ? "#0a0e1a" : "#3a5070",
                borderColor: filter === f ? "#38bdf8" : "#1e2d45"
              }}
            >
              {f}
            </button>
          ))}

          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#4a6080",borderRadius:"2px",padding:"5px 8px",fontSize:"10px",outline:"none" }}>
            {months.map(m => <option key={m} value={m}>{m === "ALL" ? "Tous les mois" : ML(m)}</option>)}
          </select>

          <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)} style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#4a6080",borderRadius:"2px",padding:"5px 8px",fontSize:"10px",outline:"none",maxWidth:"180px" }}>
            {vendors.map(v => <option key={v} value={v}>{v === "ALL" ? "Tous vendeurs" : v}</option>)}
          </select>

          <select value={filterPriced} onChange={e => setFilterPriced(e.target.value)} style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#4a6080",borderRadius:"2px",padding:"5px 8px",fontSize:"10px",outline:"none" }}>
            <option value="ALL">Pricé / non pricé</option>
            <option value="true">Pricé</option>
            <option value="false">Non pricé</option>
          </select>

          <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#4a6080",borderRadius:"2px",padding:"5px 8px",fontSize:"10px",outline:"none" }}>
            <option value="createdAt">Tri création</option>
            <option value="month">Tri mois</option>
            <option value="vendor">Tri vendeur</option>
            <option value="volume">Tri volume</option>
            <option value="price">Tri prix</option>
            <option value="status">Tri statut</option>
          </select>

          <button onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} style={{ ...S,fontSize:"10px",padding:"5px 10px",borderRadius:"2px",border:"1px solid #1e2d45",cursor:"pointer",background:"transparent",color:"#3a5070" }}>
            {sortDir === "asc" ? "↑ ASC" : "↓ DESC"}
          </button>
        </div>

        <div style={{ display:"flex",gap:"8px",alignItems:"center" }}>
          <GhostBtn onClick={exportBlotterToExcel}>Exporter Excel</GhostBtn>
          {currentUser?.role === "trader" && (
            <GoldBtn onClick={()=>setShowModal(true)}>+ Nouvel Achat</GoldBtn>
          )}
        </div>
      </div>

      <div style={{ overflowX:"auto",border:"1px solid #1e1c18",borderRadius:"2px" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr>{["Type","Vendeur","Deal Type","Période","Volume (GWhc)","Prix (€/GWhc)","Mois","Pricé","Statut Contrat","Ranking","EMMY","Approbation","Actions"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
          <tbody>
            {filtered.map(t=>{
              const can=currentUser.role==="approver"&&t.status==="PENDING"&&t.createdBy!==currentUser.id;
              const bg="#111827";
              return(
                <tr key={t.id} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#0d1526"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.ceeType==="CLASSIQUE"?"sky":"amber"}>{t.ceeType}</Badge></td>
                  <td style={{ ...CG,fontSize:"14px",color:"#e2e8f0",padding:"9px 14px",maxWidth:"180px" }}>{t.vendor}</td>
                  <td style={{ ...S,fontSize:"10px",color:"#4a6080",padding:"9px 14px" }}>{t.dealType}</td>
                  <td style={{ ...S,fontSize:"10px",color:"#3a5070",padding:"9px 14px" }}>{t.period}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e2e8f0",padding:"9px 14px" }}>{N(t.volume,3)}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e2e8f0",padding:"9px 14px" }}>{N(t.price,0)}</td>
                  <td style={{ ...S,fontSize:"11px",color:"#4a6080",padding:"9px 14px",whiteSpace:"nowrap" }}>{ML(t.month)}</td>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.priced===true?"emerald":"gray"}>{t.priced===true?"✓ Oui":"Non"}</Badge></td>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.statut==="Attribué"?"green":"amber"}>{t.statut}</Badge></td>
                  <td style={{ ...S,fontSize:"10px",color:"#38bdf8",padding:"9px 14px" }}>{t.ranking||"—"}</td>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.emmyValidated?"green":"gray"}>{t.emmyValidated?"✓ EMMY":"En attente"}</Badge></td>
                  <td style={{ padding:"9px 14px" }}>{SB(t.status)}</td>
                  <td style={{ padding:"9px 14px" }}>
                    {can&&<div style={{ display:"flex",gap:"5px" }}><button onClick={()=>onApprove(t.id,currentUser.id)} style={{ ...S,fontSize:"10px",padding:"4px 8px",background:"#0a2a1a",color:"#34d399",border:"1px solid #1d4a2a",borderRadius:"2px",cursor:"pointer" }}>✓ OK</button><button onClick={()=>onReject(t.id)} style={{ ...S,fontSize:"10px",padding:"4px 8px",background:"#2a0a0a",color:"#f87171",border:"1px solid #4a1c1c",borderRadius:"2px",cursor:"pointer" }}>✗</button></div>}
                    {t.status==="PENDING"&&!can&&<span style={{ ...S,fontSize:"10px",color:"#1e2d45" }}>Attente approbateur</span>}
                    {currentUser?.role==="approver"&&<button onClick={()=>{if(window.confirm(`Supprimer ce trade ?`)) onDelete(t.id)}} style={{ ...S,fontSize:"9px",padding:"3px 7px",background:"none",color:"#3a5070",border:"1px solid #2e2b24",borderRadius:"2px",cursor:"pointer",marginTop:"4px" }}>🗑</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal&&(
        <Modal title="Nouvel Achat CEE" onClose={()=>setShowModal(false)} wide>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"13px" }}>
            <FS label="Type CEE" value={form.ceeType} onChange={e=>setForm(f=>({...f,ceeType:e.target.value}))}><option value="CLASSIQUE">Classique</option><option value="PRECARITE">Précarité</option></FS>
            <FI label="Vendeur" placeholder="ACT (Mandat 2026)…" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))}/>
            <FS label="Deal Type" value={form.dealType} onChange={e=>setForm(f=>({...f,dealType:e.target.value}))}><option value="Fixed Price">Fixed Price</option><option value="Floating">Floating</option></FS>
            <FS label="Période" value={form.period} onChange={e=>setForm(f=>({...f,period:e.target.value}))}><option value="P6">P6</option><option value="P5">P5</option></FS>
            <FI label="Volume (GWhc)" type="number" step="0.001" placeholder="0.000" value={form.volume} onChange={e=>setForm(f=>({...f,volume:e.target.value}))}/>
            <FI label="Prix (€/GWhc)" type="number" step="1" placeholder="9000" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))}/>
            <FI label="Mois" type="month" value={form.month} onChange={e=>setForm(f=>({...f,month:e.target.value}))}/>
            <FS label="Statut" value={form.statut} onChange={e=>setForm(f=>({...f,statut:e.target.value}))}><option value="Attribué">Attribué</option><option value="Pas encore contracté">Pas encore contracté</option><option value="Contrat signé">Contrat signé</option></FS>
            <FS label="Ranking" value={form.ranking} onChange={e=>setForm(f=>({...f,ranking:e.target.value}))}><option value="">—</option>{["AAA","AA","A+","BBB","BB","B+"].map(r=><option key={r}>{r}</option>)}</FS>
          </div>
          <div style={{ display:"flex",justifyContent:"flex-end",gap:"10px",marginTop:"16px" }}><GhostBtn onClick={()=>setShowModal(false)}>Annuler</GhostBtn><GoldBtn onClick={handleSubmit}>Soumettre</GoldBtn></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OBLIGATION TAB
// ─────────────────────────────────────────────────────────────────────────────
const CLIENTS=["Spot","Certas","Certas Lyon","Autre"];
function ObligationTab({ obligations, onAdd, onDelete }) {
  const [showModal,setShowModal]=useState(false);
  const [filterClient,setFilterClient]=useState("ALL");
  const [filterMonth,setFilterMonth]=useState("ALL");
  const blank={month:"",product:"CARBURANT",volume_m3:"",priceCl:"9000",pricePr:"15000",priced:false,client:"Spot"};
  const [form,setForm]=useState(blank);
  const months=useMemo(()=>["ALL",...new Set(obligations.map(o=>o.month))].sort(),[obligations]);
  const clients=useMemo(()=>["ALL",...new Set(obligations.map(o=>o.client))]     ,[obligations]);
  const filtered=useMemo(()=>{
    let l=obligations;
    if(filterClient!=="ALL") l=l.filter(o=>o.client===filterClient);
    if(filterMonth !=="ALL") l=l.filter(o=>o.month===filterMonth);
    return [...l].sort((a,b)=>a.month.localeCompare(b.month)||a.client.localeCompare(b.client));
  },[obligations,filterClient,filterMonth]);
  const handleAdd=()=>{
    if(!form.month||!form.volume_m3) return;
    const cee=calcCEE(parseFloat(form.volume_m3),form.product);
    onAdd({...form,id:"o"+uid(),volume_m3:parseFloat(form.volume_m3),priceCl:parseFloat(form.priceCl),pricePr:parseFloat(form.pricePr),clGwhc:cee.classique,prGwhc:cee.precarite});
    setShowModal(false); setForm(blank);
  };
  const cc=c=>({Spot:"sky",Certas:"gold","Certas Lyon":"teal",Autre:"gray"}[c]||"gray");
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"12px 18px",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"14px" }}>
        {[["Carburant kWhc/m³","8 718"],["FOD kWhc/m³","11 078"],["Coeff. Précarité","0.364"],["Coeff. Correctif","0.847"]].map(([k,v])=><div key={k}><p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.1em" }}>{k}</p><p style={{ ...S,fontSize:"14px",color:"#38bdf8",marginTop:"3px" }}>{v}</p></div>)}
      </div>
      <div style={{ display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:"10px" }}>
        <div style={{ display:"flex",gap:"5px",flexWrap:"wrap" }}>
          {clients.map(c=><button key={c} onClick={()=>setFilterClient(c)} style={{ ...S,fontSize:"10px",padding:"5px 10px",borderRadius:"2px",border:"1px solid",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",background:filterClient===c?"#38bdf8":"transparent",color:filterClient===c?"#0a0e1a":"#3a5070",borderColor:filterClient===c?"#38bdf8":"#1e2d45" }}>{c}</button>)}
          <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#4a6080",borderRadius:"2px",padding:"5px 8px",fontSize:"10px",outline:"none" }}>
            {months.map(m=><option key={m} value={m}>{m==="ALL"?"Tous les mois":ML(m)}</option>)}
          </select>
        </div>
        <GoldBtn onClick={()=>setShowModal(true)}>+ Ajouter Obligation</GoldBtn>
      </div>
      <div style={{ overflowX:"auto",border:"1px solid #1e1c18",borderRadius:"2px" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr>{["Mois","Client","Produit","Volume m³","CEE CL (GWhc)","CEE PR (GWhc)","Prix CL","Prix PR","Pricé",""].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
          <tbody>
            {filtered.map((o,i)=>{
              const bg=i%2===0?"#111827":"#141210";
              return(
                <tr key={o.id} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#0d1526"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                  <td style={{ ...CG,fontSize:"14px",color:"#e2e8f0",padding:"9px 14px" }}>{ML(o.month)}</td>
                  <td style={{ padding:"9px 14px" }}><Badge color={cc(o.client)}>{o.client}</Badge></td>
                  <td style={{ padding:"9px 14px" }}><Badge color={o.product==="CARBURANT"?"sky":"purple"}>{PARAMS[o.product].label}</Badge></td>
                  <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"9px 14px" }}>{N(o.volume_m3,0)}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#2563eb",padding:"9px 14px" }}>{N(o.clGwhc,3)}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"9px 14px" }}>{N(o.prGwhc,3)}</td>
                  <td style={{ ...S,fontSize:"11px",color:"#4a6080",padding:"9px 14px" }}>{N(o.priceCl/1000,2)}</td>
                  <td style={{ ...S,fontSize:"11px",color:"#4a6080",padding:"9px 14px" }}>{N(o.pricePr/1000,2)}</td>
                  <td style={{ padding:"9px 14px" }}><Badge color={o.priced?"green":"red"}>{o.priced?"Pricé":"Non pricé"}</Badge></td>
                  <td style={{ padding:"9px 14px" }}><button onClick={()=>onDelete(o.id)} style={{ ...S,fontSize:"9px",color:"#3d3830",background:"none",border:"none",cursor:"pointer" }}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showModal&&(
        <Modal title="Ajouter Obligation" onClose={()=>setShowModal(false)} wide>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"13px" }}>
            <FI label="Mois" type="month" value={form.month} onChange={e=>setForm(f=>({...f,month:e.target.value}))}/>
            <FS label="Client" value={form.client} onChange={e=>setForm(f=>({...f,client:e.target.value}))}>{CLIENTS.map(c=><option key={c}>{c}</option>)}</FS>
            <FS label="Produit" value={form.product} onChange={e=>setForm(f=>({...f,product:e.target.value}))}>
              <option value="CARBURANT">Carburant (Road Fuel) — 8 718 kWhc/m³</option>
              <option value="FOD">FOD (Domestic Fuel) — 11 078 kWhc/m³</option>
            </FS>
            <FI label="Volume (m³)" type="number" placeholder="45000" value={form.volume_m3} onChange={e=>setForm(f=>({...f,volume_m3:e.target.value}))}/>
            <FI label="Prix CEE Classique (€/MWhc)" type="number" placeholder="9.00" value={form.priceCl} onChange={e=>setForm(f=>({...f,priceCl:e.target.value}))}/>
            <FI label="Prix CEE Précarité (€/MWhc)" type="number" placeholder="15.00" value={form.pricePr} onChange={e=>setForm(f=>({...f,pricePr:e.target.value}))}/>
            <div style={{ display:"flex",alignItems:"center",gap:"10px",paddingTop:"18px" }}><input type="checkbox" id="pr" checked={form.priced} onChange={e=>setForm(f=>({...f,priced:e.target.checked}))} style={{ accentColor:"#38bdf8" }}/><label htmlFor="pr" style={{ ...S,fontSize:"11px",color:"#4a6080",cursor:"pointer" }}>Pricé</label></div>
          </div>
          <div style={{ display:"flex",justifyContent:"flex-end",gap:"10px",marginTop:"16px" }}><GhostBtn onClick={()=>setShowModal(false)}>Annuler</GhostBtn><GoldBtn onClick={handleAdd}>Ajouter</GoldBtn></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ trades, obligations, prices, curve }) {
  const latest=useMemo(()=>{
    if(!prices.length) return { classique:curve.SPOT?.classique??8.96, precarite:curve.SPOT?.precarite??16.44, date:"(courbe)" };
    const p=[...prices].sort((a,b)=>b.date.localeCompare(a.date))[0];
    return { classique:p.classique, precarite:p.precarite, date:p.date };
  },[prices,curve]);
  const spotCl=latest.classique, spotPr=latest.precarite;

  // ── Obligations ──
  // Pricées = obligation avec prix confirmé (Jan-Mar)
  // Non pricées = obligation sans prix (Mar partiel + Avr-Déc)
  const totalOblClP=MONTHS_LIST.reduce((s,m)=>s+oblMonth(obligations,m,"CLASSIQUE",true),0);
  const totalOblPrP=MONTHS_LIST.reduce((s,m)=>s+oblMonth(obligations,m,"PRECARITE",true),0);
  const totalOblP=totalOblClP+totalOblPrP;
  const totalOblClU=MONTHS_LIST.reduce((s,m)=>s+oblMonth(obligations,m,"CLASSIQUE")-oblMonth(obligations,m,"CLASSIQUE",true),0);
  const totalOblPrU=MONTHS_LIST.reduce((s,m)=>s+oblMonth(obligations,m,"PRECARITE")-oblMonth(obligations,m,"PRECARITE",true),0);

  // ── Achats PRICÉS (trade.priced===true) vs NON PRICÉS ──
  const bClP=sumVol(trades,"CLASSIQUE",null,true),  bPrP=sumVol(trades,"PRECARITE",null,true);
  const bClU=sumVol(trades,"CLASSIQUE",null,false)-bClP, bPrU=sumVol(trades,"PRECARITE",null,false)-bPrP;
  const aClP=wAvg(trades,"CLASSIQUE",null,true),    aPrP=wAvg(trades,"PRECARITE",null,true);
  const aClU=wAvg(trades,"CLASSIQUE")>0?
    (sumVol(trades,"CLASSIQUE")*wAvg(trades,"CLASSIQUE")-bClP*aClP)/(bClU||1):0;

  // Totaux globaux (pour affichage info)
  const bCl=sumVol(trades,"CLASSIQUE"), bPr=sumVol(trades,"PRECARITE");
  const aCl=wAvg(trades,"CLASSIQUE"),   aPr=wAvg(trades,"PRECARITE");

  // ── Position nette PRICÉE (vraie exposition couverte) ──
  const netClP=bClP-totalOblClP, netPrP=bPrP-totalOblPrP;
  // ── Position nette NON PRICÉE (forward exposure SHORT) ──
  const netClU=bClU-totalOblClU, netPrU=bPrU-totalOblPrU;

  // ── Couverture sur mois pricés ──
  const covClP=totalOblClP>0?bClP/totalOblClP*100:0;
  const covPrP=totalOblPrP>0?bPrP/totalOblPrP*100:0;
  const covP=totalOblP>0?(bClP+bPrP)/totalOblP*100:0;

  // ── MtM = (spot - avgBuyPricé) × position ouverte PRICÉE seulement ──
  // Excel: open = boughtPricé - oblPricé, par mois; seul Mar a une position ouverte
  const {mtmCl,mtmPr} = useMemo(()=>MONTHS_LIST.reduce((acc,month)=>{
    const oblClP=oblMonth(obligations,month,"CLASSIQUE",true);
    const oblPrP=oblMonth(obligations,month,"PRECARITE",true);
    if(oblClP<0.001&&oblPrP<0.001) return acc;
    const mBClP=sumVol(trades,"CLASSIQUE",month,true);
    const mBPrP=sumVol(trades,"PRECARITE",month,true);
    const mAClP=wAvg(trades,"CLASSIQUE",month,true);
    const mAPrP=wAvg(trades,"PRECARITE",month,true);
    const openCl=(mBClP>oblClP)?mBClP-oblClP:0;
    const openPr=(mBPrP>oblPrP)?mBPrP-oblPrP:0;
    return {
      mtmCl: acc.mtmCl+(openCl>0?openCl*(spotCl*1000-mAClP):0),
      mtmPr: acc.mtmPr+(openPr>0?openPr*(spotPr*1000-mAPrP):0),
    };
  },{mtmCl:0,mtmPr:0}),[trades,obligations,spotCl,spotPr]);

  // ── Data Quality ──
  const dataQualityChecks = useMemo(() => {
    const issues = [];

    trades.forEach(t => {
      if (!t.month) issues.push({ severity:"high", type:"Trade sans mois", detail:`Trade ${t.id} — ${t.vendor}` });
      if (!t.volume || t.volume <= 0) issues.push({ severity:"high", type:"Volume trade invalide", detail:`Trade ${t.id} — ${t.volume} GWhc` });
      if (t.priced && (!t.price || t.price <= 0)) issues.push({ severity:"high", type:"Prix trade manquant", detail:`Trade ${t.id} — ${t.vendor}` });
      if (t.status === "APPROVED" && !t.approvedBy) issues.push({ severity:"medium", type:"Trade approuvé sans approver", detail:`Trade ${t.id}` });
      if (t.month && !MONTHS_LIST.includes(t.month)) issues.push({ severity:"medium", type:"Mois trade hors scope", detail:`Trade ${t.id} — ${t.month}` });
    });

    obligations.forEach(o => {
      const month = o.month;
      const m = parseInt(month.split("-")[1], 10);
      const NEGATIVE_ALLOWED_MONTHS = [1, 2];
      if (!o.month) issues.push({ severity:"high", type:"Obligation sans mois", detail:`Obligation ${o.id}` });
      const isEarlyYear = m === 1 || m === 2; // Janvier / Février

      if (o.volume_m3 < 0 && !isEarlyYear) {
        issues.push({
          severity: "high",
          type: "Volume obligation négatif anormal",
          detail: `Obligation ${o.id} — ${N(o.volume_m3,0)} m³`
        });
      }

      if (o.priced && (!o.priceCl || !o.pricePr || o.priceCl <= 0 || o.pricePr <= 0)) {
        issues.push({ severity:"high", type:"Obligation pricée sans prix", detail:`Obligation ${o.id} — ${ML(o.month)}` });
      }
      if (o.month && !MONTHS_LIST.includes(o.month)) issues.push({ severity:"medium", type:"Mois obligation hors scope", detail:`Obligation ${o.id} — ${o.month}` });
    });

    const seen = new Map();
    trades.forEach(t => {
      const key = `${t.ceeType}|${t.vendor}|${t.month}|${t.volume}|${t.price}`;
      if (seen.has(key)) {
        issues.push({ severity:"medium", type:"Doublon trade potentiel", detail:`${seen.get(key)} / ${t.id} — ${t.vendor}` });
      } else {
        seen.set(key, t.id);
      }
    });

    return issues;
  }, [trades, obligations]);

  // ── PnL réalisé YTD (mois pricés) ──
  const {pnlClYTD,pnlPrYTD} = useMemo(()=>MONTHS_LIST.reduce((acc,month)=>{
    const oblClP=oblMonth(obligations,month,"CLASSIQUE",true);
    const oblPrP=oblMonth(obligations,month,"PRECARITE",true);
    if(oblClP<0.001&&oblPrP<0.001) return acc;
    const mBClP=sumVol(trades,"CLASSIQUE",month,true); const mBPrP=sumVol(trades,"PRECARITE",month,true);
    const mAClP=wAvg(trades,"CLASSIQUE",month,true);   const mAPrP=wAvg(trades,"PRECARITE",month,true);
    const mSCl=avgSellMonth(obligations,month,"CLASSIQUE");
    const mSPr=avgSellMonth(obligations,month,"PRECARITE");
    const matchCl=Math.min(mBClP,oblClP); const matchPr=Math.min(mBPrP,oblPrP);
    return {
      pnlClYTD: acc.pnlClYTD+(oblClP>0.001&&mAClP>0&&mSCl>0?(mSCl-mAClP)*matchCl:0),
      pnlPrYTD: acc.pnlPrYTD+(oblPrP>0.001&&mAPrP>0&&mSPr>0?(mSPr-mAPrP)*matchPr:0),
    };
  },{pnlClYTD:0,pnlPrYTD:0}),[trades,obligations]);

  // ── Risk / Exposure KPIs ──
  const netPriced = netClP + netPrP;
  const netUnpriced = netClU + netPrU;
  const totalOblU = totalOblClU + totalOblPrU;
  const totalBoughtU = bClU + bPrU;
  const coverageUnpriced = totalOblU > 0 ? (totalBoughtU / totalOblU) * 100 : 0;

  // ── Coverage Alerts ──
  const COVERAGE_ALERT_THRESHOLD = 80;

  const coverageRows = MONTHS_LIST.map(month => {
    const oblClP = oblMonth(obligations, month, "CLASSIQUE", true);
    const oblPrP = oblMonth(obligations, month, "PRECARITE", true);
    const boughtClP = sumVol(trades, "CLASSIQUE", month, true);
    const boughtPrP = sumVol(trades, "PRECARITE", month, true);

    const obligation = oblClP + oblPrP;
    const bought = boughtClP + boughtPrP;
    const covPct = obligation > 0 ? (bought / obligation) * 100 : null;

    return { month, obligation, bought, covPct };
  });

  const coverageAlerts = coverageRows.filter(
    r => r.covPct !== null && r.covPct < COVERAGE_ALERT_THRESHOLD
  );

  const worstCoverageMonth = coverageAlerts.length
    ? coverageAlerts.reduce((worst, r) => r.covPct < worst.covPct ? r : worst, coverageAlerts[0])
    : null;
  
  const EPS = 0.1;

  const getCoverageStatus = (pct) => {
    if (pct == null) {
      return {
        label: "Pas d'obligation",
        bg: "#111827",
        color: "#64748b",
        border: "#334155"
      };
    }

    if (pct >= 120) {
      return {
        label: "Surcouvert",
        bg: "#0e2030",
        color: "#38bdf8",
        border: "#1a3848"
      };
    }

    if (pct >= 100 - EPS) {
      return {
        label: "OK",
        bg: "#0f2e1a",
        color: "#34d399",
        border: "#1d4a2a"
      };
    }

    if (pct >= COVERAGE_ALERT_THRESHOLD) {
      return {
        label: "À surveiller",
        bg: "#2e2410",
        color: "#d4a843",
        border: "#4a3a18"
      };
    }

    return {
      label: "Sous-couvert",
      bg: "#2e1010",
      color: "#f87171",
      border: "#4a1c1c"
    };
  };

  const pending=trades.filter(t=>t.status==="PENDING").length;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"22px" }}>
  {pending>0&&(
    <div style={{ background:"#2a1f0a",border:"1px solid #5a4000",borderRadius:"2px",padding:"10px 16px",display:"flex",alignItems:"center",gap:"8px" }}>
      <span style={{ color:"#fbbf24",fontSize:"12px" }}>⚠</span>
      <span style={{ ...S,fontSize:"11px",color:"#fbbf24" }}>
        {pending} trade{pending>1?"s":""} en attente d'approbation (4-yeux)
      </span>
    </div>
  )}

  {coverageAlerts.length > 0 && (
    <div style={{ background:"#2a0a0a",border:"1px solid #7f1d1d",borderRadius:"2px",padding:"10px 16px",display:"flex",alignItems:"center",gap:"8px" }}>
      <span style={{ color:"#f87171",fontSize:"12px" }}>⚠</span>
      <span style={{ ...S,fontSize:"11px",color:"#fca5a5" }}>
        {coverageAlerts.length} mois sous le seuil de couverture de {COVERAGE_ALERT_THRESHOLD}% :{" "}
        {coverageAlerts.map(r => `${ML(r.month)} (${N(r.covPct,1)}%)`).join(", ")}
      </span>
    </div>
  )}

  {dataQualityChecks.length > 0 && (
    <div style={{
      background:"#2a0a0a",
      border:"1px solid #7f1d1d",
      borderRadius:"2px",
      padding:"10px 16px",
      display:"flex",
      flexDirection:"column",
      gap:"6px"
    }}>
      <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
        <span style={{ color:"#f87171",fontSize:"12px" }}>⚠</span>
        <span style={{ ...S,fontSize:"11px",color:"#fca5a5" }}>
          {dataQualityChecks.length} anomalie(s) détectée(s) dans les données
        </span>
      </div>

      <div style={{ ...S,fontSize:"10px",color:"#fca5a5" }}>
        {dataQualityChecks.slice(0,3).map((e,i)=>(
          <div key={i}>
            • {e.type} — {e.detail}
          </div>
        ))}
        {dataQualityChecks.length > 3 && (
          <div style={{ color:"#64748b" }}>
            … +{dataQualityChecks.length - 3} autres
          </div>
        )}
      </div>
    </div>
  )}

      {/* ── PnL / MtM / Spot ── */}
      <div>
        <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"10px" }}>Résumé PnL & Marché — 06/03/2026</p>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:"10px" }}>
          <KPI label="Spot Classique"   value={`${N(spotCl)} €/MWhc`} color="sky"   sub="Prix spot C2E"/>
          <KPI label="Spot Précarité"   value={`${N(spotPr)} €/MWhc`} color="amber" sub="Prix spot C2E"/>
          <KPI label="PnL Réalisé YTD"  value={fM(pnlClYTD+pnlPrYTD)} color={(pnlClYTD+pnlPrYTD)>=0?"emerald":"rose"} sub={`CL: ${fK(pnlClYTD)} · PR: ${fK(pnlPrYTD)}`}/>
          <KPI label="MtM Pos. Ouverte" value={fK(mtmCl+mtmPr)} color={(mtmCl+mtmPr)>=0?"emerald":"rose"} sub={`CL: ${fK(mtmCl)} · PR: ${fK(mtmPr)}`}/>
          <KPI label="Net PnL+MtM YTD"  value={fM(pnlClYTD+pnlPrYTD+mtmCl+mtmPr)} color={(pnlClYTD+pnlPrYTD+mtmCl+mtmPr)>=0?"emerald":"rose"} sub="Réalisé + MtM"/>
          <KPI label="En attente"       value={pending>0?`⚠ ${pending}`:"✓ 0"} color={pending>0?"amber":"emerald"} sub="Trades 4-yeux"/>
        </div>
      </div>
      {/* ── Risk / Exposure View ── */}
      <div>
        <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"10px" }}>
          Vue Risk / Exposition
        </p>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px" }}>
          <KPI
            label="Position nette pricée"
            value={`${netPriced >= 0 ? "+" : ""}${N(netPriced,0)} GWhc`}
            color={netPriced >= 0 ? "emerald" : "rose"}
            sub="Achats pricés - obligations pricées"
          />

          <KPI
            label="Position nette non pricée"
            value={`${netUnpriced >= 0 ? "+" : ""}${N(netUnpriced,0)} GWhc`}
            color={netUnpriced >= 0 ? "emerald" : "rose"}
            sub="Achats non pricés - obligations non pricées"
          />

          <KPI
            label="Couverture non pricée"
            value={`${N(coverageUnpriced,1)}%`}
            color={coverageUnpriced >= 100 ? "emerald" : coverageUnpriced >= 70 ? "amber" : "rose"}
            sub={`${N(totalBoughtU,0)} / ${N(totalOblU,0)} GWhc`}
          />
          <KPI
            label={worstCoverageMonth ? "Mois le plus risqué" : "Aucun risque détecté"}
            value={worstCoverageMonth ? ML(worstCoverageMonth.month) : "—"}
            color={worstCoverageMonth ? "rose" : "emerald"}
            sub={
              worstCoverageMonth
                ? `Couverture: ${N(worstCoverageMonth.covPct,1)}%`
                : "Aucun mois sous le seuil"
            }
          />
        </div>
      </div>
      {/* ── Heatmap Couverture Mensuelle ── */}
      <div>
        <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"10px" }}>
          Heatmap couverture mensuelle — obligations pricées
        </p>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(12,1fr)",gap:"8px" }}>
          {coverageRows.map(r => {
            const status = getCoverageStatus(r.covPct);
            const rawNet = r.bought - r.obligation;
            const net = Math.abs(rawNet) < 0.5 ? 0 : rawNet;
            const avgSpot = ((spotCl * 1000) + (spotPr * 1000)) / 2;
            const netValue = net * avgSpot;
            const isEmpty = r.obligation === 0;
            const displayPct = r.covPct > 150 ? ">150%" : `${N(r.covPct,1)}%`;

            return (
              <div
                key={r.month}
                title={
                  isEmpty
                    ? `${ML(r.month)} — Pas d'obligation pricée`
                    : `${ML(r.month)} — ${displayPct}% couvert · ${N(r.bought,0)} / ${N(r.obligation,0)} GWhc`
                }
                style={{
                  background: status.bg,
                  border: `1px solid ${status.border}`,
                  boxShadow: (!isEmpty && r.covPct < 80)
                    ? "0 0 0 1px #f87171 inset"
                    : "none",
                  borderRadius: "2px",
                  padding: "10px 8px",
                  minHeight: "88px"
                }}
              >
                <p style={{ ...S,fontSize:"9px",color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"6px" }}>
                  {MLS(r.month)}
                </p>

                {isEmpty ? (
                  <>
                    <p style={{ ...S,fontSize:"15px",fontWeight:600,color:status.color,marginBottom:"5px" }}>
                      —
                    </p>
                    <p style={{ ...S,fontSize:"9px",color:status.color,marginBottom:"4px" }}>
                      Pas d'obligation
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ ...S,fontSize:"17px",fontWeight:600,color:status.color,marginBottom:"4px" }}>
                      {displayPct}
                    </p>

                    <p style={{ ...S,fontSize:"9px",color:status.color,marginBottom:"4px" }}>
                      {status.label}
                    </p>
                  </>
                )}

                <p style={{ ...S,fontSize:"8px",color:"#64748b",marginBottom:"3px" }}>
                  {isEmpty ? "—" : `${N(r.bought,0)} / ${N(r.obligation,0)} GWhc`}
                </p>

                {!isEmpty && (
                  <p style={{ ...S,fontSize:"8px",color:net>=0?"#34d399":"#f87171" }}>
                    {net === 0 ? "0 GWhc" : `${net > 0 ? "+" : ""}${N(net,0)} GWhc`}
                  </p>
                )}
                {!isEmpty && net !== 0 && (
                <p style={{ ...S,fontSize:"8px",color:"#64748b",marginTop:"3px" }}>
                  Expo: {Math.abs(netValue) > 1_000_000 ? fM(netValue) : fK(netValue)}
                </p>
              )}
              </div>
            );
          })}
        </div>
      </div>
      {/* ── Position PRICÉE (Jan-Mar) ── */}
      <div>
        <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"8px" }}>Position PRICÉE — Achats confirmés vs obligations avec prix fixé</p>
        <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",overflow:"hidden",marginBottom:"16px" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead><tr>{["Type","Oblig. Pricée","Acheté Pricé","Position Nette","Avg Buy","Couverture"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
            <tbody>
              {[["CEE Classique",totalOblClP,bClP,netClP,aClP,"sky"],
                ["CEE Précarité",totalOblPrP,bPrP,netPrP,aPrP,"amber"],
                ["TOTAL",totalOblP,bClP+bPrP,netClP+netPrP,(bClP*aClP+bPrP*aPrP)/((bClP+bPrP)||1),"neutral"]].map(([label,obl,bought,net,avg])=>(
                <tr key={label} style={{ borderBottom:"1px solid #1a1815" }}>
                  <td style={{ ...CG,fontSize:"14px",color:"#e2e8f0",padding:"10px 16px" }}>{label}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"10px 16px" }}>{N(obl,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e2e8f0",padding:"10px 16px" }}>{N(bought,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",padding:"10px 16px",color:net>=0?"#34d399":"#f87171",fontWeight:600 }}>{net>=0?"+":""}{N(net,1)} GWh</td>
                  <td style={{ ...S,fontSize:"11px",color:"#4a6080",padding:"10px 16px" }}>{fmtMWhc(avg)}</td>
                  <td style={{ padding:"10px 16px",minWidth:"140px" }}><CovBar pct={obl>0?bought/obl*100:0}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Position NON PRICÉE ── */}
        <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"8px" }}>Position NON PRICÉE — Exposition Forward (Mar partiel + Avr–Déc, obligation sans prix fixé)</p>
        <div style={{ background:"#111827",border:"1px solid #252219",borderRadius:"2px",overflow:"hidden" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead><tr>{["Type","Oblig. Non Pricée","Acheté Non Pricé","Position Nette","Statut"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
            <tbody>
              {[["CEE Classique",totalOblClU,bClU,netClU],
                ["CEE Précarité",totalOblPrU,bPrU,netPrU],
                ["TOTAL",totalOblClU+totalOblPrU,bClU+bPrU,netClU+netPrU]].map(([label,obl,bought,net])=>(
                <tr key={label} style={{ borderBottom:"1px solid #1a1815" }}>
                  <td style={{ ...CG,fontSize:"14px",color:"#e2e8f0",padding:"10px 16px" }}>{label}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#4a6080",padding:"10px 16px" }}>{N(obl,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e2e8f0",padding:"10px 16px" }}>{N(bought,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",padding:"10px 16px",color:net>=0?"#34d399":"#f87171",fontWeight:600 }}>{net>=0?"+":""}{N(net,1)} GWh</td>
                  <td style={{ ...S,fontSize:"11px",padding:"10px 16px",color:net<0?"#f87171":"#34d399" }}>{net<0?"⚠ SHORT — oblig. non couvertes":"✓ Long / équilibré"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CURVE + PRICES (compact versions)
// ─────────────────────────────────────────────────────────────────────────────
function CurveTab({ curve, onUpdate, trades }) {
  const [editing,setEditing]=useState(null); const [draft,setDraft]=useState({classique:"",precarite:""});
  const mtm=tenor=>{const fp=curve[tenor];if(!fp)return null;const cl=trades.filter(t=>t.status==="APPROVED"&&t.ceeType==="CLASSIQUE");const pr=trades.filter(t=>t.status==="APPROVED"&&t.ceeType==="PRECARITE");const vCl=cl.reduce((s,t)=>s+t.volume,0),vPr=pr.reduce((s,t)=>s+t.volume,0);const aCl=vCl>0?cl.reduce((s,t)=>s+t.price*t.volume,0)/vCl:0;const aPr=vPr>0?pr.reduce((s,t)=>s+t.price*t.volume,0)/vPr:0;const mCl=(fp.classique-aCl/1000)*vCl,mPr=(fp.precarite-aPr/1000)*vPr;return{mCl,mPr,tot:mCl+mPr};};
  return(
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ overflowX:"auto",border:"1px solid #1e1c18",borderRadius:"2px" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr>{["Tenor","CL (€/MWhc)","PR (€/MWhc)","MtM CL","MtM PR","MtM Total",""].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
          <tbody>
            {TENORS.map(t=>{const fp=curve[t],m=mtm(t),isE=editing===t,bg="#111827";return(
              <tr key={t} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#0d1526"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                <td style={{ padding:"9px 14px" }}><Badge color={t==="SPOT"?"gold":"gray"}>{t}</Badge></td>
                {isE?<><td style={{ padding:"7px 14px" }}><input value={draft.classique} onChange={e=>setDraft(d=>({...d,classique:e.target.value}))} style={{ ...S,background:"#0d1526",border:"1px solid #b8973a",color:"#e2e8f0",borderRadius:"2px",padding:"5px 8px",fontSize:"12px",width:"80px",outline:"none" }}/></td><td style={{ padding:"7px 14px" }}><input value={draft.precarite} onChange={e=>setDraft(d=>({...d,precarite:e.target.value}))} style={{ ...S,background:"#0d1526",border:"1px solid #b8973a",color:"#e2e8f0",borderRadius:"2px",padding:"5px 8px",fontSize:"12px",width:"80px",outline:"none" }}/></td></>:<><td style={{ ...S,fontSize:"13px",color:"#2563eb",padding:"9px 14px",fontWeight:500 }}>{fp?N(fp.classique):"—"}</td><td style={{ ...S,fontSize:"13px",color:"#d4a843",padding:"9px 14px",fontWeight:500 }}>{fp?N(fp.precarite):"—"}</td></>}
                <td style={{ ...S,fontSize:"12px",padding:"9px 14px",color:m&&m.mCl>=0?"#34d399":"#f87171" }}>{m?fK(m.mCl):"—"}</td>
                <td style={{ ...S,fontSize:"12px",padding:"9px 14px",color:m&&m.mPr>=0?"#34d399":"#f87171" }}>{m?fK(m.mPr):"—"}</td>
                <td style={{ ...S,fontSize:"13px",padding:"9px 14px",fontWeight:700,color:m&&m.tot>=0?"#34d399":"#f87171" }}>{m?fK(m.tot):"—"}</td>
                <td style={{ padding:"9px 14px" }}>{isE?<button onClick={()=>{onUpdate(t,{classique:parseFloat(draft.classique),precarite:parseFloat(draft.precarite)});setEditing(null);}} style={{ ...S,fontSize:"10px",padding:"4px 10px",background:"#38bdf8",color:"#0a0e1a",border:"none",borderRadius:"2px",cursor:"pointer" }}>✓</button>:<button onClick={()=>{setEditing(t);setDraft({classique:String(fp?.classique??""),precarite:String(fp?.precarite??"")});}} style={{ ...S,fontSize:"10px",padding:"4px 10px",background:"transparent",color:"#3a5070",border:"1px solid #2e2b24",borderRadius:"2px",cursor:"pointer" }}>Modifier</button>}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PricesTab({ prices, currentUser, onAdd }) {
  const [showModal,setShowModal]=useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form,setForm]=useState({date:today,classique:"",precarite:""});
  const handleAdd = () => {
    if (!form.date || !form.classique || !form.precarite) {
      alert("Merci de remplir tous les champs.");
      return;
    }

    onAdd({
      id: "p" + uid(),
      date: form.date,
      classique: parseFloat(form.classique),
      precarite: parseFloat(form.precarite),
      enteredBy: currentUser.id,
      enteredAt: new Date().toISOString()
    });

    setShowModal(false);
    setForm({ date: today, classique: "", precarite: "" });
};
  const sorted=[...prices].sort((a,b)=>b.date.localeCompare(a.date));
  return(
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ display:"flex",justifyContent:"flex-end" }}><GoldBtn onClick={()=>setShowModal(true)}>+ Ajouter Prix</GoldBtn></div>
      <div style={{ border:"1px solid #1e1c18",borderRadius:"2px",overflow:"hidden" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr>{["Date","Classique (€/MWhc)","Précarité (€/MWhc)","Saisi par","Horodatage"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
          <tbody>
            {sorted.map((p,i)=>{const user=USERS.find(u=>u.id===p.enteredBy);const bg=i===0?"#0d1526":"#111827";return(
              <tr key={p.id} style={{ borderBottom:"1px solid #1a1815",background:bg }}>
                <td style={{ ...S,fontSize:"12px",color:"#e2e8f0",padding:"10px 14px",fontWeight:500 }}>{p.date}{i===0&&<span style={{ marginLeft:"8px",fontSize:"9px",color:"#38bdf8" }}>DERNIER</span>}</td>
                <td style={{ ...S,fontSize:"13px",color:"#2563eb",padding:"10px 14px" }}>{N(p.classique)}</td>
                <td style={{ ...S,fontSize:"13px",color:"#d4a843",padding:"10px 14px" }}>{N(p.precarite)}</td>
                <td style={{ ...S,fontSize:"11px",color:"#4a6080",padding:"10px 14px" }}>{user?.name??p.enteredBy}</td>
                <td style={{ ...S,fontSize:"10px",color:"#3d3830",padding:"10px 14px" }}>{new Date(p.enteredAt).toLocaleString("fr-FR")}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      {showModal&&(<Modal title="Ajouter Prix Marché" onClose={()=>setShowModal(false)}><div style={{ display:"flex",flexDirection:"column",gap:"13px" }}><FI label="Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/><FI label="Classique (€/MWhc)" type="number" step="0.01" placeholder="8.96" value={form.classique} onChange={e=>setForm(f=>({...f,classique:e.target.value}))}/><FI label="Précarité (€/MWhc)" type="number" step="0.01" placeholder="16.44" value={form.precarite} onChange={e=>setForm(f=>({...f,precarite:e.target.value}))}/></div><div style={{ display:"flex",justifyContent:"flex-end",gap:"10px",marginTop:"16px" }}><GhostBtn onClick={()=>setShowModal(false)}>Annuler</GhostBtn><GoldBtn onClick={handleAdd}>Sauvegarder</GoldBtn></div></Modal>)}
    </div>
  );
}

function AuditLog({ audit, users = USERS }) {
  const [filterUser, setFilterUser] = useState("ALL");
  const [filterAction, setFilterAction] = useState("ALL");
  const [search, setSearch] = useState("");

  const AC = {
    TRADE_CREATED: "blue",
    TRADE_APPROVED: "green",
    TRADE_REJECTED: "red",
    TRADE_DELETED: "red",
    PRICE_ADDED: "amber",
    OBLIG_ADDED: "sky",
    CURVE_UPDATED: "purple"
  };

  const getUser = (userId) => {
    if (!userId || userId === "undefined") {
      return { name: "Utilisateur inconnu", initials: "?" };
    }

    const user = users.find(u => u.id === userId) || USERS.find(u => u.id === userId);

    if (!user) {
      return { name: `Utilisateur ${userId}`, initials: "?" };
    }

    return {
      name: user.name || `Utilisateur ${userId}`,
      initials: user.initials || user.name?.split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase() || "?"
    };
  };

  const actions = useMemo(
    () => ["ALL", ...new Set(audit.map(a => a.action).filter(Boolean))].sort(),
    [audit]
  );

  const auditUsers = useMemo(
    () => ["ALL", ...new Set(audit.map(a => a.user).filter(Boolean))],
    [audit]
  );

  const filteredAudit = useMemo(() => {
    const q = search.trim().toLowerCase();

    return [...audit]
      .filter(a => filterUser === "ALL" || a.user === filterUser)
      .filter(a => filterAction === "ALL" || a.action === filterAction)
      .filter(a => {
        if (!q) return true;
        const user = getUser(a.user);

        return [a.ts, user.name, a.action, a.entity, a.detail]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.ts.localeCompare(a.ts));
  }, [audit, filterUser, filterAction, search, users]);

  const escapeCsv = (value) => {
    const v = value == null ? "" : String(value);
    return `"${v.replace(/"/g, '""')}"`;
  };

  const handleExport = () => {
    const header = ["Timestamp", "Utilisateur", "Action", "Entité", "Détail"];

    const rows = filteredAudit.map(a => {
      const user = getUser(a.user);

      return [
        a.ts,
        user.name,
        a.action,
        a.entity,
        a.detail
      ].map(escapeCsv).join(",");
    });

    const csv = "\uFEFF" + [header.map(escapeCsv).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    const url = URL.createObjectURL(blob);
    const l = document.createElement("a");
    l.href = url;
    l.download = "cee_audit.csv";
    l.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ display:"flex",justifyContent:"space-between",gap:"8px",alignItems:"center",flexWrap:"wrap" }}>
        <div style={{ display:"flex",gap:"8px",flexWrap:"wrap" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher..."
            style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#e2e8f0",borderRadius:"2px",padding:"7px 10px",fontSize:"10px",outline:"none",width:"220px" }}
          />

          <select
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#4a6080",borderRadius:"2px",padding:"7px 10px",fontSize:"10px",outline:"none" }}
          >
            {auditUsers.map(u => {
              const user = u === "ALL" ? null : getUser(u);
              return <option key={u} value={u}>{u === "ALL" ? "Tous utilisateurs" : user.name}</option>;
            })}
          </select>

          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#4a6080",borderRadius:"2px",padding:"7px 10px",fontSize:"10px",outline:"none" }}
          >
            {actions.map(a => (
              <option key={a} value={a}>{a === "ALL" ? "Toutes actions" : a.replace(/_/g," ")}</option>
            ))}
          </select>

          <span style={{ ...S,fontSize:"10px",color:"#3a5070",alignSelf:"center" }}>
            {filteredAudit.length} / {audit.length} lignes
          </span>
        </div>

        <GhostBtn onClick={handleExport}>↓ Exporter CSV</GhostBtn>
      </div>

      <div style={{ border:"1px solid #1e1c18",borderRadius:"2px",overflow:"hidden" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead>
            <tr>
              {["Horodatage","Utilisateur","Action","Entité","Détail"].map(h => (
                <TH key={h}>{h}</TH>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredAudit.map(a => {
              const user = getUser(a.user);
              const bg = "#111827";

              return (
                <tr key={a.id} style={{ borderBottom:"1px solid #1a1815",background:bg }}>
                  <td style={{ ...S,fontSize:"10px",color:"#3a5070",padding:"9px 14px",whiteSpace:"nowrap" }}>
                    {new Date(a.ts).toLocaleString("fr-FR")}
                  </td>

                  <td style={{ padding:"9px 14px" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:"6px" }}>
                      <span style={{ ...S,width:"22px",height:"22px",borderRadius:"50%",background:"#1e2d45",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",color:"#38bdf8",fontWeight:600 }}>
                        {user.initials}
                      </span>
                      <span style={{ ...S,fontSize:"10px",color:"#4a6080" }}>
                        {user.name}
                      </span>
                    </div>
                  </td>

                  <td style={{ padding:"9px 14px" }}>
                    <Badge color={AC[a.action] || "gray"}>
                      {(a.action || "UNKNOWN").replace(/_/g," ")}
                    </Badge>
                  </td>

                  <td style={{ ...S,fontSize:"10px",color:"#3d3830",padding:"9px 14px" }}>
                    {a.entity || "—"}
                  </td>

                  <td style={{ ...S,fontSize:"10px",color:"#4a6080",padding:"9px 14px" }}>
                    {a.detail || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tools({ curve }) {
  const [pnlTool, setPnlTool] = useState({
    cp: "ACT",
    ceeType: "Classique",
    product: "CARBURANT",
    volumeGWhc: 3500000,
    expectedSellingDate: "2026-12-01",
    purchasePriceMWhc: 8.5,
    maturityPeriod: "S2-28",
    discountingRate: 4,
    sellingPriceMode: "spot",
    sellingPriceMWhcManual: 16.57,
  });

  const update = (field, value) => {
    setPnlTool(prev => ({ ...prev, [field]: value }));
  };

  const [convertTool, setConvertTool] = useState({
  product: "CARBURANT",
  classiqueMWhc: curve?.SPOT?.classique || 0,
  precariteMWhc: curve?.SPOT?.precarite || 0,
  useSpot: true,
  });

  const updateConvert = (field, value) => {
    setConvertTool(prev => ({ ...prev, [field]: value }));
  };

  const result = useMemo(() => {
    const productParams = PARAMS[pnlTool.product];
    const energyFactor = productParams.kwhc_per_m3;
    const precaCoeff = pnlTool.ceeType === "Preca" ? productParams.coeff_precarite : 1;

    const volumeGWhc = Number(pnlTool.volumeGWhc) || 0;
    const purchasePriceMWhc = Number(pnlTool.purchasePriceMWhc) || 0;
    const discountingRate = (Number(pnlTool.discountingRate) || 0) / 100;

    const expectedSellingDate = new Date(pnlTool.expectedSellingDate);
    const maturityEstDate = new Date(MATURITY_DATES[pnlTool.maturityPeriod]);

    const volumeM3 = volumeGWhc * 1_000_000 / energyFactor / precaCoeff;
    const purchasePriceM3 = energyFactor * purchasePriceMWhc / 1000 * precaCoeff;

    const spotSellingPriceMWhc =
      pnlTool.ceeType === "Classique"
        ? curve?.SPOT?.classique || 0
        : curve?.SPOT?.precarite || 0;

    const sellingPriceMWhc =
      pnlTool.sellingPriceMode === "manual"
        ? Number(pnlTool.sellingPriceMWhcManual) || 0
        : spotSellingPriceMWhc;

    const sellingPriceM3 = energyFactor * sellingPriceMWhc / 1000 * precaCoeff;

    const numberOfDays = Math.max(
      0,
      Math.round((maturityEstDate - expectedSellingDate) / MS_PER_DAY)
    );

    const discountingFactor = numberOfDays / 365;
    const ceePurchasePriceMarket = purchasePriceM3;

    const ceePurchasePriceNpvM3 =
      ceePurchasePriceMarket / Math.pow(1 + discountingRate, discountingFactor);

    const ceePurchasePriceNpvMWhc =
      ceePurchasePriceNpvM3 / energyFactor * 1000 / precaCoeff;

    const spreadNpvVsFacial = ceePurchasePriceMarket - ceePurchasePriceNpvM3;
    const totalSpread = sellingPriceM3 - ceePurchasePriceNpvM3;

    const pnlEur = totalSpread * volumeM3;
    const pnlWithoutFinancing = (sellingPriceM3 - purchasePriceM3) * volumeM3;
    const netFinancingImpact = pnlEur - pnlWithoutFinancing;

    return {
      energyFactor,
      precaCoeff,
      volumeM3,
      purchasePriceM3,
      spotSellingPriceMWhc,
      sellingPriceMWhc,
      sellingPriceM3,
      maturityEstDate: MATURITY_DATES[pnlTool.maturityPeriod],
      numberOfDays,
      discountingFactor,
      ceePurchasePriceMarket,
      ceePurchasePriceNpvM3,
      ceePurchasePriceNpvMWhc,
      spreadNpvVsFacial,
      totalSpread,
      pnlEur,
      pnlWithoutFinancing,
      netFinancingImpact,
    };
  }, [pnlTool, curve]);

  const convertResult = useMemo(() => {
    const productParams = PARAMS[convertTool.product];

    const classiqueMWhc = convertTool.useSpot
      ? curve?.SPOT?.classique || 0
      : Number(convertTool.classiqueMWhc) || 0;

    const precariteMWhc = convertTool.useSpot
      ? curve?.SPOT?.precarite || 0
      : Number(convertTool.precariteMWhc) || 0;

    const classiqueEurM3 =
      classiqueMWhc * productParams.kwhc_per_m3 / 1000;

    const precariteEurM3 =
      precariteMWhc *
      productParams.kwhc_per_m3 /
      1000 *
      productParams.coeff_precarite *
      productParams.coeff_correctif;

    const totalEurM3 = classiqueEurM3 + precariteEurM3;

    return {
      productLabel: productParams.label,
      kwhcPerM3: productParams.kwhc_per_m3,
      coeffPrecarite: productParams.coeff_precarite,
      coeffCorrectif: productParams.coeff_correctif,
      classiqueMWhc,
      precariteMWhc,
      classiqueEurM3,
      precariteEurM3,
      totalEurM3,
    };
  }, [convertTool, curve]);

  const row = (label, value, highlight = false) => (
    <tr>
      <td style={{ ...S, padding:"9px 12px", color:"#8aa0c0", borderBottom:"1px solid #1e2d45" }}>
        {label}
      </td>
      <td style={{
        ...S,
        padding:"9px 12px",
        color: highlight ? "#34d399" : "#e2e8f0",
        fontWeight: highlight ? 700 : 500,
        textAlign:"right",
        borderBottom:"1px solid #1e2d45"
      }}>
        {value}
      </td>
    </tr>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"18px" }}>
      <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"22px" }}>
        <p style={{ ...S, fontSize:"9px", color:"#38bdf8", textTransform:"uppercase", letterSpacing:"0.18em", marginBottom:"8px" }}>
          Outils CEE
        </p>
        <h2 style={{ ...CG, fontSize:"24px", color:"#e2e8f0", marginBottom:"4px" }}>
          Calculatrice PNL C2E
        </h2>
        <p style={{ ...S, fontSize:"11px", color:"#3a5070" }}>
          Simulation du PNL avec effet de financement selon le produit, le type CEE, le volume et la maturité.
        </p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"12px" }}>
        <KPI label="PNL - EUR" value={N(result.pnlEur, 2) + " €"} color="emerald" large />
        <KPI label="PNL without Financing" value={N(result.pnlWithoutFinancing, 2) + " €"} color="sky" large />
        <KPI label="Net Financing Impact" value={N(result.netFinancingImpact, 2) + " €"} color={result.netFinancingImpact >= 0 ? "emerald" : "rose"} large />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"360px 1fr", gap:"16px" }}>
        <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"18px" }}>
          <p style={{ ...S, fontSize:"9px", color:"#38bdf8", textTransform:"uppercase", letterSpacing:"0.16em", marginBottom:"14px" }}>
            Inputs
          </p>

          <div style={{ display:"grid", gap:"12px" }}>
            <FI label="CP" value={pnlTool.cp} onChange={e => update("cp", e.target.value)} />

            <FS label="CEE Type" value={pnlTool.ceeType} onChange={e => update("ceeType", e.target.value)}>
              <option value="Classique">Classique</option>
              <option value="Preca">Preca</option>
            </FS>

            <FS label="Product against" value={pnlTool.product} onChange={e => update("product", e.target.value)}>
              <option value="CARBURANT">Road Fuel</option>
              <option value="FOD">FOD</option>
            </FS>

            <FI label="Volume GWhc" type="number" value={pnlTool.volumeGWhc} onChange={e => update("volumeGWhc", e.target.value)} />

            <FI label="Purchase Price - €/MWhc" type="number" step="0.01" value={pnlTool.purchasePriceMWhc} onChange={e => update("purchasePriceMWhc", e.target.value)} />

            <FS label="Selling Price Mode" value={pnlTool.sellingPriceMode} onChange={e => update("sellingPriceMode", e.target.value)}>
              <option value="spot">Prix spot</option>
              <option value="manual">Entrée manuelle</option>
            </FS>

            <FI
              label="Selling Price - €/MWhc"
              type="number"
              step="0.01"
              value={pnlTool.sellingPriceMode === "spot"
                ? (pnlTool.ceeType === "Classique" ? curve?.SPOT?.classique ?? "" : curve?.SPOT?.precarite ?? "")
                : pnlTool.sellingPriceMWhcManual}
              disabled={pnlTool.sellingPriceMode === "spot"}
              onChange={e => update("sellingPriceMWhcManual", e.target.value)}
            />

            <FS label="Expected selling date" value={pnlTool.expectedSellingDate} onChange={e => update("expectedSellingDate", e.target.value)}>
              {MONTHS_LIST.map(m => <option key={m} value={`${m}-01`}>{ML(m)}</option>)}
            </FS>

            <FS label="CEE purchase maturity" value={pnlTool.maturityPeriod} onChange={e => update("maturityPeriod", e.target.value)}>
              {MATURITY_TENORS.map(t => <option key={t} value={t}>{t}</option>)}
            </FS>

            <FI label="Discounting rate (%)" type="number" step="0.1" value={pnlTool.discountingRate} onChange={e => update("discountingRate", e.target.value)} />
          </div>
        </div>

        <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"18px" }}>
          <p style={{ ...S, fontSize:"9px", color:"#38bdf8", textTransform:"uppercase", letterSpacing:"0.16em", marginBottom:"14px" }}>
            Résultats
          </p>

          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <tbody>
              {row("Product factor", `${N(result.energyFactor, 0)} kWhc/m³`)}
              {row("Volume - m³", N(result.volumeM3, 2))}
              {row("Purchase Price - €/m³", N(result.purchasePriceM3, 2))}
              {row("Selling Price - €/m³", N(result.sellingPriceM3, 2))}
              {row("Selling Price - €/MWhc", N(result.sellingPriceMWhc, 2))}
              {row("CEE purchase Maturity Est-Date", result.maturityEstDate)}
              {row("Number of days", N(result.numberOfDays, 0))}
              {row("Discounting factor", N(result.discountingFactor, 2))}
              {row("CEE Purchase Price (C2E Market)", N(result.ceePurchasePriceMarket, 2))}
              {row("CEE Purchase Price NPV - €/m³", N(result.ceePurchasePriceNpvM3, 2))}
              {row("CEE Purchase Price NPV - €/MWhc", N(result.ceePurchasePriceNpvMWhc, 2))}
              {row("Spread NPV vs Facial", N(result.spreadNpvVsFacial, 2))}
              {row("Total Spread", N(result.totalSpread, 2))}
              {row("PNL - EUR", N(result.pnlEur, 2) + " €", true)}
              {row("PNL without Financing", N(result.pnlWithoutFinancing, 2) + " €")}
              {row("Net Financing Impact", N(result.netFinancingImpact, 2) + " €", true)}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"22px" }}>
        <p style={{ ...S, fontSize:"9px", color:"#38bdf8", textTransform:"uppercase", letterSpacing:"0.18em", marginBottom:"8px" }}>
          Conversion CEE
        </p>

        <h2 style={{ ...CG, fontSize:"22px", color:"#e2e8f0", marginBottom:"4px" }}>
          Convertisseur €/MWhc → €/m³
        </h2>

        <p style={{ ...S, fontSize:"11px", color:"#3a5070", marginBottom:"18px" }}>
          Conversion des prix CEE Classique et Précarité en impact produit €/m³ selon les facteurs Road Fuel / FOD.
        </p>

        <div style={{ display:"grid", gridTemplateColumns:"360px 1fr", gap:"16px" }}>
          <div style={{ display:"grid", gap:"12px" }}>
            <FS label="Produit" value={convertTool.product} onChange={e => updateConvert("product", e.target.value)}>
              <option value="CARBURANT">Road Fuel</option>
              <option value="FOD">FOD</option>
            </FS>

            <FS label="Source prix" value={convertTool.useSpot ? "spot" : "manual"} onChange={e => updateConvert("useSpot", e.target.value === "spot")}>
              <option value="spot">Prix spot Supabase</option>
              <option value="manual">Entrée manuelle</option>
            </FS>

            <FI label="Classique - €/MWhc" type="number" step="0.01" disabled={convertTool.useSpot} value={convertTool.useSpot ? curve?.SPOT?.classique || "" : convertTool.classiqueMWhc} onChange={e => updateConvert("classiqueMWhc", e.target.value)} />

            <FI label="Précarité - €/MWhc" type="number" step="0.01" disabled={convertTool.useSpot} value={convertTool.useSpot ? curve?.SPOT?.precarite || "" : convertTool.precariteMWhc} onChange={e => updateConvert("precariteMWhc", e.target.value)} />
          </div>

          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px", marginBottom:"14px" }}>
              <KPI label="Classique" value={N(convertResult.classiqueEurM3, 2) + " €/m³"} color="sky" />
              <KPI label="Précarité" value={N(convertResult.precariteEurM3, 2) + " €/m³"} color="amber" />
              <KPI label="Total CEE" value={N(convertResult.totalEurM3, 2) + " €/m³"} color="emerald" />
            </div>

            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <tbody>
                {row("Produit", convertResult.productLabel)}
                {row("Facteur énergétique", `${N(convertResult.kwhcPerM3, 0)} kWhc/m³`)}
                {row("Coeff précarité", N(convertResult.coeffPrecarite, 3))}
                {row("Coeff correctif", N(convertResult.coeffCorrectif, 3))}
                {row("Prix Classique", `${N(convertResult.classiqueMWhc, 2)} €/MWhc`)}
                {row("Prix Précarité", `${N(convertResult.precariteMWhc, 2)} €/MWhc`)}
                {row("Impact Classique", `${N(convertResult.classiqueEurM3, 2)} €/m³`)}
                {row("Impact Précarité", `${N(convertResult.precariteEurM3, 2)} €/m³`)}
                {row("Impact total", `${N(convertResult.totalEurM3, 2)} €/m³`, true)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser,setCurrentUser]=useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState(null);
  const [trades,setTrades]          =useState([]);
  const [prices,setPrices]          =useState([]);
  const [curve,setCurve]            =useState({});
  const [obligations,setObligations]=useState([]);
  const [audit,setAudit]            =useState([]);
  const [users,setUsers]            =useState([]);
  const [tab,setTab]                =useState("dashboard");
  const [loading,setLoading]        =useState(true);
  const [error,setError]            =useState(null);

  async function loadAll() {
    try {
      setLoading(true);

      const [
        { data: ud, error: e1 },
        { data: td, error: e2 },
        { data: od, error: e3 },
        { data: pd, error: e4 },
        { data: cd, error: e5 },
        { data: ad, error: e6 }
      ] = await Promise.all([
        supabase.from("users").select("*"),
        supabase.from("trades").select("*").order("created_at"),
        supabase.from("obligations").select("*").order("month"),
        supabase.from("market_prices").select("*").order("date"),
        supabase.from("forward_curve").select("*"),
        supabase.from("audit_log").select("*").order("ts", { ascending: false }).limit(200),
      ]);

      if (e1 || e2 || e3 || e4 || e5 || e6) {
        throw new Error((e1 || e2 || e3 || e4 || e5 || e6).message);
      }

      const normT = (td || []).map(t => ({
        id: t.id,
        ceeType: t.cee_type,
        vendor: t.vendor,
        dealType: t.deal_type,
        period: t.period,
        volume: +t.volume,
        price: +t.price,
        month: t.month,
        status: t.status,
        priced: t.priced,
        statut: t.statut,
        ranking: t.ranking,
        emmyValidated: t.emmy_validated,
        createdBy: t.created_by,
        approvedBy: t.approved_by,
        createdAt: t.created_at
      }));

      const normO = (od || []).map(o => ({
        id: o.id,
        month: o.month,
        product: o.product,
        volume_m3: +o.volume_m3,
        priceCl: +o.price_cl,
        pricePr: +o.price_pr,
        priced: o.priced,
        client: o.client,
        clGwhc: +o.cl_gwhc,
        prGwhc: +o.pr_gwhc
      }));

      const normP = (pd || []).map(p => ({
        id: p.id,
        date: p.date,
        classique: +p.classique,
        precarite: +p.precarite,
        enteredBy: p.entered_by,
        enteredAt: p.entered_at
      }));

      const normC = {};
      (cd || []).forEach(c => {
        normC[c.tenor] = {
          classique: +c.classique,
          precarite: +c.precarite
        };
      });

      const normA = (ad || []).map(a => ({
        id: a.id,
        ts: a.ts,
        user: a.user_id,
        action: a.action,
        entity: a.entity,
        detail: a.detail
      }));

      setUsers(ud || []);
      setTrades(normT);
      setObligations(normO);
      setPrices(normP);
      setCurve(normC);
      setAudit(normA);

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function initAuth() {
      setAuthLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const currentSession = sessionData?.session || null;

      setSession(currentSession);

      if (!currentSession?.user) {
        setCurrentUser(null);

        // 👉 optionnel : charger quand même les données
        await loadAll();

        setAuthLoading(false);
        return;
      }

      const authId = currentSession.user.id;

      const { data: userRow, error } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", authId)
        .single();

      if (error || !userRow) {
        console.error("User mapping error:", error);
        setCurrentUser(null);

        await loadAll(); // fallback safe

        setAuthLoading(false);
        return;
      }

      setCurrentUser({
        id: userRow.id,
        name: userRow.name,
        role: userRow.role,
        initials: userRow.initials,
        email: userRow.email,
        authId: userRow.auth_id
      });

      // ✅ LOAD APRÈS AUTH
      await loadAll();

      setAuthLoading(false);
    }

    initAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      initAuth();
    });

    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const persist=useCallback(async(table,row)=>{
    const{error}=await supabase.from(table).upsert(row);
    if(error)console.error("Supabase:",error.message);
  },[]);
  const addAudit = useCallback(async(entry) => {
    const row = {
      id: "a" + uid(),
      ts: new Date().toISOString(),
      user_id: currentUser?.id,
      action: entry.action,
      entity: entry.entity,
      detail: entry.detail,
    };

    setAudit(a => [{
      id: row.id,
      ts: row.ts,
      user: row.user_id,
      action: row.action,
      entity: row.entity,
      detail: row.detail
    }, ...a]);

    await persist("audit_log", row);
  }, [currentUser, persist]);
  const handleAddTrade=useCallback(async(t)=>{
    setTrades(ts=>[...ts,t]);
    await persist("trades",{id:t.id,cee_type:t.ceeType,vendor:t.vendor,deal_type:t.dealType,
      period:t.period,volume:t.volume,price:t.price,month:t.month,status:t.status,
      priced:t.priced,statut:t.statut,ranking:t.ranking,emmy_validated:t.emmyValidated,
      created_by:t.createdBy,approved_by:t.approvedBy,created_at:t.createdAt});
    await addAudit({action:"TRADE_CREATED",entity:t.id,detail:`BUY ${N(t.volume,3)} GWhc ${t.ceeType} @ ${N(t.price,0)} — ${t.vendor}`});
  },[persist,addAudit]);
  const handleApproveTrade = useCallback(async (id, aid) => {
    setTrades(ts => ts.map(t =>
      t.id === id ? { ...t, status: "APPROVED", approvedBy: aid } : t
    ));

    await supabase
      .from("trades")
      .update({ status: "APPROVED", approved_by: aid })
      .eq("id", id);

    await addAudit({
      action: "TRADE_APPROVED",
      entity: id,
      detail: `Trade approuvé — approver: ${USERS.find(u => u.id === aid)?.name || aid}`
    });
  }, [addAudit]);
  const handleRejectTrade=useCallback(async(id)=>{
    setTrades(ts=>ts.map(t=>t.id===id?{...t,status:"REJECTED"}:t));
    await supabase.from("trades").update({status:"REJECTED"}).eq("id",id);
    await addAudit({action:"TRADE_REJECTED",entity:id,detail:"Trade rejeté par approver"});
  },[addAudit]);
  const handleAddPrice=useCallback(async(p)=>{
    setPrices(ps=>[...ps,p]);
    await persist("market_prices",{id:p.id,date:p.date,classique:p.classique,
      precarite:p.precarite,entered_by:p.enteredBy,entered_at:p.enteredAt});
    await addAudit({action:"PRICE_ADDED",entity:p.id,detail:`${p.date}: CL ${p.classique} / PR ${p.precarite}`});
  },[persist,addAudit]);
  const handleUpdateCurve = useCallback(async (tenor, px) => {
    const oldPx = curve[tenor];

    setCurve(c => ({ ...c, [tenor]: px }));

    await supabase
      .from("forward_curve")
      .update({
        classique: px.classique,
        precarite: px.precarite,
        updated_by: currentUser?.id,
        updated_at: new Date().toISOString()
      })
      .eq("tenor", tenor);

    await addAudit({
      action: "CURVE_UPDATED",
      entity: tenor,
      detail: oldPx
        ? `${tenor} — CL ${N(oldPx.classique,2)} → ${N(px.classique,2)} / PR ${N(oldPx.precarite,2)} → ${N(px.precarite,2)}`
        : `${tenor} — CL ${N(px.classique,2)} / PR ${N(px.precarite,2)}`
    });
  }, [curve, currentUser, addAudit]);
  const handleDeleteTrade = useCallback(async (id) => {
    const tradeToDelete = trades.find(t => t.id === id);

    setTrades(ts => ts.filter(t => t.id !== id));

    await supabase
      .from("trades")
      .delete()
      .eq("id", id);

    await addAudit({
      action: "TRADE_DELETED",
      entity: id,
      detail: tradeToDelete
        ? `Trade supprimé — ${tradeToDelete.vendor} · ${tradeToDelete.ceeType} · ${N(tradeToDelete.volume,3)} GWhc @ ${N(tradeToDelete.price,0)} €/GWhc · ${ML(tradeToDelete.month)}`
        : `Trade supprimé définitivement — id: ${id}`
    });
  }, [trades, addAudit]);

  const handleAddObligation=useCallback(async(o)=>{
    setObligations(os=>[...os,o]);
    await persist("obligations",{id:o.id,month:o.month,product:o.product,volume_m3:o.volume_m3,
      price_cl:o.priceCl,price_pr:o.pricePr,priced:o.priced,client:o.client,
      cl_gwhc:o.clGwhc,pr_gwhc:o.prGwhc});
    await addAudit({action:"OBLIG_ADDED",entity:o.id,detail:`${o.month} ${o.product} ${o.volume_m3}m³`});
  },[persist,addAudit]);

  const handleLogin = async () => {
    setLoginError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password
    });

    if (error) {
      setLoginError(error.message);
      return;
    }
  };

  if(loading) return(
    <div style={{background:"#0a0e1a",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"Inter, sans-serif",fontSize:"32px",color:"#38bdf8",marginBottom:"16px"}}>CEE Platform</div>
        <div style={{fontFamily:"IBM Plex Mono, monospace",fontSize:"11px",color:"#3a5070"}}>Connexion à la base de données…</div>
      </div>
    </div>
  );
  if(error) return(
    <div style={{background:"#0a0e1a",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"Inter, sans-serif",fontSize:"28px",color:"#f87171",marginBottom:"12px"}}>Erreur de connexion</div>
        <div style={{fontFamily:"IBM Plex Mono, monospace",fontSize:"11px",color:"#4a6080"}}>{error}</div>
      </div>
    </div>
  );
  if (!currentUser) return (
    <div style={{ minHeight:"100vh",background:"#0a0e1a",display:"flex",alignItems:"center",justifyContent:"center",color:"#e2e8f0" }}>
      <div style={{ width:"360px",background:"#111827",border:"1px solid #252219",borderRadius:"2px",padding:"26px" }}>
        <p style={{ ...S,fontSize:"9px",color:"#38bdf8",letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:"8px" }}>
          CEE Platform
        </p>

        <h2 style={{ ...CG,fontSize:"24px",marginBottom:"18px" }}>
          Connexion
        </h2>

        <div style={{ display:"flex",flexDirection:"column",gap:"12px" }}>
          <input
            type="email"
            placeholder="Email"
            value={loginForm.email}
            onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
            style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#e2e8f0",padding:"10px",borderRadius:"2px",outline:"none" }}
          />

          <input
            type="password"
            placeholder="Mot de passe"
            value={loginForm.password}
            onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
            style={{ ...S,background:"#0d1526",border:"1px solid #2e2b24",color:"#e2e8f0",padding:"10px",borderRadius:"2px",outline:"none" }}
          />

          {loginError && (
            <p style={{ ...S,fontSize:"11px",color:"#f87171" }}>
              {loginError}
            </p>
          )}

          <GoldBtn onClick={handleLogin}>
            Se connecter
          </GoldBtn>
        </div>
      </div>
    </div>
  );


  const pending=trades.filter(t=>t.status==="PENDING").length;

  
  const TABS=[
    {id:"dashboard",  label:"Dashboard"},
    {id:"reporting",  label:"Reporting"},
    {id:"position",   label:"Position CEE"},
    {id:"blotter",    label:`Blotter${pending>0?` (${pending})`:""}`},
    {id:"obligation", label:"Obligation"},
    {id:"curve",      label:"Courbe Forward"},
    {id:"prices",     label:"Prix Marché"},
    {id:"tools",      label:"Outils"},
    {id:"audit",      label:"Audit Log"},
  ];

return(
  <div style={{ minHeight:"100vh",background:"#0a0e1a",color:"#e2e8f0" }}>
    <div style={{ position:"fixed",inset:0,backgroundImage:"linear-gradient(#ffffff06 1px,transparent 1px),linear-gradient(90deg,#ffffff06 1px,transparent 1px)",backgroundSize:"40px 40px",pointerEvents:"none",zIndex:0 }}/>
    <div style={{ position:"relative",zIndex:1,maxWidth:"1400px",margin:"0 auto",padding:"0 28px 80px" }}>
      <header style={{ padding:"28px 0 16px",borderBottom:"1px solid #e2e4e8",display:"flex",justifyContent:"space-between",alignItems:"flex-end" }}>
        <div>
          <p style={{ ...S,fontSize:"9px",color:"#38bdf8",letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:"4px" }}>
            Gestion Stock CEE · Position · PnL · Obligation P6
          </p>
          <h1 style={{ ...CG,fontSize:"32px",fontWeight:700,color:"#e2e8f0",lineHeight:1 }}>
            CEE Dashboard
            <span style={{ ...S,fontSize:"11px",color:"#3a5070",fontWeight:400,marginLeft:"12px" }}>
              {prices.length>0
                ? `Données au ${new Date([...prices].sort((a,b)=>b.date.localeCompare(a.date))[0].date).toLocaleDateString("fr-FR")}`
                : "Chargement…"}
            </span>
          </h1>
        </div>

        <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
          <div>
            <p style={{ ...S,fontSize:"11px",color:"#e2e8f0" }}>
              {currentUser.name}
            </p>
            <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.08em" }}>
              {currentUser.role}
            </p>
          </div>

          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setCurrentUser(null);
              setSession(null);
            }}
            style={{
              ...S,
              fontSize:"9px",
              padding:"6px 10px",
              background:"transparent",
              color:"#3a5070",
              border:"1px solid #2e2b24",
              borderRadius:"2px",
              cursor:"pointer",
              textTransform:"uppercase",
              letterSpacing:"0.08em"
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <div style={{ display:"flex",gap:"16px",borderBottom:"1px solid #e2e4e8",marginBottom:"22px",overflowX:"auto" }}>
        {TABS.map(t=>(
          <button
            key={t.id}
            onClick={()=>setTab(t.id)}
            style={{
              ...S,
              background:"none",
              border:"none",
              fontSize:"10px",
              letterSpacing:"0.1em",
              textTransform:"uppercase",
              padding:"12px 0",
              cursor:"pointer",
              whiteSpace:"nowrap",
              color:tab===t.id?"#38bdf8":"#3a5070",
              borderBottom:tab===t.id?"1px solid #b8973a":"1px solid transparent",
              transition:"color 0.2s"
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab==="dashboard"  && <Dashboard     trades={trades} obligations={obligations} prices={prices} curve={curve}/>}
      {tab==="reporting"  && <Reporting     trades={trades} obligations={obligations} prices={prices} curve={curve}/>}
      {tab==="position"   && <PositionView  trades={trades} obligations={obligations} curve={curve} prices={prices}/>}
      {tab==="blotter"    && <Blotter       trades={trades} currentUser={currentUser} onAdd={handleAddTrade} onApprove={handleApproveTrade} onReject={handleRejectTrade} onDelete={handleDeleteTrade}/>}
      {tab==="obligation" && <ObligationTab obligations={obligations} onAdd={handleAddObligation} onDelete={id=>setObligations(os=>os.filter(o=>o.id!==id))}/>}
      {tab==="curve"      && <CurveTab      curve={curve} onUpdate={handleUpdateCurve} trades={trades}/>}
      {tab==="prices"     && <PricesTab     prices={prices} currentUser={currentUser} onAdd={handleAddPrice}/>}
      {tab==="tools" && <Tools curve={curve} />}
      {tab==="audit"      && <AuditLog      audit={audit} users={users}/>}
    </div>
  </div>
);
}

