import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
  CARBURANT: { label: "Road Fuel", kwhc_per_m3: 8718, coeff_precarite: 0.364, coeff_correctif: 0.847 },
  FOD:       { label: "FOD (Domestic Fuel Oil)", kwhc_per_m3: 11078, coeff_precarite: 0.364, coeff_correctif: 0.847 },
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
  SPOT:    { classique: 8.96, precarite: 16.44 },
  "S1-26": { classique: 8.96, precarite: 16.05 },
  "S2-26": { classique: 8.93, precarite: 15.81 },
  "S1-27": { classique: 8.95, precarite: 15.85 },
  "S2-27": { classique: 8.93, precarite: 15.08 },
  "S1-28": { classique: 8.95, precarite: 15.04 },
  "S2-28": { classique: 8.93, precarite: 14.98 },
};

function calcCEE(volume_m3, product) {
  const p = PARAMS[product];
  const base = volume_m3 * p.kwhc_per_m3 / 1e6 * p.coeff_correctif;
  return { classique: base * (1 - p.coeff_precarite), precarite: base * p.coeff_precarite, total: base };
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────
const USERS = [
  { id: "u1", name: "Maxime Jourdier", role: "trader", initials: "MJ" },
  { id: "u2", name: "Lilian Fages", role: "trader", initials: "LF" },
  { id: "u3", name: "Eric De Gail", role: "approver", initials: "EG" },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const N   = (n, d = 2) => n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fK  = (n, d = 0) => n == null ? "—" : (n >= 0 ? "+" : "") + N(n / 1000, d) + " k€";
const fM  = (n, d = 1) => n == null ? "—" : (n >= 0 ? "+" : "") + N(n / 1000000, d) + " M€";
const uid = () => Math.random().toString(36).slice(2, 9);

const formatDateEn = (date) => {
  if (!date || date === "(curve)") return "Curve fallback";

  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return String(date);

  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
};

// Display labels only. Do not use these values for data matching.
const MO  = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ML  = m => { const [y, mo] = m.split("-"); return MO[parseInt(mo) - 1] + " " + y; };
const MLS = m => { const [, mo] = m.split("-"); return MO[parseInt(mo) - 1]; };

// Unit convention:
// - trades / obligations stored prices: €/GWhc
// - market prices / forward curve: €/MWhc
// - calculations: €/GWhc
const toGWhc = (priceMWhc) => priceMWhc * 1000;
const toMWhc = (priceGWhc) => priceGWhc / 1000;
const fmtMWhc = (priceGWhc, d = 2) => priceGWhc ? `${N(toMWhc(priceGWhc), d)} €/MWhc` : "—";
const fmtGWhc = (priceGWhc, d = 0) => priceGWhc ? `${N(priceGWhc, d)} €/GWhc` : "—";

function wAvg(trades, ceeType, month = null, pricedOnly = false, approvedOnly = true) {
  const b = trades.filter(t =>
    (!approvedOnly || t.status === "APPROVED") &&
    t.ceeType === ceeType &&
    (month ? t.month === month : true) &&
    (!pricedOnly || t.priced === true)
  );

  const v = b.reduce((s, t) => s + t.volume, 0);
  return v > 0 ? b.reduce((s, t) => s + t.price * t.volume, 0) / v : 0;
}

function sumVol(trades, ceeType, month = null, pricedOnly = false, approvedOnly = true) {
  return trades
    .filter(t =>
      (!approvedOnly || t.status === "APPROVED") &&
      t.ceeType === ceeType &&
      (month ? t.month === month : true) &&
      (!pricedOnly || t.priced === true)
    )
    .reduce((s, t) => s + t.volume, 0);
}

function pnlBuyAvg(trades, ceeType, month = null) {
  let rows = trades.filter(t =>
    t.ceeType === ceeType &&
    t.priced === true &&
    (month ? t.month === month : true)
  );

  // Excel alignment — Jan-26 specific exclusion:
  // these rows are in the business volume but excluded from the Excel weighted buy price.
  if (month === "2026-01" && ceeType === "CLASSIQUE") {
    rows = rows.filter(t => !(Math.abs(t.volume - 30.32) < 0.001 && Math.abs(t.price - 8100) < 0.01));
  }

  if (month === "2026-01" && ceeType === "PRECARITE") {
    rows = rows.filter(t => t.id !== "xlsx_pr_001");
  }

  const v = rows.reduce((s, t) => s + t.volume, 0);
  return v > 0 ? rows.reduce((s, t) => s + t.price * t.volume, 0) / v : 0;
}

function oblMonth(obligations, month, ceeType, pricedOnly = false) {
  return obligations.filter(o => o.month === month && (!pricedOnly || o.priced)).reduce((s, o) => s + (ceeType === "CLASSIQUE" ? o.clGwhc : o.prGwhc), 0);
}

// avgSellMonth: weighted avg of obligation sell prices.
// Result is the blended €/GWhc price charged to the client across priced rows.
function avgSellMonth(obligations, month, ceeType, pricedOnly = true) {
  const priceKey = ceeType === "CLASSIQUE" ? "priceCl" : "pricePr";
  const volumeKey = ceeType === "CLASSIQUE" ? "clGwhc" : "prGwhc";

  const rows = obligations.filter(o =>
    o.month === month &&
    (!pricedOnly || o.priced)
  );

  let weightedVolume = 0;
  let weightedSum = 0;

  rows.forEach(o => {
    const volume = Number(o[volumeKey]) || 0;
    const price = Number(o[priceKey]) || 0;

    weightedVolume += volume;
    weightedSum += volume * price;
  });

  return weightedVolume > 0 ? weightedSum / weightedVolume : 0;
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
  const [regulatoryType, setRegulatoryType] = useState("CLASSIQUE");

  const latestSpot = useMemo(() => {
    if (!prices.length) {
      return {
        classique: curve.SPOT?.classique ?? 8.96,
        precarite: curve.SPOT?.precarite ?? 16.44,
        date: "(curve)"
      };
    }

    const p = [...prices].sort((a, b) => b.date.localeCompare(a.date))[0];

    return {
      classique: p.classique,
      precarite: p.precarite,
      date: p.date
    };
  }, [prices, curve]);

  const reportingDisplayDate = formatDateEn(latestSpot.date);

  // P6 reporting scope: only 2026 trades
  const trades2026 = useMemo(
    () => trades.filter(t =>
      String(t.period ?? "").trim().toUpperCase() === "P6"
    ),
    [trades]
  );

  // Monthly position data for charts
  const monthlyData = useMemo(() => MONTHS_LIST.map(month => {
    const oblCl = oblMonth(obligations, month, "CLASSIQUE");
    const oblPr = oblMonth(obligations, month, "PRECARITE");
    const oblClP = oblMonth(obligations, month, "CLASSIQUE", true);
    const oblPrP = oblMonth(obligations, month, "PRECARITE", true);

    const bClP = sumVol(trades2026, "CLASSIQUE", month, true, false);
    const bPrP = sumVol(trades2026, "PRECARITE", month, true, false);

    const bCl = sumVol(trades2026, "CLASSIQUE", month, false, false);
    const bPr = sumVol(trades2026, "PRECARITE", month, false, false);

    const aClP = pnlBuyAvg(trades2026, "CLASSIQUE", month);
    const aPrP = pnlBuyAvg(trades2026, "PRECARITE", month);

    // Priced sell average only
    const sCl = avgSellMonth(obligations, month, "CLASSIQUE", true);
    const sPr = avgSellMonth(obligations, month, "PRECARITE", true);

    // PnL = (sell - priced avg buy) × min(priced bought, priced obligation)
    const matchCl = Math.min(bClP, oblClP);
    const matchPr = Math.min(bPrP, oblPrP);

    const pnlCl =
      oblClP > 0.001 && aClP > 0 && sCl > 0
        ? (sCl - aClP) * matchCl
        : 0;

    const pnlPr =
      oblPrP > 0.001 && aPrP > 0 && sPr > 0
        ? (sPr - aPrP) * matchPr
        : 0;

    // Excel-aligned MtM:
    // If net position is positive, value against avg purchase.
    // If net position is negative, value against avg sold price.
    const netClRaw = bClP - oblClP;
    const netPrRaw = bPrP - oblPrP;

    const mtmCl =
      Math.abs(netClRaw) > 0.001 && latestSpot.classique > 0
        ? netClRaw < 0
          ? netClRaw * (latestSpot.classique * 1000 - sCl)
          : netClRaw * (latestSpot.classique * 1000 - aClP)
        : 0;

    const mtmPr =
      Math.abs(netPrRaw) > 0.001 && latestSpot.precarite > 0
        ? netPrRaw < 0
          ? netPrRaw * (latestSpot.precarite * 1000 - sPr)
          : netPrRaw * (latestSpot.precarite * 1000 - aPrP)
        : 0;

        const pricedObligation = oblClP + oblPrP;
        const pricedBought = bClP + bPrP;

    const covPct =
      pricedObligation > 0
        ? pricedBought / pricedObligation * 100
        : null;

    return {
      month: MLS(month),
      oblCl: Math.round(oblCl),
      oblPr: Math.round(oblPr),
      oblClP: Math.round(oblClP),
      oblPrP: Math.round(oblPrP),
      bCl: Math.round(bCl),
      bPr: Math.round(bPr),
      bClP: Math.round(bClP),
      bPrP: Math.round(bPrP),

      pnlClRaw: pnlCl,
      pnlPrRaw: pnlPr,
      pnlRaw: pnlCl + pnlPr,

      mtmClRaw: mtmCl,
      mtmPrRaw: mtmPr,
      mtmRaw: mtmCl + mtmPr,

      pnlCl: Math.round(pnlCl / 1000),
      pnlPr: Math.round(pnlPr / 1000),
      pnl: Math.round((pnlCl + pnlPr) / 1000),

      mtmCl: Math.round(mtmCl / 1000),
      mtmPr: Math.round(mtmPr / 1000),
      mtm: Math.round((mtmCl + mtmPr) / 1000),

      covPct: covPct == null ? null : Math.round(covPct),
      covPctChart: covPct == null ? null : Math.min(Math.round(covPct), 150),

      netClP: Math.round(bClP - oblClP),
      netPrP: Math.round(bPrP - oblPrP),
      netPos: Math.round(bClP + bPrP - oblClP - oblPrP)
    };
  }), [trades2026, obligations, latestSpot]);

  const estimatedTotalPnl = useMemo(
    () => monthlyData.reduce((s, d) => s + d.pnlRaw + d.mtmRaw, 0),
    [monthlyData]
  );

  // Price history for chart
  const priceHistory = useMemo(
    () => [...prices]
      .filter(p => p.classique)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(p => ({
        date: p.date.slice(5),
        cl: p.classique,
        pr: p.precarite
      })),
    [prices]
  );

  // Vendor breakdown
  const vendorData = useMemo(() => {
    const m = {};

    trades2026
      .filter(t => t.status === "APPROVED")
      .forEach(t => {
        m[t.vendor] = (m[t.vendor] || 0) + t.volume;
      });

    return Object.entries(m)
      .map(([name, vol]) => ({ name, vol: Math.round(vol) }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 8);
  }, [trades2026]);

  // Cumulative PnL
  const cumPnlData = useMemo(() => {
    let cum = 0;

    return monthlyData.map(d => {
      cum += d.pnl;

      return {
        month: d.month,
        pnl: d.pnl,
        cumPnl: cum
      };
    });
  }, [monthlyData]);

  const pnlBridgeData = useMemo(() => {
    const realizedCl = monthlyData.reduce((s, d) => s + d.pnlCl, 0);
    const realizedPr = monthlyData.reduce((s, d) => s + d.pnlPr, 0);
    const mtmCl = monthlyData.reduce((s, d) => s + d.mtmCl, 0);
    const mtmPr = monthlyData.reduce((s, d) => s + d.mtmPr, 0);

    const netTotal = realizedCl + realizedPr + mtmCl + mtmPr;

    return [
      { name: "Realized CL", value: realizedCl },
      { name: "Realized PR", value: realizedPr },
      { name: "MtM CL", value: mtmCl },
      { name: "MtM PR", value: mtmPr },
      { name: "Net Total", value: netTotal }
    ];
  }, [monthlyData]);

  // Coverage donut data
  const totalOblP = MONTHS_LIST.reduce(
    (s, m) =>
      s +
      oblMonth(obligations, m, "CLASSIQUE", true) +
      oblMonth(obligations, m, "PRECARITE", true),
    0
  );

  const totalBoughtP =
    sumVol(trades2026, "CLASSIQUE", null, true, false) +
    sumVol(trades2026, "PRECARITE", null, true, false);

  const totalBought =
    sumVol(trades2026, "CLASSIQUE", null, false, false) +
    sumVol(trades2026, "PRECARITE", null, false, false);

  const totalUnpriced =
    MONTHS_LIST.reduce(
      (s, m) =>
        s +
        oblMonth(obligations, m, "CLASSIQUE") +
        oblMonth(obligations, m, "PRECARITE"),
      0
    ) - totalOblP;

  const covPct = totalOblP > 0 ? Math.min(totalBoughtP / totalOblP * 100, 100) : 0;

  // Regulatory & performance risk datasets
  const regulatoryBaseTrades = useMemo(
    () => trades2026.filter(t => t.priced === true),
    [trades2026]
  );

  const regulatoryApprovalTrades = useMemo(
    () => trades2026,
    [trades2026]
  );

  const buildRegulatoryMetrics = (ceeType) => {
    const rows = regulatoryBaseTrades.filter(t => t.ceeType === ceeType);

    // Pending approval list includes both priced and unpriced trades
    const approvalRows = regulatoryApprovalTrades.filter(t => t.ceeType === ceeType);

    const isYes = (v) =>
      v === true || String(v ?? "").trim().toLowerCase() === "yes";

    const isInternallyApproved = (t) => isYes(t.approval);

    const creditedOf = (t) => {
      const vol = Number(t.volume || 0);
      const credited = Number(t.volumeCredited ?? t.volumeDeposited ?? 0);

      return Math.max(0, Math.min(credited, vol));
    };

    const remainingToCreditOf = (t) => {
      const vol = Number(t.volume || 0);

      const remainingRaw = Number(
        t.volumeRemainingToBeCredited ??
        t.volumeRemainingToBeDeposited ??
        vol - creditedOf(t)
      );

      return Math.max(0, remainingRaw);
    };

    const totalPurchased = rows.reduce((s, t) => s + Number(t.volume || 0), 0);

    const volume = (predicate) =>
      rows
        .filter(predicate)
        .reduce((s, t) => s + Number(t.volume || 0), 0);

    const creditedVolume = rows.reduce((s, t) => s + creditedOf(t), 0);

    const validatedVolume = volume(t => t.validated === true);

    const creditedAndValidatedVolume = rows.reduce((s, t) => {
      if (t.validated !== true) return s;
      return s + creditedOf(t);
    }, 0);

    const paidVolume = volume(t => t.payment === true);

    const paidCreditedNotValidatedVolume = rows.reduce((s, t) => {
      if (t.payment !== true || t.validated === true) return s;
      return s + creditedOf(t);
    }, 0);

    const paidNotCreditedVolume = rows.reduce((s, t) => {
      if (t.payment !== true) return s;
      return s + remainingToCreditOf(t);
    }, 0);

    const paidNotCreditedExposure = rows.reduce((s, t) => {
      if (t.payment !== true || t.validated === true) return s;
      return s + Number(t.riskPerformanceMt || 0);
    }, 0);

    const pendingApprovalRows = approvalRows
      .filter(t => !isInternallyApproved(t))
      .map(t => ({
        id: t.id,
        vendor: t.vendor || "Unknown",
        volume: Number(t.volume || 0),
        price: Number(t.price || 0),
        month: t.month,
        status: t.status,
        approval: t.approval,
        priced: t.priced
      }))
      .sort((a, b) => b.volume - a.volume);

    const ratingMap = {};

    rows.forEach(t => {
      const rating = t.cpRanking || "N/A";
      ratingMap[rating] = (ratingMap[rating] || 0) + Number(t.volume || 0);
    });

    const ratingData = Object.entries(ratingMap)
      .map(([rating, volume]) => ({
        rating,
        volume: Math.round(volume)
      }))
      .sort((a, b) => b.volume - a.volume);

    const cpRiskMap = {};

    rows.forEach(t => {
      const vendor = t.vendor || "Unknown";
      const rating = t.cpRanking || "N/A";

      const paidNotCreditedVolume =
        t.payment === true
          ? remainingToCreditOf(t)
          : 0;

      const creditedNotValidatedVolume =
        t.payment === true && t.validated !== true
          ? creditedOf(t)
          : 0;

      // Risk Performance MT comes directly from Excel.
      // It is aggregated for paid and not fully validated lines.
      const currentPerformanceRisk =
        t.payment === true && t.validated !== true
          ? Number(t.riskPerformanceMt || 0)
          : 0;

      if (!cpRiskMap[vendor]) {
        cpRiskMap[vendor] = {
          vendor,
          rating,
          paidNotCreditedVolume: 0,
          creditedNotValidatedVolume: 0,
          exposure: 0
        };
      }

      cpRiskMap[vendor].paidNotCreditedVolume += paidNotCreditedVolume;
      cpRiskMap[vendor].creditedNotValidatedVolume += creditedNotValidatedVolume;
      cpRiskMap[vendor].exposure += currentPerformanceRisk;
    });

    const counterpartyRiskData = Object.values(cpRiskMap)
      .filter(r =>
        Math.abs(r.paidNotCreditedVolume) > 0.001 ||
        Math.abs(r.creditedNotValidatedVolume) > 0.001 ||
        Math.abs(r.exposure) > 0.001
      )
      .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure));

    const pct = (num, denom = totalPurchased) =>
      denom > 0 ? num / denom * 100 : 0;

    return {
      ceeType,
      rows,
      totalPurchased,

      approvedPct: pct(volume(t => isInternallyApproved(t))),
      signedContractPct: pct(volume(t => t.contractSigned === true)),
      creditedPct: pct(creditedVolume),
      validatedPct: pct(validatedVolume),
      creditedAndValidatedPct: pct(creditedAndValidatedVolume),

      paidPct: pct(paidVolume),
      paidCreditedNotValidatedPct: pct(paidCreditedNotValidatedVolume, paidVolume),
      paidNotCreditedPct: pct(paidNotCreditedVolume, paidVolume),
      paidNotCreditedExposure,

      pendingApprovalRows,
      ratingData,
      counterpartyRiskData
    };
  };

  const regulatoryClassique = useMemo(
    () => buildRegulatoryMetrics("CLASSIQUE"),
    [regulatoryBaseTrades, regulatoryApprovalTrades]
  );

  const regulatoryPrecarite = useMemo(
    () => buildRegulatoryMetrics("PRECARITE"),
    [regulatoryBaseTrades, regulatoryApprovalTrades]
  );

  const activeRegulatoryData =
    regulatoryType === "CLASSIQUE" ? regulatoryClassique : regulatoryPrecarite;

  const activeRegulatoryTitle =
    regulatoryType === "CLASSIQUE" ? "Classique" : "Précarité";

  const REPORTS = [
    { id: "executive", label: "Executive Summary" },
    { id: "position", label: "Position & Coverage" },
    { id: "pnl", label: "PnL & MtM" },
    { id: "regulatory", label: "Regulatory & Performance Risk" }
  ];

  const SectionTitle = ({ children }) => (
    <p style={{
      ...S,
      fontSize: "9px",
      color: "#38bdf8",
      textTransform: "uppercase",
      letterSpacing: "0.18em",
      marginBottom: "14px",
      marginTop: "8px"
    }}>
      {children}
    </p>
  );

  const RegulatoryBlock = ({ title, data }) => {
    const riskColor = (v) =>
      v < 0 ? "#34d399" : v > 0 ? "#f87171" : "#4a6080";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div style={{
          background: "#111827",
          border: "1px solid #1e2d45",
          borderRadius: "2px",
          padding: "18px"
        }}>
          <p style={{
            ...S,
            fontSize: "9px",
            color: "#38bdf8",
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            marginBottom: "8px"
          }}>
            {title}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
            <KPI
              label={`Total ${title} Purchased`}
              value={`${N(data.totalPurchased, 0)} GWhc`}
              color="sky"
              sub="Priced purchased volume"
            />

            <KPI
              label="Approved internally"
              value={`${N(data.approvedPct, 1)}%`}
              color={data.approvedPct >= 95 ? "emerald" : data.approvedPct >= 80 ? "amber" : "rose"}
              sub="Approved / purchased"
            />

            <KPI
              label="Signed contract"
              value={`${N(data.signedContractPct, 1)}%`}
              color={data.signedContractPct >= 95 ? "emerald" : data.signedContractPct >= 80 ? "amber" : "rose"}
              sub="Contract signed / purchased"
            />

            <KPI
              label="Paid"
              value={`${N(data.paidPct, 1)}%`}
              color={data.paidPct >= 95 ? "emerald" : data.paidPct >= 80 ? "amber" : "rose"}
              sub="Paid / purchased"
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"18px" }}>
            <SectionTitle>Regulatory Risk</SectionTitle>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px", marginBottom:"16px" }}>
              <KPI
                label="Credited on EMMY"
                value={`${N(data.creditedPct, 1)}%`}
                color={data.creditedPct >= 95 ? "emerald" : data.creditedPct >= 80 ? "amber" : "rose"}
              />

              <KPI
                label="Validated on EMMY"
                value={`${N(data.validatedPct, 1)}%`}
                color={data.validatedPct >= 95 ? "emerald" : data.validatedPct >= 80 ? "amber" : "rose"}
              />

              <KPI
                label="Credited & validated"
                value={`${N(data.creditedAndValidatedPct, 1)}%`}
                color={data.creditedAndValidatedPct >= 95 ? "emerald" : data.creditedAndValidatedPct >= 80 ? "amber" : "rose"}
              />
            </div>

            <p style={{
              ...S,
              fontSize:"9px",
              color:"#38bdf8",
              textTransform:"uppercase",
              letterSpacing:"0.14em",
              marginBottom:"8px"
            }}>
              Pending approval volumes
            </p>

            <div style={{ maxHeight:"220px", overflowY:"auto", border:"1px solid #1e1c18" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    {["Counterparty", "Month", "Volume", "Priced", "Status"].map(h => (
                      <TH key={h}>{h}</TH>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {data.pendingApprovalRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...S, padding:"10px 14px", color:"#4a6080" }}>
                        No pending approval.
                      </td>
                    </tr>
                  ) : data.pendingApprovalRows.map(r => (
                    <tr key={r.id} style={{ borderBottom:"1px solid #1a1815" }}>
                      <td style={{ ...S, padding:"9px 14px", color:"#e2e8f0" }}>{r.vendor}</td>

                      <td style={{ ...S, padding:"9px 14px", color:"#4a6080" }}>
                        {r.month ? ML(r.month) : "—"}
                      </td>

                      <td style={{ ...S, padding:"9px 14px", color:"#e2e8f0" }}>
                        {N(r.volume, 2)} GWhc
                      </td>

                      <td style={{ padding:"9px 14px" }}>
                        <Badge color={r.priced === true ? "green" : "gray"}>
                          {r.priced === true ? "Priced" : "Unpriced"}
                        </Badge>
                      </td>

                      <td style={{ padding:"9px 14px" }}>
                        <Badge color="amber">
                          {String(r.approval ?? "").trim() === "No" ? "Approval No" : r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"18px" }}>
            <SectionTitle>Performance Risk</SectionTitle>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px", marginBottom:"16px" }}>
              <KPI
                label="Paid credited not validated"
                value={`${N(data.paidCreditedNotValidatedPct, 1)}%`}
                color={data.paidCreditedNotValidatedPct > 0 ? "amber" : "emerald"}
                sub="Of paid volume"
              />

              <KPI
                label="Paid not credited"
                value={`${N(data.paidNotCreditedPct, 1)}%`}
                color={data.paidNotCreditedPct > 0 ? "rose" : "emerald"}
                sub="Of paid volume"
              />

              <KPI
                label="Financial exposure"
                value={fM(data.paidNotCreditedExposure)}
                color={data.paidNotCreditedExposure > 0 ? "rose" : data.paidNotCreditedExposure < 0 ? "emerald" : "gray"}
                sub="Paid but not credited"
              />
            </div>

            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.counterpartyRiskData} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ ...S, fontSize:9, fill:"#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="vendor"
                  tick={{ ...S, fontSize:9, fill:"#4a6080" }}
                  axisLine={false}
                  tickLine={false}
                  width={170}
                />
                <Tooltip content={<ChartTip />} />

                <Bar dataKey="exposure" name="Current performance risk (€)" radius={[0,1,1,0]}>
                  {data.counterpartyRiskData.map((entry) => (
                    <Cell
                      key={`risk-cell-${entry.vendor}`}
                      fill={riskColor(entry.exposure)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" }}>
          <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"18px" }}>
            <SectionTitle>Volumes by Counterparty Rating</SectionTitle>

            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.ratingData} barSize={24}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis
                  dataKey="rating"
                  tick={{ ...S, fontSize:9, fill:"#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize:9, fill:"#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="volume" name="Volume (GWhc)" fill="#38bdf8" radius={[1,1,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background:"#111827", border:"1px solid #252219", borderRadius:"2px", padding:"18px" }}>
            <SectionTitle>Performance Risk by Counterparty</SectionTitle>

            <div style={{ maxHeight:"240px", overflowY:"auto", border:"1px solid #1e1c18" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    {["Counterparty", "Rating", "Paid not credited", "Credited not validated", "Exposure"].map(h => (
                      <TH key={h}>{h}</TH>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {data.counterpartyRiskData.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...S, padding:"10px 14px", color:"#4a6080" }}>
                        No current performance risk.
                      </td>
                    </tr>
                  ) : data.counterpartyRiskData.map(r => (
                    <tr key={r.vendor} style={{ borderBottom:"1px solid #1a1815" }}>
                      <td style={{ ...S, padding:"9px 14px", color:"#e2e8f0" }}>{r.vendor}</td>

                      <td style={{ padding:"9px 14px" }}>
                        <Badge color={r.rating === "AAA" ? "green" : r.rating === "N/A" ? "gray" : "amber"}>
                          {r.rating}
                        </Badge>
                      </td>

                      <td style={{ ...S, padding:"9px 14px", color:"#f87171" }}>
                        {N(r.paidNotCreditedVolume, 2)} GWhc
                      </td>

                      <td style={{ ...S, padding:"9px 14px", color:"#d4a843" }}>
                        {N(r.creditedNotValidatedVolume, 2)} GWhc
                      </td>

                      <td style={{ ...S, padding:"9px 14px", color: riskColor(r.exposure), fontWeight:700 }}>
                        {fM(r.exposure)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Report selector */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {REPORTS.map(r => (
          <button
            key={r.id}
            onClick={() => setReport(r.id)}
            style={{
              ...S,
              fontSize: "10px",
              padding: "7px 14px",
              borderRadius: "2px",
              border: "1px solid",
              cursor: "pointer",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: report === r.id ? "#38bdf8" : "transparent",
              color: report === r.id ? "#0a0e1a" : "#3a5070",
              borderColor: report === r.id ? "#38bdf8" : "#1e2d45"
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── EXECUTIVE SUMMARY ── */}
      {report === "executive" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "22px 26px" }}>
            <p style={{ ...S, fontSize: "9px", color: "#3a5070", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "4px" }}>
              CEE Management Report — P6
            </p>
            <h2 style={{ ...CG, fontSize: "28px", fontWeight: 700, color: "#e2e8f0", marginBottom: "2px" }}>
              Executive Dashboard
            </h2>
            <p style={{ ...S, fontSize: "10px", color: "#3a5070" }}>
              As of {reportingDisplayDate} · Reference period: 2026 (P6)
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
            <KPI
              large
              label="Estimated Total PnL"
              value={fM(estimatedTotalPnl)}
              color={estimatedTotalPnl >= 0 ? "emerald" : "rose"}
              sub="Realized + MtM"
            />

            <KPI
              large
              label="Total Purchased Inventory"
              value={N(totalBought, 0) + " GWhc"}
              color="sky"
              sub={`Classique: ${N(sumVol(trades2026, "CLASSIQUE", null, false, false), 0)} · Précarité: ${N(sumVol(trades2026, "PRECARITE", null, false, false), 0)}`}
            />

            <KPI
              large
              label="Obligation Coverage"
              value={N(covPct, 1) + "%"}
              color={covPct >= 100 ? "emerald" : covPct >= 70 ? "amber" : "rose"}
              sub={`${N(totalOblP, 0)} priced GWhc`}
            />

            <KPI
              large
              label="To Cover (Forward)"
              value={N(totalUnpriced, 0) + " GWhc"}
              color="rose"
              sub="Remaining unpriced obligation"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "16px" }}>
            <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
              <SectionTitle>2026 Global Coverage</SectionTitle>

              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Covered", value: Math.round(totalBought) },
                      { name: "Unpriced", value: Math.round(totalUnpriced) },
                      { name: "Uncovered", value: Math.max(0, Math.round(totalOblP - totalBought)) }
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    <Cell fill="#34d399" />
                    <Cell fill="#f87171" />
                    <Cell fill="#d4a843" />
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ ...S, fontSize: "10px", color: "#4a6080" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
              <SectionTitle>Monthly Net Position (GWhc) — Priced</SectionTitle>

              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barSize={18}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                  <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTip />} />
                  <ReferenceLine y={0} stroke="#1e2d45" />
                  <Bar dataKey="netPos" name="Net position" fill="#2563eb" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>Monthly Realized PnL (k€) + Cumulative</SectionTitle>

            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cumPnlData} barSize={20}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={44} />
                <YAxis yAxisId="right" orientation="right" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<ChartTip />} />
                <ReferenceLine yAxisId="left" y={0} stroke="#1e2d45" />
                <Bar yAxisId="left" dataKey="pnl" name="Monthly PnL (k€)" fill="#34d399" radius={[1, 1, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumPnl" name="Cumulative PnL (k€)" stroke="#38bdf8" strokeWidth={2} dot={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>Purchases by Seller (GWhc)</SectionTitle>

            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={vendorData} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" horizontal={false} />
                <XAxis type="number" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ ...S, fontSize: 9, fill: "#4a6080" }} axisLine={false} tickLine={false} width={170} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="vol" name="Volume (GWhc)" fill="#38bdf8" radius={[0, 1, 1, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── POSITION & COVERAGE ── */}
      {report === "position" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>Obligation vs Purchases by Month (GWhc)</SectionTitle>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "#4a6080" }} />
                <Bar dataKey="oblClP" name="Total Classique Obligation" fill="#1a3848" radius={[1, 1, 0, 0]} stackId="obl" />
                <Bar dataKey="oblPrP" name="Total Précarité Obligation" fill="#2e2410" radius={[1, 1, 0, 0]} stackId="obl" />
                <Bar dataKey="bClP" name="Purchased Classique Priced" fill="#2563eb" radius={[1, 1, 0, 0]} stackId="buy" fillOpacity={0.85} />
                <Bar dataKey="bPrP" name="Purchased Précarité Priced" fill="#d4a843" radius={[1, 1, 0, 0]} stackId="buy" fillOpacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>Priced Coverage Control — Monthly Detail</SectionTitle>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                <thead>
                  <tr>
                    {[
                      "Month",
                      "Priced Obligation",
                      "Priced Purchases",
                      "Net Position",
                      "Coverage",
                      "Status"
                    ].map(h => (
                      <TH key={h}>{h}</TH>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {monthlyData
                    .filter(d => (d.oblClP + d.oblPrP + d.bClP + d.bPrP) > 0)
                    .map(d => {
                      const obligation = d.oblClP + d.oblPrP;
                      const purchased = d.bClP + d.bPrP;
                      const net = d.netPos;
                      const coverage = d.covPct;

                      let status = { label: "N/A", color: "gray" };

                      if (obligation > 0) {
                        if (coverage >= 150) {
                          status = { label: "Overcovered", color: "sky" };
                        } else if (coverage >= 100) {
                          status = { label: "OK", color: "green" };
                        } else if (coverage >= 80) {
                          status = { label: "Watch", color: "amber" };
                        } else {
                          status = { label: "Undercovered", color: "red" };
                        }
                      }

                      return (
                        <tr key={d.month} style={{ borderBottom: "1px solid #1a1815" }}>
                          <td style={{ ...S, fontSize: "11px", color: "#e2e8f0", padding: "10px 14px", whiteSpace: "nowrap" }}>
                            {d.month}
                          </td>

                          <td style={{ ...S, fontSize: "11px", color: "#4a6080", padding: "10px 14px" }}>
                            {N(obligation, 0)} GWhc
                          </td>

                          <td style={{ ...S, fontSize: "11px", color: "#e2e8f0", padding: "10px 14px" }}>
                            {N(purchased, 0)} GWhc
                          </td>

                          <td style={{
                            ...S,
                            fontSize: "11px",
                            padding: "10px 14px",
                            color: net >= 0 ? "#34d399" : "#f87171",
                            fontWeight: 600
                          }}>
                            {net >= 0 ? "+" : ""}
                            {N(net, 0)} GWhc
                          </td>

                          <td style={{ ...S, fontSize: "11px", color: "#38bdf8", padding: "10px 14px", fontWeight: 600 }}>
                            {coverage == null ? "—" : coverage > 150 ? ">150%" : `${N(coverage, 0)}%`}
                          </td>

                          <td style={{ padding: "10px 14px" }}>
                            <Badge color={status.color}>{status.label}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>Unpriced Obligation (Forward) — GWhc to Cover</SectionTitle>

            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData.map(d => ({ ...d, unpriced: d.oblCl + d.oblPr - d.oblClP - d.oblPrP }))}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="unpriced" name="Unpriced (GWhc)" fill="#f87171" radius={[1, 1, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── PNL & MTM ── */}
      {report === "pnl" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
              <SectionTitle>Monthly Realized PnL by Type (k€)</SectionTitle>

              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} barGap={3}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                  <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTip />} />
                  <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "#4a6080" }} />
                  <ReferenceLine y={0} stroke="#1e2d45" />
                  <Bar dataKey="pnlCl" name="Realized PnL Classique (k€)" fill="#2563eb" radius={[1, 1, 0, 0]} />
                  <Bar dataKey="pnlPr" name="Realized PnL Précarité (k€)" fill="#d4a843" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
              <SectionTitle>Open Position MtM by Month (k€)</SectionTitle>

              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} barGap={3}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                  <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTip />} />
                  <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "#4a6080" }} />
                  <ReferenceLine y={0} stroke="#1e2d45" />
                  <Bar dataKey="mtmCl" name="MtM Classique (k€)" fill="#38bdf8" radius={[1, 1, 0, 0]} />
                  <Bar dataKey="mtmPr" name="MtM Précarité (k€)" fill="#f59e0b" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>YTD PnL Bridge — Realized to Net PnL + MtM (k€)</SectionTitle>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={pnlBridgeData} barSize={46}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="name" tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ ...S, fontSize: 9, fill: "#3a5070" }} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<ChartTip />} />
                <ReferenceLine y={0} stroke="#1e2d45" />
                <Bar dataKey="value" name="Contribution (k€)" radius={[1, 1, 0, 0]}>
                  {pnlBridgeData.map((entry) => (
                    <Cell
                      key={`bridge-cell-${entry.name}`}
                      fill={
                        entry.name === "Net Total"
                          ? "#34d399"
                          : entry.value >= 0
                            ? "#38bdf8"
                            : "#f87171"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(5,1fr)",
              gap: "10px",
              marginTop: "14px"
            }}>
              {pnlBridgeData.map(d => (
                <div key={d.name} style={{
                  background: "#0d1526",
                  border: "1px solid #1e2d45",
                  borderRadius: "2px",
                  padding: "10px 12px"
                }}>
                  <p style={{
                    ...S,
                    fontSize: "8px",
                    color: "#3a5070",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "4px"
                  }}>
                    {d.name}
                  </p>

                  <p style={{
                    ...CG,
                    fontSize: "17px",
                    color: d.value >= 0 ? "#34d399" : "#f87171",
                    fontWeight: 700
                  }}>
                    {d.value >= 0 ? "+" : ""}
                    {N(d.value, 0)} k€
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REGULATORY & PERFORMANCE RISK ── */}
      {report === "regulatory" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"18px" }}>
          <div style={{
            background:"#111827",
            border:"1px solid #1e2d45",
            borderRadius:"2px",
            padding:"14px 16px",
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center",
            gap:"12px",
            flexWrap:"wrap"
          }}>
            <div>
              <p style={{
                ...S,
                fontSize:"9px",
                color:"#38bdf8",
                textTransform:"uppercase",
                letterSpacing:"0.18em",
                marginBottom:"6px"
              }}>
                Regulatory & Performance Risk
              </p>

              <p style={{ ...S, fontSize:"11px", color:"#4a6080", lineHeight:1.5 }}>
                Follow-up of internal approval, contracts, EMMY crediting, EMMY validation, payment and counterparty performance risk.
              </p>
            </div>

            <div style={{ display:"flex", gap:"8px" }}>
              <button
                onClick={() => setRegulatoryType("CLASSIQUE")}
                style={{
                  ...S,
                  fontSize:"10px",
                  padding:"7px 14px",
                  borderRadius:"2px",
                  border:"1px solid",
                  cursor:"pointer",
                  letterSpacing:"0.08em",
                  textTransform:"uppercase",
                  background: regulatoryType === "CLASSIQUE" ? "#38bdf8" : "transparent",
                  color: regulatoryType === "CLASSIQUE" ? "#0a0e1a" : "#3a5070",
                  borderColor: regulatoryType === "CLASSIQUE" ? "#38bdf8" : "#1e2d45"
                }}
              >
                Classique
              </button>

              <button
                onClick={() => setRegulatoryType("PRECARITE")}
                style={{
                  ...S,
                  fontSize:"10px",
                  padding:"7px 14px",
                  borderRadius:"2px",
                  border:"1px solid",
                  cursor:"pointer",
                  letterSpacing:"0.08em",
                  textTransform:"uppercase",
                  background: regulatoryType === "PRECARITE" ? "#d4a843" : "transparent",
                  color: regulatoryType === "PRECARITE" ? "#0a0e1a" : "#3a5070",
                  borderColor: regulatoryType === "PRECARITE" ? "#d4a843" : "#1e2d45"
                }}
              >
                Précarité
              </button>
            </div>
          </div>

          <RegulatoryBlock
            title={activeRegulatoryTitle}
            data={activeRegulatoryData}
          />
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

  const latestSpot = useMemo(() => {
    if (!prices.length) {
      return {
        classique: (curve.SPOT?.classique ?? 8.78) * 1000,
        precarite: (curve.SPOT?.precarite ?? 16.88) * 1000
      };
    }

    const p = [...prices].sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return String(b.enteredAt || "").localeCompare(String(a.enteredAt || ""));
    })[0];

    return {
      classique: Number(p.classique || 0) * 1000,
      precarite: Number(p.precarite || 0) * 1000
    };
  }, [prices, curve]);

  const rows = useMemo(() => {
    const businessTrades = trades.filter(t => t.priced === true || t.priced === false);

    const buyVol = (ceeType, month = null, pricedOnly = false) =>
      businessTrades
        .filter(t =>
          t.ceeType === ceeType &&
          (month ? t.month === month : true) &&
          (!pricedOnly || t.priced === true)
        )
        .reduce((s, t) => s + Number(t.volume || 0), 0);

    const buyAvg = (ceeType, month = null, pricedOnly = false) => {
      const base = businessTrades.filter(t =>
        t.ceeType === ceeType &&
        (month ? t.month === month : true) &&
        (!pricedOnly || t.priced === true)
      );

      const vol = base.reduce((s, t) => s + Number(t.volume || 0), 0);
      if (vol <= 0) return 0;

      return base.reduce((s, t) => s + Number(t.price || 0) * Number(t.volume || 0), 0) / vol;
    };

    return MONTHS_LIST.map(month => {
      const oblClP = oblMonth(obligations, month, "CLASSIQUE", true);
      const oblPrP = oblMonth(obligations, month, "PRECARITE", true);

      const oblClT = oblMonth(obligations, month, "CLASSIQUE");
      const oblPrT = oblMonth(obligations, month, "PRECARITE");

      const bClP = buyVol("CLASSIQUE", month, true);
      const bPrP = buyVol("PRECARITE", month, true);

      const bCl = buyVol("CLASSIQUE", month, false);
      const bPr = buyVol("PRECARITE", month, false);

      const aCl = buyAvg("CLASSIQUE", month, false);
      const aPr = buyAvg("PRECARITE", month, false);

      const aClP = pnlBuyAvg(trades, "CLASSIQUE", month);
      const aPrP = pnlBuyAvg(trades, "PRECARITE", month);

      const sCl = avgSellMonth(obligations, month, "CLASSIQUE");
      const sPr = avgSellMonth(obligations, month, "PRECARITE");

      const sClP = avgSellMonth(obligations, month, "CLASSIQUE", true);
      const sPrP = avgSellMonth(obligations, month, "PRECARITE", true);

      const netCl = bCl - oblClT;
      const netPr = bPr - oblPrT;

      const totalObl = oblClT + oblPrT;
      const totalBuy = bCl + bPr;
      const covPct = totalObl > 0 ? totalBuy / totalObl * 100 : null;

      const pricedObl = oblClP + oblPrP;
      const pricedBuy = bClP + bPrP;
      const pricedCovPct = pricedObl > 0 ? pricedBuy / pricedObl * 100 : null;

      const matchCl = Math.min(bClP, oblClP);
      const matchPr = Math.min(bPrP, oblPrP);

      const pnlCl =
        matchCl > 0.001 && aClP > 0 && sClP > 0
          ? (sClP - aClP) * matchCl
          : 0;

      const pnlPr =
        matchPr > 0.001 && aPrP > 0 && sPrP > 0
          ? (sPrP - aPrP) * matchPr
          : 0;

      const openCl =
        oblClP > 0.001 && bClP > oblClP
          ? bClP - oblClP
          : 0;

      const openPr =
        oblPrP > 0.001 && bPrP > oblPrP
          ? bPrP - oblPrP
          : 0;

      const mtmCl =
        openCl > 0 && aClP > 0
          ? openCl * (latestSpot.classique - aClP)
          : 0;

      const mtmPr =
        openPr > 0 && aPrP > 0
          ? openPr * (latestSpot.precarite - aPrP)
          : 0;

      const oblClU = Math.max(oblClT - oblClP, 0);
      const oblPrU = Math.max(oblPrT - oblPrP, 0);

      const bClU = Math.max(bCl - bClP, 0);
      const bPrU = Math.max(bPr - bPrP, 0);

      const forwardCl = bClU - oblClU;
      const forwardPr = bPrU - oblPrU;

      return {
        month,

        oblClP,
        oblPrP,
        oblClT,
        oblPrT,

        bCl,
        bPr,
        bClP,
        bPrP,
        bClU,
        bPrU,

        aCl,
        aPr,
        aClP,
        aPrP,

        sCl,
        sPr,
        sClP,
        sPrP,

        netCl,
        netPr,
        covPct,
        pricedCovPct,

        matchCl,
        matchPr,
        openCl,
        openPr,

        pnlCl,
        pnlPr,
        mtmCl,
        mtmPr,

        oblClU,
        oblPrU,
        forwardCl,
        forwardPr,

        unpricedSpotValue:
          oblClU * latestSpot.classique +
          oblPrU * latestSpot.precarite
      };
    });
  }, [trades, obligations, latestSpot]);

  const tot = useMemo(() => ({
    oblCl: rows.reduce((s, r) => s + r.oblClT, 0),
    oblPr: rows.reduce((s, r) => s + r.oblPrT, 0),

    oblClP: rows.reduce((s, r) => s + r.oblClP, 0),
    oblPrP: rows.reduce((s, r) => s + r.oblPrP, 0),

    bCl: rows.reduce((s, r) => s + r.bCl, 0),
    bPr: rows.reduce((s, r) => s + r.bPr, 0),

    bClP: rows.reduce((s, r) => s + r.bClP, 0),
    bPrP: rows.reduce((s, r) => s + r.bPrP, 0),

    bClU: rows.reduce((s, r) => s + r.bClU, 0),
    bPrU: rows.reduce((s, r) => s + r.bPrU, 0),

    pnlCl: rows.reduce((s, r) => s + r.pnlCl, 0),
    pnlPr: rows.reduce((s, r) => s + r.pnlPr, 0),

    mtmCl: rows.reduce((s, r) => s + r.mtmCl, 0),
    mtmPr: rows.reduce((s, r) => s + r.mtmPr, 0),

    oblClU: rows.reduce((s, r) => s + r.oblClU, 0),
    oblPrU: rows.reduce((s, r) => s + r.oblPrU, 0),

    forwardCl: rows.reduce((s, r) => s + r.forwardCl, 0),
    forwardPr: rows.reduce((s, r) => s + r.forwardPr, 0),

    unpricedSpotValue: rows.reduce((s, r) => s + r.unpricedSpotValue, 0)
  }), [rows]);

  const totalObl = tot.oblCl + tot.oblPr;
  const totalBuy = tot.bCl + tot.bPr;
  const totalPricedObl = tot.oblClP + tot.oblPrP;
  const totalPricedBuy = tot.bClP + tot.bPrP;

  const totalCoverage = totalObl > 0 ? totalBuy / totalObl * 100 : null;
  const pricedCoverage = totalPricedObl > 0 ? totalPricedBuy / totalPricedObl * 100 : null;

  const totalPnl = tot.pnlCl + tot.pnlPr;
  const totalMtm = tot.mtmCl + tot.mtmPr;
  const totalEstimated = totalPnl + totalMtm;

  const VIEWS = [
    { id: "position", label: "Position & Coverage" },
    { id: "pnl", label: "Realized PnL & MtM" },
    { id: "unpriced", label: "Unpriced Obligations" }
  ];

  const pc = (v) => v != null ? (
    <span style={{
      ...S,
      fontSize: "12px",
      color: v > 0 ? CHART_COLORS.green : v < 0 ? CHART_COLORS.red : "#3a5070",
      fontWeight: v !== 0 ? 600 : 400
    }}>
      {v > 0 ? "+" : ""}{N(v, 2)}
    </span>
  ) : "—";

  const pk = (v) => v != null ? (
    <span style={{
      ...S,
      fontSize: "12px",
      color: v > 0 ? CHART_COLORS.green : v < 0 ? CHART_COLORS.red : "#3a5070",
      fontWeight: v !== 0 ? 600 : 400
    }}>
      {fK(v)}
    </span>
  ) : "—";

  const zeroDash = (
    <span style={{ ...S, fontSize: "10px", color: "#1e2d45" }}>—</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "14px", borderBottom: "1px solid #e2e4e8" }}>
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            style={{
              ...S,
              background: "none",
              border: "none",
              fontSize: "10px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "10px 0",
              cursor: "pointer",
              whiteSpace: "nowrap",
              color: view === v.id ? "#38bdf8" : "#3a5070",
              borderBottom: view === v.id ? "1px solid #b8973a" : "1px solid transparent"
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
        {view === "position" && (
          <>
            <KPI
              label="FY 2026 Classique Obligation"
              value={N(tot.oblCl, 0) + " GWhc"}
              color="sky"
              sub="Full-year obligation"
            />

            <KPI
              label="FY 2026 Classique Purchased"
              value={N(tot.bCl, 0) + " GWhc"}
              color="sky"
              sub="Full-year purchases"
            />

            <KPI
              label="FY 2026 Précarité Obligation"
              value={N(tot.oblPr, 0) + " GWhc"}
              color="amber"
              sub="Full-year obligation"
            />

            <KPI
              label="FY 2026 Précarité Purchased"
              value={N(tot.bPr, 0) + " GWhc"}
              color="amber"
              sub="Full-year purchases"
            />
          </>
        )}

        {view === "pnl" && (
          <>
            <KPI label="Realized PnL Classique" value={fK(tot.pnlCl)} color={tot.pnlCl >= 0 ? "emerald" : "rose"} />
            <KPI label="Realized PnL Précarité" value={fK(tot.pnlPr)} color={tot.pnlPr >= 0 ? "emerald" : "rose"} />
            <KPI label="MtM Classique" value={fK(tot.mtmCl)} color={tot.mtmCl >= 0 ? "emerald" : "rose"} />
            <KPI label="MtM Précarité" value={fK(tot.mtmPr)} color={tot.mtmPr >= 0 ? "emerald" : "rose"} />
          </>
        )}

        {view === "unpriced" && (
          <>
            <KPI label="Unpriced Classique Obligation" value={N(tot.oblClU, 0) + " GWhc"} color="rose" />
            <KPI label="Unpriced Précarité Obligation" value={N(tot.oblPrU, 0) + " GWhc"} color="rose" />
            <KPI label="Unpriced Purchases" value={N(tot.bClU + tot.bPrU, 0) + " GWhc"} color="sky" />
            <KPI label="Forward Position" value={N(tot.forwardCl + tot.forwardPr, 0) + " GWhc"} color={(tot.forwardCl + tot.forwardPr) >= 0 ? "emerald" : "rose"} />
          </>
        )}
      </div>

      {view === "position" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "10px" }}>
          <KPI
            label="FY 2026 Total Coverage"
            value={totalCoverage == null ? "—" : `${N(totalCoverage, 1)}%`}
            color={totalCoverage >= 100 ? "emerald" : totalCoverage >= 80 ? "amber" : "rose"}
            sub="Full-year purchases / full-year obligations"
          />

          <KPI
            label="Priced Coverage"
            value={pricedCoverage == null ? "—" : `${N(pricedCoverage, 1)}%`}
            color={pricedCoverage >= 100 ? "emerald" : pricedCoverage >= 80 ? "amber" : "rose"}
            sub="Priced purchases / priced obligations only"
          />
        </div>
      )}

      {view === "pnl" && (
        <KPI
          label="Estimated Total PnL"
          value={fM(totalEstimated)}
          color={totalEstimated >= 0 ? "emerald" : "rose"}
          sub="Realized PnL + open priced position MtM"
        />
      )}

      {view === "unpriced" && (
        <KPI
          label="Unpriced Spot Valuation"
          value={fM(tot.unpricedSpotValue)}
          color="gray"
          sub="Unpriced obligations valued at latest spot"
        />
      )}

      <div style={{ overflowX: "auto", border: "1px solid #1e1c18", borderRadius: "2px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: view === "pnl" ? "1150px" : "1000px" }}>
          <thead>
            <tr>
              <TH>Month</TH>

              {view === "position" && (
                <>
                  <TH>FY Classique Obligation</TH>
                  <TH>FY Précarité Obligation</TH>
                  <TH>FY Purchased Classique</TH>
                  <TH>FY Purchased Précarité</TH>
                  <TH>Net Classique</TH>
                  <TH>Net Précarité</TH>
                  <TH>Total Coverage</TH>
                  <TH>Priced Coverage</TH>
                  <TH>Avg Purchase Classique</TH>
                  <TH>Avg Purchase Précarité</TH>
                </>
              )}

              {view === "pnl" && (
                <>
                  <TH>Avg Purchase Classique</TH>
                  <TH>Avg Sale Classique</TH>
                  <TH>Matched Classique</TH>
                  <TH>PnL Classique</TH>
                  <TH>Avg Purchase Précarité</TH>
                  <TH>Avg Sale Précarité</TH>
                  <TH>Matched Précarité</TH>
                  <TH>PnL Précarité</TH>
                  <TH>Open Classique</TH>
                  <TH>MtM Classique</TH>
                  <TH>Open Précarité</TH>
                  <TH>MtM Précarité</TH>
                  <TH>Net PnL + MtM</TH>
                </>
              )}

              {view === "unpriced" && (
                <>
                  <TH>Total Classique Obligation</TH>
                  <TH>Unpriced Classique Obligation</TH>
                  <TH>Unpriced Classique Purchased</TH>
                  <TH>Forward Classique</TH>
                  <TH>Total Précarité Obligation</TH>
                  <TH>Unpriced Précarité Obligation</TH>
                  <TH>Unpriced Précarité Purchased</TH>
                  <TH>Forward Précarité</TH>
                  <TH>Total Unpriced</TH>
                  <TH>Estimated Spot Value</TH>
                </>
              )}
            </tr>
          </thead>

          <tbody>
            {rows.map((r, i) => {
              const bg = i % 2 === 0 ? "#111827" : "#141210";
              const isForecast = r.month > "2026-05";

              return (
                <tr
                  key={r.month}
                  style={{ borderBottom: "1px solid #1a1815", background: bg }}
                  onMouseEnter={e => e.currentTarget.style.background = "#0d1526"}
                  onMouseLeave={e => e.currentTarget.style.background = bg}
                >
                  <td style={{ ...CG, fontSize: "15px", color: "#e2e8f0", padding: "9px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {ML(r.month)}
                    {isForecast && <span style={{ ...S, fontSize: "8px", color: "#1e2d45", marginLeft: "6px" }}>FCST</span>}
                  </td>

                  {view === "position" && (
                    <>
                      <td style={{ ...S, fontSize: "12px", color: "#2563eb", padding: "9px 14px" }}>{N(r.oblClT, 2)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "#d4a843", padding: "9px 14px" }}>{N(r.oblPrT, 2)}</td>
                      <td style={{ ...S, fontSize: "12px", color: r.bCl > 0 ? "#e2e8f0" : "#3d3830", padding: "9px 14px" }}>{N(r.bCl, 2)}</td>
                      <td style={{ ...S, fontSize: "12px", color: r.bPr > 0 ? "#e2e8f0" : "#3d3830", padding: "9px 14px" }}>{N(r.bPr, 2)}</td>
                      <td style={{ padding: "9px 14px" }}>{pc(r.netCl)}</td>
                      <td style={{ padding: "9px 14px" }}>{pc(r.netPr)}</td>
                      <td style={{ padding: "9px 14px", minWidth: "120px" }}>
                        {r.covPct == null ? zeroDash : <CovBar pct={r.covPct} />}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: "#38bdf8", padding: "9px 14px" }}>
                        {r.pricedCovPct == null ? "—" : `${N(r.pricedCovPct, 1)}%`}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{fmtMWhc(r.aCl)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{fmtMWhc(r.aPr)}</td>
                    </>
                  )}

                  {view === "pnl" && (
                    <>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{fmtMWhc(r.aClP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{fmtMWhc(r.sClP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{r.matchCl > 0 ? N(r.matchCl, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.pnlCl) > 0.01 ? pk(r.pnlCl) : zeroDash}</td>

                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{fmtMWhc(r.aPrP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{fmtMWhc(r.sPrP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{r.matchPr > 0 ? N(r.matchPr, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.pnlPr) > 0.01 ? pk(r.pnlPr) : zeroDash}</td>

                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{r.openCl > 0 ? N(r.openCl, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.mtmCl) > 0.01 ? pk(r.mtmCl) : zeroDash}</td>

                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{r.openPr > 0 ? N(r.openPr, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.mtmPr) > 0.01 ? pk(r.mtmPr) : zeroDash}</td>

                      <td style={{ padding: "9px 14px" }}>{pk(r.pnlCl + r.pnlPr + r.mtmCl + r.mtmPr)}</td>
                    </>
                  )}

                  {view === "unpriced" && (
                    <>
                      <td style={{ ...S, fontSize: "12px", color: "#2563eb", padding: "9px 14px" }}>{N(r.oblClT, 2)}</td>
                      <td style={{ padding: "9px 14px" }}>
                        {r.oblClU > 0.01
                          ? <span style={{ ...S, fontSize: "12px", color: "#f87171", fontWeight: 600 }}>{N(r.oblClU, 2)}</span>
                          : zeroDash}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: r.bClU > 0 ? "#e2e8f0" : "#3d3830", padding: "9px 14px" }}>
                        {r.bClU > 0.01 ? N(r.bClU, 2) : "—"}
                      </td>
                      <td style={{ padding: "9px 14px" }}>
                        {(r.oblClU + r.bClU) > 0.01 ? pc(r.forwardCl) : zeroDash}
                      </td>

                      <td style={{ ...S, fontSize: "12px", color: "#d4a843", padding: "9px 14px" }}>{N(r.oblPrT, 2)}</td>
                      <td style={{ padding: "9px 14px" }}>
                        {r.oblPrU > 0.01
                          ? <span style={{ ...S, fontSize: "12px", color: "#f87171", fontWeight: 600 }}>{N(r.oblPrU, 2)}</span>
                          : zeroDash}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: r.bPrU > 0 ? "#e2e8f0" : "#3d3830", padding: "9px 14px" }}>
                        {r.bPrU > 0.01 ? N(r.bPrU, 2) : "—"}
                      </td>
                      <td style={{ padding: "9px 14px" }}>
                        {(r.oblPrU + r.bPrU) > 0.01 ? pc(r.forwardPr) : zeroDash}
                      </td>

                      <td style={{ padding: "9px 14px" }}>
                        {(r.oblClU + r.oblPrU) > 0.01
                          ? <span style={{ ...S, fontSize: "12px", color: "#f87171", fontWeight: 600 }}>{N(r.oblClU + r.oblPrU, 2)}</span>
                          : zeroDash}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>
                        {(r.oblClU + r.oblPrU) > 0.01 ? fK(r.unpricedSpotValue) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}

            <tr style={{ background: "#1e2d45", borderTop: "1px solid #2e2b24" }}>
              <td style={{ ...S, fontSize: "10px", color: "#38bdf8", padding: "10px 14px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Total 2026
              </td>

              {view === "position" && (
                <>
                  <td style={{ ...S, fontSize: "12px", color: "#2563eb", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblCl, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#d4a843", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblPr, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#e2e8f0", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bCl, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#e2e8f0", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bPr, 0)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.bCl - tot.oblCl)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.bPr - tot.oblPr)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#38bdf8", padding: "10px 14px", fontWeight: 700 }}>
                    {totalCoverage == null ? "—" : `${N(totalCoverage, 1)}%`}
                  </td>
                  <td style={{ ...S, fontSize: "12px", color: "#38bdf8", padding: "10px 14px", fontWeight: 700 }}>
                    {pricedCoverage == null ? "—" : `${N(pricedCoverage, 1)}%`}
                  </td>
                  <td colSpan={2} />
                </>
              )}

              {view === "pnl" && (
                <>
                  <td colSpan={3} />
                  <td style={{ padding: "10px 14px" }}>{pk(tot.pnlCl)}</td>
                  <td colSpan={3} />
                  <td style={{ padding: "10px 14px" }}>{pk(tot.pnlPr)}</td>
                  <td />
                  <td style={{ padding: "10px 14px" }}>{pk(tot.mtmCl)}</td>
                  <td />
                  <td style={{ padding: "10px 14px" }}>{pk(tot.mtmPr)}</td>
                  <td style={{ padding: "10px 14px" }}>{pk(totalEstimated)}</td>
                </>
              )}

              {view === "unpriced" && (
                <>
                  <td />
                  <td style={{ ...S, fontSize: "12px", color: "#f87171", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblClU, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#e2e8f0", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bClU, 0)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.forwardCl)}</td>
                  <td />
                  <td style={{ ...S, fontSize: "12px", color: "#f87171", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblPrU, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#e2e8f0", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bPrU, 0)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.forwardPr)}</td>
                  <td style={{ ...S, fontSize: "13px", color: "#f87171", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblClU + tot.oblPrU, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "10px 14px", fontWeight: 700 }}>{fK(tot.unpricedSpotValue)}</td>
                </>
              )}
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
function Blotter({ trades, currentUser, onAdd, onApprove, onReject, onDelete, onUpdate }) {
  const [filter, setFilter] = useState("ALL");
  const [filterMonth, setFilterMonth] = useState("ALL");
  const [filterVendor, setFilterVendor] = useState("ALL");
  const [filterPriced, setFilterPriced] = useState("ALL");
  
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);

  const BLOTTER_TABLE_WIDTH = "2050px";

  // Operational filters
  const [filterContract, setFilterContract] = useState("ALL");
  const [filterPayment, setFilterPayment] = useState("ALL");
  const [filterValidation, setFilterValidation] = useState("ALL");
  const [filterDeposit, setFilterDeposit] = useState("ALL");
  const [filterCpRanking, setFilterCpRanking] = useState("ALL");

  const [sortKey, setSortKey] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [showModal, setShowModal] = useState(false);
  const [tradesDraft, setTradesDraft] = useState({});

  const blank = {
    ceeType: "CLASSIQUE",
    vendor: "",
    dealType: "Fixed Price",
    period: "P6",
    volume: "",
    price: "",
    month: "",
    priced: true,

    sourcing: "Secondary",
    contractYesNo: true,
    contractSigned: false,
    contractDate: "",
    paymentTerms: "After Delivery",
    volumeDeposited: "0",
    validated: false,
    payment: false,
    cpRanking: "",
    comments: "",

    ranking: "",
    statut: "Pas encore contracté"
  };
  const [form, setForm] = useState(blank);

  const months = useMemo(
    () => ["ALL", ...new Set(trades.map(t => t.month).filter(Boolean))].sort(),
    [trades]
  );

  const vendors = useMemo(
    () => ["ALL", ...new Set(trades.map(t => t.vendor).filter(Boolean))].sort(),
    [trades]
  );

  const cpRankings = useMemo(
    () => ["ALL", ...new Set(trades.map(t => t.cpRanking).filter(Boolean))].sort(),
    [trades]
  );
  
  const EPS = 0.001;

  const getContractStatus = (t) => {
    if (t.contractSigned === true) return { label: "Signed", color: "green" };
    if (t.contractYesNo === true && t.contractSigned !== true) return { label: "To sign", color: "amber" };
    if (t.contractYesNo === false) return { label: "No contract", color: "red" };
    return { label: "N/A", color: "gray" };
  };

  const getPaymentStatus = (t) => {
    if (t.payment === true) return { label: "Paid", color: "green" };
    if (t.payment === false) return { label: "Unpaid", color: "red" };
    return { label: "N/A", color: "gray" };
  };

  const getValidationStatus = (t) => {
    if (t.validated === true) return { label: "Validated", color: "green" };
    if (t.validated === false) return { label: "Pending", color: "amber" };
    return { label: "N/A", color: "gray" };
  };

  const getDepositStatus = (t) => {
    const remaining = Number(t.volumeRemainingToBeDeposited);
    const deposited = Number(t.volumeCredited ?? t.volumeDeposited ?? 0);

    if (!Number.isFinite(remaining)) return { label: "N/A", color: "gray" };
    if (remaining < -EPS) return { label: "Over", color: "purple" };
    if (Math.abs(remaining) <= EPS) return { label: "Full", color: "green" };
    if (deposited > EPS && remaining > EPS) return { label: "Partial", color: "amber" };
    return { label: "Open", color: "red" };
  };

  const filtered = useMemo(() => {
    let l = [...trades];

    if (filter === "PENDING") l = l.filter(t => t.status === "PENDING");
    if (filter === "APPROVED") l = l.filter(t => t.status === "APPROVED");
    if (filter === "CLASSIQUE") l = l.filter(t => t.ceeType === "CLASSIQUE");
    if (filter === "PRECARITE") l = l.filter(t => t.ceeType === "PRECARITE");

    if (filterMonth !== "ALL") l = l.filter(t => t.month === filterMonth);
    if (filterVendor !== "ALL") l = l.filter(t => t.vendor === filterVendor);
    if (filterPriced !== "ALL") l = l.filter(t => String(t.priced) === filterPriced);

    if (filterContract !== "ALL") {
      l = l.filter(t => {
        const s = getContractStatus(t).label;
        return s === filterContract;
      });
    }

    if (filterPayment !== "ALL") {
      l = l.filter(t => {
        const s = getPaymentStatus(t).label;
        return s === filterPayment;
      });
    }

    if (filterValidation !== "ALL") {
      l = l.filter(t => {
        const s = getValidationStatus(t).label;
        return s === filterValidation;
      });
    }

    if (filterDeposit !== "ALL") {
      l = l.filter(t => {
        const s = getDepositStatus(t).label;
        return s === filterDeposit;
      });
    }

    if (filterCpRanking !== "ALL") {
      l = l.filter(t => t.cpRanking === filterCpRanking);
    }

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
  }, [
    trades,
    filter,
    filterMonth,
    filterVendor,
    filterPriced,
    filterContract,
    filterPayment,
    filterValidation,
    filterDeposit,
    filterCpRanking,
    sortKey,
    sortDir
  ]);

  const exportBlotterToExcel = () => {
    const data = filtered.map(t => ({
      ID: t.id,
      Type: t.ceeType,
      Seller: t.vendor,
      "Deal type": t.dealType,
      Period: t.period,
      "Volume (GWhc)": t.volume,
      "Price (EUR/GWhc)": t.price ?? "",
      Month: t.month,
      Priced: t.priced ? "Yes" : "No",
      "Contract status": t.statut || "",
      Ranking: t.ranking || "",
      EMMY: t.emmyValidated ? "Validated" : "Pending",
      Approval: t.status,
      "Created by": t.createdBy,
      "Approved by": t.approvedBy || "",
      "Created at": t.createdAt ? new Date(t.createdAt).toLocaleString("fr-FR") : ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!autofilter"] = { ref: worksheet["!ref"] };
    worksheet["!cols"] = Object.keys(data[0] || { Empty: "" }).map(() => ({ wch: 18 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Blotter");

    XLSX.writeFile(workbook, `CEE_Blotter_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const handleSubmit = () => {
    if (!form.vendor || !form.volume || !form.price || !form.month) {
      alert("Merci de renseigner au minimum le seller, le volume, le prix et le mois.");
      return;
    }

    const volume = Number(form.volume);
    const price = Number(form.price);
    const deposited = Number(form.volumeDeposited || 0);

    if (!Number.isFinite(volume) || volume <= 0) {
      alert("Merci de saisir un volume valide.");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      alert("Merci de saisir un prix valide.");
      return;
    }

    if (!Number.isFinite(deposited) || deposited < 0) {
      alert("Merci de saisir un volume déposé valide.");
      return;
    }

    const remaining = volume - deposited;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const newTrade = {
      id: "t" + uid(),

      ceeType: form.ceeType,
      vendor: form.vendor,
      dealType: form.dealType,
      period: form.period,
      volume,
      price,
      month: form.month,
      status: "PENDING",
      priced: form.priced,
      statut: form.contractSigned ? "Contrat signé" : form.statut,
      ranking: form.ranking || form.cpRanking || null,
      emmyValidated: false,
      createdBy: currentUser.id,
      approvedBy: null,
      createdAt: now,

      year: Number(String(form.month).slice(0, 4)) || null,
      operationType: "Achat",
      pricingMonth: null,
      comments: form.comments || null,
      sourcing: form.sourcing || null,
      tolerancePct: null,
      volumeM3Equivalent: null,

      contractYesNo: form.contractYesNo,
      contractSigned: form.contractSigned,
      contractDate: form.contractDate || null,
      paymentTerms: form.paymentTerms || null,

      volumeDeposited: deposited,
      volumeRemainingToBeDeposited: remaining,

      validated: form.validated,
      validationDate: form.validated ? today : null,

      payment: form.payment,
      paymentDate: form.payment ? today : null,

      cpRanking: form.cpRanking || null
    };

    onAdd(newTrade);
    setShowModal(false);
    setForm(blank);
  };

  const SB=s=>s==="APPROVED"?<Badge color="green">Approved</Badge>:s==="PENDING"?<Badge color="amber">Pending</Badge>:<Badge color="red">Rejected</Badge>;

  const filterLabel = (f) => {
    if (f === "ALL") return "ALL";
    if (f === "PENDING") return "PENDING";
    if (f === "APPROVED") return "APPROVED";
    if (f === "CLASSIQUE") return "CLASSIQUE";
    if (f === "PRECARITE") return "PRÉCARITÉ";
    return f;
  };

  const syncTopScroll = () => {
    if (tableScrollRef.current && topScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };

  const syncTableScroll = () => {
    if (tableScrollRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  };

  const togglePriced = (t) => {
    onUpdate(t.id, {
      priced: !t.priced
    });
  };

  const toggleContract = (t) => {
    const nextSigned = !t.contractSigned;

    onUpdate(t.id, {
      contractSigned: nextSigned,
      contractYesNo: nextSigned ? true : t.contractYesNo
    });
  };

  const toggleValidation = (t) => {
    const nextValidated = !t.validated;

    onUpdate(t.id, {
      validated: nextValidated,
      validationDate: nextValidated ? new Date().toISOString().slice(0, 10) : null
    });
  };

  const togglePayment = (t) => {
    const nextPayment = !t.payment;

    onUpdate(t.id, {
      payment: nextPayment,
      paymentDate: nextPayment ? new Date().toISOString().slice(0, 10) : null
    });
  };

  const toggleApproval = (t) => {
    const nextStatus = t.status === "APPROVED" ? "PENDING" : "APPROVED";

    onUpdate(t.id, {
      status: nextStatus,
      approvedBy: nextStatus === "APPROVED" ? currentUser.id : null
    });
  };

  const updateDeposited = (t, value) => {
    const deposited = Number(value);

    if (!Number.isFinite(deposited) || deposited < 0) {
      alert("Merci de saisir un volume déposé valide.");
      return;
    }

    const remaining = Number(t.volume || 0) - deposited;

    onUpdate(t.id, {
      volumeDeposited: deposited,
      volumeRemainingToBeDeposited: remaining
    });
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{
        background: "#111827",
        border: "1px solid #1e2d45",
        borderRadius: "2px",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>
        {/* Row 1 — Main status filters + actions */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap"
        }}>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {["ALL", "PENDING", "APPROVED", "CLASSIQUE", "PRECARITE"].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  ...S,
                  fontSize: "10px",
                  padding: "6px 12px",
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
                {filterLabel(f)}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={exportBlotterToExcel}
              style={{
                ...S,
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "linear-gradient(135deg, #0f2e1a, #123d24)",
                color: "#34d399",
                border: "1px solid #1d6b3a",
                borderRadius: "2px",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                padding: "8px 14px",
                cursor: "pointer",
                boxShadow: "0 0 0 1px rgba(52, 211, 153, 0.08) inset"
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "16px",
                  height: "16px",
                  borderRadius: "2px",
                  background: "#166534",
                  color: "#dcfce7",
                  fontSize: "10px",
                  fontWeight: 800,
                  lineHeight: 1
                }}
              >
                X
              </span>
              Export Excel
            </button>

            {currentUser?.role === "trader" && (
              <GoldBtn onClick={() => setShowModal(true)}>+ New Purchase</GoldBtn>
            )}
          </div>
        </div>

        {/* Row 2 — Business / operational filters */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
          gap: "8px"
        }}>
          <select
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            {months.map(m => (
              <option key={m} value={m}>
                {m === "ALL" ? "All months" : ML(m)}
              </option>
            ))}
          </select>

          <select
            value={filterVendor}
            onChange={e => setFilterVendor(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            {vendors.map(v => (
              <option key={v} value={v}>
                {v === "ALL" ? "All sellers" : v}
              </option>
            ))}
          </select>

          <select
            value={filterPriced}
            onChange={e => setFilterPriced(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            <option value="ALL">Priced / unpriced</option>
            <option value="true">Priced</option>
            <option value="false">Unpriced</option>
          </select>

          <select
            value={filterContract}
            onChange={e => setFilterContract(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            <option value="ALL">All contracts</option>
            <option value="Signed">Signed</option>
            <option value="To sign">To sign</option>
            <option value="No contract">No contract</option>
            <option value="N/A">N/A</option>
          </select>

          <select
            value={filterValidation}
            onChange={e => setFilterValidation(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            <option value="ALL">All validations</option>
            <option value="Validated">Validated</option>
            <option value="Pending">Pending validation</option>
            <option value="N/A">N/A</option>
          </select>

          <select
            value={filterPayment}
            onChange={e => setFilterPayment(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            <option value="ALL">All payments</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="N/A">N/A</option>
          </select>

          <select
            value={filterDeposit}
            onChange={e => setFilterDeposit(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            <option value="ALL">All deposits</option>
            <option value="Full">Fully deposited</option>
            <option value="Partial">Partially deposited</option>
            <option value="Open">Open deposit</option>
            <option value="Over">Over-deposited</option>
            <option value="N/A">N/A</option>
          </select>

          <select
            value={filterCpRanking}
            onChange={e => setFilterCpRanking(e.target.value)}
            style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
          >
            {cpRankings.map(r => (
              <option key={r} value={r}>
                {r === "ALL" ? "All CP rankings" : r}
              </option>
            ))}
          </select>
        </div>

        {/* Row 3 — Sort controls + result count */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          borderTop: "1px solid #1e2d45",
          paddingTop: "10px"
        }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value)}
              style={{ ...S, background:"#0d1526", border:"1px solid #2e2b24", color:"#4a6080", borderRadius:"2px", padding:"7px 9px", fontSize:"10px", outline:"none" }}
            >
              <option value="createdAt">Sort by creation date</option>
              <option value="month">Sort by month</option>
              <option value="vendor">Sort by seller</option>
              <option value="volume">Sort by volume</option>
              <option value="price">Sort by price</option>
              <option value="status">Sort by approval</option>
            </select>

            <button
              onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
              style={{
                ...S,
                fontSize: "10px",
                padding: "7px 12px",
                borderRadius: "2px",
                border: "1px solid #1e2d45",
                cursor: "pointer",
                background: "transparent",
                color: "#3a5070"
              }}
            >
              {sortDir === "asc" ? "↑ ASC" : "↓ DESC"}
            </button>
          </div>

          <span style={{ ...S, fontSize: "10px", color: "#3a5070" }}>
            {filtered.length} trade{filtered.length > 1 ? "s" : ""} displayed / {trades.length} total
          </span>
        </div>
      </div>

      <div>
        <div
          ref={topScrollRef}
          onScroll={syncTopScroll}
          style={{
            overflowX: "auto",
            overflowY: "hidden",
            height: "14px",
            marginBottom: "6px",
            border: "1px solid #1e2d45",
            borderRadius: "2px",
            background: "#0d1526"
          }}
        >
          <div style={{ width: BLOTTER_TABLE_WIDTH, height: "1px" }} />
        </div>

        <div
          ref={tableScrollRef}
          onScroll={syncTableScroll}
          style={{
            overflowX: "auto",
            border: "1px solid #1e1c18",
            borderRadius: "2px"
          }}
        >
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:BLOTTER_TABLE_WIDTH }}>
            <thead>
              <tr>
                {[
                  "Type",
                  "Seller",
                  "Deal Type",
                  "Period",
                  "Month",
                  "Pricing Month",
                  "Volume (GWhc)",
                  "Price (€/GWhc)",
                  "Priced",
                  "Sourcing",
                  "Contract",
                  "Validated",
                  "Payment",
                  "Credited EMMY (GWhc)",
                  "Remaining to credit (GWhc)",
                  "CP Ranking",
                  "Approval",
                  "Actions"
                ].map(h => <TH key={h}>{h}</TH>)}
              </tr>
            </thead>

            <tbody>
              {filtered.map(t => {
                const can = currentUser.role === "approver" && t.status === "PENDING" && t.createdBy !== currentUser.id;
                const bg = "#111827";

                return (
                  <tr
                    key={t.id}
                    style={{ borderBottom:"1px solid #1a1815", background:bg }}
                    onMouseEnter={e => e.currentTarget.style.background = "#0d1526"}
                    onMouseLeave={e => e.currentTarget.style.background = bg}
                  >
                    <td
                      style={{
                        padding:"9px 14px",
                        minWidth:"130px",
                        whiteSpace:"nowrap"
                      }}
                    >
                      <Badge color={t.ceeType === "CLASSIQUE" ? "sky" : "amber"}>
                        {t.ceeType === "PRECARITE" ? "PRÉCARITÉ" : t.ceeType}
                      </Badge>
                    </td>

                    <td style={{ ...CG, fontSize:"14px", color:"#e2e8f0", padding:"9px 14px", maxWidth:"180px" }}>
                      {t.vendor}
                    </td>

                    <td style={{ ...S, fontSize:"10px", color:"#4a6080", padding:"9px 14px" }}>
                      {t.dealType}
                    </td>

                    <td style={{ ...S, fontSize:"10px", color:"#3a5070", padding:"9px 14px" }}>
                      {t.period}
                    </td>

                    <td style={{ ...S, fontSize:"11px", color:"#4a6080", padding:"9px 14px", whiteSpace:"nowrap" }}>
                      {t.month ? ML(t.month) : "—"}
                    </td>

                    <td style={{ ...S, fontSize:"11px", color:"#4a6080", padding:"9px 14px", whiteSpace:"nowrap" }}>
                      {t.pricingMonth ? ML(t.pricingMonth) : "—"}
                    </td>

                    <td style={{ ...S, fontSize:"12px", color:"#e2e8f0", padding:"9px 14px" }}>
                      {N(t.volume, 3)}
                    </td>

                    <td style={{ ...S, fontSize:"12px", color:"#e2e8f0", padding:"9px 14px" }}>
                      {N(t.price, 0)}
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      <button
                        onClick={() => togglePriced(t)}
                        style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}
                        title="Toggle priced status"
                      >
                        <Badge color={t.priced === true ? "green" : "gray"}>
                          {t.priced === true ? "Priced" : "Unpriced"}
                        </Badge>
                      </button>
                    </td>

                    <td style={{ ...S, fontSize:"10px", color:"#4a6080", padding:"9px 14px", maxWidth:"170px" }}>
                      {t.sourcing || "—"}
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      <button
                        onClick={() => toggleContract(t)}
                        style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}
                        title="Toggle contract signed"
                      >
                        {(() => {
                          const s = getContractStatus(t);
                          return <Badge color={s.color}>{s.label}</Badge>;
                        })()}
                      </button>
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      <button
                        onClick={() => toggleValidation(t)}
                        style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}
                        title="Toggle validation status"
                      >
                        {(() => {
                          const s = getValidationStatus(t);
                          return <Badge color={s.color}>{s.label}</Badge>;
                        })()}
                      </button>
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      <button
                        onClick={() => togglePayment(t)}
                        style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}
                        title="Toggle payment status"
                      >
                        {(() => {
                          const s = getPaymentStatus(t);
                          return <Badge color={s.color}>{s.label}</Badge>;
                        })()}
                      </button>
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      <input
                        type="number"
                        step="0.001"
                        value={tradesDraft[t.id] ?? t.volumeCredited ?? t.volumeDeposited ?? ""}
                        onChange={e => {
                          setTradesDraft(prev => ({
                            ...prev,
                            [t.id]: e.target.value
                          }));
                        }}
                        onBlur={e => {
                          updateDeposited(t, e.target.value);
                          setTradesDraft(prev => {
                            const next = { ...prev };
                            delete next[t.id];
                            return next;
                          });
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        style={{
                          ...S,
                          width:"82px",
                          background:"#0d1526",
                          border:"1px solid #2e2b24",
                          color:"#e2e8f0",
                          borderRadius:"2px",
                          padding:"5px 7px",
                          fontSize:"10px",
                          outline:"none"
                        }}
                      />
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      {(() => {
                        const s = getDepositStatus(t);
                        const remaining = t.volumeRemainingToBeDeposited;

                        return (
                          <div style={{ display:"flex", flexDirection:"column", gap:"3px" }}>
                            <Badge color={s.color}>{s.label}</Badge>
                            <span
                              style={{
                                ...S,
                                fontSize:"10px",
                                color: remaining < -EPS ? "#b07ee8" : remaining > EPS ? "#f87171" : "#4a6080"
                              }}
                            >
                              {remaining != null ? N(remaining, 3) : "—"}
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      {t.cpRanking
                        ? (
                          <Badge color={t.cpRanking === "AAA" ? "green" : t.cpRanking?.includes("A") ? "sky" : "amber"}>
                            {t.cpRanking}
                          </Badge>
                        )
                        : <span style={{ ...S, fontSize:"10px", color:"#3d3830" }}>—</span>}
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      <button
                        onClick={() => toggleApproval(t)}
                        style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}
                        title="Toggle approval status"
                      >
                        {SB(t.status)}
                      </button>
                    </td>

                    <td style={{ padding:"9px 14px" }}>
                      {can && (
                        <div style={{ display:"flex", gap:"5px" }}>
                          <button
                            onClick={() => onApprove(t.id, currentUser.id)}
                            style={{ ...S, fontSize:"10px", padding:"4px 8px", background:"#0a2a1a", color:"#34d399", border:"1px solid #1d4a2a", borderRadius:"2px", cursor:"pointer" }}
                          >
                            ✓ OK
                          </button>

                          <button
                            onClick={() => onReject(t.id)}
                            style={{ ...S, fontSize:"10px", padding:"4px 8px", background:"#2a0a0a", color:"#f87171", border:"1px solid #4a1c1c", borderRadius:"2px", cursor:"pointer" }}
                          >
                            ✗
                          </button>
                        </div>
                      )}

                      {t.status === "PENDING" && !can && (
                        <span style={{ ...S, fontSize:"10px", color:"#1e2d45" }}>
                          Awaiting approver
                        </span>
                      )}

                      {currentUser?.role === "approver" && (
                        <button
                          onClick={() => { if (window.confirm(`Delete this trade?`)) onDelete(t.id); }}
                          style={{ ...S, fontSize:"9px", padding:"3px 7px", background:"none", color:"#3a5070", border:"1px solid #2e2b24", borderRadius:"2px", cursor:"pointer", marginTop:"4px" }}
                        >
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
        </div>
      </div>

      {showModal && (
        <Modal title="New CEE Purchase" onClose={() => setShowModal(false)} wide>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"13px" }}>
            <FS label="CEE Type" value={form.ceeType} onChange={e => setForm(f => ({ ...f, ceeType:e.target.value }))}>
              <option value="CLASSIQUE">Classique</option>
              <option value="PRECARITE">Précarité</option>
            </FS>

            <FI
              label="Seller"
              placeholder="ACT France, OTC, Eco-Environnement..."
              value={form.vendor}
              onChange={e => setForm(f => ({ ...f, vendor:e.target.value }))}
            />

            <FS label="Deal Type" value={form.dealType} onChange={e => setForm(f => ({ ...f, dealType:e.target.value }))}>
              <option value="Fixed Price">Fixed Price</option>
              <option value="Floating">Floating</option>
            </FS>

            <FS label="Period" value={form.period} onChange={e => setForm(f => ({ ...f, period:e.target.value }))}>
              <option value="P6">P6</option>
              <option value="P5">P5</option>
            </FS>

            <FI
              label="Month"
              type="month"
              value={form.month}
              onChange={e => setForm(f => ({ ...f, month:e.target.value }))}
            />

            <FS
              label="Priced"
              value={String(form.priced)}
              onChange={e => setForm(f => ({ ...f, priced:e.target.value === "true" }))}
            >
              <option value="true">Priced</option>
              <option value="false">Unpriced</option>
            </FS>

            <FI
              label="Volume (GWhc)"
              type="number"
              step="0.001"
              placeholder="0.000"
              value={form.volume}
              onChange={e => setForm(f => ({ ...f, volume:e.target.value }))}
            />

            <FI
              label="Price (€/GWhc)"
              type="number"
              step="1"
              placeholder="9000"
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price:e.target.value }))}
            />

            <FI
              label="Deposited (GWhc)"
              type="number"
              step="0.001"
              placeholder="0.000"
              value={form.volumeDeposited}
              onChange={e => setForm(f => ({ ...f, volumeDeposited:e.target.value }))}
            />

            <FS label="Sourcing" value={form.sourcing} onChange={e => setForm(f => ({ ...f, sourcing:e.target.value }))}>
              <option value="">—</option>
              <option value="Primary">Primary</option>
              <option value="Secondary">Secondary</option>
              <option value="Program">Program</option>
              <option value="Authorized representative">Authorized representative</option>
            </FS>

            <FS
              label="Contract expected"
              value={String(form.contractYesNo)}
              onChange={e => setForm(f => ({ ...f, contractYesNo:e.target.value === "true" }))}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </FS>

            <FS
              label="Contract signed"
              value={String(form.contractSigned)}
              onChange={e => setForm(f => ({ ...f, contractSigned:e.target.value === "true" }))}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </FS>

            <FI
              label="Contract date"
              type="date"
              value={form.contractDate}
              onChange={e => setForm(f => ({ ...f, contractDate:e.target.value }))}
            />

            <FS label="Payment terms" value={form.paymentTerms} onChange={e => setForm(f => ({ ...f, paymentTerms:e.target.value }))}>
              <option value="After Delivery">After Delivery</option>
              <option value="Prepayment">Prepayment</option>
            </FS>

            <FS
              label="Validated"
              value={String(form.validated)}
              onChange={e => setForm(f => ({ ...f, validated:e.target.value === "true" }))}
            >
              <option value="false">Pending</option>
              <option value="true">Validated</option>
            </FS>

            <FS
              label="Payment"
              value={String(form.payment)}
              onChange={e => setForm(f => ({ ...f, payment:e.target.value === "true" }))}
            >
              <option value="false">Unpaid</option>
              <option value="true">Paid</option>
            </FS>

            <FS label="CP Ranking" value={form.cpRanking} onChange={e => setForm(f => ({ ...f, cpRanking:e.target.value }))}>
              <option value="">—</option>
              {["AAA","AA","A+","A","BBB","BB","B+"].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </FS>

            <FI
              label="Comments"
              placeholder="Optional comment"
              value={form.comments}
              onChange={e => setForm(f => ({ ...f, comments:e.target.value }))}
            />
          </div>

          <div style={{
            marginTop:"14px",
            padding:"10px 12px",
            background:"#0d1526",
            border:"1px solid #1e2d45",
            borderRadius:"2px"
          }}>
            <p style={{ ...S, fontSize:"10px", color:"#3a5070" }}>
              Remaining to deposit will be calculated automatically:
              {" "}
              <span style={{ color:"#38bdf8" }}>
                {Number.isFinite(Number(form.volume)) && Number.isFinite(Number(form.volumeDeposited || 0))
                  ? `${N(Number(form.volume) - Number(form.volumeDeposited || 0), 3)} GWhc`
                  : "—"}
              </span>
            </p>
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:"10px", marginTop:"16px" }}>
            <GhostBtn onClick={() => setShowModal(false)}>Cancel</GhostBtn>
            <GoldBtn onClick={handleSubmit}>Submit</GoldBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OBLIGATION TAB
// ─────────────────────────────────────────────────────────────────────────────
const CLIENTS = ["Spot", "Certas", "Certas Lyon", "Autre"];

function ObligationTab({ obligations, onAdd, onDelete, canEdit = true }) {
  const [showModal, setShowModal] = useState(false);
  const [filterClient, setFilterClient] = useState("ALL");
  const [filterMonth, setFilterMonth] = useState("ALL");
  const blank = { month: "", product: "CARBURANT", volume_m3: "", priceCl: "9000", pricePr: "15000", priced: false, client: "Spot" };
  const [form, setForm] = useState(blank);

  const months = useMemo(() => ["ALL", ...new Set(obligations.map(o => o.month))].sort(), [obligations]);
  const clients = useMemo(() => ["ALL", ...new Set(obligations.map(o => o.client))], [obligations]);

  const filtered = useMemo(() => {
    let l = obligations;
    if (filterClient !== "ALL") l = l.filter(o => o.client === filterClient);
    if (filterMonth !== "ALL") l = l.filter(o => o.month === filterMonth);
    return [...l].sort((a, b) => a.month.localeCompare(b.month) || a.client.localeCompare(b.client));
  }, [obligations, filterClient, filterMonth]);

  const handleAdd = () => {
    if (!form.month || !form.volume_m3) return;
    const cee = calcCEE(parseFloat(form.volume_m3), form.product);
    onAdd({
      ...form,
      id: "o" + uid(),
      volume_m3: parseFloat(form.volume_m3),
      priceCl: parseFloat(form.priceCl),
      pricePr: parseFloat(form.pricePr),
      clGwhc: cee.classique,
      prGwhc: cee.precarite
    });
    setShowModal(false);
    setForm(blank);
  };

  const cc = c => ({ Spot: "sky", Certas: "gold", "Certas Lyon": "teal", Autre: "gray" }[c] || "gray");

  const clientLabel = (c) => {
    if (c === "ALL") return "ALL";
    if (c === "Autre") return "Other";
    return c;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "12px 18px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px" }}>
        {[
          ["Road Fuel kWhc/m³", "8 718"],
          ["FOD kWhc/m³", "11 078"],
          ["Précarité Coeff.", "0.364"],
          ["Correction Coeff.", "0.847"]
        ].map(([k, v]) => (
          <div key={k}>
            <p style={{ ...S, fontSize: "9px", color: "#3a5070", textTransform: "uppercase", letterSpacing: "0.1em" }}>{k}</p>
            <p style={{ ...S, fontSize: "14px", color: "#38bdf8", marginTop: "3px" }}>{v}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
          {clients.map(c => (
            <button
              key={c}
              onClick={() => setFilterClient(c)}
              style={{
                ...S,
                fontSize: "10px",
                padding: "5px 10px",
                borderRadius: "2px",
                border: "1px solid",
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                background: filterClient === c ? "#38bdf8" : "transparent",
                color: filterClient === c ? "#0a0e1a" : "#3a5070",
                borderColor: filterClient === c ? "#38bdf8" : "#1e2d45"
              }}
            >
              {clientLabel(c)}
            </button>
          ))}

          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...S, background: "#0d1526", border: "1px solid #2e2b24", color: "#4a6080", borderRadius: "2px", padding: "5px 8px", fontSize: "10px", outline: "none" }}>
            {months.map(m => <option key={m} value={m}>{m === "ALL" ? "All months" : ML(m)}</option>)}
          </select>
        </div>

        {canEdit && (
          <GoldBtn onClick={() => setShowModal(true)}>+ Add Obligation</GoldBtn>
        )}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #1e1c18", borderRadius: "2px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {[
                "Month",
                "Client",
                "Product",
                "Volume m³",
                "CEE Classique (GWhc)",
                "CEE Précarité (GWhc)",
                "Price Classique",
                "Price Précarité",
                "Priced",
                ...(canEdit ? [""] : [])
              ].map(h => <TH key={h}>{h}</TH>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((o, i) => {
              const bg = i % 2 === 0 ? "#111827" : "#141210";
              return (
                <tr key={o.id} style={{ borderBottom: "1px solid #1a1815", background: bg }} onMouseEnter={e => e.currentTarget.style.background = "#0d1526"} onMouseLeave={e => e.currentTarget.style.background = bg}>
                  <td style={{ ...CG, fontSize: "14px", color: "#e2e8f0", padding: "9px 14px" }}>{ML(o.month)}</td>
                  <td style={{ padding: "9px 14px" }}><Badge color={cc(o.client)}>{clientLabel(o.client)}</Badge></td>
                  <td style={{ padding: "9px 14px" }}><Badge color={o.product === "CARBURANT" ? "sky" : "purple"}>{PARAMS[o.product].label}</Badge></td>
                  <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "9px 14px" }}>{N(o.volume_m3, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#2563eb", padding: "9px 14px" }}>{N(o.clGwhc, 3)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#d4a843", padding: "9px 14px" }}>{N(o.prGwhc, 3)}</td>
                  <td style={{ ...S, fontSize: "11px", color: "#4a6080", padding: "9px 14px" }}>{N(o.priceCl / 1000, 2)}</td>
                  <td style={{ ...S, fontSize: "11px", color: "#4a6080", padding: "9px 14px" }}>{N(o.pricePr / 1000, 2)}</td>
                  <td style={{ padding: "9px 14px" }}><Badge color={o.priced ? "green" : "red"}>{o.priced ? "Priced" : "Unpriced"}</Badge></td>
                  {canEdit && (
                    <td style={{ padding: "9px 14px" }}>
                      <button
                        onClick={() => onDelete(o.id)}
                        style={{
                          ...S,
                          fontSize: "9px",
                          color: "#3d3830",
                          background: "none",
                          border: "none",
                          cursor: "pointer"
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && showModal && (
        <Modal title="Add Obligation" onClose={() => setShowModal(false)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "13px" }}>
            <FI label="Month" type="month" value={form.month} onChange={e => setForm(f => ({ ...f, month: e.target.value }))} />

            <FS label="Client" value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))}>
              {CLIENTS.map(c => <option key={c} value={c}>{clientLabel(c)}</option>)}
            </FS>

            <FS label="Product" value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))}>
              <option value="CARBURANT">Road Fuel — 8 718 kWhc/m³</option>
              <option value="FOD">FOD (Domestic Fuel Oil) — 11 078 kWhc/m³</option>
            </FS>

            <FI label="Volume (m³)" type="number" placeholder="45000" value={form.volume_m3} onChange={e => setForm(f => ({ ...f, volume_m3: e.target.value }))} />
            <FI label="CEE Classique Price (€/MWhc)" type="number" placeholder="9.00" value={form.priceCl} onChange={e => setForm(f => ({ ...f, priceCl: e.target.value }))} />
            <FI label="CEE Précarité Price (€/MWhc)" type="number" placeholder="15.00" value={form.pricePr} onChange={e => setForm(f => ({ ...f, pricePr: e.target.value }))} />

            <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingTop: "18px" }}>
              <input type="checkbox" id="pr" checked={form.priced} onChange={e => setForm(f => ({ ...f, priced: e.target.checked }))} style={{ accentColor: "#38bdf8" }} />
              <label htmlFor="pr" style={{ ...S, fontSize: "11px", color: "#4a6080", cursor: "pointer" }}>Priced</label>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
            <GhostBtn onClick={() => setShowModal(false)}>Cancel</GhostBtn>
            <GoldBtn onClick={handleAdd}>Add</GoldBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ trades, obligations, prices, curve }) {
  const latest = useMemo(() => {
    if (!prices.length) return { classique: curve.SPOT?.classique ?? 8.96, precarite: curve.SPOT?.precarite ?? 16.44, date: "(curve)" };
    const p = [...prices].sort((a, b) => b.date.localeCompare(a.date))[0];
    return { classique: p.classique, precarite: p.precarite, date: p.date };
  }, [prices, curve]);

  const displayDate = formatDateEn(latest.date);

  const spotCl = latest.classique;
  const spotPr = latest.precarite;

  // P6 dashboard scope: exclude 2025 and P5 trades
  const tradesP6 = useMemo(
    () => trades.filter(t => {
      const period = String(t.period ?? "").trim().toUpperCase();

      return period === "P6";
    }),
    [trades]
  );

  // Same methodology as the Tools converter, using Road Fuel by default
  const spotProductParams = PARAMS.CARBURANT;

  const spotClEurM3 =
    spotCl * spotProductParams.kwhc_per_m3 / 1000;

  const spotPrEurM3 =
    spotPr *
    spotProductParams.kwhc_per_m3 /
    1000 *
    spotProductParams.coeff_precarite *
    spotProductParams.coeff_correctif;

  // ── Obligations ──
  // Priced = obligation with confirmed price
  // Unpriced = obligation without fixed price
  const totalOblClP = MONTHS_LIST.reduce((s, m) => s + oblMonth(obligations, m, "CLASSIQUE", true), 0);
  const totalOblPrP = MONTHS_LIST.reduce((s, m) => s + oblMonth(obligations, m, "PRECARITE", true), 0);
  const totalOblP = totalOblClP + totalOblPrP;
  const totalOblClU = MONTHS_LIST.reduce((s, m) => s + oblMonth(obligations, m, "CLASSIQUE") - oblMonth(obligations, m, "CLASSIQUE", true), 0);
  const totalOblPrU = MONTHS_LIST.reduce((s, m) => s + oblMonth(obligations, m, "PRECARITE") - oblMonth(obligations, m, "PRECARITE", true), 0);

  // ── Priced purchases vs unpriced purchases ──
  // Excel P6 scope: all 2026 P6 trades, including pending approval.
  const bClP = sumVol(tradesP6, "CLASSIQUE", null, true, false);
  const bPrP = sumVol(tradesP6, "PRECARITE", null, true, false);

  const bCl = sumVol(tradesP6, "CLASSIQUE", null, false, false);
  const bPr = sumVol(tradesP6, "PRECARITE", null, false, false);

  const bClU = bCl - bClP;
  const bPrU = bPr - bPrP;

  const aClP = pnlBuyAvg(tradesP6, "CLASSIQUE", null);
  const aPrP = pnlBuyAvg(tradesP6, "PRECARITE", null);

  const aCl = wAvg(tradesP6, "CLASSIQUE");
  const aPr = wAvg(tradesP6, "PRECARITE");

  // ── Net priced position ──
  const netClP = bClP - totalOblClP, netPrP = bPrP - totalOblPrP;

  // ── Net unpriced position / forward exposure ──
  const netClU = bClU - totalOblClU, netPrU = bPrU - totalOblPrU;

  // ── Coverage on priced months ──
  const covClP = totalOblClP > 0 ? bClP / totalOblClP * 100 : 0;
  const covPrP = totalOblPrP > 0 ? bPrP / totalOblPrP * 100 : 0;
  const covP = totalOblP > 0 ? (bClP + bPrP) / totalOblP * 100 : 0;

  // ── MtM = (spot - priced avg buy) × priced open position only ──
  const { mtmCl, mtmPr } = useMemo(() => MONTHS_LIST.reduce((acc, month) => {
    const oblClP = oblMonth(obligations, month, "CLASSIQUE", true);
    const oblPrP = oblMonth(obligations, month, "PRECARITE", true);

    const mBClP = sumVol(tradesP6, "CLASSIQUE", month, true, false);
    const mBPrP = sumVol(tradesP6, "PRECARITE", month, true, false);

    const mAClP = pnlBuyAvg(tradesP6, "CLASSIQUE", month);
    const mAPrP = pnlBuyAvg(tradesP6, "PRECARITE", month);

    const mSCl = avgSellMonth(obligations, month, "CLASSIQUE", true);
    const mSPr = avgSellMonth(obligations, month, "PRECARITE", true);

    const netClRaw = mBClP - oblClP;
    const netPrRaw = mBPrP - oblPrP;

    const monthMtmCl =
      Math.abs(netClRaw) > 0.001 && spotCl > 0
        ? netClRaw < 0
          ? netClRaw * (spotCl * 1000 - mSCl)
          : mAClP > 0
            ? netClRaw * (spotCl * 1000 - mAClP)
            : 0
        : 0;

    const monthMtmPr =
      Math.abs(netPrRaw) > 0.001 && spotPr > 0
        ? netPrRaw < 0
          ? netPrRaw * (spotPr * 1000 - mSPr)
          : mAPrP > 0
            ? netPrRaw * (spotPr * 1000 - mAPrP)
            : 0
        : 0;

    return {
      mtmCl: acc.mtmCl + monthMtmCl,
      mtmPr: acc.mtmPr + monthMtmPr,
    };
  }, { mtmCl: 0, mtmPr: 0 }), [tradesP6, obligations, spotCl, spotPr]);

  // ── Data Quality ──
  const dataQualityChecks = useMemo(() => {
    const issues = [];

    const TRADE_VOLUME_EPS = 0.000001;

    tradesP6.forEach(t => {
      const volume = Number(t.volume ?? 0);
      const price = Number(t.price ?? 0);
      const isZeroVolumePlaceholder = Math.abs(volume) < TRADE_VOLUME_EPS;

      if (!t.month) {
        issues.push({
          severity: "high",
          type: "Trade missing month",
          detail: `Trade ${t.id} — ${t.vendor}`
        });
      }

      if (!isZeroVolumePlaceholder && volume < 0) {
        issues.push({
          severity: "high",
          type: "Invalid trade volume",
          detail: `Trade ${t.id} — ${volume} GWhc`
        });
      }

      if (!isZeroVolumePlaceholder && t.priced && price <= 0) {
        issues.push({
          severity: "high",
          type: "Missing trade price",
          detail: `Trade ${t.id} — ${t.vendor}`
        });
      }

      if (t.status === "APPROVED" && !t.approvedBy) {
        issues.push({
          severity: "medium",
          type: "Approved trade without approver",
          detail: `Trade ${t.id}`
        });
      }

      const ALLOWED_EXTRA_TRADE_MONTHS = ["2025-12"];

      if (
        t.month &&
        !MONTHS_LIST.includes(t.month) &&
        !ALLOWED_EXTRA_TRADE_MONTHS.includes(t.month)
      ) {
        issues.push({
          severity: "medium",
          type: "Trade month out of scope",
          detail: `Trade ${t.id} — ${t.month}`
        });
      }
    });

    obligations.forEach(o => {
      const month = o.month;
      const m = parseInt(month.split("-")[1], 10);
      const NEGATIVE_ALLOWED_MONTHS = [1, 2];

      if (!o.month) issues.push({ severity: "high", type: "Obligation missing month", detail: `Obligation ${o.id}` });

      const isEarlyYear = m === 1 || m === 2;

      // Negative Spot obligation lines can be legitimate Excel adjustments.
      if (o.volume_m3 < 0 && !isEarlyYear && o.client !== "Spot") {
        issues.push({
          severity: "high",
          type: "Abnormal negative obligation volume",
          detail: `Obligation ${o.id} — ${N(o.volume_m3, 0)} m³`
        });
      }

      if (o.priced && (!o.priceCl || !o.pricePr || o.priceCl <= 0 || o.pricePr <= 0)) {
        issues.push({ severity: "high", type: "Priced obligation without price", detail: `Obligation ${o.id} — ${ML(o.month)}` });
      }

      if (o.month && !MONTHS_LIST.includes(o.month)) {
        issues.push({ severity: "medium", type: "Obligation month out of scope", detail: `Obligation ${o.id} — ${o.month}` });
      }
    });

    const seen = new Map();

    tradesP6.forEach(t => {
      const key = [
        t.ceeType,
        t.vendor,
        t.month,
        t.dealType,
        t.pricingMonth ?? "NO_PRICING_MONTH",
        String(t.priced),
        Number(t.volume ?? 0).toFixed(6),
        Number(t.price ?? 0).toFixed(4)
      ].join("|");

      if (seen.has(key)) {
        issues.push({
          severity: "medium",
          type: "Potential duplicate trade",
          detail: `${seen.get(key)} / ${t.id} — ${t.vendor}`
        });
      } else {
        seen.set(key, t.id);
      }
    });

    return issues;
  }, [tradesP6, obligations]);

  // ── Realized YTD PnL on priced months ──
  // Business PnL includes all imported priced trades, including pending four-eyes approval.
  // Buy average is aligned with the Excel PnL methodology.
  const { pnlClYTD, pnlPrYTD } = useMemo(() => MONTHS_LIST.reduce((acc, month) => {
    const oblClP = oblMonth(obligations, month, "CLASSIQUE", true);
    const oblPrP = oblMonth(obligations, month, "PRECARITE", true);

    if (oblClP < 0.001 && oblPrP < 0.001) return acc;

    const mBClP = sumVol(tradesP6, "CLASSIQUE", month, true, false);
    const mBPrP = sumVol(tradesP6, "PRECARITE", month, true, false);

    const mAClP = pnlBuyAvg(tradesP6, "CLASSIQUE", month);
    const mAPrP = pnlBuyAvg(tradesP6, "PRECARITE", month);

    const mSCl = avgSellMonth(obligations, month, "CLASSIQUE", true);
    const mSPr = avgSellMonth(obligations, month, "PRECARITE", true);

    const matchCl = Math.min(mBClP, oblClP);
    const matchPr = Math.min(mBPrP, oblPrP);

    return {
      pnlClYTD: acc.pnlClYTD + (
        matchCl > 0.001 && mAClP > 0 && mSCl > 0
          ? (mSCl - mAClP) * matchCl
          : 0
      ),
      pnlPrYTD: acc.pnlPrYTD + (
        matchPr > 0.001 && mAPrP > 0 && mSPr > 0
          ? (mSPr - mAPrP) * matchPr
          : 0
      ),
    };
  }, { pnlClYTD: 0, pnlPrYTD: 0 }), [tradesP6, obligations]);


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
    const boughtClP = sumVol(tradesP6, "CLASSIQUE", month, true, false);
    const boughtPrP = sumVol(tradesP6, "PRECARITE", month, true, false);

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
        label: "No obligation",
        bg: "#111827",
        color: "#64748b",
        border: "#334155"
      };
    }

    if (pct >= 120) {
      return {
        label: "Overcovered",
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
        label: "Watchlist",
        bg: "#2e2410",
        color: "#d4a843",
        border: "#4a3a18"
      };
    }

    return {
      label: "Undercovered",
      bg: "#2e1010",
      color: "#f87171",
      border: "#4a1c1c"
    };
  };

  // ── Operational Follow-up ──
  const pending = tradesP6.filter(t => t.status === "PENDING").length;

  const MATERIAL_TRADE_THRESHOLD = 50; // GWhc
  const DEPOSIT_EPS = 0.001;

  const operationalMetrics = useMemo(() => {
    const relevantTrades = tradesP6.filter(t => t.priced === true);

    const materialTrades = relevantTrades.filter(t =>
      Number(t.volume) >= MATERIAL_TRADE_THRESHOLD
    );

    const unsignedContracts = materialTrades.filter(t =>
      t.contractYesNo === false || t.contractSigned === false
    );

    const pendingValidations = relevantTrades.filter(t =>
      t.validated === false
    );

    const unpaidTrades = relevantTrades.filter(t =>
      t.payment === false
    );

    const remainingDepositVolume = relevantTrades.reduce((s, t) => {
      const remaining = Number(t.volumeRemainingToBeDeposited);
      return Number.isFinite(remaining) && remaining > DEPOSIT_EPS
        ? s + remaining
        : s;
    }, 0);

    const overDepositedVolume = relevantTrades.reduce((s, t) => {
      const remaining = Number(t.volumeRemainingToBeDeposited);
      return Number.isFinite(remaining) && remaining < -DEPOSIT_EPS
        ? s + Math.abs(remaining)
        : s;
    }, 0);

    const missingCpRanking = materialTrades.filter(t =>
      !t.cpRanking
    );

    return {
      relevantCount: relevantTrades.length,
      materialCount: materialTrades.length,

      unsignedContractsCount: unsignedContracts.length,
      unsignedContractsVolume: unsignedContracts.reduce((s, t) => s + Number(t.volume || 0), 0),

      pendingValidationsCount: pendingValidations.length,
      pendingValidationsVolume: pendingValidations.reduce((s, t) => s + Number(t.volume || 0), 0),

      unpaidTradesCount: unpaidTrades.length,
      unpaidTradesVolume: unpaidTrades.reduce((s, t) => s + Number(t.volume || 0), 0),

      remainingDepositVolume,
      overDepositedVolume,

      missingCpRankingCount: missingCpRanking.length,
      missingCpRankingVolume: missingCpRanking.reduce((s, t) => s + Number(t.volume || 0), 0),
    };
  }, [tradesP6]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
      {pending > 0 && (
        <div style={{ background: "#2a1f0a", border: "1px solid #5a4000", borderRadius: "2px", padding: "10px 16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#fbbf24", fontSize: "12px" }}>⚠</span>
          <span style={{ ...S, fontSize: "11px", color: "#fbbf24" }}>
            {pending} trade{pending > 1 ? "s" : ""} awaiting four-eyes approval
          </span>
        </div>
      )}

      {operationalMetrics.unsignedContractsCount > 0 && (
        <div style={{
          background:"#2a1f0a",
          border:"1px solid #5a4000",
          borderRadius:"2px",
          padding:"10px 16px",
          display:"flex",
          alignItems:"center",
          gap:"8px"
        }}>
          <span style={{ color:"#fbbf24",fontSize:"12px" }}>⚠</span>
          <span style={{ ...S,fontSize:"11px",color:"#fbbf24" }}>
            {operationalMetrics.unsignedContractsCount} material trade{operationalMetrics.unsignedContractsCount > 1 ? "s" : ""} without signed contract
            {" "}({N(operationalMetrics.unsignedContractsVolume,0)} GWhc)
          </span>
        </div>
      )}

      {operationalMetrics.remainingDepositVolume > 0 && (
        <div style={{
          background:"#2a0a0a",
          border:"1px solid #7f1d1d",
          borderRadius:"2px",
          padding:"10px 16px",
          display:"flex",
          alignItems:"center",
          gap:"8px"
        }}>
          <span style={{ color:"#f87171",fontSize:"12px" }}>⚠</span>
          <span style={{ ...S,fontSize:"11px",color:"#fca5a5" }}>
            {N(operationalMetrics.remainingDepositVolume,0)} GWhc still to be deposited across priced trades
          </span>
        </div>
      )}

      {coverageAlerts.length > 0 && (
        <div style={{ background: "#2a0a0a", border: "1px solid #7f1d1d", borderRadius: "2px", padding: "10px 16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#f87171", fontSize: "12px" }}>⚠</span>
          <span style={{ ...S, fontSize: "11px", color: "#fca5a5" }}>
            {coverageAlerts.length} month{coverageAlerts.length > 1 ? "s" : ""} below the {COVERAGE_ALERT_THRESHOLD}% coverage threshold:{" "}
            {coverageAlerts.map(r => `${ML(r.month)} (${N(r.covPct, 1)}%)`).join(", ")}
          </span>
        </div>
      )}

      {dataQualityChecks.length > 0 && (
        <div style={{
          background: "#2a0a0a",
          border: "1px solid #7f1d1d",
          borderRadius: "2px",
          padding: "10px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "6px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#f87171", fontSize: "12px" }}>⚠</span>
            <span style={{ ...S, fontSize: "11px", color: "#fca5a5" }}>
              {dataQualityChecks.length} data issue{dataQualityChecks.length > 1 ? "s" : ""} detected
            </span>
          </div>

          <div style={{ ...S, fontSize: "10px", color: "#fca5a5" }}>
            {dataQualityChecks.slice(0, 3).map((e, i) => (
              <div key={i}>
                • {e.type} — {e.detail}
              </div>
            ))}
            {dataQualityChecks.length > 3 && (
              <div style={{ color: "#64748b" }}>
                … +{dataQualityChecks.length - 3} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PnL / MtM / Spot ── */}
      <div>
        <p style={{ ...S, fontSize: "9px", color: "#3a5070", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "10px" }}>
          PNL & Market Summary — {displayDate}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "10px" }}>
          <KPI label="Spot Classique" value={`${N(spotCl)} €/MWhc`} color="sky"sub={`Road Fuel impact: ${N(spotClEurM3, 2)} €/m³`}/>
          <KPI label="Spot Précarité" value={`${N(spotPr)} €/MWhc`} color="amber" sub={`Road Fuel impact: ${N(spotPrEurM3, 2)} €/m³`}/>
          <KPI label="Realized PnL YTD" value={fM(pnlClYTD + pnlPrYTD)} color={(pnlClYTD + pnlPrYTD) >= 0 ? "emerald" : "rose"} sub={`Classique: ${fK(pnlClYTD)} · Précarité: ${fK(pnlPrYTD)}`} />
          <KPI label="Open Position MtM" value={fK(mtmCl + mtmPr)} color={(mtmCl + mtmPr) >= 0 ? "emerald" : "rose"} sub={`Classique: ${fK(mtmCl)} · Précarité: ${fK(mtmPr)}`} />
          <KPI label="Net PnL+MtM YTD" value={fM(pnlClYTD + pnlPrYTD + mtmCl + mtmPr)} color={(pnlClYTD + pnlPrYTD + mtmCl + mtmPr) >= 0 ? "emerald" : "rose"} sub="Realized + MtM" />
          <KPI label="Pending" value={pending > 0 ? `⚠ ${pending}` : "✓ 0"} color={pending > 0 ? "amber" : "emerald"} sub="Four-eyes trades" />
        </div>
      </div>

      {/* ── Risk / Exposure View ── */}
      <div>
        <p style={{ ...S, fontSize: "9px", color: "#3a5070", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "10px" }}>
          Risk / Exposure View
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
          <KPI
            label="Net Priced Position"
            value={`${netPriced >= 0 ? "+" : ""}${N(netPriced, 0)} GWhc`}
            color={netPriced >= 0 ? "emerald" : "rose"}
            sub="Priced purchases - priced obligations"
          />

          <KPI
            label="Net Unpriced Position"
            value={`${netUnpriced >= 0 ? "+" : ""}${N(netUnpriced, 0)} GWhc`}
            color={netUnpriced >= 0 ? "emerald" : "rose"}
            sub="Unpriced purchases - unpriced obligations"
          />

          <KPI
            label="Unpriced Coverage"
            value={`${N(coverageUnpriced, 1)}%`}
            color={coverageUnpriced >= 100 ? "emerald" : coverageUnpriced >= 70 ? "amber" : "rose"}
            sub={`${N(totalBoughtU, 0)} / ${N(totalOblU, 0)} GWhc`}
          />

          <KPI
            label={worstCoverageMonth ? "Riskiest Month" : "No Risk Detected"}
            value={worstCoverageMonth ? ML(worstCoverageMonth.month) : "—"}
            color={worstCoverageMonth ? "rose" : "emerald"}
            sub={
              worstCoverageMonth
                ? `Coverage: ${N(worstCoverageMonth.covPct, 1)}%`
                : "No month below threshold"
            }
          />
        </div>
      </div>

      {/* ── Operational Follow-up ── */}
      <div>
        <p style={{ ...S,fontSize:"9px",color:"#3a5070",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"10px" }}>
          Operational Follow-up
        </p>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:"10px" }}>
          <KPI
            label="Contracts not signed"
            value={N(operationalMetrics.unsignedContractsCount,0)}
            color={operationalMetrics.unsignedContractsCount > 0 ? "amber" : "emerald"}
            sub={`${N(operationalMetrics.unsignedContractsVolume,0)} GWhc material volume`}
          />

          <KPI
            label="Pending validation"
            value={N(operationalMetrics.pendingValidationsCount,0)}
            color={operationalMetrics.pendingValidationsCount > 0 ? "amber" : "emerald"}
            sub={`${N(operationalMetrics.pendingValidationsVolume,0)} GWhc`}
          />

          <KPI
            label="Unpaid trades"
            value={N(operationalMetrics.unpaidTradesCount,0)}
            color={operationalMetrics.unpaidTradesCount > 0 ? "rose" : "emerald"}
            sub={`${N(operationalMetrics.unpaidTradesVolume,0)} GWhc`}
          />

          <KPI
            label="Remaining to deposit"
            value={`${N(operationalMetrics.remainingDepositVolume,0)} GWhc`}
            color={operationalMetrics.remainingDepositVolume > 0 ? "rose" : "emerald"}
            sub="Volume still to be deposited"
          />

          <KPI
            label="Over-deposited"
            value={`${N(operationalMetrics.overDepositedVolume,0)} GWhc`}
            color={operationalMetrics.overDepositedVolume > 0 ? "amber" : "emerald"}
            sub="Absolute excess volume"
          />

          <KPI
            label="Missing CP ranking"
            value={N(operationalMetrics.missingCpRankingCount,0)}
            color={operationalMetrics.missingCpRankingCount > 0 ? "amber" : "emerald"}
            sub={`${N(operationalMetrics.missingCpRankingVolume,0)} GWhc material volume`}
          />
        </div>
      </div>

      {/* ── Monthly Coverage Heatmap ── */}
      <div>
        <p style={{ ...S, fontSize: "9px", color: "#3a5070", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "10px" }}>
          Monthly Coverage Heatmap — Priced Obligations
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: "8px" }}>
          {coverageRows.map(r => {
            const status = getCoverageStatus(r.covPct);
            const rawNet = r.bought - r.obligation;
            const net = Math.abs(rawNet) < 0.5 ? 0 : rawNet;
            const avgSpot = ((spotCl * 1000) + (spotPr * 1000)) / 2;
            const netValue = net * avgSpot;
            const isEmpty = r.obligation === 0;
            const displayPct = r.covPct > 150 ? ">150%" : `${N(r.covPct, 1)}%`;

            return (
              <div
                key={r.month}
                title={
                  isEmpty
                    ? `${ML(r.month)} — No priced obligation`
                    : `${ML(r.month)} — ${displayPct} covered · ${N(r.bought, 0)} / ${N(r.obligation, 0)} GWhc`
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
                <p style={{ ...S, fontSize: "9px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
                  {MLS(r.month)}
                </p>

                {isEmpty ? (
                  <>
                    <p style={{ ...S, fontSize: "15px", fontWeight: 600, color: status.color, marginBottom: "5px" }}>
                      —
                    </p>
                    <p style={{ ...S, fontSize: "9px", color: status.color, marginBottom: "4px" }}>
                      No obligation
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ ...S, fontSize: "17px", fontWeight: 600, color: status.color, marginBottom: "4px" }}>
                      {displayPct}
                    </p>

                    <p style={{ ...S, fontSize: "9px", color: status.color, marginBottom: "4px" }}>
                      {status.label}
                    </p>
                  </>
                )}

                <p style={{ ...S, fontSize: "8px", color: "#64748b", marginBottom: "3px" }}>
                  {isEmpty ? "—" : `${N(r.bought, 0)} / ${N(r.obligation, 0)} GWhc`}
                </p>

                {!isEmpty && (
                  <p style={{ ...S, fontSize: "8px", color: net >= 0 ? "#34d399" : "#f87171" }}>
                    {net === 0 ? "0 GWhc" : `${net > 0 ? "+" : ""}${N(net, 0)} GWhc`}
                  </p>
                )}

                {!isEmpty && net !== 0 && (
                  <p style={{ ...S, fontSize: "8px", color: "#64748b", marginTop: "3px" }}>
                    Exposure: {Math.abs(netValue) > 1_000_000 ? fM(netValue) : fK(netValue)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Priced Position ── */}
      <div>
        <p style={{ ...S, fontSize: "9px", color: "#3a5070", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "8px" }}>
          Priced Position — Confirmed Purchases vs Fixed-Price Obligations
        </p>

        <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", overflow: "hidden", marginBottom: "16px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Type", "Priced Obligation", "Priced Purchased", "Net Position", "Avg Buy", "Coverage"].map(h => <TH key={h}>{h}</TH>)}
              </tr>
            </thead>
            <tbody>
              {[
                ["CEE Classique", totalOblClP, bClP, netClP, aClP, "sky"],
                ["CEE Précarité", totalOblPrP, bPrP, netPrP, aPrP, "amber"],
                ["TOTAL", totalOblP, bClP + bPrP, netClP + netPrP, (bClP * aClP + bPrP * aPrP) / ((bClP + bPrP) || 1), "neutral"]
              ].map(([label, obl, bought, net, avg]) => (
                <tr key={label} style={{ borderBottom: "1px solid #1a1815" }}>
                  <td style={{ ...CG, fontSize: "14px", color: "#e2e8f0", padding: "10px 16px" }}>{label}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "10px 16px" }}>{N(obl, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", color: "#e2e8f0", padding: "10px 16px" }}>{N(bought, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", padding: "10px 16px", color: net >= 0 ? "#34d399" : "#f87171", fontWeight: 600 }}>{net >= 0 ? "+" : ""}{N(net, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "11px", color: "#4a6080", padding: "10px 16px" }}>{fmtMWhc(avg)}</td>
                  <td style={{ padding: "10px 16px", minWidth: "140px" }}><CovBar pct={obl > 0 ? bought / obl * 100 : 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Unpriced Position ── */}
        <p style={{ ...S, fontSize: "9px", color: "#3a5070", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "8px" }}>
          Unpriced Position — Forward Exposure (Partial Mar + Apr–Dec, obligations without fixed price)
        </p>

        <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Type", "Unpriced Obligation", "Unpriced Purchased", "Net Position", "Status"].map(h => <TH key={h}>{h}</TH>)}
              </tr>
            </thead>
            <tbody>
              {[
                ["CEE Classique", totalOblClU, bClU, netClU],
                ["CEE Précarité", totalOblPrU, bPrU, netPrU],
                ["TOTAL", totalOblClU + totalOblPrU, bClU + bPrU, netClU + netPrU]
              ].map(([label, obl, bought, net]) => (
                <tr key={label} style={{ borderBottom: "1px solid #1a1815" }}>
                  <td style={{ ...CG, fontSize: "14px", color: "#e2e8f0", padding: "10px 16px" }}>{label}</td>
                  <td style={{ ...S, fontSize: "12px", color: "#4a6080", padding: "10px 16px" }}>{N(obl, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", color: "#e2e8f0", padding: "10px 16px" }}>{N(bought, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", padding: "10px 16px", color: net >= 0 ? "#34d399" : "#f87171", fontWeight: 600 }}>{net >= 0 ? "+" : ""}{N(net, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "11px", padding: "10px 16px", color: net < 0 ? "#f87171" : "#34d399" }}>{net < 0 ? "⚠ SHORT — uncovered obligations" : "✓ Long / balanced"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MarketCurvesTab({ prices, curve, currentUser, onAddPrice, onUpdateCurve, canEdit = true }) {
  const [view, setView] = useState("spot");
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [editingTenor, setEditingTenor] = useState(null);
  const [draftCurve, setDraftCurve] = useState({ classique: "", precarite: "" });

  const today = new Date().toISOString().slice(0, 10);

  const [priceForm, setPriceForm] = useState({
    date: today,
    classique: "",
    precarite: ""
  });

  const [npvParams, setNpvParams] = useState({
    product: "CARBURANT",
    discountRate: 4
  });

  const sortedPrices = useMemo(
    () => [...prices].sort((a, b) => b.date.localeCompare(a.date)),
    [prices]
  );

  const latestPrice = sortedPrices[0] || null;

  const priceHistory = useMemo(
    () => [...prices]
      .filter(p => p.classique != null && p.precarite != null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(p => ({
        date: p.date?.slice(5) || p.date,
        classique: Number(p.classique),
        precarite: Number(p.precarite)
      })),
    [prices]
  );

  const curveData = useMemo(
    () => TENORS.map(tenor => ({
      tenor,
      classique: curve[tenor]?.classique ?? null,
      precarite: curve[tenor]?.precarite ?? null
    })),
    [curve]
  );

  const spotCurve = curve?.SPOT || latestPrice || { classique: 0, precarite: 0 };

  const npvData = useMemo(() => {
    const productParams = PARAMS[npvParams.product];
    const energyFactor = productParams.kwhc_per_m3;
    const precaCoeff = productParams.coeff_precarite;
    const discountRate = (Number(npvParams.discountRate) || 0) / 100;

    const refSpotClMWhc = Number(spotCurve.classique) || 0;
    const refSpotPrMWhc = Number(spotCurve.precarite) || 0;

    const spotClM3 = energyFactor * refSpotClMWhc / 1000;
    const spotPrM3 = energyFactor * refSpotPrMWhc / 1000 * precaCoeff;
    const totalSpotM3 = spotClM3 + spotPrM3;

    const spotMaturityDate = MATURITY_DATES?.SPOT
      ? new Date(MATURITY_DATES.SPOT)
      : new Date();

    const calculateLine = (tenor) => {
      const c = curve[tenor];
      if (!c) return null;

      const maturityDateRaw = MATURITY_DATES?.[tenor] || null;
      const maturityDate = maturityDateRaw ? new Date(maturityDateRaw) : new Date();

      const rawDays = Math.round((maturityDate - spotMaturityDate) / MS_PER_DAY);
      const numberOfDays = Math.max(0, rawDays);
      const discountingFactor = numberOfDays / 365;

      const clMWhc = Number(c.classique) || 0;
      const prMWhc = Number(c.precarite) || 0;

      // Forward price converted into product equivalent €/m³
      const clM3 = energyFactor * clMWhc / 1000;
      const prM3 = energyFactor * prMWhc / 1000 * precaCoeff;
      const totalMarketM3 = clM3 + prM3;

      // Financing / NPV logic aligned with the first CEE PnL tool
      const clNpvM3 = clM3 / Math.pow(1 + discountRate, discountingFactor);
      const prNpvM3 = prM3 / Math.pow(1 + discountRate, discountingFactor);
      const totalNpvM3 = clNpvM3 + prNpvM3;

      const clFinancingM3 = clNpvM3 - clM3;
      const prFinancingM3 = prNpvM3 - prM3;
      const totalFinancingM3 = totalNpvM3 - totalMarketM3;

      // Re-conversion into €/MWhc after financing
      const clNpvMWhc = clNpvM3 / energyFactor * 1000;
      const prNpvMWhc = prNpvM3 / energyFactor * 1000 / precaCoeff;

      // Comparison term price vs spot price after NPV
      const clNpvVsSpotMWhc = clNpvMWhc - refSpotClMWhc;
      const prNpvVsSpotMWhc = prNpvMWhc - refSpotPrMWhc;
      const totalNpvVsSpotM3 = totalNpvM3 - totalSpotM3;

      return {
        tenor,
        maturityDate: maturityDateRaw || "—",
        rawDays,
        numberOfDays,
        discountingFactor,

        clMWhc,
        prMWhc,

        clM3,
        prM3,
        totalMarketM3,

        clFinancingM3,
        prFinancingM3,
        totalFinancingM3,

        clNpvM3,
        prNpvM3,
        totalNpvM3,

        clNpvMWhc,
        prNpvMWhc,

        clNpvVsSpotMWhc,
        prNpvVsSpotMWhc,
        totalNpvVsSpotM3
      };
    };

    return TENORS
      .map(calculateLine)
      .filter(Boolean);
  }, [curve, spotCurve, npvParams]);

  const handleAddPrice = () => {
    if (!priceForm.date || !priceForm.classique || !priceForm.precarite) {
      alert("Please fill in all fields.");
      return;
    }

    const classique = Number(priceForm.classique);
    const precarite = Number(priceForm.precarite);

    if (!Number.isFinite(classique) || !Number.isFinite(precarite)) {
      alert("Please enter valid prices.");
      return;
    }

    onAddPrice({
      id: "p" + uid(),
      date: priceForm.date,
      classique,
      precarite,
      enteredBy: currentUser.id,
      enteredAt: new Date().toISOString()
    });

    setShowPriceModal(false);
    setPriceForm({ date: today, classique: "", precarite: "" });
  };

  const handleSaveCurve = (tenor) => {
    const classique = Number(draftCurve.classique);
    const precarite = Number(draftCurve.precarite);

    if (!Number.isFinite(classique) || !Number.isFinite(precarite)) {
      alert("Please enter valid curve prices.");
      return;
    }

    onUpdateCurve(tenor, { classique, precarite });
    setEditingTenor(null);
  };

  const ViewButton = ({ id, children }) => (
    <button
      onClick={() => setView(id)}
      style={{
        ...S,
        fontSize: "10px",
        padding: "7px 14px",
        borderRadius: "2px",
        border: "1px solid",
        cursor: "pointer",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: view === id ? "#38bdf8" : "transparent",
        color: view === id ? "#0a0e1a" : "#3a5070",
        borderColor: view === id ? "#38bdf8" : "#1e2d45"
      }}
    >
      {children}
    </button>
  );

  const SectionTitle = ({ children }) => (
    <p style={{
      ...S,
      fontSize: "9px",
      color: "#38bdf8",
      textTransform: "uppercase",
      letterSpacing: "0.18em",
      marginBottom: "14px",
      marginTop: "4px"
    }}>
      {children}
    </p>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{
        background: "#111827",
        border: "1px solid #1e2d45",
        borderRadius: "2px",
        padding: "16px 18px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "14px",
        flexWrap: "wrap"
      }}>
        <div>
          <p style={{
            ...S,
            fontSize: "9px",
            color: "#38bdf8",
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            marginBottom: "6px"
          }}>
            Market & Curves
          </p>

          <p style={{ ...S, fontSize: "11px", color: "#4a6080", lineHeight: 1.6 }}>
            Spot market prices, CEE forward curve and spot-vs-forward analysis.
            Prices are expressed in €/MWhc.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <ViewButton id="spot">Spot Market Prices</ViewButton>
          <ViewButton id="curve">CEE Forward Curve</ViewButton>
          <ViewButton id="npv">Spot vs Forward / NPV</ViewButton>
        </div>
      </div>

      {view === "spot" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
            <KPI
              label="Latest Classique"
              value={latestPrice ? `${N(latestPrice.classique, 2)} €/MWhc` : "—"}
              color="sky"
              sub={latestPrice ? `As of ${latestPrice.date}` : "No market price"}
            />

            <KPI
              label="Latest Précarité"
              value={latestPrice ? `${N(latestPrice.precarite, 2)} €/MWhc` : "—"}
              color="amber"
              sub={latestPrice ? `As of ${latestPrice.date}` : "No market price"}
            />

            <KPI
              label="Price records"
              value={N(prices.length, 0)}
              color="emerald"
              sub="Historical market price entries"
            />
          </div>

          <div style={{
            background: "#111827",
            border: "1px solid #252219",
            borderRadius: "2px",
            padding: "18px"
          }}>
            <SectionTitle>Spot Market Price History — Classique vs Précarité</SectionTitle>

            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "#4a6080" }} />
                <Line
                  type="monotone"
                  dataKey="classique"
                  name="Classique (€/MWhc)"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ fill: "#2563eb", r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="precarite"
                  name="Précarité (€/MWhc)"
                  stroke="#d4a843"
                  strokeWidth={2}
                  dot={{ fill: "#d4a843", r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {canEdit && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <GoldBtn onClick={() => setShowPriceModal(true)}>+ Add Market Price</GoldBtn>
            </div>
          )}

          <div style={{ border: "1px solid #1e1c18", borderRadius: "2px", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date", "Classique (€/MWhc)", "Précarité (€/MWhc)", "Entered by", "Timestamp"].map(h => (
                    <TH key={h}>{h}</TH>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sortedPrices.map((p, i) => {
                  const user = USERS.find(u => u.id === p.enteredBy);
                  const bg = i === 0 ? "#0d1526" : "#111827";

                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #1a1815", background: bg }}>
                      <td style={{ ...S, fontSize: "12px", color: "#e2e8f0", padding: "10px 14px", fontWeight: 500 }}>
                        {p.date}
                        {i === 0 && (
                          <span style={{ marginLeft: "8px", fontSize: "9px", color: "#38bdf8" }}>
                            LATEST
                          </span>
                        )}
                      </td>

                      <td style={{ ...S, fontSize: "13px", color: "#2563eb", padding: "10px 14px" }}>
                        {N(p.classique, 2)}
                      </td>

                      <td style={{ ...S, fontSize: "13px", color: "#d4a843", padding: "10px 14px" }}>
                        {N(p.precarite, 2)}
                      </td>

                      <td style={{ ...S, fontSize: "11px", color: "#4a6080", padding: "10px 14px" }}>
                        {user?.name ?? p.enteredBy}
                      </td>

                      <td style={{ ...S, fontSize: "10px", color: "#3d3830", padding: "10px 14px" }}>
                        {p.enteredAt ? new Date(p.enteredAt).toLocaleString("fr-FR") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canEdit && showPriceModal && (
            <Modal title="Add Market Price" onClose={() => setShowPriceModal(false)}>
              <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
                <FI
                  label="Date"
                  type="date"
                  value={priceForm.date}
                  onChange={e => setPriceForm(f => ({ ...f, date: e.target.value }))}
                />

                <FI
                  label="Classique (€/MWhc)"
                  type="number"
                  step="0.01"
                  placeholder="8.96"
                  value={priceForm.classique}
                  onChange={e => setPriceForm(f => ({ ...f, classique: e.target.value }))}
                />

                <FI
                  label="Précarité (€/MWhc)"
                  type="number"
                  step="0.01"
                  placeholder="16.44"
                  value={priceForm.precarite}
                  onChange={e => setPriceForm(f => ({ ...f, precarite: e.target.value }))}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
                <GhostBtn onClick={() => setShowPriceModal(false)}>Cancel</GhostBtn>
                <GoldBtn onClick={handleAddPrice}>Save</GoldBtn>
              </div>
            </Modal>
          )}
        </div>
      )}

      {view === "curve" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{
            background: "#111827",
            border: "1px solid #1e2d45",
            borderRadius: "2px",
            padding: "14px 16px"
          }}>
            <p style={{ ...S, fontSize: "11px", color: "#4a6080", lineHeight: 1.6 }}>
              The CEE forward curve shows Classique and Précarité prices by maturity.
              It is used as a market reference for forward pricing, spot/term comparison and valuation analysis.
            </p>
          </div>

          <div style={{
            background: "#111827",
            border: "1px solid #252219",
            borderRadius: "2px",
            padding: "18px"
          }}>
            <SectionTitle>CEE Forward Curve — Classique vs Précarité by Maturity</SectionTitle>

            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={curveData}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis
                  dataKey="tenor"
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "#4a6080" }} />
                <Line
                  type="monotone"
                  dataKey="classique"
                  name="Classique Forward (€/MWhc)"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ fill: "#2563eb", r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="precarite"
                  name="Précarité Forward (€/MWhc)"
                  stroke="#d4a843"
                  strokeWidth={2}
                  dot={{ fill: "#d4a843", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #1e1c18", borderRadius: "2px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {[
                    "Tenor",
                    "Classique Forward (€/MWhc)",
                    "Précarité Forward (€/MWhc)",
                    ...(canEdit ? ["Actions"] : [])
                  ].map(h => (
                    <TH key={h}>{h}</TH>
                  ))}
                </tr>
              </thead>

              <tbody>
                {TENORS.map(t => {
                  const fp = curve[t];
                  const isEditing = editingTenor === t;
                  const bg = "#111827";

                  return (
                    <tr
                      key={t}
                      style={{ borderBottom: "1px solid #1a1815", background: bg }}
                      onMouseEnter={e => e.currentTarget.style.background = "#0d1526"}
                      onMouseLeave={e => e.currentTarget.style.background = bg}
                    >
                      <td style={{ padding: "9px 14px" }}>
                        <Badge color={t === "SPOT" ? "gold" : "gray"}>{t}</Badge>
                      </td>

                      {isEditing ? (
                        <>
                          <td style={{ padding: "7px 14px" }}>
                            <input
                              value={draftCurve.classique}
                              onChange={e => setDraftCurve(d => ({ ...d, classique: e.target.value }))}
                              style={{
                                ...S,
                                background: "#0d1526",
                                border: "1px solid #b8973a",
                                color: "#e2e8f0",
                                borderRadius: "2px",
                                padding: "5px 8px",
                                fontSize: "12px",
                                width: "90px",
                                outline: "none"
                              }}
                            />
                          </td>

                          <td style={{ padding: "7px 14px" }}>
                            <input
                              value={draftCurve.precarite}
                              onChange={e => setDraftCurve(d => ({ ...d, precarite: e.target.value }))}
                              style={{
                                ...S,
                                background: "#0d1526",
                                border: "1px solid #b8973a",
                                color: "#e2e8f0",
                                borderRadius: "2px",
                                padding: "5px 8px",
                                fontSize: "12px",
                                width: "90px",
                                outline: "none"
                              }}
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ ...S, fontSize: "13px", color: "#2563eb", padding: "9px 14px", fontWeight: 500 }}>
                            {fp ? N(fp.classique, 2) : "—"}
                          </td>

                          <td style={{ ...S, fontSize: "13px", color: "#d4a843", padding: "9px 14px", fontWeight: 500 }}>
                            {fp ? N(fp.precarite, 2) : "—"}
                          </td>
                        </>
                      )}

                      {canEdit && (
                        <td style={{ padding: "9px 14px" }}>
                          {isEditing ? (
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                onClick={() => handleSaveCurve(t)}
                                style={{
                                  ...S,
                                  fontSize: "10px",
                                  padding: "4px 10px",
                                  background: "#38bdf8",
                                  color: "#0a0e1a",
                                  border: "none",
                                  borderRadius: "2px",
                                  cursor: "pointer"
                                }}
                              >
                                ✓ Save
                              </button>

                              <button
                                onClick={() => setEditingTenor(null)}
                                style={{
                                  ...S,
                                  fontSize: "10px",
                                  padding: "4px 10px",
                                  background: "transparent",
                                  color: "#3a5070",
                                  border: "1px solid #2e2b24",
                                  borderRadius: "2px",
                                  cursor: "pointer"
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingTenor(t);
                                setDraftCurve({
                                  classique: String(fp?.classique ?? ""),
                                  precarite: String(fp?.precarite ?? "")
                                });
                              }}
                              style={{
                                ...S,
                                fontSize: "10px",
                                padding: "4px 10px",
                                background: "transparent",
                                color: "#3a5070",
                                border: "1px solid #2e2b24",
                                borderRadius: "2px",
                                cursor: "pointer"
                              }}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "npv" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{
            background: "#111827",
            border: "1px solid #1e2d45",
            borderRadius: "2px",
            padding: "14px 16px"
          }}>
            <p style={{ ...S, fontSize: "11px", color: "#4a6080", lineHeight: 1.6 }}>
              This section compares spot prices with forward prices by maturity, applies a simple discounting logic,
              and translates forward-vs-spot spreads into €/m³ impact using product parameters.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
            <KPI
              label="Spot Classique"
              value={`${N(spotCurve.classique, 2)} €/MWhc`}
              color="sky"
              sub="Reference spot level"
            />

            <KPI
              label="Spot Précarité"
              value={`${N(spotCurve.precarite, 2)} €/MWhc`}
              color="amber"
              sub="Reference spot level"
            />

            <KPI
              label="Discount rate"
              value={`${N(Number(npvParams.discountRate) || 0, 2)}%`}
              color="emerald"
              sub="Used for NPV analysis"
            />
          </div>

          <div style={{
            background: "#111827",
            border: "1px solid #252219",
            borderRadius: "2px",
            padding: "18px"
          }}>
            <SectionTitle>Analysis Parameters</SectionTitle>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <FS
                label="Product"
                value={npvParams.product}
                onChange={e => setNpvParams(p => ({ ...p, product: e.target.value }))}
              >
                <option value="CARBURANT">Road Fuel</option>
                <option value="FOD">FOD</option>
              </FS>

              <FI
                label="Discount rate (%)"
                type="number"
                step="0.1"
                value={npvParams.discountRate}
                onChange={e => setNpvParams(p => ({ ...p, discountRate: e.target.value }))}
              />
            </div>
          </div>

          <div style={{
            background: "#111827",
            border: "1px solid #252219",
            borderRadius: "2px",
            padding: "18px"
          }}>
            <SectionTitle>NPV Forward Price vs Spot by Maturity (€/MWhc)</SectionTitle>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={npvData} barGap={3}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis
                  dataKey="tenor"
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "#4a6080" }} />
                <ReferenceLine y={0} stroke="#1e2d45" />
                <Bar
                  dataKey="clNpvVsSpotMWhc"
                  name="Classique NPV - Spot"
                  fill="#2563eb"
                  radius={[1, 1, 0, 0]}
                />
                <Bar
                  dataKey="prNpvVsSpotMWhc"
                  name="Précarité NPV - Spot"
                  fill="#d4a843"
                  radius={[1, 1, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{
            background: "#111827",
            border: "1px solid #252219",
            borderRadius: "2px",
            padding: "18px"
          }}>
           <SectionTitle>NPV Forward Impact vs Spot — Product Equivalent (€/m³)</SectionTitle>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={npvData} barGap={3}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e2d45" vertical={false} />
                <XAxis
                  dataKey="tenor"
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: "#3a5070" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "#4a6080" }} />
                <ReferenceLine y={0} stroke="#1e2d45" />
                <Bar
                  dataKey="clFinancingM3"
                  name="Classique financing €/m³"
                  fill="#2563eb"
                  radius={[1, 1, 0, 0]}
                />
                <Bar
                  dataKey="prFinancingM3"
                  name="Précarité financing €/m³"
                  fill="#d4a843"
                  radius={[1, 1, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #1e1c18", borderRadius: "2px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1100px" }}>
              <thead>
                <tr>
                  {[
                    "Tenor",
                    "Maturity date",
                    "Days",
                    "Fwd CL",
                    "Fwd PR",
                    "CL €/m³",
                    "PR €/m³",
                    "CL NPV €/MWhc",
                    "PR NPV €/MWhc",
                    "CL NPV vs Spot",
                    "PR NPV vs Spot",
                    "Total NPV vs Spot €/m³"
                  ].map(h => (
                    <TH key={h}>{h}</TH>
                  ))}
                </tr>
              </thead>

              <tbody>
                {npvData.map(d => (
                  <tr key={d.tenor} style={{ borderBottom: "1px solid #1a1815", background: "#111827" }}>
                    <td style={{ padding: "9px 14px" }}>
                      <Badge color={d.tenor === "SPOT" ? "gold" : "gray"}>{d.tenor}</Badge>
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#4a6080", padding: "9px 14px" }}>
                      {d.maturityDate}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#4a6080", padding: "9px 14px" }}>
                      {N(d.numberOfDays, 0)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#2563eb", padding: "9px 14px" }}>
                      {N(d.clMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#d4a843", padding: "9px 14px" }}>
                      {N(d.prMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#2563eb", padding: "9px 14px" }}>
                      {N(d.clM3, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#d4a843", padding: "9px 14px" }}>
                      {N(d.prM3, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#2563eb", padding: "9px 14px" }}>
                      {N(d.clNpvMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "#d4a843", padding: "9px 14px" }}>
                      {N(d.prNpvMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: d.clNpvVsSpotMWhc >= 0 ? "#34d399" : "#f87171", padding: "9px 14px" }}>
                      {d.clNpvVsSpotMWhc >= 0 ? "+" : ""}
                      {N(d.clNpvVsSpotMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: d.prNpvVsSpotMWhc >= 0 ? "#34d399" : "#f87171", padding: "9px 14px" }}>
                      {d.prNpvVsSpotMWhc >= 0 ? "+" : ""}
                      {N(d.prNpvVsSpotMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: d.totalNpvVsSpotM3 >= 0 ? "#34d399" : "#f87171", padding: "9px 14px", fontWeight: 700 }}>
                      {d.totalNpvVsSpotM3 >= 0 ? "+" : ""}
                      {N(d.totalNpvVsSpotM3, 2)} €/m³
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
      return { name: "Unknown user", initials: "?" };
    }

    const user = users.find(u => u.id === userId) || USERS.find(u => u.id === userId);

    if (!user) {
      return { name: `User ${userId}`, initials: "?" };
    }

    return {
      name: user.name || `User ${userId}`,
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
    const header = ["Timestamp", "User", "Action", "Entity", "Detail"];

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
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            style={{ ...S, background: "#0d1526", border: "1px solid #2e2b24", color: "#e2e8f0", borderRadius: "2px", padding: "7px 10px", fontSize: "10px", outline: "none", width: "220px" }}
          />

          <select
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            style={{ ...S, background: "#0d1526", border: "1px solid #2e2b24", color: "#4a6080", borderRadius: "2px", padding: "7px 10px", fontSize: "10px", outline: "none" }}
          >
            {auditUsers.map(u => {
              const user = u === "ALL" ? null : getUser(u);
              return <option key={u} value={u}>{u === "ALL" ? "All users" : user.name}</option>;
            })}
          </select>

          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            style={{ ...S, background: "#0d1526", border: "1px solid #2e2b24", color: "#4a6080", borderRadius: "2px", padding: "7px 10px", fontSize: "10px", outline: "none" }}
          >
            {actions.map(a => (
              <option key={a} value={a}>{a === "ALL" ? "All actions" : a.replace(/_/g, " ")}</option>
            ))}
          </select>

          <span style={{ ...S, fontSize: "10px", color: "#3a5070", alignSelf: "center" }}>
            {filteredAudit.length} / {audit.length} rows
          </span>
        </div>

        <GhostBtn onClick={handleExport}>↓ Export CSV</GhostBtn>
      </div>

      <div style={{ border: "1px solid #1e1c18", borderRadius: "2px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Timestamp", "User", "Action", "Entity", "Detail"].map(h => (
                <TH key={h}>{h}</TH>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredAudit.map(a => {
              const user = getUser(a.user);
              const bg = "#111827";

              return (
                <tr key={a.id} style={{ borderBottom: "1px solid #1a1815", background: bg }}>
                  <td style={{ ...S, fontSize: "10px", color: "#3a5070", padding: "9px 14px", whiteSpace: "nowrap" }}>
                    {new Date(a.ts).toLocaleString("fr-FR")}
                  </td>

                  <td style={{ padding: "9px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ ...S, width: "22px", height: "22px", borderRadius: "50%", background: "#1e2d45", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#38bdf8", fontWeight: 600 }}>
                        {user.initials}
                      </span>
                      <span style={{ ...S, fontSize: "10px", color: "#4a6080" }}>
                        {user.name}
                      </span>
                    </div>
                  </td>

                  <td style={{ padding: "9px 14px" }}>
                    <Badge color={AC[a.action] || "gray"}>
                      {(a.action || "UNKNOWN").replace(/_/g, " ")}
                    </Badge>
                  </td>

                  <td style={{ ...S, fontSize: "10px", color: "#3d3830", padding: "9px 14px" }}>
                    {a.entity || "—"}
                  </td>

                  <td style={{ ...S, fontSize: "10px", color: "#4a6080", padding: "9px 14px" }}>
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
    volumeGWhc: 1000,
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
      <td style={{ ...S, padding: "9px 12px", color: "#8aa0c0", borderBottom: "1px solid #1e2d45" }}>
        {label}
      </td>
      <td style={{
        ...S,
        padding: "9px 12px",
        color: highlight ? "#34d399" : "#e2e8f0",
        fontWeight: highlight ? 700 : 500,
        textAlign: "right",
        borderBottom: "1px solid #1e2d45"
      }}>
        {value}
      </td>
    </tr>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "22px" }}>
        <p style={{ ...S, fontSize: "9px", color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: "8px" }}>
          CEE Tools
        </p>
        <h2 style={{ ...CG, fontSize: "24px", color: "#e2e8f0", marginBottom: "4px" }}>
          CEE PnL Calculator
        </h2>
        <p style={{ ...S, fontSize: "11px", color: "#3a5070" }}>
          PnL simulation including financing effect by product, CEE type, volume and maturity.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        <KPI label="PnL - EUR" value={N(result.pnlEur, 2) + " €"} color="emerald" large />
        <KPI label="PnL without Financing" value={N(result.pnlWithoutFinancing, 2) + " €"} color="sky" large />
        <KPI label="Net Financing Impact" value={N(result.netFinancingImpact, 2) + " €"} color={result.netFinancingImpact >= 0 ? "emerald" : "rose"} large />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "16px" }}>
        <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
          <p style={{ ...S, fontSize: "9px", color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "14px" }}>
            Inputs
          </p>

          <div style={{ display: "grid", gap: "12px" }}>
            <FI label="CP" value={pnlTool.cp} onChange={e => update("cp", e.target.value)} />

            <FS label="CEE Type" value={pnlTool.ceeType} onChange={e => update("ceeType", e.target.value)}>
              <option value="Classique">Classique</option>
              <option value="Preca">Précarité</option>
            </FS>

            <FS label="Product Against" value={pnlTool.product} onChange={e => update("product", e.target.value)}>
              <option value="CARBURANT">Road Fuel</option>
              <option value="FOD">FOD</option>
            </FS>

            <FI label="Volume (GWhc)" type="number" value={pnlTool.volumeGWhc} onChange={e => update("volumeGWhc", e.target.value)} />

            <FI label="Purchase Price - €/MWhc" type="number" step="0.01" value={pnlTool.purchasePriceMWhc} onChange={e => update("purchasePriceMWhc", e.target.value)} />

            <FS label="Selling Price Mode" value={pnlTool.sellingPriceMode} onChange={e => update("sellingPriceMode", e.target.value)}>
              <option value="spot">Spot price</option>
              <option value="manual">Manual input</option>
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

            <FS label="Expected Selling Date" value={pnlTool.expectedSellingDate} onChange={e => update("expectedSellingDate", e.target.value)}>
              {MONTHS_LIST.map(m => <option key={m} value={`${m}-01`}>{ML(m)}</option>)}
            </FS>

            <FS label="CEE Purchase Maturity" value={pnlTool.maturityPeriod} onChange={e => update("maturityPeriod", e.target.value)}>
              {MATURITY_TENORS.map(t => <option key={t} value={t}>{t}</option>)}
            </FS>

            <FI label="Discounting Rate (%)" type="number" step="0.1" value={pnlTool.discountingRate} onChange={e => update("discountingRate", e.target.value)} />
          </div>
        </div>

        <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "18px" }}>
          <p style={{ ...S, fontSize: "9px", color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "14px" }}>
            Results
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {row("Product factor", `${N(result.energyFactor, 0)} kWhc/m³`)}
              {row("Volume - m³", N(result.volumeM3, 2))}
              {row("Purchase Price - €/m³", N(result.purchasePriceM3, 2))}
              {row("Selling Price - €/m³", N(result.sellingPriceM3, 2))}
              {row("Selling Price - €/MWhc", N(result.sellingPriceMWhc, 2))}
              {row("CEE Purchase Maturity Est. Date", result.maturityEstDate)}
              {row("Number of Days", N(result.numberOfDays, 0))}
              {row("Discounting Factor", N(result.discountingFactor, 2))}
              {row("CEE Purchase Price (CEE Market)", N(result.ceePurchasePriceMarket, 2))}
              {row("CEE Purchase Price NPV - €/m³", N(result.ceePurchasePriceNpvM3, 2))}
              {row("CEE Purchase Price NPV - €/MWhc", N(result.ceePurchasePriceNpvMWhc, 2))}
              {row("NPV vs Face Value Spread", N(result.spreadNpvVsFacial, 2))}
              {row("Total Spread", N(result.totalSpread, 2))}
              {row("PnL - EUR", N(result.pnlEur, 2) + " €", true)}
              {row("PnL without Financing", N(result.pnlWithoutFinancing, 2) + " €")}
              {row("Net Financing Impact", N(result.netFinancingImpact, 2) + " €", true)}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: "#111827", border: "1px solid #252219", borderRadius: "2px", padding: "22px" }}>
        <p style={{ ...S, fontSize: "9px", color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: "8px" }}>
          CEE Conversion
        </p>

        <h2 style={{ ...CG, fontSize: "22px", color: "#e2e8f0", marginBottom: "4px" }}>
          €/MWhc → €/m³ Converter
        </h2>

        <p style={{ ...S, fontSize: "11px", color: "#3a5070", marginBottom: "18px" }}>
          Converts Classique and Précarité CEE prices into product impact in €/m³ using Road Fuel / FOD factors.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "16px" }}>
          <div style={{ display: "grid", gap: "12px" }}>
            <FS label="Product" value={convertTool.product} onChange={e => updateConvert("product", e.target.value)}>
              <option value="CARBURANT">Road Fuel</option>
              <option value="FOD">FOD</option>
            </FS>

            <FS label="Price Source" value={convertTool.useSpot ? "spot" : "manual"} onChange={e => updateConvert("useSpot", e.target.value === "spot")}>
              <option value="spot">Supabase spot price</option>
              <option value="manual">Manual input</option>
            </FS>

            <FI label="Classique - €/MWhc" type="number" step="0.01" disabled={convertTool.useSpot} value={convertTool.useSpot ? curve?.SPOT?.classique || "" : convertTool.classiqueMWhc} onChange={e => updateConvert("classiqueMWhc", e.target.value)} />

            <FI label="Précarité - €/MWhc" type="number" step="0.01" disabled={convertTool.useSpot} value={convertTool.useSpot ? curve?.SPOT?.precarite || "" : convertTool.precariteMWhc} onChange={e => updateConvert("precariteMWhc", e.target.value)} />
          </div>

          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px", marginBottom: "14px" }}>
              <KPI label="Classique" value={N(convertResult.classiqueEurM3, 2) + " €/m³"} color="sky" />
              <KPI label="Précarité" value={N(convertResult.precariteEurM3, 2) + " €/m³"} color="amber" />
              <KPI label="Total CEE" value={N(convertResult.totalEurM3, 2) + " €/m³"} color="emerald" />
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {row("Product", convertResult.productLabel)}
                {row("Energy Factor", `${N(convertResult.kwhcPerM3, 0)} kWhc/m³`)}
                {row("Précarité Coeff.", N(convertResult.coeffPrecarite, 3))}
                {row("Correction Coeff.", N(convertResult.coeffCorrectif, 3))}
                {row("Classique Price", `${N(convertResult.classiqueMWhc, 2)} €/MWhc`)}
                {row("Précarité Price", `${N(convertResult.precariteMWhc, 2)} €/MWhc`)}
                {row("Classique Impact", `${N(convertResult.classiqueEurM3, 2)} €/m³`)}
                {row("Précarité Impact", `${N(convertResult.precariteEurM3, 2)} €/m³`)}
                {row("Total Impact", `${N(convertResult.totalEurM3, 2)} €/m³`, true)}
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

  const isViewer = currentUser?.role === "viewer";
  const canEdit = currentUser?.role === "trader" || currentUser?.role === "approver";
  const canApprove = currentUser?.role === "approver";
  const canCreate = currentUser?.role === "trader";

  async function loadAll({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      setError(null);

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
        createdAt: t.created_at,

        // Extended Excel fields
        year: t.year,
        operationType: t.operation_type,
        pricingMonth: t.pricing_month,
        comments: t.comments,
        sourcing: t.sourcing,
        tolerancePct: t.tolerance_pct != null ? +t.tolerance_pct : null,
        volumeM3Equivalent: t.volume_m3_equivalent != null ? +t.volume_m3_equivalent : null,
        approval: t.approval,
        contractYesNo: t.contract_yes_no,
        contractSigned: t.contract_signed,
        contractDate: t.contract_date,
        paymentTerms: t.payment_terms,
        volumeDeposited: t.volume_deposited != null ? +t.volume_deposited : null,
        volumeRemainingToBeDeposited: t.volume_remaining_to_be_deposited != null ? +t.volume_remaining_to_be_deposited : null,
        validated: t.validated,
        validationDate: t.validation_date,
        payment: t.payment,
        paymentDate: t.payment_date,
        cpRanking: t.cp_ranking,
        riskPerformanceMt: t.risk_performance_mt != null ? +t.risk_performance_mt : null,

        // Business aliases for the new Excel wording
        volumeCredited: t.volume_deposited != null ? +t.volume_deposited : null,
        volumeRemainingToBeCredited: t.volume_remaining_to_be_deposited != null ? +t.volume_remaining_to_be_deposited : null,
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
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    async function initAuth(silent = false) {
      if (!silent) setAuthLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const currentSession = sessionData?.session || null;

      setSession(currentSession);

      if (!currentSession?.user) {
        setCurrentUser(null);

        // Optional: still load data
        await loadAll({ silent });

        if (!silent) setAuthLoading(false);
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

        await loadAll({ silent }); // safe fallback

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

      // Load after auth
      await loadAll({ silent });

      setAuthLoading(false);
    }

    initAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setCurrentUser(null);
        setSession(null);
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        initAuth(true);
      }
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
    await persist("trades", {
      id: t.id,
      cee_type: t.ceeType,
      vendor: t.vendor,
      deal_type: t.dealType,
      period: t.period,
      volume: t.volume,
      price: t.price,
      month: t.month,
      status: t.status,
      priced: t.priced,
      statut: t.statut,
      ranking: t.ranking,
      emmy_validated: t.emmyValidated,
      created_by: t.createdBy,
      approved_by: t.approvedBy,
      created_at: t.createdAt,

      year: t.year ?? (Number(String(t.month || "").slice(0, 4)) || null),
      operation_type: t.operationType || "Achat",
      pricing_month: t.pricingMonth || null,
      comments: t.comments || null,
      sourcing: t.sourcing || null,
      tolerance_pct: t.tolerancePct ?? null,
      volume_m3_equivalent: t.volumeM3Equivalent ?? null,
      approval: t.approval || null,
      contract_yes_no: t.contractYesNo,
      contract_signed: t.contractSigned,
      contract_date: t.contractDate || null,
      payment_terms: t.paymentTerms || null,
      volume_deposited: t.volumeDeposited ?? 0,
      volume_remaining_to_be_deposited: t.volumeRemainingToBeDeposited ?? Number(t.volume || 0),
      validated: t.validated,
      validation_date: t.validationDate || null,
      payment: t.payment,
      payment_date: t.paymentDate || null,
      cp_ranking: t.cpRanking || null
    });
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
      detail: `Trade approved — approver: ${USERS.find(u => u.id === aid)?.name || aid}`
    });
  }, [addAudit]);

  const handleRejectTrade=useCallback(async(id)=>{
    setTrades(ts=>ts.map(t=>t.id===id?{...t,status:"REJECTED"}:t));
    await supabase.from("trades").update({status:"REJECTED"}).eq("id",id);
    await addAudit({action:"TRADE_REJECTED",entity:id,detail:"Trade rejected by approver"});
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
        ? `Trade deleted — ${tradeToDelete.vendor} · ${tradeToDelete.ceeType} · ${N(tradeToDelete.volume,3)} GWhc @ ${N(tradeToDelete.price,0)} €/GWhc · ${ML(tradeToDelete.month)}`
        : `Trade permanently deleted — id: ${id}`
    });
  }, [trades, addAudit]);

  const handleUpdateTrade = useCallback(async (id, patch) => {
    const tradeBefore = trades.find(t => t.id === id);
    const updatedAt = new Date().toISOString();

    // Optimistic update immédiat pour recalcul dashboard/reporting sans attendre Supabase
    setTrades(ts => ts.map(t => {
      if (t.id !== id) return t;

      const next = {
        ...t,
        ...patch,
        updatedAt
      };

      // Synchronisation des alias métier / technique
      if ("volumeCredited" in patch) {
        next.volumeDeposited = patch.volumeCredited;
      }

      if ("volumeDeposited" in patch) {
        next.volumeCredited = patch.volumeDeposited;
      }

      if ("volumeRemainingToBeCredited" in patch) {
        next.volumeRemainingToBeDeposited = patch.volumeRemainingToBeCredited;
      }

      if ("volumeRemainingToBeDeposited" in patch) {
        next.volumeRemainingToBeCredited = patch.volumeRemainingToBeDeposited;
      }

      return next;
    }));

    const dbPatch = {};

    // Core trade fields
    if ("ceeType" in patch) dbPatch.cee_type = patch.ceeType;
    if ("vendor" in patch) dbPatch.vendor = patch.vendor;
    if ("dealType" in patch) dbPatch.deal_type = patch.dealType;
    if ("period" in patch) dbPatch.period = patch.period;
    if ("volume" in patch) dbPatch.volume = patch.volume;
    if ("price" in patch) dbPatch.price = patch.price;
    if ("month" in patch) dbPatch.month = patch.month;
    if ("status" in patch) dbPatch.status = patch.status;
    if ("priced" in patch) dbPatch.priced = patch.priced;
    if ("statut" in patch) dbPatch.statut = patch.statut;
    if ("ranking" in patch) dbPatch.ranking = patch.ranking;
    if ("emmyValidated" in patch) dbPatch.emmy_validated = patch.emmyValidated;

    // Extended Excel fields
    if ("year" in patch) dbPatch.year = patch.year;
    if ("operationType" in patch) dbPatch.operation_type = patch.operationType;
    if ("pricingMonth" in patch) dbPatch.pricing_month = patch.pricingMonth;
    if ("comments" in patch) dbPatch.comments = patch.comments;
    if ("sourcing" in patch) dbPatch.sourcing = patch.sourcing;
    if ("tolerancePct" in patch) dbPatch.tolerance_pct = patch.tolerancePct;
    if ("volumeM3Equivalent" in patch) dbPatch.volume_m3_equivalent = patch.volumeM3Equivalent;
    if ("approval" in patch) dbPatch.approval = patch.approval;
    if ("contractYesNo" in patch) dbPatch.contract_yes_no = patch.contractYesNo;
    if ("contractSigned" in patch) dbPatch.contract_signed = patch.contractSigned;
    if ("contractDate" in patch) dbPatch.contract_date = patch.contractDate;
    if ("paymentTerms" in patch) dbPatch.payment_terms = patch.paymentTerms;

    // Business wording = credited on EMMY
    // Technical DB column kept = volume_deposited
    if ("volumeDeposited" in patch) {
      dbPatch.volume_deposited = patch.volumeDeposited;
    }

    if ("volumeCredited" in patch) {
      dbPatch.volume_deposited = patch.volumeCredited;
    }

    if ("volumeRemainingToBeDeposited" in patch) {
      dbPatch.volume_remaining_to_be_deposited = patch.volumeRemainingToBeDeposited;
    }

    if ("volumeRemainingToBeCredited" in patch) {
      dbPatch.volume_remaining_to_be_deposited = patch.volumeRemainingToBeCredited;
    }

    if ("validated" in patch) dbPatch.validated = patch.validated;
    if ("validationDate" in patch) dbPatch.validation_date = patch.validationDate;
    if ("payment" in patch) dbPatch.payment = patch.payment;
    if ("paymentDate" in patch) dbPatch.payment_date = patch.paymentDate;
    if ("cpRanking" in patch) dbPatch.cp_ranking = patch.cpRanking;
    if ("riskPerformanceMt" in patch) dbPatch.risk_performance_mt = patch.riskPerformanceMt;

    if ("createdBy" in patch) dbPatch.created_by = patch.createdBy;
    if ("approvedBy" in patch) dbPatch.approved_by = patch.approvedBy;

    dbPatch.updated_at = updatedAt;

    const { data, error } = await supabase
      .from("trades")
      .update(dbPatch)
      .eq("id", id)
      .select("id, priced, updated_at")
      .maybeSingle();


    if (error || !data) {
      console.error("Trade update error:", error);
      alert(
        "You do not have permission to edit the blotter"
      );
      await loadAll({ silent: true });
      return;
    }

    await addAudit({
      action: "TRADE_UPDATED",
      entity: id,
      detail: tradeBefore
        ? `Trade updated — ${tradeBefore.vendor} · ${tradeBefore.ceeType} · ${N(tradeBefore.volume, 3)} GWhc`
        : `Trade updated — id: ${id}`
    });
  }, [trades, addAudit, loadAll]);

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
        <div style={{fontFamily:"IBM Plex Mono, monospace",fontSize:"11px",color:"#3a5070"}}>Connecting to database…</div>
      </div>
    </div>
  );

  if(error) return(
    <div style={{background:"#0a0e1a",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"Inter, sans-serif",fontSize:"28px",color:"#f87171",marginBottom:"12px"}}>Connection Error</div>
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
          Login
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
            placeholder="Password"
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
            Log in
          </GoldBtn>
        </div>
      </div>
    </div>
  );

  const pending=trades.filter(t=>t.status==="PENDING").length;

  // ── Operational Follow-up ──
  const MATERIAL_TRADE_THRESHOLD = 50; // GWhc
  const DEPOSIT_EPS = 0.001;


  const TABS=[
    {id:"dashboard",  label:"Dashboard"},
    {id:"reporting",  label:"Reporting"},
    {id:"position",   label:"CEE Position"},
    {id:"blotter",    label:`Blotter${pending>0?` (${pending})`:""}`},
    {id:"obligation", label:"Obligation"},
    { id:"market", label:"Market & Curves" },
    {id:"tools",      label:"Tools"},
    {id:"audit",      label:"Audit Log"},
  ];

  const appDisplayDate = prices.length
  ? formatDateEn([...prices].sort((a, b) => b.date.localeCompare(a.date))[0].date)
  : "Curve fallback";

  return(
    <div style={{ minHeight:"100vh",background:"#0a0e1a",color:"#e2e8f0" }}>
      <div style={{ position:"fixed",inset:0,backgroundImage:"linear-gradient(#ffffff06 1px,transparent 1px),linear-gradient(90deg,#ffffff06 1px,transparent 1px)",backgroundSize:"40px 40px",pointerEvents:"none",zIndex:0 }}/>
      <div style={{ position:"relative",zIndex:1,maxWidth:"1400px",margin:"0 auto",padding:"0 28px 80px" }}>
        <header style={{ padding:"28px 0 16px",borderBottom:"1px solid #e2e4e8",display:"flex",justifyContent:"space-between",alignItems:"flex-end" }}>
          <div>
            <p style={{ ...S,fontSize:"9px",color:"#38bdf8",letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:"4px" }}>
              CEE Inventory Management · Position · PnL · P6 Obligation
            </p>
            <h1 style={{ ...CG,fontSize:"32px",fontWeight:700,color:"#e2e8f0",lineHeight:1 }}>
              CEE Dashboard
              <span style={{ ...S,fontSize:"11px",color:"#3a5070",fontWeight:400,marginLeft:"12px" }}>
                {prices.length>0
                  ? `Data as of ${appDisplayDate}`
                  : "Loading…"}
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
        {tab==="blotter" && (
          <Blotter
            trades={trades}
            currentUser={currentUser}
            onAdd={handleAddTrade}
            onApprove={handleApproveTrade}
            onReject={handleRejectTrade}
            onDelete={handleDeleteTrade}
            onUpdate={handleUpdateTrade}
          />
        )}
        {tab==="obligation" && (
          <ObligationTab
            obligations={obligations}
            onAdd={handleAddObligation}
            onDelete={id => setObligations(os => os.filter(o => o.id !== id))}
            canEdit={canEdit}
          />
        )}
        {tab === "market" && (
          <MarketCurvesTab
            prices={prices}
            curve={curve}
            currentUser={currentUser}
            onAddPrice={handleAddPrice}
            onUpdateCurve={handleUpdateCurve}
            canEdit={canEdit}
          />
        )}
        {tab==="tools"      && <Tools curve={curve} />}
        {tab==="audit"      && <AuditLog audit={audit} users={users}/>}
      </div>
    </div>
  );
}

