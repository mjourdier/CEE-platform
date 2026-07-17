import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from "recharts";
import * as XLSX from "xlsx";
import { Analytics } from "@vercel/analytics/react";
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
  const rows = trades.filter(t =>
    t.ceeType === ceeType &&
    t.priced === true &&
    (month ? t.month === month : true)
  );

  const volume = rows.reduce(
    (sum, trade) => sum + Number(trade.volume || 0),
    0
  );

  if (volume <= 0) {
    return 0;
  }

  return rows.reduce(
    (sum, trade) =>
      sum +
      Number(trade.price || 0) *
      Number(trade.volume || 0),
    0
  ) / volume;
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

function getCreditingVolumes(trade) {
  const totalVolume = Math.max(
    Number(trade?.volume || 0),
    0
  );

  const creditedRaw =
    trade?.volumeCredited ??
    trade?.volumeDeposited;

  const remainingRaw =
    trade?.volumeRemainingToBeCredited ??
    trade?.volumeRemainingToBeDeposited;

  const hasCreditedVolume =
    creditedRaw !== null &&
    creditedRaw !== undefined &&
    creditedRaw !== "" &&
    Number.isFinite(Number(creditedRaw));

  const hasRemainingVolume =
    remainingRaw !== null &&
    remainingRaw !== undefined &&
    remainingRaw !== "" &&
    Number.isFinite(Number(remainingRaw));

  let creditedVolume;

  if (hasCreditedVolume) {
    creditedVolume =
      Number(creditedRaw);
  } else if (hasRemainingVolume) {
    creditedVolume =
      totalVolume - Number(remainingRaw);
  } else {
    creditedVolume = 0;
  }

  creditedVolume = Math.min(
    Math.max(creditedVolume, 0),
    totalVolume
  );

  const uncreditedVolume = Math.max(
    totalVolume - creditedVolume,
    0
  );

  return {
    totalVolume,
    creditedVolume,
    uncreditedVolume
  };
}

function calcPaidRiskSplit(trade) {
  const {
    creditedVolume,
    uncreditedVolume
  } = getCreditingVolumes(trade);

  const price = Math.max(
    Number(trade?.price || 0),
    0
  );

  const isPaid =
    trade?.payment === true;

  if (!isPaid) {
    return {
      defaultRisk: 0,
      regulatoryRisk: 0
    };
  }

  return {
    defaultRisk:
      uncreditedVolume * price,

    regulatoryRisk:
      creditedVolume * price
  };
}

function splitTradeByCreditingStatus(trade) {
  const CREDIT_EPSILON = 0.01;

  const {
    totalVolume,
    creditedVolume,
    uncreditedVolume
  } = getCreditingVolumes(trade);

  const riskPerformance =
    Number(trade?.riskPerformanceMt || 0);

  const defaultRisk =
    Number(trade?.defaultRisk || 0);

  const regulatoryRisk =
    Number(trade?.regulatoryRisk || 0);

  const baseTrade = {
    sourceTradeId: trade.id,

    vendor:
      trade.vendor || "Unknown",

    rating:
      trade.cpRanking || "N/A",

    month:
      trade.month,

    price:
      Number(trade.price || 0),

    priced:
      trade.priced === true,

    validated:
      trade.validated === true,

    paid:
      trade.payment === true,

    totalContractVolume:
      totalVolume
  };

  // Cas exceptionnel : contrat de volume nul.
  // On conserve une ligne afin de ne pas faire disparaître
  // artificiellement le contrat du reporting.
  if (totalVolume <= CREDIT_EPSILON) {
    const credited =
      uncreditedVolume <= CREDIT_EPSILON;

    return [
      {
        ...baseTrade,

        id:
          `${trade.id}::${
            credited
              ? "credited"
              : "uncredited"
          }`,

        credited,

        volume: 0,

        riskPerformance,

        defaultRisk:
          credited ? 0 : defaultRisk,

        regulatoryRisk:
          credited ? regulatoryRisk : 0,

        totalRisk:
          riskPerformance +
          defaultRisk +
          regulatoryRisk
      }
    ];
  }

  const slices = [];

  // Fraction déjà créditée
  if (creditedVolume > CREDIT_EPSILON) {
    const creditedShare =
      creditedVolume / totalVolume;

    const creditedRiskPerformance =
      riskPerformance * creditedShare;

    slices.push({
      ...baseTrade,

      id:
        `${trade.id}::credited`,

      credited: true,

      volume:
        creditedVolume,

      riskPerformance:
        creditedRiskPerformance,

      defaultRisk: 0,

      regulatoryRisk,

      totalRisk:
        creditedRiskPerformance +
        regulatoryRisk
    });
  }

  // Fraction restant à créditer
  if (uncreditedVolume > CREDIT_EPSILON) {
    const uncreditedShare =
      uncreditedVolume / totalVolume;

    const uncreditedRiskPerformance =
      riskPerformance * uncreditedShare;

    slices.push({
      ...baseTrade,

      id:
        `${trade.id}::uncredited`,

      credited: false,

      volume:
        uncreditedVolume,

      riskPerformance:
        uncreditedRiskPerformance,

      defaultRisk,

      regulatoryRisk: 0,

      totalRisk:
        uncreditedRiskPerformance +
        defaultRisk
    });
  }

  return slices;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATOMS
// ─────────────────────────────────────────────────────────────────────────────
const THEME_PRESETS = {
  dark: {
    page: "#070b16",
    panel: "#111827",
    panelAlt: "#0d1526",
    tableHeader: "#0f1724",
    rowAlt: "#0f1624",

    textPrimary: "#e8edf7",
    textSecondary: "#9aabc2",
    textMuted: "#7187a6",
    textLabel: "#8297b7",
    textDisabled: "#526176",

    sectionTitle: "#8da3c3",
    controlText: "#8195b4",

    border: "#2a3950",
    borderSoft: "#1e2d45",
    hover: "#162033",

    gridLine: "#ffffff06",
    chartGrid: "#22314d",
    chartAxis: "#7187a6",

    blue: "#2563eb",
    sky: "#38bdf8",
    green: "#34d399",
    red: "#f87171",
    amber: "#d4a843",
    orange: "#f59e0b",
    purple: "#c296ed",
    gold: "#facc15",
    teal: "#75dbc0",

    selectedText: "#07101d",

    successBg: "#0f2e1a",
    successBorder: "#245b34",
    successText: "#85d291",

    warningBg: "#2e2410",
    warningBorder: "#5c4820",
    warningText: "#e2bd5b",

    dangerBg: "#2e1010",
    dangerBorder: "#642929",
    dangerText: "#e48787",

    infoBg: "#0e2030",
    infoBorder: "#21536b",
    infoText: "#72cceb",

    neutralBg: "#1b2433",
    neutralBorder: "#34445d",
    neutralText: "#9aabc2",

    purpleBg: "#1e1028",
    purpleBorder: "#51306b",
    purpleText: "#c296ed",

    goldBg: "#2a2010",
    goldBorder: "#594a25",
    goldText: "#d0ad50",

    tealBg: "#0e2820",
    tealBorder: "#245d4a",
    tealText: "#75dbc0",

    overlay: "rgba(4, 7, 14, 0.88)",
    shadow: "0 20px 60px rgba(0, 0, 0, 0.45)"
  },

  light: {
    page: "#eef3f8",
    panel: "#ffffff",
    panelAlt: "#f6f8fb",
    tableHeader: "#e9eff6",
    rowAlt: "#fbfcfe",

    textPrimary: "#172033",
    textSecondary: "#40516a",
    textMuted: "#6f8097",
    textLabel: "#53677f",
    textDisabled: "#9aa8b9",

    sectionTitle: "#435d7d",
    controlText: "#506781",

    border: "#b7c5d5",
    borderSoft: "#d6e0ea",
    hover: "#eaf1f7",

    gridLine: "rgba(31, 48, 69, 0.035)",
    chartGrid: "#d7e1eb",
    chartAxis: "#697b92",

    blue: "#2457c5",
    sky: "#087fae",
    green: "#087a58",
    red: "#c93649",
    amber: "#a66800",
    orange: "#c56b00",
    purple: "#7745a5",
    gold: "#9b7200",
    teal: "#087763",

    selectedText: "#ffffff",

    successBg: "#e9f8f0",
    successBorder: "#8ac8a7",
    successText: "#087a58",

    warningBg: "#fff6df",
    warningBorder: "#e2bd62",
    warningText: "#835800",

    dangerBg: "#fff0f2",
    dangerBorder: "#e4a0a9",
    dangerText: "#a82436",

    infoBg: "#e9f5fb",
    infoBorder: "#91cae4",
    infoText: "#086f99",

    neutralBg: "#eef2f6",
    neutralBorder: "#c4d0dc",
    neutralText: "#53677f",

    purpleBg: "#f4edfb",
    purpleBorder: "#cdb8e3",
    purpleText: "#6d3f97",

    goldBg: "#fff6df",
    goldBorder: "#e4c46f",
    goldText: "#845c00",

    tealBg: "#e8f7f3",
    tealBorder: "#91cebf",
    tealText: "#087763",

    overlay: "rgba(15, 23, 42, 0.46)",
    shadow: "0 20px 60px rgba(15, 23, 42, 0.18)"
  }
};

// CSS variables let every component switch appearance without receiving a theme prop.
const THEME = {
  page: "var(--theme-page)",
  panel: "var(--theme-panel)",
  panelAlt: "var(--theme-panel-alt)",
  tableHeader: "var(--theme-table-header)",
  rowAlt: "var(--theme-row-alt)",

  textPrimary: "var(--theme-text-primary)",
  textSecondary: "var(--theme-text-secondary)",
  textMuted: "var(--theme-text-muted)",
  textLabel: "var(--theme-text-label)",
  textDisabled: "var(--theme-text-disabled)",

  sectionTitle: "var(--theme-section-title)",
  controlText: "var(--theme-control-text)",

  border: "var(--theme-border)",
  borderSoft: "var(--theme-border-soft)",
  hover: "var(--theme-hover)",

  gridLine: "var(--theme-grid-line)",
  chartGrid: "var(--theme-chart-grid)",
  chartAxis: "var(--theme-chart-axis)",

  blue: "var(--theme-blue)",
  sky: "var(--theme-sky)",
  green: "var(--theme-green)",
  red: "var(--theme-red)",
  amber: "var(--theme-amber)",
  orange: "var(--theme-orange)",
  purple: "var(--theme-purple)",
  gold: "var(--theme-gold)",
  teal: "var(--theme-teal)",

  selectedText: "var(--theme-selected-text)",

  successBg: "var(--theme-success-bg)",
  successBorder: "var(--theme-success-border)",
  successText: "var(--theme-success-text)",

  warningBg: "var(--theme-warning-bg)",
  warningBorder: "var(--theme-warning-border)",
  warningText: "var(--theme-warning-text)",

  dangerBg: "var(--theme-danger-bg)",
  dangerBorder: "var(--theme-danger-border)",
  dangerText: "var(--theme-danger-text)",

  infoBg: "var(--theme-info-bg)",
  infoBorder: "var(--theme-info-border)",
  infoText: "var(--theme-info-text)",

  neutralBg: "var(--theme-neutral-bg)",
  neutralBorder: "var(--theme-neutral-border)",
  neutralText: "var(--theme-neutral-text)",

  purpleBg: "var(--theme-purple-bg)",
  purpleBorder: "var(--theme-purple-border)",
  purpleText: "var(--theme-purple-text)",

  goldBg: "var(--theme-gold-bg)",
  goldBorder: "var(--theme-gold-border)",
  goldText: "var(--theme-gold-text)",

  tealBg: "var(--theme-teal-bg)",
  tealBorder: "var(--theme-teal-border)",
  tealText: "var(--theme-teal-text)",

  overlay: "var(--theme-overlay)",
  shadow: "var(--theme-shadow)"
};

const S = {
  fontFamily: "Inter, sans-serif",
  lineHeight: 1.35
};

const CG = {
  fontFamily: "Inter, sans-serif",
  fontWeight: 600
};

const CHART_COLORS = {
  classique: THEME.blue,
  precarite: THEME.amber,
  green: THEME.green,
  red: THEME.red,
  gold: THEME.sky,
  bg: THEME.panel,
  grid: THEME.chartGrid,

  oblCl: "#5b7c99",
  oblPr: "#8a6a1f",
  achCl: "#4f7cff",
  achPr: "#e0b84f"
};

function Badge({ children, color }) {
  const palette = {
    green: [THEME.successBg, THEME.successText, THEME.successBorder],
    red: [THEME.dangerBg, THEME.dangerText, THEME.dangerBorder],
    amber: [THEME.warningBg, THEME.warningText, THEME.warningBorder],
    blue: [THEME.infoBg, THEME.infoText, THEME.infoBorder],
    sky: [THEME.infoBg, THEME.infoText, THEME.infoBorder],
    gray: [THEME.neutralBg, THEME.neutralText, THEME.neutralBorder],
    purple: [THEME.purpleBg, THEME.purpleText, THEME.purpleBorder],
    gold: [THEME.goldBg, THEME.goldText, THEME.goldBorder],
    teal: [THEME.tealBg, THEME.tealText, THEME.tealBorder]
  };

  const [bg, fg, bc] =
    palette[color] || palette.gray;

  return (
    <span
      style={{
        ...S,
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 7px",
        borderRadius: "2px",
        fontSize: "10px",
        fontWeight: 600,
        border: `1px solid ${bc}`,
        background: bg,
        color: fg,
        letterSpacing: "0.06em"
      }}
    >
      {children}
    </span>
  );
}

function KPI({ label, value, sub, color }) {
  const accentColors = {
    emerald: THEME.green,
    rose: THEME.red,
    sky: THEME.sky,
    amber: THEME.amber,
    gold: "var(--theme-gold)",
    neutral: THEME.textMuted,
    gray: THEME.textMuted
  };

  const accent = accentColors[color] || THEME.textMuted;

  return (
    <div
      style={{
        background: THEME.panel,
        border: `1px solid ${THEME.borderSoft}`,
        borderLeft: `2px solid ${accent}`,
        borderRadius: "3px",
        padding: "16px 18px",
        minHeight: "112px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between"
      }}
    >
      <div>
        <p
          style={{
            ...S,
            fontSize: "9px",
            lineHeight: 1.25,
            color: THEME.textLabel,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            margin: 0,
            marginBottom: "9px"
          }}
        >
          {label}
        </p>

        <p
          style={{
            ...S,
            fontSize: "23px",
            lineHeight: 1.08,
            color: THEME.textPrimary,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0
          }}
        >
          {value}
        </p>
      </div>

      {sub && (
        <p
          style={{
            ...S,
            fontSize: "10px",
            lineHeight: 1.4,
            color: THEME.textSecondary,
            fontWeight: 400,
            margin: 0,
            marginTop: "9px"
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: THEME.overlay,
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px"
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: THEME.panel,
          border: `1px solid ${THEME.border}`,
          borderRadius: "3px",
          width: "100%",
          maxWidth: wide ? "860px" : "520px",
          maxHeight: "92vh",
          overflowY: "auto",
          position: "relative",
          boxShadow: THEME.shadow
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "1px",
            background:
              "linear-gradient(90deg, transparent, #b8973a77, transparent)"
          }}
        />

        <div
          style={{
            padding: "20px 26px 14px",
            borderBottom: `1px solid ${THEME.borderSoft}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <h3
            style={{
              ...CG,
              fontSize: "20px",
              color: THEME.textPrimary,
              margin: 0
            }}
          >
            {title}
          </h3>

          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: THEME.textMuted,
              fontSize: "22px",
              cursor: "pointer",
              lineHeight: 1,
              padding: "2px 5px"
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "18px 26px 22px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FL({ children }) {
  return (
    <p
      style={{
        ...S,
        fontSize: "10px",
        color: THEME.textLabel,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.11em",
        marginBottom: "6px"
      }}
    >
      {children}
    </p>
  );
}

function FI({ label, ...p }) {
  return (
    <div>
      <FL>{label}</FL>

      <input
        style={{
          ...S,
          background: THEME.panelAlt,
          border: `1px solid ${THEME.border}`,
          color: THEME.textPrimary,
          borderRadius: "2px",
          padding: "9px 10px",
          fontSize: "12px",
          width: "100%",
          outline: "none"
        }}
        {...p}
      />
    </div>
  );
}

function FS({ label, children, ...p }) {
  return (
    <div>
      <FL>{label}</FL>

      <select
        style={{
          ...S,
          background: THEME.panelAlt,
          border: `1px solid ${THEME.border}`,
          color: THEME.textPrimary,
          borderRadius: "2px",
          padding: "9px 10px",
          fontSize: "12px",
          width: "100%",
          outline: "none"
        }}
        {...p}
      >
        {children}
      </select>
    </div>
  );
}

function GoldBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...S,
        background: "linear-gradient(135deg, #b8973a, #d4af55)",
        color: "#0a0e1a",
        border: "none",
        borderRadius: "2px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        padding: "9px 18px",
        cursor: "pointer"
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...S,
        background: "transparent",
        color: THEME.textSecondary,
        border: `1px solid ${THEME.border}`,
        borderRadius: "2px",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        padding: "8px 14px",
        cursor: "pointer"
      }}
    >
      {children}
    </button>
  );
}

function TH({ children }) {
  return (
    <th
      style={{
        ...S,
        fontSize: "10px",
        color: THEME.textLabel,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.09em",
        padding: "9px 14px",
        textAlign: "left",
        whiteSpace: "nowrap",
        background: THEME.tableHeader,
        borderBottom: `1px solid ${THEME.border}`
      }}
    >
      {children}
    </th>
  );
}

function CovBar({ pct }) {
  const c =
    pct >= 100
      ? THEME.green
      : pct >= 70
        ? THEME.amber
        : THEME.red;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px"
      }}
    >
      <div
        style={{
          flex: 1,
          height: "5px",
          background: THEME.borderSoft,
          borderRadius: "1px",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: "100%",
            background: c,
            borderRadius: "1px"
          }}
        />
      </div>

      <span
        style={{
          ...S,
          fontSize: "10px",
          fontWeight: 600,
          color: c,
          minWidth: "38px",
          textAlign: "right"
        }}
      >
        {N(pct, 1)}%
      </span>
    </div>
  );
}

// Custom chart tooltip
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: THEME.panelAlt,
        border: `1px solid ${THEME.border}`,
        borderRadius: "3px",
        padding: "10px 14px",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)"
      }}
    >
      <p
        style={{
          ...S,
          fontSize: "10px",
          color: THEME.sky,
          fontWeight: 600,
          marginBottom: "6px"
        }}
      >
        {label}
      </p>

      {payload.map(p => (
        <p
          key={p.dataKey}
          style={{
            ...S,
            fontSize: "11px",
            color: p.color || THEME.textSecondary,
            marginBottom: "2px"
          }}
        >
          {p.name}:{" "}
          {typeof p.value === "number"
            ? N(p.value, Math.abs(p.value) > 1000 ? 0 : 2)
            : p.value}
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTING TAB
// ─────────────────────────────────────────────────────────────────────────────
function Reporting({
  trades,
  obligations,
  prices,
  curve,
  displayDate
}) {
  const [report, setReport] = useState("executive");

  const [regulatoryType, setRegulatoryType] =
    useState("CLASSIQUE");

  // Ligne sélectionnée dans la future matrice de risque.
  // Contiendra les statuts Credited / Validated / Paid
  // ainsi que les contrats correspondant à cette combinaison.
  const [selectedRiskBucket, setSelectedRiskBucket] =
    useState(null);

  const [riskFilters, setRiskFilters] = useState({
    status: "ALL",
    credited: "ALL",
    validated: "ALL",
    paid: "ALL",
    dominantRisk: "ALL"
  });

  useEffect(() => {
    setSelectedRiskBucket(null);

    setRiskFilters({
      status: "ALL",
      credited: "ALL",
      validated: "ALL",
      paid: "ALL",
      dominantRisk: "ALL"
    });
  }, [regulatoryType]);

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

  // P6 reporting scope: only 2026 trades
  const trades2026 = useMemo(
    () => trades.filter(t =>
      String(t.period ?? "").trim().toUpperCase() === "P6"
    ),
    [trades]
  );

  // Regulatory Risk scope:
  // P5 and P6 are both included because the regulatory exposure
  // continues beyond the commercial period of the trade.
  const riskReportingTrades = useMemo(
    () =>
      trades.filter(trade => {
        const period =
          String(trade.period ?? "")
            .trim()
            .toUpperCase();

        return period === "P5" || period === "P6";
      }),
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
  // Scope: all P6 trades, with a Priced / Unpriced breakdown.
  const regulatoryBaseTrades = useMemo(
    () => trades2026,
    [trades2026]
  );

  const regulatoryApprovalTrades = useMemo(
    () => trades2026,
    [trades2026]
  );

  const buildRegulatoryMetrics = (ceeType) => {
    const rows = regulatoryBaseTrades.filter(
      trade => trade.ceeType === ceeType
    );

    const pricedRows = rows.filter(
      trade => trade.priced === true
    );

    const unpricedRows = rows.filter(
      trade => trade.priced !== true
    );

    const approvalRows = regulatoryApprovalTrades.filter(
      trade => trade.ceeType === ceeType
    );

    const isYes = value =>
      value === true ||
      String(value ?? "").trim().toLowerCase() === "yes";

    const isInternallyApproved = trade =>
      isYes(trade.approval);

    const creditedOf = trade => {
      const volume = Number(trade.volume || 0);

      const credited = Number(
        trade.volumeCredited ??
        trade.volumeDeposited ??
        0
      );

      return Math.max(
        0,
        Math.min(credited, volume)
      );
    };

    const remainingToCreditOf = trade => {
      const volume = Number(trade.volume || 0);

      const remainingRaw = Number(
        trade.volumeRemainingToBeCredited ??
        trade.volumeRemainingToBeDeposited ??
        volume - creditedOf(trade)
      );

      return Math.max(0, remainingRaw);
    };

    const calculateScopeMetrics = scopeRows => {
      const totalPurchased = scopeRows.reduce(
        (sum, trade) =>
          sum + Number(trade.volume || 0),
        0
      );

      const volume = predicate =>
        scopeRows
          .filter(predicate)
          .reduce(
            (sum, trade) =>
              sum + Number(trade.volume || 0),
            0
          );

      const creditedVolume = scopeRows.reduce(
        (sum, trade) =>
          sum + creditedOf(trade),
        0
      );

      const validatedVolume = volume(
        trade => trade.validated === true
      );

      const creditedAndValidatedVolume =
        scopeRows.reduce(
          (sum, trade) => {
            if (trade.validated !== true) {
              return sum;
            }

            return sum + creditedOf(trade);
          },
          0
        );

      const paidVolume = volume(
        trade => trade.payment === true
      );

      const paidCreditedNotValidatedVolume =
        scopeRows.reduce(
          (sum, trade) => {
            if (
              trade.payment !== true ||
              trade.validated === true
            ) {
              return sum;
            }

            return sum + creditedOf(trade);
          },
          0
        );

      const paidNotCreditedVolume =
        scopeRows.reduce(
          (sum, trade) => {
            if (trade.payment !== true) {
              return sum;
            }

            return sum + remainingToCreditOf(trade);
          },
          0
        );

      const pct = (
        numerator,
        denominator = totalPurchased
      ) =>
        denominator > 0
          ? numerator / denominator * 100
          : 0;

      return {
        totalPurchased,

        approvedPct: pct(
          volume(
            trade =>
              isInternallyApproved(trade)
          )
        ),

        signedContractPct: pct(
          volume(
            trade =>
              trade.contractSigned === true
          )
        ),

        paidPct: pct(paidVolume),

        creditedPct: pct(creditedVolume),

        validatedPct: pct(validatedVolume),

        creditedAndValidatedPct: pct(
          creditedAndValidatedVolume
        ),

        paidCreditedNotValidatedPct: pct(
          paidCreditedNotValidatedVolume,
          paidVolume
        ),

        paidNotCreditedPct: pct(
          paidNotCreditedVolume,
          paidVolume
        ),

        paidVolume,
        paidNotCreditedVolume
      };
    };

    const totalMetrics =
      calculateScopeMetrics(rows);

    const pricedMetrics =
      calculateScopeMetrics(pricedRows);

    const unpricedMetrics =
      calculateScopeMetrics(unpricedRows);

    // ========================================================================
    // PERFORMANCE RISK
    // All P6 trades, whether priced or unpriced.
    // ========================================================================

    const totalNotValidatedRows = rows
      .filter(
        trade =>
          trade.validated !== true
      )
      .map(trade => ({
        id: trade.id,
        vendor:
          trade.vendor || "Unknown",
        rating:
          trade.cpRanking || "N/A",
        month:
          trade.month,
        volume:
          Number(trade.volume || 0),
        price:
          Number(trade.price || 0),
        payment:
          trade.payment === true,
        priced:
          trade.priced === true,
        creditedVolume:
          creditedOf(trade),
        remainingToCreditVolume:
          remainingToCreditOf(trade),
        exposure:
          Number(
            trade.riskPerformanceMt || 0
          ),

        defaultRisk:
          Number(
            trade.defaultRisk || 0
          )
      }))
      .sort(
        (a, b) =>
          Math.abs(b.exposure) -
          Math.abs(a.exposure)
      );

    const aggregateRiskRows = riskRows =>
      riskRows.reduce(
        (result, trade) => ({
          volume:
            result.volume +
            Number(trade.volume || 0),

          exposure:
            result.exposure +
            Number(trade.exposure || 0)
        }),
        {
          volume: 0,
          exposure: 0
        }
      );

    const totalNotValidated =
      aggregateRiskRows(
        totalNotValidatedRows
      );

    const totalNotValidatedPriced =
      aggregateRiskRows(
        totalNotValidatedRows.filter(
          trade => trade.priced === true
        )
      );

    const totalNotValidatedUnpriced =
      aggregateRiskRows(
        totalNotValidatedRows.filter(
          trade => trade.priced !== true
        )
      );

    const paidNotValidatedRows =
      totalNotValidatedRows.filter(
        trade => trade.payment === true
      );

    const unpaidNotValidatedRows =
      totalNotValidatedRows.filter(
        trade => trade.payment !== true
      );

    const paidNotValidated =
      aggregateRiskRows(
        paidNotValidatedRows
      );

    const paidNotValidatedPriced =
      aggregateRiskRows(
        paidNotValidatedRows.filter(
          trade => trade.priced === true
        )
      );

    const paidNotValidatedUnpriced =
      aggregateRiskRows(
        paidNotValidatedRows.filter(
          trade => trade.priced !== true
        )
      );

    const unpaidNotValidated =
      aggregateRiskRows(
        unpaidNotValidatedRows
      );

    const unpaidNotValidatedPriced =
      aggregateRiskRows(
        unpaidNotValidatedRows.filter(
          trade => trade.priced === true
        )
      );

    const unpaidNotValidatedUnpriced =
      aggregateRiskRows(
        unpaidNotValidatedRows.filter(
          trade => trade.priced !== true
        )
      );

    // ========================================================================
    // DEFAULT RISK — UNPAID & NOT VALIDATED
    //
    // Périmètre :
    // - P6 ;
    // - Payment !== true ;
    // - Validated !== true ;
    // - Priced et Unpriced.
    //
    // Cette mesure utilise la nouvelle colonne Supabase `default_risk`.
    // Elle reste distincte de `risk_performance_mt`.
    // ========================================================================

    const paidDefaultRiskRows =
      totalNotValidatedRows
        .filter(
          trade => trade.payment === true
        )
        .map(trade => ({
          id: trade.id,
          vendor: trade.vendor,
          rating: trade.rating,
          month: trade.month,
          volume: Number(trade.volume || 0),
          price: Number(trade.price || 0),
          priced: trade.priced === true,
          defaultRisk: Number(trade.defaultRisk || 0)
        }))
        .sort(
          (a, b) =>
            Math.abs(b.defaultRisk) -
            Math.abs(a.defaultRisk)
        );

    const aggregateDefaultRiskRows = riskRows =>
      riskRows.reduce(
        (result, trade) => ({
          volume:
            result.volume +
            Number(trade.volume || 0),

          defaultRisk:
            result.defaultRisk +
            Number(trade.defaultRisk || 0)
        }),
        {
          volume: 0,
          defaultRisk: 0
        }
      );

    const paidDefaultRisk =
      aggregateDefaultRiskRows(
        paidDefaultRiskRows
      );

    const paidDefaultRiskPriced =
      aggregateDefaultRiskRows(
        paidDefaultRiskRows.filter(
          trade => trade.priced === true
        )
      );

    const paidDefaultRiskUnpriced =
      aggregateDefaultRiskRows(
        paidDefaultRiskRows.filter(
          trade => trade.priced !== true
        )
      );

    const paidDefaultRiskCounterpartyMap =
      paidDefaultRiskRows.reduce(
        (map, trade) => {
          if (!map[trade.vendor]) {
            map[trade.vendor] = {
              vendor: trade.vendor,
              rating: trade.rating,

              pricedVolume: 0,
              unpricedVolume: 0,
              totalVolume: 0,

              pricedDefaultRisk: 0,
              unpricedDefaultRisk: 0,
              totalDefaultRisk: 0
            };
          }

          const row = map[trade.vendor];

          row.totalVolume += trade.volume;
          row.totalDefaultRisk += trade.defaultRisk;

          if (trade.priced === true) {
            row.pricedVolume += trade.volume;
            row.pricedDefaultRisk += trade.defaultRisk;
          } else {
            row.unpricedVolume += trade.volume;
            row.unpricedDefaultRisk += trade.defaultRisk;
          }

          return map;
        },
        {}
      );

    const paidDefaultRiskCounterpartyData =
      Object.values(
        paidDefaultRiskCounterpartyMap
      )
        .filter(row =>
          Math.abs(row.totalVolume) > 0.001 ||
          Math.abs(row.totalDefaultRisk) > 0.01
        )
        .sort(
          (a, b) =>
            Math.abs(b.totalDefaultRisk) -
            Math.abs(a.totalDefaultRisk)
        );

    // ========================================================================
    // PERFORMANCE RISK BY COUNTERPARTY
    // ========================================================================

    const counterpartyMap = {};

    rows.forEach(trade => {
      const vendor =
        trade.vendor || "Unknown";

      const rating =
        trade.cpRanking || "N/A";

      if (!counterpartyMap[vendor]) {
        counterpartyMap[vendor] = {
          vendor,
          rating,

          paidNotCreditedVolume: 0,
          creditedNotValidatedVolume: 0,

          paidExposure: 0,
          unpaidExposure: 0,

          pricedExposure: 0,
          unpricedExposure: 0,

          totalExposure: 0,
          totalVolume: 0
        };
      }

      const row =
        counterpartyMap[vendor];

      if (trade.payment === true) {
        row.paidNotCreditedVolume +=
          remainingToCreditOf(trade);
      }

      if (
        trade.payment === true &&
        trade.validated !== true
      ) {
        row.creditedNotValidatedVolume +=
          creditedOf(trade);
      }

      if (trade.validated !== true) {
        const exposure =
          Number(
            trade.riskPerformanceMt || 0
          );

        const tradeVolume =
          Number(trade.volume || 0);

        row.totalExposure += exposure;
        row.totalVolume += tradeVolume;

        if (trade.payment === true) {
          row.paidExposure += exposure;
        } else {
          row.unpaidExposure += exposure;
        }

        if (trade.priced === true) {
          row.pricedExposure += exposure;
        } else {
          row.unpricedExposure += exposure;
        }
      }
    });

    const totalNotValidatedCounterpartyData =
      Object.values(counterpartyMap)
        .filter(row =>
          Math.abs(row.totalVolume) > 0.001 ||
          Math.abs(row.totalExposure) > 0.001
        )
        .sort(
          (a, b) =>
            Math.abs(b.totalExposure) -
            Math.abs(a.totalExposure)
        );

    // ========================================================================
    // PENDING APPROVALS
    // ========================================================================

    const pendingApprovalRows = approvalRows
      .filter(
        trade =>
          !isInternallyApproved(trade)
      )
      .map(trade => ({
        id:
          trade.id,
        vendor:
          trade.vendor || "Unknown",
        volume:
          Number(trade.volume || 0),
        price:
          Number(trade.price || 0),
        month:
          trade.month,
        status:
          trade.status,
        approval:
          trade.approval,
        priced:
          trade.priced
      }))
      .sort(
        (a, b) =>
          b.volume - a.volume
      );

    // ========================================================================
    // RATING
    // ========================================================================

    const ratingMap = {};

    rows.forEach(trade => {
      const rating =
        trade.cpRanking || "N/A";

      ratingMap[rating] =
        (ratingMap[rating] || 0) +
        Number(trade.volume || 0);
    });

    const ratingData =
      Object.entries(ratingMap)
        .map(
          ([rating, ratingVolume]) => ({
            rating,
            volume:
              Math.round(ratingVolume)
          })
        )
        .sort(
          (a, b) =>
            b.volume - a.volume
        );

    const totalPurchased =
      totalMetrics.totalPurchased;

    const pctOfTotalPurchased = value =>
      totalPurchased > 0
        ? value / totalPurchased * 100
        : 0;

    return {
      ceeType,
      rows,

      // Total purchased
      totalPurchased:
        totalMetrics.totalPurchased,

      totalPurchasedPriced:
        pricedMetrics.totalPurchased,

      totalPurchasedUnpriced:
        unpricedMetrics.totalPurchased,

      // Approved
      approvedPct:
        totalMetrics.approvedPct,

      approvedPctPriced:
        pricedMetrics.approvedPct,

      approvedPctUnpriced:
        unpricedMetrics.approvedPct,

      // Contracts
      signedContractPct:
        totalMetrics.signedContractPct,

      signedContractPctPriced:
        pricedMetrics.signedContractPct,

      signedContractPctUnpriced:
        unpricedMetrics.signedContractPct,

      // Paid
      paidPct:
        totalMetrics.paidPct,

      paidPctPriced:
        pricedMetrics.paidPct,

      paidPctUnpriced:
        unpricedMetrics.paidPct,

      // EMMY
      creditedPct:
        totalMetrics.creditedPct,

      creditedPctPriced:
        pricedMetrics.creditedPct,

      creditedPctUnpriced:
        unpricedMetrics.creditedPct,

      validatedPct:
        totalMetrics.validatedPct,

      validatedPctPriced:
        pricedMetrics.validatedPct,

      validatedPctUnpriced:
        unpricedMetrics.validatedPct,

      creditedAndValidatedPct:
        totalMetrics.creditedAndValidatedPct,

      creditedAndValidatedPctPriced:
        pricedMetrics.creditedAndValidatedPct,

      creditedAndValidatedPctUnpriced:
        unpricedMetrics.creditedAndValidatedPct,

      // Paid-flow exceptions
      paidCreditedNotValidatedPct:
        totalMetrics.paidCreditedNotValidatedPct,

      paidCreditedNotValidatedPctPriced:
        pricedMetrics.paidCreditedNotValidatedPct,

      paidCreditedNotValidatedPctUnpriced:
        unpricedMetrics.paidCreditedNotValidatedPct,

      paidNotCreditedPct:
        totalMetrics.paidNotCreditedPct,

      paidNotCreditedPctPriced:
        pricedMetrics.paidNotCreditedPct,

      paidNotCreditedPctUnpriced:
        unpricedMetrics.paidNotCreditedPct,

      paidNotCreditedVolume:
        totalMetrics.paidNotCreditedVolume,

      paidNotCreditedVolumePriced:
        pricedMetrics.paidNotCreditedVolume,

      paidNotCreditedVolumeUnpriced:
        unpricedMetrics.paidNotCreditedVolume,

      // Total unvalidated risk
      totalNotValidatedExposure:
        totalNotValidated.exposure,

      totalNotValidatedExposurePriced:
        totalNotValidatedPriced.exposure,

      totalNotValidatedExposureUnpriced:
        totalNotValidatedUnpriced.exposure,

      totalNotValidatedVolume:
        totalNotValidated.volume,

      totalNotValidatedVolumePriced:
        totalNotValidatedPriced.volume,

      totalNotValidatedVolumeUnpriced:
        totalNotValidatedUnpriced.volume,

      totalNotValidatedPct:
        pctOfTotalPurchased(
          totalNotValidated.volume
        ),

      // Paid risk
      paidNotValidatedExposure:
        paidNotValidated.exposure,

      paidNotValidatedExposurePriced:
        paidNotValidatedPriced.exposure,

      paidNotValidatedExposureUnpriced:
        paidNotValidatedUnpriced.exposure,

      paidNotValidatedVolume:
        paidNotValidated.volume,

      paidNotValidatedVolumePriced:
        paidNotValidatedPriced.volume,

      paidNotValidatedVolumeUnpriced:
        paidNotValidatedUnpriced.volume,

      // Unpaid risk
      unpaidNotValidatedExposure:
        unpaidNotValidated.exposure,

      unpaidNotValidatedExposurePriced:
        unpaidNotValidatedPriced.exposure,

      unpaidNotValidatedExposureUnpriced:
        unpaidNotValidatedUnpriced.exposure,

      unpaidNotValidatedVolume:
        unpaidNotValidated.volume,

      unpaidNotValidatedVolumePriced:
        unpaidNotValidatedPriced.volume,

      unpaidNotValidatedVolumeUnpriced:
        unpaidNotValidatedUnpriced.volume,

      // Default Risk — unpaid & not validated
      paidDefaultRisk:
        paidDefaultRisk.defaultRisk,

      paidDefaultRiskPriced:
        paidDefaultRiskPriced.defaultRisk,

      paidDefaultRiskUnpriced:
        paidDefaultRiskUnpriced.defaultRisk,

      paidDefaultRiskVolume:
        paidDefaultRisk.volume,

      paidDefaultRiskVolumePriced:
        paidDefaultRiskPriced.volume,

      paidDefaultRiskVolumeUnpriced:
        paidDefaultRiskUnpriced.volume,

      paidDefaultRiskRows,
      paidDefaultRiskCounterpartyData,
      
      // Detailed data
      totalNotValidatedRows,
      totalNotValidatedCounterpartyData,
      pendingApprovalRows,
      ratingData
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

  // ==========================================================================
  // RISK MATRIX — P5 + P6
  // Temporary addition: the previous regulatory calculations remain in place
  // until RegulatoryBlock is replaced in the next step.
  // ==========================================================================

  const RISK_STATUS_COMBINATIONS = [
    {
      credited: false,
      validated: false,
      paid: false,
      label: "Not credited · Not validated · Unpaid"
    },
    {
      credited: false,
      validated: false,
      paid: true,
      label: "Paid · Not credited · Not validated"
    },
    {
      credited: false,
      validated: true,
      paid: false,
      label: "Validated · Not credited · Unpaid"
    },
    {
      credited: false,
      validated: true,
      paid: true,
      label: "Paid & validated · Not credited"
    },
    {
      credited: true,
      validated: false,
      paid: false,
      label: "Credited · Not validated · Unpaid"
    },
    {
      credited: true,
      validated: false,
      paid: true,
      label: "Paid & credited · Not validated"
    },
    {
      credited: true,
      validated: true,
      paid: false,
      label: "Credited & validated · Unpaid"
    },
    {
      credited: true,
      validated: true,
      paid: true,
      label: "Fully completed"
    }
  ];

  const buildRiskMatrix = ceeType => {
    const rows = riskReportingTrades.filter(
      trade => trade.ceeType === ceeType
    );

    const CREDIT_EPSILON = 0.01;

    // Un contrat source apparaît une seule fois dans la matrice.
    // Un contrat partiellement crédité reste classé Credited = No
    // tant que son volume restant dépasse 0,01 GWhc.
    const contracts = rows.map(trade => {
      const {
        totalVolume,
        creditedVolume,
        uncreditedVolume
      } = getCreditingVolumes(trade);

      const validated =
        trade.validated === true;

      const riskPerformance =
        Number(trade.riskPerformanceMt || 0);

      const defaultRisk =
        Number(trade.defaultRisk || 0);

      const regulatoryRisk =
        Number(trade.regulatoryRisk || 0);

      const regulatoryRiskPendingValidation =
        validated
          ? 0
          : regulatoryRisk;

      const regulatoryRiskValidated =
        validated
          ? regulatoryRisk
          : 0;

      return {
        id: trade.id,
        sourceTradeId: trade.id,

        vendor:
          trade.vendor || "Unknown",

        rating:
          trade.cpRanking || "N/A",

        month:
          trade.month,

        period:
          trade.period,

        volume:
          totalVolume,

        totalContractVolume:
          totalVolume,

        creditedVolume,
        uncreditedVolume,

        creditedPct:
          totalVolume > 0
            ? creditedVolume / totalVolume * 100
            : 0,

        price:
          Number(trade.price || 0),

        priced:
          trade.priced === true,

        credited:
          uncreditedVolume <= CREDIT_EPSILON,

        validated,

        paid:
          trade.payment === true,

        riskPerformance,
        defaultRisk,

        regulatoryRiskPendingValidation,
        regulatoryRiskValidated,
        regulatoryRisk,

        totalRisk:
          riskPerformance +
          defaultRisk +
          regulatoryRisk
      };
    });

    const aggregateContracts = contractRows => {
      const totals = contractRows.reduce(
        (result, contract) => ({
          volume:
            result.volume +
            Number(contract.volume || 0),

          riskPerformance:
            result.riskPerformance +
            Number(contract.riskPerformance || 0),

          defaultRisk:
            result.defaultRisk +
            Number(contract.defaultRisk || 0),
          
          regulatoryRiskPendingValidation:
            result.regulatoryRiskPendingValidation +
            Number(
              contract.regulatoryRiskPendingValidation || 0
            ),

          regulatoryRiskValidated:
            result.regulatoryRiskValidated +
            Number(
              contract.regulatoryRiskValidated || 0
            ),

          regulatoryRisk:
            result.regulatoryRisk +
            Number(contract.regulatoryRisk || 0),

          totalRisk:
            result.totalRisk +
            Number(contract.totalRisk || 0)
        }),
        {
          volume: 0,
          riskPerformance: 0,
          defaultRisk: 0,
          regulatoryRiskPendingValidation: 0,
          regulatoryRiskValidated: 0,
          regulatoryRisk: 0,
          totalRisk: 0
        }
      );

      // Defensive unique count by source trade ID.
      // Each source contract should appear only once in the matrix.
      const uniqueTradeIds = new Set(
        contractRows.map(contract =>
          contract.sourceTradeId || contract.id
        )
      );

      return {
        tradeCount: uniqueTradeIds.size,
        ...totals
      };
    };

    const portfolioTotals =
      aggregateContracts(contracts);

    const buckets =
      RISK_STATUS_COMBINATIONS.map(status => {
        const bucketContracts =
          contracts
            .filter(
              contract =>
                contract.credited ===
                  status.credited &&
                contract.validated ===
                  status.validated &&
                contract.paid ===
                  status.paid
            )
            .sort(
              (a, b) =>
                Math.abs(b.totalRisk) -
                Math.abs(a.totalRisk)
            );

        const bucketTotals =
          aggregateContracts(bucketContracts);

        const counterpartyMap =
          bucketContracts.reduce(
            (map, contract) => {
              const vendor =
                contract.vendor || "Unknown";

              if (!map[vendor]) {
                map[vendor] = {
                  vendor,

                  rating:
                    contract.rating || "N/A",

                  tradeIds: new Set(),

                  volume: 0,
                  riskPerformance: 0,
                  defaultRisk: 0,

                  regulatoryRiskPendingValidation: 0,
                  regulatoryRiskValidated: 0,
                  regulatoryRisk: 0,

                  totalRisk: 0
                };
              }

              const counterparty =
                map[vendor];

              counterparty.tradeIds.add(
                contract.sourceTradeId ||
                contract.id
              );

              counterparty.volume +=
                Number(contract.volume || 0);

              counterparty.riskPerformance +=
                Number(
                  contract.riskPerformance || 0
                );

              counterparty.defaultRisk +=
                Number(contract.defaultRisk || 0);

              counterparty.regulatoryRiskPendingValidation +=
                Number(
                  contract.regulatoryRiskPendingValidation || 0
                );

              counterparty.regulatoryRiskValidated +=
                Number(
                  contract.regulatoryRiskValidated || 0
                );

              counterparty.regulatoryRisk +=
                Number(
                  contract.regulatoryRisk || 0
                );

              counterparty.totalRisk +=
                Number(contract.totalRisk || 0);

              return map;
            },
            {}
          );

        const counterparties =
          Object.values(counterpartyMap)
            .map(counterparty => ({
              vendor:
                counterparty.vendor,

              rating:
                counterparty.rating,

              tradeCount:
                counterparty.tradeIds.size,

              volume:
                counterparty.volume,

              riskPerformance:
                counterparty.riskPerformance,

              defaultRisk:
                counterparty.defaultRisk,

              regulatoryRiskPendingValidation:
                counterparty.regulatoryRiskPendingValidation,

              regulatoryRiskValidated:
                counterparty.regulatoryRiskValidated,

              regulatoryRisk:
                counterparty.regulatoryRisk,

              totalRisk:
                counterparty.totalRisk
            }))
            .sort(
              (a, b) =>
                Math.abs(b.totalRisk) -
                Math.abs(a.totalRisk)
            );

        return {
          key: [
            status.credited
              ? "credited"
              : "not-credited",

            status.validated
              ? "validated"
              : "not-validated",

            status.paid
              ? "paid"
              : "unpaid"
          ].join("-"),

          label:
            status.label,

          credited:
            status.credited,

          validated:
            status.validated,

          paid:
            status.paid,

          tradeCount:
            bucketTotals.tradeCount,

          volume:
            bucketTotals.volume,

          portfolioPct:
            portfolioTotals.volume > 0
              ? (
                  bucketTotals.volume /
                  portfolioTotals.volume
                ) * 100
              : 0,

          riskPerformance:
            bucketTotals.riskPerformance,

          defaultRisk:
            bucketTotals.defaultRisk,

          regulatoryRiskPendingValidation:
            bucketTotals.regulatoryRiskPendingValidation,

          regulatoryRiskValidated:
            bucketTotals.regulatoryRiskValidated,

          regulatoryRisk:
            bucketTotals.regulatoryRisk,

          totalRisk:
            bucketTotals.totalRisk,

          contracts:
            bucketContracts,

          counterparties
        };
      });

    return {
      ceeType,

      tradeCount:
        portfolioTotals.tradeCount,

      totalVolume:
        portfolioTotals.volume,

      totalRiskPerformance:
        portfolioTotals.riskPerformance,

      totalDefaultRisk:
        portfolioTotals.defaultRisk,

      totalRegulatoryRiskPendingValidation:
        portfolioTotals.regulatoryRiskPendingValidation,

      totalRegulatoryRiskValidated:
        portfolioTotals.regulatoryRiskValidated,

      totalRegulatoryRisk:
        portfolioTotals.regulatoryRisk,

      totalRisk:
        portfolioTotals.totalRisk,

      buckets,
      contracts
    };
  };

  const riskMatrixClassique = useMemo(
    () => buildRiskMatrix("CLASSIQUE"),
    [riskReportingTrades]
  );

  const riskMatrixPrecarite = useMemo(
    () => buildRiskMatrix("PRECARITE"),
    [riskReportingTrades]
  );

  const activeRiskMatrixData =
    regulatoryType === "CLASSIQUE"
      ? riskMatrixClassique
      : riskMatrixPrecarite;

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
      color: "var(--theme-sky)",
      textTransform: "uppercase",
      letterSpacing: "0.18em",
      marginBottom: "14px",
      marginTop: "8px"
    }}>
      {children}
    </p>
  );

  const RegulatoryBlock = ({ title, data }) => {
    const riskColor = value =>
      value < 0
        ? THEME.green
        : value > 0
          ? THEME.red
          : THEME.textMuted;

    const statusBadgeColor = value =>
      value === true
        ? "green"
        : "gray";

    const periodCounts = (data.contracts || []).reduce(
      (counts, contract) => {
        const period = String(
          contract.period || ""
        )
          .trim()
          .toUpperCase();

        if (period === "P5" || period === "P6") {
          counts[period] += 1;
        }

        return counts;
      },
      {
        P5: 0,
        P6: 0
      }
    );

    const scopeLabel = "P5 + P6";

    const riskCompositionBase =
      Math.abs(data.totalRiskPerformance) +
      Math.abs(data.totalDefaultRisk) +
      Math.abs(
        data.totalRegulatoryRiskPendingValidation
      ) +
      Math.abs(
        data.totalRegulatoryRiskValidated
      );

    const riskShare = value =>
      riskCompositionBase > 0
        ? Math.abs(value) / riskCompositionBase * 100
        : 0;

    const dominantRiskLabel = bucket => {
      if (bucket.tradeCount === 0) {
        return "No active contracts";
      }

      const risks = [
        {
          label: "Performance risk",
          value: bucket.riskPerformance
        },
        {
          label: "Default risk",
          value: bucket.defaultRisk
        },
        {
          label: "Regulatory risk — pending validation",
          value:
            bucket.regulatoryRiskPendingValidation
        },
        {
          label: "Regulatory risk — validated",
          value:
            bucket.regulatoryRiskValidated
        }
      ].sort(
        (a, b) =>
          Math.abs(b.value) - Math.abs(a.value)
      );

      if (Math.abs(risks[0].value) < 0.01) {
        return "No material risk";
      }

      return `${risks[0].label} dominant`;
    };

    const EyeIcon = () => (
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );


    const cardStyle = {
      background: THEME.panel,
      border: `1px solid ${THEME.borderSoft}`,
      borderRadius: "3px",
      padding: "20px 22px"
    };

    const riskComponentColors = {
      performancePositive: THEME.red,
      performanceNegative: THEME.green,
      defaultRisk: THEME.orange,
      regulatoryPending: THEME.amber,
      regulatoryValidated: THEME.sky
    };

    // Stable colors by contract-status category. These colors are shared by
    // the portfolio-volume donut and its legend, for both Classique and
    // Précarité views.
    const statusCategoryColorMap = {
      "not-credited-not-validated-unpaid": THEME.red,
      "not-credited-not-validated-paid": THEME.orange,
      "not-credited-validated-unpaid": THEME.purple,
      "not-credited-validated-paid": THEME.amber,
      "credited-not-validated-unpaid": THEME.teal,
      "credited-not-validated-paid": THEME.gold,
      "credited-validated-unpaid": THEME.sky,
      "credited-validated-paid": THEME.green
    };

    const detailRiskDistributionData = selectedRiskBucket
      ? [
          {
            key: "riskPerformance",
            name:
              selectedRiskBucket.riskPerformance < 0
                ? "Risk Performance — Risk Offset"
                : "Risk Performance — Exposure",
            value: Math.abs(
              Number(
                selectedRiskBucket.riskPerformance || 0
              )
            ),
            signedValue: Number(
              selectedRiskBucket.riskPerformance || 0
            ),
            color:
              selectedRiskBucket.riskPerformance < 0
                ? riskComponentColors.performanceNegative
                : riskComponentColors.performancePositive
          },
          {
            key: "defaultRisk",
            name: "Default Risk",
            value: Math.abs(
              Number(selectedRiskBucket.defaultRisk || 0)
            ),
            signedValue: Number(
              selectedRiskBucket.defaultRisk || 0
            ),
            color: riskComponentColors.defaultRisk
          },
          {
            key: "regulatoryPending",
            name: "Regulatory — Pending Validation",
            value: Math.abs(
              Number(
                selectedRiskBucket
                  .regulatoryRiskPendingValidation || 0
              )
            ),
            signedValue: Number(
              selectedRiskBucket
                .regulatoryRiskPendingValidation || 0
            ),
            color: riskComponentColors.regulatoryPending
          },
          {
            key: "regulatoryValidated",
            name: "Regulatory — Validated",
            value: Math.abs(
              Number(
                selectedRiskBucket
                  .regulatoryRiskValidated || 0
              )
            ),
            signedValue: Number(
              selectedRiskBucket
                .regulatoryRiskValidated || 0
            ),
            color: riskComponentColors.regulatoryValidated
          }
        ].filter(component => component.value > 0.01)
      : [];

    const detailRiskMagnitude =
      detailRiskDistributionData.reduce(
        (sum, component) => sum + component.value,
        0
      );

    const StatusRiskTooltip = ({ active, payload, label }) => {
      if (!active || !payload?.length) return null;

      const row = payload[0]?.payload;
      if (!row) return null;

      return (
        <div
          style={{
            background: THEME.panelAlt,
            border: `1px solid ${THEME.border}`,
            borderRadius: "3px",
            padding: "11px 13px",
            minWidth: "245px",
            boxShadow: THEME.shadow
          }}
        >
          <p
            style={{
              ...S,
              fontSize: "10px",
              color: THEME.textPrimary,
              fontWeight: 700,
              margin: 0,
              marginBottom: "5px"
            }}
          >
            {label}
          </p>

          <p
            style={{
              ...S,
              fontSize: "9px",
              color: THEME.textMuted,
              margin: 0,
              marginBottom: "9px"
            }}
          >
            {row.tradeCount} contract
            {row.tradeCount > 1 ? "s" : ""}
            {" · "}
            {N(row.volume, 2)} GWhc
            {" · "}
            {N(row.portfolioPct, 1)}% of portfolio
          </p>

          {[
            {
              label:
                row.riskPerformance < 0
                  ? "Risk Performance — Risk Offset"
                  : "Risk Performance — Exposure",
              value: row.riskPerformance,
              color:
                row.riskPerformance < 0
                  ? riskComponentColors.performanceNegative
                  : riskComponentColors.performancePositive
            },
            {
              label: "Default Risk",
              value: row.defaultRisk,
              color: riskComponentColors.defaultRisk
            },
            {
              label: "Regulatory — Pending Validation",
              value: row.regulatoryPending,
              color: riskComponentColors.regulatoryPending
            },
            {
              label: "Regulatory — Validated",
              value: row.regulatoryValidated,
              color: riskComponentColors.regulatoryValidated
            }
          ].map(component => (
            <div
              key={component.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "14px",
                marginBottom: "4px"
              }}
            >
              <span
                style={{
                  ...S,
                  fontSize: "9px",
                  color: component.color
                }}
              >
                {component.label}
              </span>

              <span
                style={{
                  ...S,
                  fontSize: "10px",
                  color: component.color,
                  fontWeight: 700,
                  whiteSpace: "nowrap"
                }}
              >
                {fM(component.value)}
              </span>
            </div>
          ))}

          <div
            style={{
              borderTop: `1px solid ${THEME.borderSoft}`,
              marginTop: "8px",
              paddingTop: "8px",
              display: "flex",
              justifyContent: "space-between",
              gap: "14px"
            }}
          >
            <span
              style={{
                ...S,
                fontSize: "9px",
                color: THEME.textSecondary,
                fontWeight: 600
              }}
            >
              Total Risk
            </span>

            <span
              style={{
                ...S,
                fontSize: "10px",
                color: riskColor(row.totalRisk),
                fontWeight: 800,
                whiteSpace: "nowrap"
              }}
            >
              {fM(row.totalRisk)}
            </span>
          </div>
        </div>
      );
    };

    const DetailRiskTooltip = ({ active, payload }) => {
      if (!active || !payload?.length) return null;

      const component = payload[0]?.payload;
      if (!component) return null;

      const share =
        detailRiskMagnitude > 0
          ? component.value / detailRiskMagnitude * 100
          : 0;

      return (
        <div
          style={{
            background: THEME.panel,
            border: `1px solid ${THEME.border}`,
            borderRadius: "3px",
            padding: "10px 12px",
            boxShadow: THEME.shadow
          }}
        >
          <p
            style={{
              ...S,
              fontSize: "10px",
              color: component.color,
              fontWeight: 700,
              margin: 0,
              marginBottom: "5px"
            }}
          >
            {component.name}
          </p>

          <p
            style={{
              ...S,
              fontSize: "11px",
              color: component.color,
              fontWeight: 800,
              margin: 0
            }}
          >
            {fM(component.signedValue)}
          </p>

          <p
            style={{
              ...S,
              fontSize: "9px",
              color: THEME.textMuted,
              margin: 0,
              marginTop: "3px"
            }}
          >
            {N(share, 1)}% of absolute risk magnitude
          </p>
        </div>
      );
    };

    const VolumeShareTooltip = ({ active, payload }) => {
      if (!active || !payload?.length) return null;

      const row = payload[0]?.payload;
      if (!row) return null;

      return (
        <div
          style={{
            background: THEME.panelAlt,
            border: `1px solid ${THEME.border}`,
            borderRadius: "3px",
            padding: "10px 12px",
            minWidth: "230px",
            boxShadow: THEME.shadow
          }}
        >
          <p
            style={{
              ...S,
              fontSize: "10px",
              color: row.color,
              fontWeight: 700,
              margin: 0,
              marginBottom: "6px"
            }}
          >
            {row.label}
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              marginBottom: "4px"
            }}
          >
            <span
              style={{
                ...S,
                fontSize: "9px",
                color: THEME.textMuted
              }}
            >
              Volume
            </span>

            <span
              style={{
                ...S,
                fontSize: "10px",
                color: THEME.textPrimary,
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              {N(row.volume, 2)} GWhc
            </span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              marginBottom: "4px"
            }}
          >
            <span
              style={{
                ...S,
                fontSize: "9px",
                color: THEME.textMuted
              }}
            >
              Current selection
            </span>

            <span
              style={{
                ...S,
                fontSize: "10px",
                color: row.color,
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              {N(row.selectionPct, 1)}%
            </span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px"
            }}
          >
            <span
              style={{
                ...S,
                fontSize: "9px",
                color: THEME.textMuted
              }}
            >
              Full portfolio
            </span>

            <span
              style={{
                ...S,
                fontSize: "10px",
                color: THEME.textSecondary,
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              {N(row.portfolioPct, 1)}%
            </span>
          </div>
        </div>
      );
    };

    const visibleBuckets = data.buckets.filter(
      bucket => bucket.tradeCount > 0
    );  

    const dominantRiskKey = bucket => {
      const risks = [
        {
          key: "PERFORMANCE",
          value: Math.abs(
            Number(bucket.riskPerformance || 0)
          )
        },
        {
          key: "DEFAULT",
          value: Math.abs(
            Number(bucket.defaultRisk || 0)
          )
        },
        {
          key: "REGULATORY_PENDING",
          value: Math.abs(
            Number(
              bucket.regulatoryRiskPendingValidation ||
              0
            )
          )
        },
        {
          key: "REGULATORY_VALIDATED",
          value: Math.abs(
            Number(
              bucket.regulatoryRiskValidated ||
              0
            )
          )
        }
      ].sort(
        (a, b) => b.value - a.value
      );

      return risks[0].value > 0.01
        ? risks[0].key
        : "NONE";
    };

    const filteredBuckets =
      visibleBuckets.filter(bucket => {
        if (
          riskFilters.status !== "ALL" &&
          bucket.key !== riskFilters.status
        ) {
          return false;
        }

        if (
          riskFilters.credited !== "ALL" &&
          String(bucket.credited) !==
            riskFilters.credited
        ) {
          return false;
        }

        if (
          riskFilters.validated !== "ALL" &&
          String(bucket.validated) !==
            riskFilters.validated
        ) {
          return false;
        }

        if (
          riskFilters.paid !== "ALL" &&
          String(bucket.paid) !==
            riskFilters.paid
        ) {
          return false;
        }

        if (
          riskFilters.dominantRisk !== "ALL" &&
          dominantRiskKey(bucket) !==
            riskFilters.dominantRisk
        ) {
          return false;
        }

        return true;
      });

    const statusRiskChartData =
      filteredBuckets.map(bucket => {
        const riskPerformance =
          Number(bucket.riskPerformance || 0);

        return {
          status:
            `${bucket.label} · ` +
            `${N(bucket.portfolioPct, 1)}% vol.`,

          tradeCount:
            Number(bucket.tradeCount || 0),

          volume:
            Number(bucket.volume || 0),

          portfolioPct:
            Number(bucket.portfolioPct || 0),

          riskPerformance,

          riskPerformancePositive:
            Math.max(riskPerformance, 0),

          riskPerformanceNegative:
            Math.min(riskPerformance, 0),

          defaultRisk:
            Number(bucket.defaultRisk || 0),

          regulatoryPending:
            Number(
              bucket.regulatoryRiskPendingValidation ||
              0
            ),

          regulatoryValidated:
            Number(
              bucket.regulatoryRiskValidated ||
              0
            ),

          totalRisk:
            Number(bucket.totalRisk || 0)
        };
      });

    const selectedCategoryVolume =
      filteredBuckets.reduce(
        (sum, bucket) =>
          sum + Number(bucket.volume || 0),
        0
      );

    const portfolioVolumeChartData =
      filteredBuckets.map(bucket => ({
        key: bucket.key,
        label: bucket.label,
        volume: Number(bucket.volume || 0),
        tradeCount: Number(bucket.tradeCount || 0),
        portfolioPct: Number(bucket.portfolioPct || 0),
        selectionPct:
          selectedCategoryVolume > 0
            ? Number(bucket.volume || 0) /
              selectedCategoryVolume * 100
            : 0,
        color:
          statusCategoryColorMap[bucket.key] ||
          THEME.textMuted
      }));

    const filteredContracts =
      filteredBuckets.flatMap(
        bucket => bucket.contracts || []
      );

    const filteredTradeIds =
      new Set(
        filteredContracts.map(
          contract =>
            contract.sourceTradeId ||
            contract.id
        )
      );

    const filteredTotals =
      filteredBuckets.reduce(
        (totals, bucket) => ({
          tradeCount:
            filteredTradeIds.size,

          volume:
            totals.volume +
            Number(bucket.volume || 0),

          riskPerformance:
            totals.riskPerformance +
            Number(
              bucket.riskPerformance || 0
            ),

          defaultRisk:
            totals.defaultRisk +
            Number(bucket.defaultRisk || 0),

          regulatoryRiskPendingValidation:
            totals.regulatoryRiskPendingValidation +
            Number(
              bucket.regulatoryRiskPendingValidation ||
              0
            ),

          regulatoryRiskValidated:
            totals.regulatoryRiskValidated +
            Number(
              bucket.regulatoryRiskValidated ||
              0
            ),

          regulatoryRisk:
            totals.regulatoryRisk +
            Number(
              bucket.regulatoryRisk || 0
            ),

          totalRisk:
            totals.totalRisk +
            Number(bucket.totalRisk || 0)
        }),
        {
          tradeCount: filteredTradeIds.size,
          volume: 0,
          riskPerformance: 0,
          defaultRisk: 0,
          regulatoryRiskPendingValidation: 0,
          regulatoryRiskValidated: 0,
          regulatoryRisk: 0,
          totalRisk: 0
        }
      );

    const filteredPortfolioPct =
      data.totalVolume > 0
        ? (
            filteredTotals.volume /
            data.totalVolume
          ) * 100
        : 0;

    const hasRiskFilters =
      Object.values(riskFilters).some(
        value => value !== "ALL"
      );

    const updateRiskFilter = (
      filterName,
      value
    ) => {
      setRiskFilters(current => ({
        ...current,
        [filterName]: value
      }));
    };

    const resetRiskFilters = () => {
      setRiskFilters({
        status: "ALL",
        credited: "ALL",
        validated: "ALL",
        paid: "ALL",
        dominantRisk: "ALL"
      });
    };

    const riskFilterStyle = {
      ...S,
      background: THEME.panelAlt,
      border: `1px solid ${THEME.border}`,
      color: THEME.textSecondary,
      borderRadius: "2px",
      padding: "8px 10px",
      fontSize: "10px",
      fontWeight: 500,
      outline: "none",
      minHeight: "34px"
    };

    return (
      <>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px"
          }}
        >
          {/* ======================================================
              1. GLOBAL RISK SUMMARY
          ====================================================== */}
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "16px"
              }}
            >
              <div>
                <SectionTitle>
                  {title} — {scopeLabel} Risk Summary
                </SectionTitle>

                <p
                  style={{
                    ...S,
                    fontSize: "11px",
                    color: THEME.textMuted,
                    lineHeight: 1.55,
                    marginTop: "-6px",
                    marginBottom: 0
                  }}
                >
                  Consolidated contractual risk across all
                  Credited, Validated and Paid status combinations.
                </p>
              </div>

              <Badge color="sky">
                {data.tradeCount} contracts
                {" · "}
                P5 {periodCounts.P5}
                {" · "}
                P6 {periodCounts.P6}
              </Badge>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(175px, 1fr))",
                gap: "10px"
              }}
            >
              <KPI
                label="Total Risk"
                value={fM(data.totalRisk)}
                color={
                  data.totalRisk > 0
                    ? "rose"
                    : data.totalRisk < 0
                      ? "emerald"
                      : "gray"
                }
                sub={
                  `Performance ${N(
                    riskShare(data.totalRiskPerformance),
                    1
                  )}% · Default ${N(
                    riskShare(data.totalDefaultRisk),
                    1
                  )}% · Reg. pending ${N(
                    riskShare(
                      data.totalRegulatoryRiskPendingValidation
                    ),
                    1
                  )}% · Reg. validated ${N(
                    riskShare(
                      data.totalRegulatoryRiskValidated
                    ),
                    1
                  )}%`
                }
              />

              <KPI
                label="Risk Performance"
                value={fM(
                  data.totalRiskPerformance
                )}
                color={
                  data.totalRiskPerformance > 0
                    ? "rose"
                    : data.totalRiskPerformance < 0
                      ? "emerald"
                      : "gray"
                }
                sub="Performance / MtM exposure"
              />

              <KPI
                label="Default Risk"
                value={fM(
                  data.totalDefaultRisk
                )}
                color={
                  data.totalDefaultRisk > 0
                    ? "rose"
                    : "gray"
                }
                sub="Paid but not credited exposure"
              />

              <KPI
                label="Reg. Risk — Pending Validation"
                value={fM(
                  data.totalRegulatoryRiskPendingValidation
                )}
                color={
                  data.totalRegulatoryRiskPendingValidation > 0
                    ? "amber"
                    : "gray"
                }
                sub="Credited CEE awaiting EMMY validation"
              />

              <KPI
                label="Reg. Risk — Validated"
                value={fM(
                  data.totalRegulatoryRiskValidated
                )}
                color={
                  data.totalRegulatoryRiskValidated > 0
                    ? "sky"
                    : "gray"
                }
                sub="Validated CEE with residual invalidation exposure"
              />
            </div>
          </div>

          {/* ======================================================
              2. STATUS RISK MATRIX
          ====================================================== */}
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "14px"
              }}
            >
              <div>
                <SectionTitle>
                  Risk by Contract Status
                </SectionTitle>

                <p
                  style={{
                    ...S,
                    fontSize: "11px",
                    color: THEME.textMuted,
                    lineHeight: 1.55,
                    marginTop: "-6px",
                    marginBottom: 0
                  }}
                >
                  Active contract status combinations based on EMMY crediting,
validation and payment status.
                </p>
              </div>

              <Badge color="gray">
                {visibleBuckets.length} active status
                {visibleBuckets.length > 1 ? "es" : ""}
              </Badge>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
                background: THEME.panelAlt,
                border: `1px solid ${THEME.borderSoft}`,
                borderRadius: "3px",
                padding: "10px",
                marginBottom: "12px"
              }}
            >
              <select
                value={riskFilters.status}
                onChange={event =>
                  updateRiskFilter(
                    "status",
                    event.target.value
                  )
                }
                style={{
                  ...riskFilterStyle,
                  flex: "2 1 280px",
                  minWidth: "250px"
                }}
              >
                <option value="ALL">
                  All contract statuses
                </option>

                {visibleBuckets.map(bucket => (
                  <option
                    key={bucket.key}
                    value={bucket.key}
                  >
                    {bucket.label}
                  </option>
                ))}
              </select>

              <select
                value={riskFilters.credited}
                onChange={event =>
                  updateRiskFilter(
                    "credited",
                    event.target.value
                  )
                }
                style={{
                  ...riskFilterStyle,
                  flex: "1 1 135px"
                }}
              >
                <option value="ALL">
                  Credited: All
                </option>
                <option value="true">
                  Credited: Yes
                </option>
                <option value="false">
                  Credited: No
                </option>
              </select>

              <select
                value={riskFilters.validated}
                onChange={event =>
                  updateRiskFilter(
                    "validated",
                    event.target.value
                  )
                }
                style={{
                  ...riskFilterStyle,
                  flex: "1 1 135px"
                }}
              >
                <option value="ALL">
                  Validated: All
                </option>
                <option value="true">
                  Validated: Yes
                </option>
                <option value="false">
                  Validated: No
                </option>
              </select>

              <select
                value={riskFilters.paid}
                onChange={event =>
                  updateRiskFilter(
                    "paid",
                    event.target.value
                  )
                }
                style={{
                  ...riskFilterStyle,
                  flex: "1 1 125px"
                }}
              >
                <option value="ALL">
                  Paid: All
                </option>
                <option value="true">
                  Paid: Yes
                </option>
                <option value="false">
                  Paid: No
                </option>
              </select>

              <select
                value={riskFilters.dominantRisk}
                onChange={event =>
                  updateRiskFilter(
                    "dominantRisk",
                    event.target.value
                  )
                }
                style={{
                  ...riskFilterStyle,
                  flex: "1 1 175px"
                }}
              >
                <option value="ALL">
                  Dominant risk: All
                </option>
                <option value="PERFORMANCE">
                  Performance risk
                </option>
                <option value="DEFAULT">
                  Default risk
                </option>
                <option value="REGULATORY_PENDING">
                  Regulatory — pending validation
                </option>
                <option value="REGULATORY_VALIDATED">
                  Regulatory — validated
                </option>
                <option value="NONE">
                  No material risk
                </option>
              </select>

              <button
                onClick={resetRiskFilters}
                disabled={!hasRiskFilters}
                style={{
                  ...S,
                  minHeight: "34px",
                  padding: "8px 12px",
                  background: "transparent",
                  color: hasRiskFilters
                    ? THEME.sky
                    : THEME.textMuted,
                  border: `1px solid ${
                    hasRiskFilters
                      ? "rgba(56, 189, 248, 0.35)"
                      : THEME.border
                  }`,
                  borderRadius: "2px",
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: hasRiskFilters
                    ? "pointer"
                    : "default",
                  opacity: hasRiskFilters ? 1 : 0.5
                }}
              >
                Reset filters
              </button>
            </div>

            <div
              style={{
                overflowX: "auto",
                border: `1px solid ${THEME.borderSoft}`,
                borderRadius: "3px"
              }}
            >
              <table
                style={{
                  width: "100%",
                  minWidth: "1080px",
                  borderCollapse: "collapse",
                  tableLayout: "fixed"
                }}
              >
                <colgroup>
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "8%" }} />
                </colgroup>

                <thead>
                  <tr>
                    <TH>Contract status</TH>
                    <TH>Contracts</TH>
                    <TH>Volume</TH>
                    <TH>Risk performance</TH>
                    <TH>Default risk</TH>
                    <TH>
                      <span style={{ lineHeight: 1.2 }}>
                        Reg. risk
                        <br />
                        pending validation
                      </span>
                    </TH>
                    <TH>
                      <span style={{ lineHeight: 1.2 }}>
                        Reg. risk
                        <br />
                        validated
                      </span>
                    </TH>
                    <TH>Total risk</TH>

                    <th
                      style={{
                        ...S,
                        position: "sticky",
                        right: 0,
                        zIndex: 4,
                        fontSize: "10px",
                        color: THEME.textLabel,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.09em",
                        padding: "9px 8px",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        background: THEME.tableHeader,
                        borderBottom: `1px solid ${THEME.border}`,
                        boxShadow:
                          "-8px 0 14px rgba(7, 11, 22, 0.22)"
                      }}
                    >
                      Details
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredBuckets.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        style={{
                          ...S,
                          padding: "30px 16px",
                          textAlign: "center",
                          color: THEME.textMuted,
                          background: THEME.panelAlt
                        }}
                      >
                        No active contract status matches the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredBuckets.map(
                      (bucket, index) => {
                        const hasContracts =
                          bucket.tradeCount > 0;

                        const rowBackground =
                          index % 2 === 0
                            ? THEME.panel
                            : THEME.panelAlt;

                        const accentColor =
                          hasContracts
                            ? riskColor(bucket.totalRisk)
                            : THEME.borderSoft;

                        return (
                          <tr
                            key={bucket.key}
                            style={{
                              background: rowBackground,
                              borderBottom:
                                `1px solid ${THEME.borderSoft}`,
                              opacity:
                                hasContracts ? 1 : 0.48
                            }}
                          >
                            <td
                              style={{
                                ...S,
                                padding: "12px 12px",
                                borderLeft:
                                  `3px solid ${accentColor}`,
                                verticalAlign: "middle"
                              }}
                            >
                              <div
                                style={{
                                  color:
                                    hasContracts
                                      ? THEME.textPrimary
                                      : THEME.textMuted,
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  lineHeight: 1.3
                                }}
                              >
                                {bucket.label}
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  gap: "5px",
                                  flexWrap: "wrap",
                                  marginTop: "7px"
                                }}
                              >
                                <Badge
                                  color={
                                    bucket.credited
                                      ? "green"
                                      : "gray"
                                  }
                                >
                                  C: {bucket.credited ? "Yes" : "No"}
                                </Badge>

                                <Badge
                                  color={
                                    bucket.validated
                                      ? "green"
                                      : "gray"
                                  }
                                >
                                  V: {bucket.validated ? "Yes" : "No"}
                                </Badge>

                                <Badge
                                  color={
                                    bucket.paid
                                      ? "green"
                                      : "gray"
                                  }
                                >
                                  P: {bucket.paid ? "Yes" : "No"}
                                </Badge>
                              </div>

                              <div
                                style={{
                                  marginTop: "7px",
                                  color:
                                    hasContracts
                                      ? accentColor
                                      : THEME.textMuted,
                                  fontSize: "9px",
                                  fontWeight: 500,
                                  letterSpacing: "0.02em"
                                }}
                              >
                                {dominantRiskLabel(bucket)}
                              </div>
                            </td>

                            <td
                              style={{
                                ...S,
                                padding: "12px 6px",
                                color: THEME.textSecondary,
                                fontWeight: 700,
                                textAlign: "center",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {N(bucket.tradeCount, 0)}
                            </td>

                            <td
                              style={{
                                ...S,
                                padding: "12px 7px",
                                color: THEME.textSecondary,
                                textAlign: "right",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {N(bucket.volume, 2)}
                              <span
                                style={{
                                  display: "block",
                                  fontSize: "8px",
                                  color: THEME.textMuted,
                                  marginTop: "2px"
                                }}
                              >
                                GWhc
                              </span>
                            </td>

                            <td
                              style={{
                                ...S,
                                padding: "12px 7px",
                                color: riskColor(
                                  bucket.riskPerformance
                                ),
                                fontWeight: 650,
                                textAlign: "right",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {fM(bucket.riskPerformance)}
                            </td>

                            <td
                              style={{
                                ...S,
                                padding: "12px 7px",
                                color:
                                  bucket.defaultRisk > 0
                                    ? THEME.red
                                    : THEME.textMuted,
                                fontWeight: 650,
                                textAlign: "right",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {fM(bucket.defaultRisk)}
                            </td>

                            <td
                              style={{
                                ...S,
                                padding: "12px 7px",
                                color:
                                  bucket.regulatoryRiskPendingValidation > 0
                                    ? THEME.amber
                                    : THEME.textMuted,
                                fontWeight: 650,
                                textAlign: "right",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {fM(
                                bucket.regulatoryRiskPendingValidation
                              )}
                            </td>

                            <td
                              style={{
                                ...S,
                                padding: "12px 7px",
                                color:
                                  bucket.regulatoryRiskValidated > 0
                                    ? THEME.sky
                                    : THEME.textMuted,
                                fontWeight: 650,
                                textAlign: "right",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {fM(
                                bucket.regulatoryRiskValidated
                              )}
                            </td>

                            <td
                              style={{
                                ...S,
                                padding: "12px 7px",
                                textAlign: "right",
                                whiteSpace: "nowrap"
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "flex-end",
                                  minWidth: "70px",
                                  padding: "5px 6px",
                                  borderRadius: "2px",
                                  color: riskColor(
                                    bucket.totalRisk
                                  ),
                                  background:
                                    bucket.totalRisk > 0
                                      ? "rgba(248, 113, 113, 0.09)"
                                      : bucket.totalRisk < 0
                                        ? "rgba(52, 211, 153, 0.09)"
                                        : "rgba(113, 135, 166, 0.08)",
                                  border:
                                    `1px solid ${
                                      bucket.totalRisk > 0
                                        ? "rgba(248, 113, 113, 0.22)"
                                        : bucket.totalRisk < 0
                                          ? "rgba(52, 211, 153, 0.22)"
                                          : THEME.borderSoft
                                    }`,
                                  fontWeight: 800
                                }}
                              >
                                {fM(bucket.totalRisk)}
                              </span>
                            </td>

                            <td
                              style={{
                                position: "sticky",
                                right: 0,
                                zIndex: 2,
                                padding: "12px 7px",
                                textAlign: "center",
                                background: rowBackground,
                                boxShadow:
                                  "-8px 0 14px rgba(7, 11, 22, 0.20)"
                              }}
                            >
                              {hasContracts ? (
                                <button
                                  onClick={() =>
                                    setSelectedRiskBucket(bucket)
                                  }
                                  style={{
                                    ...S,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "5px",
                                    width: "100%",
                                    maxWidth: "112px",
                                    background:
                                      "rgba(56, 189, 248, 0.08)",
                                    color: THEME.sky,
                                    border:
                                      "1px solid rgba(56, 189, 248, 0.28)",
                                    borderRadius: "2px",
                                    fontSize: "8px",
                                    fontWeight: 700,
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                    padding: "7px 6px",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap"
                                  }}
                                >
                                  <EyeIcon />
                                  View
                                </button>
                              ) : (
                                <span
                                  style={{
                                    ...S,
                                    color: THEME.textMuted,
                                    fontSize: "11px"
                                  }}
                                >
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      }
                    )
                  )}
                </tbody>

                <tfoot>
                  <tr
                    style={{
                      background: THEME.tableHeader,
                      borderTop: `1px solid ${THEME.border}`
                    }}
                  >
                    <td
                      style={{
                        ...S,
                        padding: "13px 12px",
                        color: THEME.sky,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        borderLeft: `3px solid ${THEME.sky}`,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {hasRiskFilters
                        ? `Filtered ${title} ${scopeLabel}`
                        : `Total ${title} ${scopeLabel}`}
                    </td>

                    <td
                      style={{
                        ...S,
                        padding: "13px 6px",
                        color: THEME.textPrimary,
                        fontWeight: 700,
                        textAlign: "center"
                      }}
                    >
                      {N(filteredTotals.tradeCount, 0)}
                    </td>

                    <td
                      style={{
                        ...S,
                        padding: "13px 7px",
                        color: THEME.textPrimary,
                        fontWeight: 700,
                        textAlign: "right",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {N(filteredTotals.volume, 2)} GWhc
                    </td>

                    <td
                      style={{
                        ...S,
                        padding: "13px 7px",
                        color: riskColor(
                          filteredTotals.riskPerformance
                        ),
                        fontWeight: 700,
                        textAlign: "right",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {fM(filteredTotals.riskPerformance)}
                    </td>

                    <td
                      style={{
                        ...S,
                        padding: "13px 7px",
                        color:
                          filteredTotals.defaultRisk > 0
                            ? THEME.red
                            : THEME.textMuted,
                        fontWeight: 700,
                        textAlign: "right",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {fM(filteredTotals.defaultRisk)}
                    </td>

                    <td
                      style={{
                        ...S,
                        padding: "13px 7px",
                        color:
                          filteredTotals.regulatoryRiskPendingValidation > 0
                            ? THEME.amber
                            : THEME.textMuted,
                        fontWeight: 700,
                        textAlign: "right",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {fM(
                        filteredTotals.regulatoryRiskPendingValidation
                      )}
                    </td>

                    <td
                      style={{
                        ...S,
                        padding: "13px 7px",
                        color:
                          filteredTotals.regulatoryRiskValidated > 0
                            ? THEME.sky
                            : THEME.textMuted,
                        fontWeight: 700,
                        textAlign: "right",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {fM(
                        filteredTotals.regulatoryRiskValidated
                      )}
                    </td>

                    <td
                      style={{
                        ...S,
                        padding: "13px 7px",
                        color: riskColor(
                          filteredTotals.totalRisk
                        ),
                        fontWeight: 800,
                        textAlign: "right",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {fM(filteredTotals.totalRisk)}
                    </td>

                    <td
                      style={{
                        position: "sticky",
                        right: 0,
                        zIndex: 3,
                        background: THEME.tableHeader,
                        boxShadow:
                          "-8px 0 14px rgba(7, 11, 22, 0.22)"
                      }}
                    />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ======================================================
              3. RISK DISTRIBUTION BY STATUS CATEGORY
          ====================================================== */}
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "14px"
              }}
            >
              <div>
                <SectionTitle>
                  Risk Profile by Contract Status
                </SectionTitle>

                <p
                  style={{
                    ...S,
                    fontSize: "11px",
                    color: THEME.textMuted,
                    lineHeight: 1.55,
                    marginTop: "-6px",
                    marginBottom: 0
                  }}
                >
                  Distribution of the four risk components across active
                  contract-status categories. Negative performance extends
                  to the left as a green mitigating contribution.
                </p>
              </div>

              <Badge color="gray">
                {statusRiskChartData.length} active status
                {statusRiskChartData.length > 1 ? "es" : ""}
              </Badge>
            </div>

            {statusRiskChartData.length === 0 ? (
              <div
                style={{
                  ...S,
                  height: "240px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: THEME.textMuted
                }}
              >
                No active contract status matches the filters.
              </div>
            ) : (
              <ResponsiveContainer
                width="100%"
                height={Math.max(
                  280,
                  statusRiskChartData.length * 58
                )}
              >
                <BarChart
                  data={statusRiskChartData}
                  layout="vertical"
                  stackOffset="sign"
                  barSize={22}
                  margin={{
                    top: 14,
                    right: 28,
                    left: 28,
                    bottom: 12
                  }}
                >
                  <CartesianGrid
                    strokeDasharray="3 6"
                    stroke={THEME.chartGrid}
                    horizontal={false}
                  />

                  <XAxis
                    type="number"
                    tick={{
                      ...S,
                      fontSize: 9,
                      fill: THEME.chartAxis
                    }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={value =>
                      `${N(value / 1000000, 1)} M`
                    }
                  />

                  <YAxis
                    type="category"
                    dataKey="status"
                    width={245}
                    tick={{
                      ...S,
                      fontSize: 9,
                      fill: THEME.textSecondary
                    }}
                    axisLine={false}
                    tickLine={false}
                  />

                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    content={<StatusRiskTooltip />}
                  />

                  <Legend
                    iconSize={9}
                    wrapperStyle={{
                      ...S,
                      fontSize: "10px",
                      color: THEME.textSecondary
                    }}
                  />

                  <ReferenceLine
                    x={0}
                    stroke={THEME.chartGrid}
                  />

                  <Bar
                    dataKey="riskPerformanceNegative"
                    name="Risk Performance — Risk Offset"
                    stackId="risk"
                    fill={riskComponentColors.performanceNegative}
                    radius={[2, 0, 0, 2]}
                  />

                  <Bar
                    dataKey="riskPerformancePositive"
                    name="Risk Performance — Exposure"
                    stackId="risk"
                    fill={riskComponentColors.performancePositive}
                  />

                  <Bar
                    dataKey="defaultRisk"
                    name="Default Risk"
                    stackId="risk"
                    fill={riskComponentColors.defaultRisk}
                  />

                  <Bar
                    dataKey="regulatoryPending"
                    name="Regulatory — Pending Validation"
                    stackId="risk"
                    fill={riskComponentColors.regulatoryPending}
                  />

                  <Bar
                    dataKey="regulatoryValidated"
                    name="Regulatory — Validated"
                    stackId="risk"
                    fill={riskComponentColors.regulatoryValidated}
                    radius={[0, 2, 2, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}

            <div
              style={{
                borderTop: `1px solid ${THEME.borderSoft}`,
                marginTop: "18px",
                paddingTop: "18px"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "14px",
                  flexWrap: "wrap",
                  marginBottom: "10px"
                }}
              >
                <div>
                  <SectionTitle>
                    Portfolio Volume Distribution by Status
                  </SectionTitle>

                  <p
                    style={{
                      ...S,
                      fontSize: "10px",
                      color: THEME.textMuted,
                      lineHeight: 1.5,
                      marginTop: "-6px",
                      marginBottom: 0
                    }}
                  >
                    Volume share by active contract-status category. The
                    donut follows the current filters, while the legend also
                    reports each category's share of the full portfolio.
                  </p>
                </div>

                <Badge color="gray">
                  {N(selectedCategoryVolume, 2)} GWhc displayed
                </Badge>
              </div>

              {portfolioVolumeChartData.length === 0 ? (
                <div
                  style={{
                    ...S,
                    height: "210px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: THEME.textMuted
                  }}
                >
                  No volume matches the selected filters.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(250px, 0.8fr) minmax(360px, 1.2fr)",
                    gap: "18px",
                    alignItems: "center"
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      minHeight: "240px"
                    }}
                  >
                    <ResponsiveContainer
                      width="100%"
                      height={240}
                    >
                      <PieChart>
                        <Pie
                          data={portfolioVolumeChartData}
                          dataKey="volume"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={88}
                          paddingAngle={2}
                          stroke={THEME.panel}
                          strokeWidth={2}
                        >
                          {portfolioVolumeChartData.map(
                            category => (
                              <Cell
                                key={category.key}
                                fill={category.color}
                              />
                            )
                          )}
                        </Pie>

                        <Tooltip
                          content={<VolumeShareTooltip />}
                        />
                      </PieChart>
                    </ResponsiveContainer>

                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none"
                      }}
                    >
                      <span
                        style={{
                          ...S,
                          fontSize: "9px",
                          color: THEME.textMuted,
                          textTransform: "uppercase",
                          letterSpacing: "0.1em"
                        }}
                      >
                        Displayed volume
                      </span>

                      <span
                        style={{
                          ...CG,
                          fontSize: "17px",
                          color: THEME.textPrimary,
                          fontWeight: 800,
                          marginTop: "3px"
                        }}
                      >
                        {N(selectedCategoryVolume, 0)} GWhc
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "7px"
                    }}
                  >
                    {portfolioVolumeChartData.map(
                      category => (
                        <div
                          key={category.key}
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "10px minmax(190px, 1fr) auto auto",
                            alignItems: "center",
                            gap: "8px",
                            padding: "8px 9px",
                            background: THEME.panelAlt,
                            border:
                              `1px solid ${THEME.borderSoft}`,
                            borderRadius: "2px"
                          }}
                        >
                          <span
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "1px",
                              background: category.color
                            }}
                          />

                          <span
                            style={{
                              ...S,
                              fontSize: "9px",
                              color: THEME.textSecondary,
                              fontWeight: 600,
                              lineHeight: 1.3
                            }}
                          >
                            {category.label}
                          </span>

                          <span
                            style={{
                              ...S,
                              fontSize: "9px",
                              color: category.color,
                              fontWeight: 800,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {N(category.selectionPct, 1)}%
                          </span>

                          <span
                            style={{
                              ...S,
                              minWidth: "105px",
                              fontSize: "9px",
                              color: THEME.textMuted,
                              textAlign: "right",
                              whiteSpace: "nowrap"
                            }}
                          >
                            {N(category.volume, 2)} GWhc
                            {" · "}
                            {N(category.portfolioPct, 1)}% portfolio
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ======================================================
            4. SELECTED CATEGORY DETAIL MODAL
        ====================================================== */}
        {selectedRiskBucket && (
          <Modal
            title={`${title} — ${selectedRiskBucket.label}`}
            onClose={() =>
              setSelectedRiskBucket(null)
            }
            wide
          >
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                marginBottom: "16px"
              }}
            >
              <Badge
                color={statusBadgeColor(
                  selectedRiskBucket.credited
                )}
              >
                Credited:{" "}
                {selectedRiskBucket.credited
                  ? "Yes"
                  : "No"}
              </Badge>

              <Badge
                color={statusBadgeColor(
                  selectedRiskBucket.validated
                )}
              >
                Validated:{" "}
                {selectedRiskBucket.validated
                  ? "Yes"
                  : "No"}
              </Badge>

              <Badge
                color={statusBadgeColor(
                  selectedRiskBucket.paid
                )}
              >
                Paid:{" "}
                {selectedRiskBucket.paid
                  ? "Yes"
                  : "No"}
              </Badge>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(6, minmax(110px, 1fr))",
                gap: "8px",
                marginBottom: "18px"
              }}
            >
              <KPI
                label="Volume"
                value={`${N(
                  selectedRiskBucket.volume,
                  2
                )} GWhc`}
                color="sky"
                sub={`${selectedRiskBucket.tradeCount} contracts`}
              />

              <KPI
                label="Risk Performance"
                value={fM(
                  selectedRiskBucket.riskPerformance
                )}
                color={
                  selectedRiskBucket.riskPerformance > 0
                    ? "rose"
                    : selectedRiskBucket.riskPerformance < 0
                      ? "emerald"
                      : "gray"
                }
              />

              <KPI
                label="Default Risk"
                value={fM(
                  selectedRiskBucket.defaultRisk
                )}
                color={
                  selectedRiskBucket.defaultRisk > 0
                    ? "rose"
                    : "gray"
                }
              />

              <KPI
                label="Reg. Risk — Pending"
                value={fM(
                  selectedRiskBucket.regulatoryRiskPendingValidation
                )}
                color={
                  selectedRiskBucket.regulatoryRiskPendingValidation > 0
                    ? "amber"
                    : "gray"
                }
              />

              <KPI
                label="Reg. Risk — Validated"
                value={fM(
                  selectedRiskBucket.regulatoryRiskValidated
                )}
                color={
                  selectedRiskBucket.regulatoryRiskValidated > 0
                    ? "sky"
                    : "gray"
                }
              />

              <KPI
                label="Total Risk"
                value={fM(
                  selectedRiskBucket.totalRisk
                )}
                color={
                  selectedRiskBucket.totalRisk > 0
                    ? "rose"
                    : selectedRiskBucket.totalRisk < 0
                      ? "emerald"
                      : "gray"
                }
              />
            </div>

            <div
              style={{
                background: THEME.panelAlt,
                border: `1px solid ${THEME.borderSoft}`,
                borderRadius: "3px",
                padding: "16px",
                marginBottom: "18px"
              }}
            >
              <SectionTitle>
                Risk Distribution within this Category
              </SectionTitle>

              <p
                style={{
                  ...S,
                  fontSize: "10px",
                  color: THEME.textMuted,
                  lineHeight: 1.5,
                  marginTop: "-6px",
                  marginBottom: "14px"
                }}
              >
                Relative composition of the selected status category.
                Segment sizes use absolute magnitudes; signed amounts remain
                visible in the legend and tooltip.
              </p>

              {detailRiskDistributionData.length === 0 ? (
                <div
                  style={{
                    ...S,
                    height: "220px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: THEME.textMuted
                  }}
                >
                  No material risk in this category.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(270px, 0.9fr) minmax(300px, 1.1fr)",
                    gap: "18px",
                    alignItems: "center"
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      minHeight: "270px"
                    }}
                  >
                    <ResponsiveContainer
                      width="100%"
                      height={270}
                    >
                      <PieChart>
                        <Pie
                          data={detailRiskDistributionData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={65}
                          outerRadius={100}
                          paddingAngle={3}
                          stroke={THEME.panelAlt}
                          strokeWidth={2}
                        >
                          {detailRiskDistributionData.map(
                            component => (
                              <Cell
                                key={component.key}
                                fill={component.color}
                              />
                            )
                          )}
                        </Pie>

                        <Tooltip
                          content={<DetailRiskTooltip />}
                        />
                      </PieChart>
                    </ResponsiveContainer>

                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none"
                      }}
                    >
                      <span
                        style={{
                          ...S,
                          fontSize: "9px",
                          color: THEME.textMuted,
                          textTransform: "uppercase",
                          letterSpacing: "0.1em"
                        }}
                      >
                        Total Risk
                      </span>

                      <span
                        style={{
                          ...CG,
                          fontSize: "20px",
                          color: riskColor(
                            selectedRiskBucket.totalRisk
                          ),
                          fontWeight: 800,
                          marginTop: "3px"
                        }}
                      >
                        {fM(selectedRiskBucket.totalRisk)}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px"
                    }}
                  >
                    {detailRiskDistributionData.map(
                      component => {
                        const share =
                          detailRiskMagnitude > 0
                            ? component.value /
                              detailRiskMagnitude * 100
                            : 0;

                        return (
                          <div
                            key={component.key}
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "10px minmax(150px, 1fr) auto auto",
                              alignItems: "center",
                              gap: "9px",
                              padding: "9px 10px",
                              background: THEME.panel,
                              border:
                                `1px solid ${THEME.borderSoft}`,
                              borderRadius: "2px"
                            }}
                          >
                            <span
                              style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "1px",
                                background: component.color
                              }}
                            />

                            <span
                              style={{
                                ...S,
                                fontSize: "10px",
                                color: THEME.textSecondary,
                                fontWeight: 600
                              }}
                            >
                              {component.name}
                            </span>

                            <span
                              style={{
                                ...S,
                                fontSize: "10px",
                                color: component.color,
                                fontWeight: 800,
                                whiteSpace: "nowrap"
                              }}
                            >
                              {fM(component.signedValue)}
                            </span>

                            <span
                              style={{
                                ...S,
                                minWidth: "46px",
                                fontSize: "9px",
                                color: THEME.textMuted,
                                textAlign: "right",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {N(share, 1)}%
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <SectionTitle>
                Contracts Included
              </SectionTitle>

              <div
                style={{
                  overflowX: "auto",
                  maxHeight: "390px",
                  overflowY: "auto",
                  border:
                    `1px solid ${THEME.borderSoft}`
                }}
              >
                <table
                  style={{
                    width: "100%",
                    minWidth: "1500px",
                    borderCollapse: "collapse"
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "Counterparty",
                        "Rating",
                        "Month",
                        "Volume",
                        "Credit allocation",
                        "Price",
                        "Risk performance",
                        "Default risk",
                        "Reg. risk — pending validation",
                        "Reg. risk — validated",
                        "Total risk"
                      ].map(header => (
                        <TH key={header}>
                          {header}
                        </TH>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {selectedRiskBucket.contracts.map(
                      contract => (
                        <tr
                          key={contract.id}
                          style={{
                            borderBottom:
                              `1px solid ${THEME.borderSoft}`
                          }}
                        >
                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color:
                                THEME.textPrimary,
                              fontWeight: 600
                            }}
                          >
                            {contract.vendor}
                          </td>

                          <td
                            style={{
                              padding: "10px 14px"
                            }}
                          >
                            <Badge
                              color={
                                contract.rating === "AAA"
                                  ? "green"
                                  : contract.rating === "N/A"
                                    ? "gray"
                                    : "amber"
                              }
                            >
                              {contract.rating}
                            </Badge>
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color:
                                THEME.textMuted,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {contract.month
                              ? ML(contract.month)
                              : "—"}
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color:
                                THEME.textSecondary,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {N(
                              contract.volume,
                              2
                            )} GWhc
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              whiteSpace: "nowrap"
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: "4px"
                              }}
                            >
                              <Badge
                                color={
                                  contract.credited
                                    ? "green"
                                    : contract.creditedVolume > 0.01
                                      ? "amber"
                                      : "gray"
                                }
                              >
                                {contract.credited
                                  ? "Fully credited"
                                  : contract.creditedVolume > 0.01
                                    ? "Partially credited"
                                    : "Not credited"}
                              </Badge>

                              <span
                                style={{
                                  fontSize: "9px",
                                  color: THEME.textMuted
                                }}
                              >
                                {N(contract.creditedPct, 1)}% credited
                                {" · "}
                                {N(contract.uncreditedVolume, 2)} GWhc remaining
                              </span>
                            </div>
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color:
                                THEME.textSecondary,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {N(
                              contract.price,
                              0
                            )} €/GWhc
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color: riskColor(
                                contract.riskPerformance
                              ),
                              fontWeight: 600,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {fM(
                              contract.riskPerformance
                            )}
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color:
                                contract.defaultRisk > 0
                                  ? THEME.red
                                  : THEME.textMuted,
                              fontWeight: 600,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {fM(
                              contract.defaultRisk
                            )}
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color:
                                contract.regulatoryRiskPendingValidation > 0
                                  ? THEME.amber
                                  : THEME.textMuted,
                              fontWeight: 600,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {fM(
                              contract.regulatoryRiskPendingValidation
                            )}
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color:
                                contract.regulatoryRiskValidated > 0
                                  ? THEME.sky
                                  : THEME.textMuted,
                              fontWeight: 600,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {fM(
                              contract.regulatoryRiskValidated
                            )}
                          </td>

                          <td
                            style={{
                              ...S,
                              padding: "10px 14px",
                              color: riskColor(
                                contract.totalRisk
                              ),
                              fontWeight: 800,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {fM(
                              contract.totalRisk
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Modal>
        )}
      </>
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
              fontWeight: report === r.id ? 600 : 500,
              padding: "8px 14px",
              borderRadius: "2px",
              border: "1px solid",
              cursor: "pointer",
              letterSpacing: "0.08em",
              textTransform: "uppercase",

              background:
                report === r.id
                  ? THEME.sky
                  : THEME.panelAlt,

              color:
                report === r.id
                  ? "var(--theme-selected-text)"
                  : THEME.controlText,

              borderColor:
                report === r.id
                  ? THEME.sky
                  : THEME.border,

              transition:
                "color 0.2s ease, border-color 0.2s ease, background 0.2s ease"
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── EXECUTIVE SUMMARY ── */}
      {report === "executive" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "22px 26px" }}>
            <p
              style={{
                ...S,
                fontSize: "10px",
                color: THEME.sectionTitle,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                marginBottom: "5px"
              }}
            >
              CEE Management Report — P6
            </p>

            <h2
              style={{
                ...CG,
                fontSize: "28px",
                fontWeight: 700,
                color: THEME.textPrimary,
                marginBottom: "3px"
              }}
            >
              Executive Dashboard
            </h2>

            <p
              style={{
                ...S,
                fontSize: "11px",
                color: THEME.textMuted,
                fontWeight: 500,
                marginTop: "3px"
              }}
            >
              As of {displayDate || "Loading…"} · Reference period: 2026 (P6)
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
            <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
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
                    <Cell fill="var(--theme-green)" />
                    <Cell fill="var(--theme-red)" />
                    <Cell fill="var(--theme-amber)" />
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ ...S, fontSize: "10px", color: "var(--theme-text-secondary)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
              <SectionTitle>Monthly Net Position (GWhc) — Priced</SectionTitle>

              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barSize={18}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                  <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTip />} />
                  <ReferenceLine y={0} stroke="var(--theme-border-soft)" />
                  <Bar dataKey="netPos" name="Net position" fill="var(--theme-blue)" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>Monthly Realized PnL (k€) + Cumulative</SectionTitle>

            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cumPnlData} barSize={20}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} width={44} />
                <YAxis yAxisId="right" orientation="right" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<ChartTip />} />
                <ReferenceLine yAxisId="left" y={0} stroke="var(--theme-border-soft)" />
                <Bar yAxisId="left" dataKey="pnl" name="Monthly PnL (k€)" fill="var(--theme-green)" radius={[1, 1, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumPnl" name="Cumulative PnL (k€)" stroke="var(--theme-sky)" strokeWidth={2} dot={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>Purchases by Seller (GWhc)</SectionTitle>

            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={vendorData} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" horizontal={false} />
                <XAxis type="number" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} width={170} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="vol" name="Volume (GWhc)" fill="var(--theme-sky)" radius={[0, 1, 1, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── POSITION & COVERAGE ── */}
{report === "position" && (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "20px"
    }}
  >
    {/* ======================================================
        OBLIGATIONS VS PURCHASES
    ====================================================== */}
    <div
      style={{
        background: THEME.panel,
        border: `1px solid ${THEME.borderSoft}`,
        borderRadius: "3px",
        padding: "20px 22px"
      }}
    >
      <SectionTitle>
        Obligation vs Purchases by Month (GWhc)
      </SectionTitle>

      <ResponsiveContainer width="100%" height={350}>
        <BarChart
          data={monthlyData}
          barGap={8}
          barCategoryGap="26%"
          margin={{
            top: 8,
            right: 20,
            left: 4,
            bottom: 8
          }}
        >
          <CartesianGrid
            strokeDasharray="3 6"
            stroke={THEME.chartGrid}
            vertical={false}
            opacity={0.8}
          />

          <XAxis
            dataKey="month"
            tick={{
              ...S,
              fontSize: 11,
              fontWeight: 500,
              fill: THEME.chartAxis
            }}
            axisLine={false}
            tickLine={false}
            dy={6}
          />

          <YAxis
            tick={{
              ...S,
              fontSize: 11,
              fill: THEME.chartAxis
            }}
            axisLine={false}
            tickLine={false}
            width={54}
            tickFormatter={value => N(value, 0)}
          />

          <Tooltip content={<ChartTip />} />

          <Legend
            verticalAlign="top"
            align="center"
            iconSize={10}
            iconType="square"
            height={42}
            wrapperStyle={{
              ...S,
              fontSize: "11px",
              color: THEME.textSecondary,
              paddingBottom: "12px"
            }}
          />

          {/* Obligations — muted colors */}
          <Bar
            dataKey="oblClP"
            name="Classique Obligation"
            fill="#59748f"
            stackId="obl"
            radius={[2, 2, 0, 0]}
            maxBarSize={36}
          />

          <Bar
            dataKey="oblPrP"
            name="Précarité Obligation"
            fill="#8c7131"
            stackId="obl"
            radius={[2, 2, 0, 0]}
            maxBarSize={36}
          />

          {/* Purchases — brighter colors */}
          <Bar
            dataKey="bClP"
            name="Priced Purchases CL"
            fill="#4f7cff"
            stackId="buy"
            radius={[2, 2, 0, 0]}
            maxBarSize={36}
          />

          <Bar
            dataKey="bPrP"
            name="Priced Purchases PR"
            fill="#e0b84f"
            stackId="buy"
            radius={[2, 2, 0, 0]}
            maxBarSize={36}
          />
        </BarChart>
      </ResponsiveContainer>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "22px",
          flexWrap: "wrap",
          marginTop: "4px"
        }}
      >
        <span
          style={{
            ...S,
            fontSize: "10px",
            color: THEME.textSecondary
          }}
        >
          Muted bars: priced obligations
        </span>

        <span
          style={{
            ...S,
            fontSize: "10px",
            color: THEME.textSecondary
          }}
        >
          Bright bars: priced purchases
        </span>
      </div>
    </div>

    {/* ======================================================
        MONTHLY COVERAGE TABLE
    ====================================================== */}
    <div
      style={{
        background: THEME.panel,
        border: `1px solid ${THEME.borderSoft}`,
        borderRadius: "3px",
        padding: "20px 22px"
      }}
    >
      <SectionTitle>
        Priced Coverage Control — Monthly Detail
      </SectionTitle>

      <div
        style={{
          overflowX: "auto",
          border: `1px solid ${THEME.borderSoft}`,
          borderRadius: "2px"
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: "900px"
          }}
        >
          <thead>
            <tr>
              {[
                "Month",
                "Priced Obligation",
                "Priced Purchases",
                "Net Position",
                "Coverage",
                "Status"
              ].map(header => (
                <TH key={header}>{header}</TH>
              ))}
            </tr>
          </thead>

          <tbody>
            {monthlyData
              .filter(
                row =>
                  row.oblClP +
                    row.oblPrP +
                    row.bClP +
                    row.bPrP >
                  0
              )
              .map((row, index) => {
                const obligation =
                  row.oblClP + row.oblPrP;

                const purchased =
                  row.bClP + row.bPrP;

                const net = row.netPos;
                const coverage = row.covPct;

                let status = {
                  label: "N/A",
                  color: "gray"
                };

                if (obligation > 0) {
                  if (coverage >= 150) {
                    status = {
                      label: "Overcovered",
                      color: "sky"
                    };
                  } else if (coverage >= 100) {
                    status = {
                      label: "OK",
                      color: "green"
                    };
                  } else if (coverage >= 80) {
                    status = {
                      label: "Watch",
                      color: "amber"
                    };
                  } else {
                    status = {
                      label: "Undercovered",
                      color: "red"
                    };
                  }
                }

                const rowBackground =
                  index % 2 === 0
                    ? THEME.panel
                    : THEME.panelAlt;

                return (
                  <tr
                    key={row.month}
                    style={{
                      background: rowBackground,
                      borderBottom: `1px solid ${THEME.borderSoft}`
                    }}
                    onMouseEnter={event => {
                      event.currentTarget.style.background =
                        "var(--theme-hover)";
                    }}
                    onMouseLeave={event => {
                      event.currentTarget.style.background =
                        rowBackground;
                    }}
                  >
                    <td
                      style={{
                        ...CG,
                        fontSize: "12px",
                        color: THEME.textPrimary,
                        padding: "11px 14px",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {row.month}
                    </td>

                    <td
                      style={{
                        ...S,
                        fontSize: "12px",
                        color: THEME.textSecondary,
                        padding: "11px 14px"
                      }}
                    >
                      {N(obligation, 0)} GWhc
                    </td>

                    <td
                      style={{
                        ...S,
                        fontSize: "12px",
                        color: THEME.textPrimary,
                        padding: "11px 14px",
                        fontWeight: 500
                      }}
                    >
                      {N(purchased, 0)} GWhc
                    </td>

                    <td
                      style={{
                        ...S,
                        fontSize: "12px",
                        padding: "11px 14px",
                        color:
                          net >= 0
                            ? THEME.green
                            : THEME.red,
                        fontWeight: 600
                      }}
                    >
                      {net >= 0 ? "+" : ""}
                      {N(net, 0)} GWhc
                    </td>

                    <td
                      style={{
                        ...S,
                        fontSize: "12px",
                        color: THEME.sky,
                        padding: "11px 14px",
                        fontWeight: 600
                      }}
                    >
                      {coverage == null
                        ? "—"
                        : coverage > 150
                          ? ">150%"
                          : `${N(coverage, 0)}%`}
                    </td>

                    <td
                      style={{
                        padding: "11px 14px"
                      }}
                    >
                      <Badge color={status.color}>
                        {status.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>

    {/* ======================================================
        UNPRICED OBLIGATIONS
    ====================================================== */}
    <div
      style={{
        background: THEME.panel,
        border: `1px solid ${THEME.borderSoft}`,
        borderRadius: "3px",
        padding: "20px 22px"
      }}
    >
      <SectionTitle>
        Unpriced Obligation (Forward) — GWhc to Cover
      </SectionTitle>

      <ResponsiveContainer width="100%" height={250}>
        <BarChart
          data={monthlyData.map(row => ({
            ...row,
            unpriced:
              row.oblCl +
              row.oblPr -
              row.oblClP -
              row.oblPrP
          }))}
          barCategoryGap="38%"
          margin={{
            top: 8,
            right: 20,
            left: 4,
            bottom: 8
          }}
        >
          <CartesianGrid
            strokeDasharray="3 6"
            stroke={THEME.chartGrid}
            vertical={false}
            opacity={0.8}
          />

          <XAxis
            dataKey="month"
            tick={{
              ...S,
              fontSize: 11,
              fontWeight: 500,
              fill: THEME.chartAxis
            }}
            axisLine={false}
            tickLine={false}
            dy={6}
          />

          <YAxis
            tick={{
              ...S,
              fontSize: 11,
              fill: THEME.chartAxis
            }}
            axisLine={false}
            tickLine={false}
            width={54}
            tickFormatter={value => N(value, 0)}
          />

          <Tooltip content={<ChartTip />} />

          <ReferenceLine
            y={0}
            stroke={THEME.chartGrid}
          />

          <Bar
            dataKey="unpriced"
            name="Unpriced Obligation"
            fill={THEME.red}
            fillOpacity={0.9}
            radius={[2, 2, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
)}

      {/* ── PNL & MTM ── */}
      {report === "pnl" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
              <SectionTitle>Monthly Realized PnL by Type (k€)</SectionTitle>

              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} barGap={3}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                  <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTip />} />
                  <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "var(--theme-text-secondary)" }} />
                  <ReferenceLine y={0} stroke="var(--theme-border-soft)" />
                  <Bar dataKey="pnlCl" name="Realized PnL Classique (k€)" fill="var(--theme-blue)" radius={[1, 1, 0, 0]} />
                  <Bar dataKey="pnlPr" name="Realized PnL Précarité (k€)" fill="var(--theme-amber)" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
              <SectionTitle>Open Position MtM by Month (k€)</SectionTitle>

              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} barGap={3}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                  <XAxis dataKey="month" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTip />} />
                  <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "var(--theme-text-secondary)" }} />
                  <ReferenceLine y={0} stroke="var(--theme-border-soft)" />
                  <Bar dataKey="mtmCl" name="MtM Classique (k€)" fill="var(--theme-sky)" radius={[1, 1, 0, 0]} />
                  <Bar dataKey="mtmPr" name="MtM Précarité (k€)" fill="var(--theme-orange)" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
            <SectionTitle>YTD PnL Bridge — Realized to Net PnL + MtM (k€)</SectionTitle>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={pnlBridgeData} barSize={46}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                <XAxis dataKey="name" tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} />
                <YAxis tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<ChartTip />} />
                <ReferenceLine y={0} stroke="var(--theme-border-soft)" />
                <Bar dataKey="value" name="Contribution (k€)" radius={[1, 1, 0, 0]}>
                  {pnlBridgeData.map((entry) => (
                    <Cell
                      key={`bridge-cell-${entry.name}`}
                      fill={
                        entry.name === "Net Total"
                          ? "var(--theme-green)"
                          : entry.value >= 0
                            ? "var(--theme-sky)"
                            : "var(--theme-red)"
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
                  background: "var(--theme-panel-alt)",
                  border: "1px solid var(--theme-border-soft)",
                  borderRadius: "2px",
                  padding: "10px 12px"
                }}>
                  <p style={{
                    ...S,
                    fontSize: "8px",
                    color: "var(--theme-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "4px"
                  }}>
                    {d.name}
                  </p>

                  <p style={{
                    ...CG,
                    fontSize: "17px",
                    color: d.value >= 0 ? "var(--theme-green)" : "var(--theme-red)",
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
            background:"var(--theme-panel)",
            border:"1px solid var(--theme-border-soft)",
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
                color:"var(--theme-sky)",
                textTransform:"uppercase",
                letterSpacing:"0.18em",
                marginBottom:"6px"
              }}>
                Regulatory & Performance Risk
              </p>

              <p style={{ ...S, fontSize:"11px", color:"var(--theme-text-secondary)", lineHeight:1.5 }}>
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
                  background: regulatoryType === "CLASSIQUE" ? "var(--theme-sky)" : "transparent",
                  color: regulatoryType === "CLASSIQUE" ? THEME.selectedText : "var(--theme-text-muted)",
                  borderColor: regulatoryType === "CLASSIQUE" ? "var(--theme-sky)" : "var(--theme-border-soft)"
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
                  background: regulatoryType === "PRECARITE" ? "var(--theme-amber)" : "transparent",
                  color: regulatoryType === "PRECARITE" ? THEME.selectedText : "var(--theme-text-muted)",
                  borderColor: regulatoryType === "PRECARITE" ? "var(--theme-amber)" : "var(--theme-border-soft)"
                }}
              >
                Précarité
              </button>
            </div>
          </div>

          <RegulatoryBlock
            title={activeRegulatoryTitle}
            data={activeRiskMatrixData}
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
      color: v > 0 ? CHART_COLORS.green : v < 0 ? CHART_COLORS.red : "var(--theme-text-muted)",
      fontWeight: v !== 0 ? 600 : 400
    }}>
      {v > 0 ? "+" : ""}{N(v, 2)}
    </span>
  ) : "—";

  const pk = (v) => v != null ? (
    <span style={{
      ...S,
      fontSize: "12px",
      color: v > 0 ? CHART_COLORS.green : v < 0 ? CHART_COLORS.red : "var(--theme-text-muted)",
      fontWeight: v !== 0 ? 600 : 400
    }}>
      {fK(v)}
    </span>
  ) : "—";

  const zeroDash = (
    <span style={{ ...S, fontSize: "10px", color: "var(--theme-border-soft)" }}>—</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "14px", borderBottom: "1px solid var(--theme-border)" }}>
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
              color: view === v.id ? "var(--theme-sky)" : "var(--theme-text-muted)",
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

      <div style={{ overflowX: "auto", border: "1px solid var(--theme-border-soft)", borderRadius: "2px" }}>
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
              const bg = i % 2 === 0 ? "var(--theme-panel)" : "var(--theme-row-alt)";
              const isForecast = r.month > "2026-05";

              return (
                <tr
                  key={r.month}
                  style={{ borderBottom: "1px solid var(--theme-border-soft)", background: bg }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--theme-panel-alt)"}
                  onMouseLeave={e => e.currentTarget.style.background = bg}
                >
                  <td style={{ ...CG, fontSize: "15px", color: "var(--theme-text-primary)", padding: "9px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {ML(r.month)}
                    {isForecast && <span style={{ ...S, fontSize: "8px", color: "var(--theme-border-soft)", marginLeft: "6px" }}>FCST</span>}
                  </td>

                  {view === "position" && (
                    <>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-blue)", padding: "9px 14px" }}>{N(r.oblClT, 2)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-amber)", padding: "9px 14px" }}>{N(r.oblPrT, 2)}</td>
                      <td style={{ ...S, fontSize: "12px", color: r.bCl > 0 ? "var(--theme-text-primary)" : "var(--theme-text-disabled)", padding: "9px 14px" }}>{N(r.bCl, 2)}</td>
                      <td style={{ ...S, fontSize: "12px", color: r.bPr > 0 ? "var(--theme-text-primary)" : "var(--theme-text-disabled)", padding: "9px 14px" }}>{N(r.bPr, 2)}</td>
                      <td style={{ padding: "9px 14px" }}>{pc(r.netCl)}</td>
                      <td style={{ padding: "9px 14px" }}>{pc(r.netPr)}</td>
                      <td style={{ padding: "9px 14px", minWidth: "120px" }}>
                        {r.covPct == null ? zeroDash : <CovBar pct={r.covPct} />}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-sky)", padding: "9px 14px" }}>
                        {r.pricedCovPct == null ? "—" : `${N(r.pricedCovPct, 1)}%`}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{fmtMWhc(r.aCl)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{fmtMWhc(r.aPr)}</td>
                    </>
                  )}

                  {view === "pnl" && (
                    <>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{fmtMWhc(r.aClP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{fmtMWhc(r.sClP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{r.matchCl > 0 ? N(r.matchCl, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.pnlCl) > 0.01 ? pk(r.pnlCl) : zeroDash}</td>

                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{fmtMWhc(r.aPrP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{fmtMWhc(r.sPrP)}</td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{r.matchPr > 0 ? N(r.matchPr, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.pnlPr) > 0.01 ? pk(r.pnlPr) : zeroDash}</td>

                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{r.openCl > 0 ? N(r.openCl, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.mtmCl) > 0.01 ? pk(r.mtmCl) : zeroDash}</td>

                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{r.openPr > 0 ? N(r.openPr, 2) : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>{Math.abs(r.mtmPr) > 0.01 ? pk(r.mtmPr) : zeroDash}</td>

                      <td style={{ padding: "9px 14px" }}>{pk(r.pnlCl + r.pnlPr + r.mtmCl + r.mtmPr)}</td>
                    </>
                  )}

                  {view === "unpriced" && (
                    <>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-blue)", padding: "9px 14px" }}>{N(r.oblClT, 2)}</td>
                      <td style={{ padding: "9px 14px" }}>
                        {r.oblClU > 0.01
                          ? <span style={{ ...S, fontSize: "12px", color: "var(--theme-red)", fontWeight: 600 }}>{N(r.oblClU, 2)}</span>
                          : zeroDash}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: r.bClU > 0 ? "var(--theme-text-primary)" : "var(--theme-text-disabled)", padding: "9px 14px" }}>
                        {r.bClU > 0.01 ? N(r.bClU, 2) : "—"}
                      </td>
                      <td style={{ padding: "9px 14px" }}>
                        {(r.oblClU + r.bClU) > 0.01 ? pc(r.forwardCl) : zeroDash}
                      </td>

                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-amber)", padding: "9px 14px" }}>{N(r.oblPrT, 2)}</td>
                      <td style={{ padding: "9px 14px" }}>
                        {r.oblPrU > 0.01
                          ? <span style={{ ...S, fontSize: "12px", color: "var(--theme-red)", fontWeight: 600 }}>{N(r.oblPrU, 2)}</span>
                          : zeroDash}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: r.bPrU > 0 ? "var(--theme-text-primary)" : "var(--theme-text-disabled)", padding: "9px 14px" }}>
                        {r.bPrU > 0.01 ? N(r.bPrU, 2) : "—"}
                      </td>
                      <td style={{ padding: "9px 14px" }}>
                        {(r.oblPrU + r.bPrU) > 0.01 ? pc(r.forwardPr) : zeroDash}
                      </td>

                      <td style={{ padding: "9px 14px" }}>
                        {(r.oblClU + r.oblPrU) > 0.01
                          ? <span style={{ ...S, fontSize: "12px", color: "var(--theme-red)", fontWeight: 600 }}>{N(r.oblClU + r.oblPrU, 2)}</span>
                          : zeroDash}
                      </td>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>
                        {(r.oblClU + r.oblPrU) > 0.01 ? fK(r.unpricedSpotValue) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}

            <tr style={{ background: "var(--theme-border-soft)", borderTop: "1px solid var(--theme-border)" }}>
              <td style={{ ...S, fontSize: "10px", color: "var(--theme-sky)", padding: "10px 14px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Total 2026
              </td>

              {view === "position" && (
                <>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-blue)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblCl, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-amber)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblPr, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-primary)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bCl, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-primary)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bPr, 0)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.bCl - tot.oblCl)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.bPr - tot.oblPr)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-sky)", padding: "10px 14px", fontWeight: 700 }}>
                    {totalCoverage == null ? "—" : `${N(totalCoverage, 1)}%`}
                  </td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-sky)", padding: "10px 14px", fontWeight: 700 }}>
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
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-red)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblClU, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-primary)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bClU, 0)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.forwardCl)}</td>
                  <td />
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-red)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblPrU, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-primary)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.bPrU, 0)}</td>
                  <td style={{ padding: "10px 14px" }}>{pc(tot.forwardPr)}</td>
                  <td style={{ ...S, fontSize: "13px", color: "var(--theme-red)", padding: "10px 14px", fontWeight: 700 }}>{N(tot.oblClU + tot.oblPrU, 0)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "10px 14px", fontWeight: 700 }}>{fK(tot.unpricedSpotValue)}</td>
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

  const filterSelectStyle = {
    ...S,
    background: THEME.panelAlt,
    border: `1px solid ${THEME.border}`,
    color: THEME.textSecondary,
    borderRadius: "2px",
    padding: "7px 9px",
    fontSize: "10px",
    fontWeight: 500,
    outline: "none",
    minHeight: "32px"
  };

  return (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "14px"
    }}
  >
    {/* ======================================================
        FILTERS AND ACTIONS
    ====================================================== */}
    <div
      style={{
        background: THEME.panel,
        border: `1px solid ${THEME.border}`,
        borderRadius: "2px",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}
    >
      {/* Row 1 — Main status filters + actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap"
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap"
          }}
        >
          {[
            "ALL",
            "PENDING",
            "APPROVED",
            "CLASSIQUE",
            "PRECARITE"
          ].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...S,
                fontSize: "10px",
                fontWeight: filter === f ? 600 : 500,
                padding: "6px 12px",
                borderRadius: "2px",
                border: "1px solid",
                cursor: "pointer",
                letterSpacing: "0.08em",
                textTransform: "uppercase",

                background:
                  filter === f
                    ? THEME.sky
                    : "transparent",

                color:
                  filter === f
                    ? "var(--theme-selected-text)"
                    : THEME.controlText,

                borderColor:
                  filter === f
                    ? THEME.sky
                    : THEME.border,

                transition:
                  "color 0.2s ease, border-color 0.2s ease, background 0.2s ease"
              }}
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <button
            onClick={exportBlotterToExcel}
            style={{
              ...S,
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background:
                "linear-gradient(135deg, var(--theme-success-bg), #123d24)",
              color: "var(--theme-green)",
              border: "1px solid #1d6b3a",
              borderRadius: "2px",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              padding: "8px 14px",
              cursor: "pointer",
              boxShadow:
                "0 0 0 1px rgba(52, 211, 153, 0.08) inset"
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
            <GoldBtn
              onClick={() => setShowModal(true)}
            >
              + New Purchase
            </GoldBtn>
          )}
        </div>
      </div>

      {/* Row 2 — Business / operational filters */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(145px, 1fr))",
          gap: "8px"
        }}
      >
        <select
          value={filterMonth}
          onChange={e =>
            setFilterMonth(e.target.value)
          }
          style={filterSelectStyle}
        >
          {months.map(m => (
            <option key={m} value={m}>
              {m === "ALL"
                ? "All months"
                : ML(m)}
            </option>
          ))}
        </select>

        <select
          value={filterVendor}
          onChange={e =>
            setFilterVendor(e.target.value)
          }
          style={filterSelectStyle}
        >
          {vendors.map(v => (
            <option key={v} value={v}>
              {v === "ALL"
                ? "All sellers"
                : v}
            </option>
          ))}
        </select>

        <select
          value={filterPriced}
          onChange={e =>
            setFilterPriced(e.target.value)
          }
          style={filterSelectStyle}
        >
          <option value="ALL">
            Priced / unpriced
          </option>
          <option value="true">
            Priced
          </option>
          <option value="false">
            Unpriced
          </option>
        </select>

        <select
          value={filterContract}
          onChange={e =>
            setFilterContract(e.target.value)
          }
          style={filterSelectStyle}
        >
          <option value="ALL">
            All contracts
          </option>
          <option value="Signed">
            Signed
          </option>
          <option value="To sign">
            To sign
          </option>
          <option value="No contract">
            No contract
          </option>
          <option value="N/A">
            N/A
          </option>
        </select>

        <select
          value={filterValidation}
          onChange={e =>
            setFilterValidation(e.target.value)
          }
          style={filterSelectStyle}
        >
          <option value="ALL">
            All validations
          </option>
          <option value="Validated">
            Validated
          </option>
          <option value="Pending">
            Pending validation
          </option>
          <option value="N/A">
            N/A
          </option>
        </select>

        <select
          value={filterPayment}
          onChange={e =>
            setFilterPayment(e.target.value)
          }
          style={filterSelectStyle}
        >
          <option value="ALL">
            All payments
          </option>
          <option value="Paid">
            Paid
          </option>
          <option value="Unpaid">
            Unpaid
          </option>
          <option value="N/A">
            N/A
          </option>
        </select>

        <select
          value={filterDeposit}
          onChange={e =>
            setFilterDeposit(e.target.value)
          }
          style={filterSelectStyle}
        >
          <option value="ALL">
            All deposits
          </option>
          <option value="Full">
            Fully deposited
          </option>
          <option value="Partial">
            Partially deposited
          </option>
          <option value="Open">
            Open deposit
          </option>
          <option value="Over">
            Over-deposited
          </option>
          <option value="N/A">
            N/A
          </option>
        </select>

        <select
          value={filterCpRanking}
          onChange={e =>
            setFilterCpRanking(e.target.value)
          }
          style={filterSelectStyle}
        >
          {cpRankings.map(r => (
            <option key={r} value={r}>
              {r === "ALL"
                ? "All CP rankings"
                : r}
            </option>
          ))}
        </select>
      </div>

      {/* Row 3 — Sort controls + result count */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          borderTop:
            `1px solid ${THEME.borderSoft}`,
          paddingTop: "10px"
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap"
          }}
        >
          <select
            value={sortKey}
            onChange={e =>
              setSortKey(e.target.value)
            }
            style={filterSelectStyle}
          >
            <option value="createdAt">
              Sort by creation date
            </option>
            <option value="month">
              Sort by month
            </option>
            <option value="vendor">
              Sort by seller
            </option>
            <option value="volume">
              Sort by volume
            </option>
            <option value="price">
              Sort by price
            </option>
            <option value="status">
              Sort by approval
            </option>
          </select>

          <button
            onClick={() =>
              setSortDir(d =>
                d === "asc"
                  ? "desc"
                  : "asc"
              )
            }
            style={{
              ...S,
              fontSize: "10px",
              fontWeight: 500,
              padding: "7px 12px",
              borderRadius: "2px",
              border:
                `1px solid ${THEME.border}`,
              cursor: "pointer",
              background: THEME.panelAlt,
              color: THEME.controlText,
              minHeight: "32px"
            }}
          >
            {sortDir === "asc"
              ? "↑ ASC"
              : "↓ DESC"}
          </button>
        </div>

        <span
          style={{
            ...S,
            fontSize: "10px",
            color: THEME.textMuted,
            fontWeight: 500
          }}
        >
          {filtered.length} trade
          {filtered.length > 1 ? "s" : ""} displayed
          {" / "}
          {trades.length} total
        </span>
      </div>
    </div>

    {/* ======================================================
        BLOTTER TABLE
    ====================================================== */}
    <div>
      <div
        ref={topScrollRef}
        onScroll={syncTopScroll}
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          height: "14px",
          marginBottom: "6px",
          border:
            `1px solid ${THEME.border}`,
          borderRadius: "2px",
          background: THEME.panelAlt
        }}
      >
        <div
          style={{
            width: BLOTTER_TABLE_WIDTH,
            height: "1px"
          }}
        />
      </div>

      <div
        ref={tableScrollRef}
        onScroll={syncTableScroll}
        style={{
          overflowX: "auto",
          border:
            `1px solid ${THEME.borderSoft}`,
          borderRadius: "2px"
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            minWidth: BLOTTER_TABLE_WIDTH
          }}
        >
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
              ].map(header => (
                <TH key={header}>
                  {header}
                </TH>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map(trade => {
              const can =
                currentUser.role === "approver" &&
                trade.status === "PENDING" &&
                trade.createdBy !== currentUser.id;

              const rowBackground = THEME.panel;

              return (
                <tr
                  key={trade.id}
                  style={{
                    borderBottom:
                      `1px solid ${THEME.borderSoft}`,
                    background: rowBackground
                  }}
                  onMouseEnter={event => {
                    event.currentTarget.style.background =
                      THEME.panelAlt;
                  }}
                  onMouseLeave={event => {
                    event.currentTarget.style.background =
                      rowBackground;
                  }}
                >
                  <td
                    style={{
                      padding: "9px 14px",
                      minWidth: "130px",
                      whiteSpace: "nowrap"
                    }}
                  >
                    <Badge
                      color={
                        trade.ceeType === "CLASSIQUE"
                          ? "sky"
                          : "amber"
                      }
                    >
                      {trade.ceeType === "PRECARITE"
                        ? "PRÉCARITÉ"
                        : trade.ceeType}
                    </Badge>
                  </td>

                  <td
                    style={{
                      ...CG,
                      fontSize: "14px",
                      color: THEME.textPrimary,
                      padding: "9px 14px",
                      maxWidth: "180px"
                    }}
                  >
                    {trade.vendor}
                  </td>

                  <td
                    style={{
                      ...S,
                      fontSize: "10px",
                      color: THEME.textSecondary,
                      padding: "9px 14px"
                    }}
                  >
                    {trade.dealType}
                  </td>

                  <td
                    style={{
                      ...S,
                      fontSize: "10px",
                      color: THEME.textMuted,
                      padding: "9px 14px"
                    }}
                  >
                    {trade.period}
                  </td>

                  <td
                    style={{
                      ...S,
                      fontSize: "11px",
                      color: THEME.textSecondary,
                      padding: "9px 14px",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {trade.month
                      ? ML(trade.month)
                      : "—"}
                  </td>

                  <td
                    style={{
                      ...S,
                      fontSize: "11px",
                      color: THEME.textSecondary,
                      padding: "9px 14px",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {trade.pricingMonth
                      ? ML(trade.pricingMonth)
                      : "—"}
                  </td>

                  <td
                    style={{
                      ...S,
                      fontSize: "12px",
                      color: THEME.textPrimary,
                      padding: "9px 14px"
                    }}
                  >
                    {N(trade.volume, 3)}
                  </td>

                  <td
                    style={{
                      ...S,
                      fontSize: "12px",
                      color: THEME.textPrimary,
                      padding: "9px 14px"
                    }}
                  >
                    {N(trade.price, 0)}
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    <button
                      onClick={() =>
                        togglePriced(trade)
                      }
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer"
                      }}
                      title="Toggle priced status"
                    >
                      <Badge
                        color={
                          trade.priced === true
                            ? "green"
                            : "gray"
                        }
                      >
                        {trade.priced === true
                          ? "Priced"
                          : "Unpriced"}
                      </Badge>
                    </button>
                  </td>

                  <td
                    style={{
                      ...S,
                      fontSize: "10px",
                      color: THEME.textSecondary,
                      padding: "9px 14px",
                      maxWidth: "170px"
                    }}
                  >
                    {trade.sourcing || "—"}
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    <button
                      onClick={() =>
                        toggleContract(trade)
                      }
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer"
                      }}
                      title="Toggle contract signed"
                    >
                      {(() => {
                        const status =
                          getContractStatus(trade);

                        return (
                          <Badge color={status.color}>
                            {status.label}
                          </Badge>
                        );
                      })()}
                    </button>
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    <button
                      onClick={() =>
                        toggleValidation(trade)
                      }
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer"
                      }}
                      title="Toggle validation status"
                    >
                      {(() => {
                        const status =
                          getValidationStatus(trade);

                        return (
                          <Badge color={status.color}>
                            {status.label}
                          </Badge>
                        );
                      })()}
                    </button>
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    <button
                      onClick={() =>
                        togglePayment(trade)
                      }
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer"
                      }}
                      title="Toggle payment status"
                    >
                      {(() => {
                        const status =
                          getPaymentStatus(trade);

                        return (
                          <Badge color={status.color}>
                            {status.label}
                          </Badge>
                        );
                      })()}
                    </button>
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    <input
                      type="number"
                      step="0.001"
                      value={
                        tradesDraft[trade.id] ??
                        trade.volumeCredited ??
                        trade.volumeDeposited ??
                        ""
                      }
                      onChange={event => {
                        setTradesDraft(previous => ({
                          ...previous,
                          [trade.id]: event.target.value
                        }));
                      }}
                      onBlur={event => {
                        updateDeposited(
                          trade,
                          event.target.value
                        );

                        setTradesDraft(previous => {
                          const next = {
                            ...previous
                          };

                          delete next[trade.id];

                          return next;
                        });
                      }}
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      style={{
                        ...S,
                        width: "82px",
                        background: THEME.panelAlt,
                        border:
                          `1px solid ${THEME.border}`,
                        color: THEME.textPrimary,
                        borderRadius: "2px",
                        padding: "5px 7px",
                        fontSize: "10px",
                        outline: "none"
                      }}
                    />
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    {(() => {
                      const status =
                        getDepositStatus(trade);

                      const remaining =
                        trade.volumeRemainingToBeDeposited;

                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "3px"
                          }}
                        >
                          <Badge color={status.color}>
                            {status.label}
                          </Badge>

                          <span
                            style={{
                              ...S,
                              fontSize: "10px",
                              color:
                                remaining < -EPS
                                  ? "var(--theme-purple)"
                                  : remaining > EPS
                                    ? THEME.red
                                    : THEME.textSecondary
                            }}
                          >
                            {remaining != null
                              ? N(remaining, 3)
                              : "—"}
                          </span>
                        </div>
                      );
                    })()}
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    {trade.cpRanking ? (
                      <Badge
                        color={
                          trade.cpRanking === "AAA"
                            ? "green"
                            : trade.cpRanking?.includes("A")
                              ? "sky"
                              : "amber"
                        }
                      >
                        {trade.cpRanking}
                      </Badge>
                    ) : (
                      <span
                        style={{
                          ...S,
                          fontSize: "10px",
                          color: THEME.textMuted
                        }}
                      >
                        —
                      </span>
                    )}
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    <button
                      onClick={() =>
                        toggleApproval(trade)
                      }
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer"
                      }}
                      title="Toggle approval status"
                    >
                      {SB(trade.status)}
                    </button>
                  </td>

                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    {can && (
                      <div
                        style={{
                          display: "flex",
                          gap: "5px"
                        }}
                      >
                        <button
                          onClick={() =>
                            onApprove(
                              trade.id,
                              currentUser.id
                            )
                          }
                          style={{
                            ...S,
                            fontSize: "10px",
                            padding: "4px 8px",
                            background: "var(--theme-success-bg)",
                            color: THEME.green,
                            border:
                              "1px solid var(--theme-success-border)",
                            borderRadius: "2px",
                            cursor: "pointer"
                          }}
                        >
                          ✓ OK
                        </button>

                        <button
                          onClick={() =>
                            onReject(trade.id)
                          }
                          style={{
                            ...S,
                            fontSize: "10px",
                            padding: "4px 8px",
                            background: "var(--theme-danger-bg)",
                            color: THEME.red,
                            border:
                              "1px solid var(--theme-danger-border)",
                            borderRadius: "2px",
                            cursor: "pointer"
                          }}
                        >
                          ✗
                        </button>
                      </div>
                    )}

                    {trade.status === "PENDING" &&
                      !can && (
                        <span
                          style={{
                            ...S,
                            fontSize: "10px",
                            color: THEME.textMuted
                          }}
                        >
                          Awaiting approver
                        </span>
                      )}

                    {currentUser?.role ===
                      "approver" && (
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                "Delete this trade?"
                              )
                            ) {
                              onDelete(trade.id);
                            }
                          }}
                          style={{
                            ...S,
                            fontSize: "9px",
                            padding: "3px 7px",
                            background:
                              "transparent",
                            color:
                              THEME.controlText,
                            border:
                              `1px solid ${THEME.border}`,
                            borderRadius: "2px",
                            cursor: "pointer",
                            marginTop: "4px"
                          }}
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

    {/* ======================================================
        NEW PURCHASE MODAL
    ====================================================== */}
    {showModal && (
      <Modal
        title="New CEE Purchase"
        onClose={() =>
          setShowModal(false)
        }
        wide
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "1fr 1fr 1fr",
            gap: "13px"
          }}
        >
          <FS
            label="CEE Type"
            value={form.ceeType}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                ceeType: event.target.value
              }))
            }
          >
            <option value="CLASSIQUE">
              Classique
            </option>
            <option value="PRECARITE">
              Précarité
            </option>
          </FS>

          <FI
            label="Seller"
            placeholder="ACT France, OTC, Eco-Environnement..."
            value={form.vendor}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                vendor: event.target.value
              }))
            }
          />

          <FS
            label="Deal Type"
            value={form.dealType}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                dealType: event.target.value
              }))
            }
          >
            <option value="Fixed Price">
              Fixed Price
            </option>
            <option value="Floating">
              Floating
            </option>
          </FS>

          <FS
            label="Period"
            value={form.period}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                period: event.target.value
              }))
            }
          >
            <option value="P6">
              P6
            </option>
            <option value="P5">
              P5
            </option>
          </FS>

          <FI
            label="Month"
            type="month"
            value={form.month}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                month: event.target.value
              }))
            }
          />

          <FS
            label="Priced"
            value={String(form.priced)}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                priced:
                  event.target.value === "true"
              }))
            }
          >
            <option value="true">
              Priced
            </option>
            <option value="false">
              Unpriced
            </option>
          </FS>

          <FI
            label="Volume (GWhc)"
            type="number"
            step="0.001"
            placeholder="0.000"
            value={form.volume}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                volume: event.target.value
              }))
            }
          />

          <FI
            label="Price (€/GWhc)"
            type="number"
            step="1"
            placeholder="9000"
            value={form.price}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                price: event.target.value
              }))
            }
          />

          <FI
            label="Deposited (GWhc)"
            type="number"
            step="0.001"
            placeholder="0.000"
            value={form.volumeDeposited}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                volumeDeposited:
                  event.target.value
              }))
            }
          />

          <FS
            label="Sourcing"
            value={form.sourcing}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                sourcing: event.target.value
              }))
            }
          >
            <option value="">
              —
            </option>
            <option value="Primary">
              Primary
            </option>
            <option value="Secondary">
              Secondary
            </option>
            <option value="Program">
              Program
            </option>
            <option value="Authorized representative">
              Authorized representative
            </option>
          </FS>

          <FS
            label="Contract expected"
            value={String(
              form.contractYesNo
            )}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                contractYesNo:
                  event.target.value === "true"
              }))
            }
          >
            <option value="true">
              Yes
            </option>
            <option value="false">
              No
            </option>
          </FS>

          <FS
            label="Contract signed"
            value={String(
              form.contractSigned
            )}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                contractSigned:
                  event.target.value === "true"
              }))
            }
          >
            <option value="false">
              No
            </option>
            <option value="true">
              Yes
            </option>
          </FS>

          <FI
            label="Contract date"
            type="date"
            value={form.contractDate}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                contractDate:
                  event.target.value
              }))
            }
          />

          <FS
            label="Payment terms"
            value={form.paymentTerms}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                paymentTerms:
                  event.target.value
              }))
            }
          >
            <option value="After Delivery">
              After Delivery
            </option>
            <option value="Prepayment">
              Prepayment
            </option>
          </FS>

          <FS
            label="Validated"
            value={String(form.validated)}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                validated:
                  event.target.value === "true"
              }))
            }
          >
            <option value="false">
              Pending
            </option>
            <option value="true">
              Validated
            </option>
          </FS>

          <FS
            label="Payment"
            value={String(form.payment)}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                payment:
                  event.target.value === "true"
              }))
            }
          >
            <option value="false">
              Unpaid
            </option>
            <option value="true">
              Paid
            </option>
          </FS>

          <FS
            label="CP Ranking"
            value={form.cpRanking}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                cpRanking:
                  event.target.value
              }))
            }
          >
            <option value="">
              —
            </option>

            {[
              "AAA",
              "AA",
              "A+",
              "A",
              "BBB",
              "BB",
              "B+"
            ].map(ranking => (
              <option
                key={ranking}
                value={ranking}
              >
                {ranking}
              </option>
            ))}
          </FS>

          <FI
            label="Comments"
            placeholder="Optional comment"
            value={form.comments}
            onChange={event =>
              setForm(previous => ({
                ...previous,
                comments:
                  event.target.value
              }))
            }
          />
        </div>

        <div
          style={{
            marginTop: "14px",
            padding: "10px 12px",
            background: THEME.panelAlt,
            border:
              `1px solid ${THEME.borderSoft}`,
            borderRadius: "2px"
          }}
        >
          <p
            style={{
              ...S,
              fontSize: "10px",
              color: THEME.textSecondary
            }}
          >
            Remaining to deposit will be calculated
            automatically:{" "}

            <span
              style={{
                color: THEME.sky,
                fontWeight: 600
              }}
            >
              {Number.isFinite(
                Number(form.volume)
              ) &&
              Number.isFinite(
                Number(
                  form.volumeDeposited || 0
                )
              )
                ? `${N(
                    Number(form.volume) -
                      Number(
                        form.volumeDeposited || 0
                      ),
                    3
                  )} GWhc`
                : "—"}
            </span>
          </p>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "16px"
          }}
        >
          <GhostBtn
            onClick={() =>
              setShowModal(false)
            }
          >
            Cancel
          </GhostBtn>

          <GoldBtn onClick={handleSubmit}>
            Submit
          </GoldBtn>
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

function ObligationTab({
  obligations,
  onAdd,
  onUpdate,
  onDelete,
  canEdit = false
}) {
  const [showModal, setShowModal] = useState(false);
  const [filterClient, setFilterClient] = useState("ALL");
  const [filterMonth, setFilterMonth] = useState("ALL");
  const blank = { month: "", product: "CARBURANT", volume_m3: "", priceCl: "9000", pricePr: "15000", priced: false, client: "Spot" };
  const [form, setForm] = useState(blank);
  const [volumeDrafts, setVolumeDrafts] =
    useState({});

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

  const saveVolume = async obligation => {
    if (
      !Object.prototype.hasOwnProperty.call(
        volumeDrafts,
        obligation.id
      )
    ) {
      return;
    }

    const rawVolume =
      volumeDrafts[obligation.id];

    await onUpdate(
      obligation.id,
      rawVolume
    );

    setVolumeDrafts(current => {
      const next = { ...current };

      delete next[obligation.id];

      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "12px 18px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px" }}>
        {[
          ["Road Fuel kWhc/m³", "8 718"],
          ["FOD kWhc/m³", "11 078"],
          ["Précarité Coeff.", "0.364"],
          ["Correction Coeff.", "0.847"]
        ].map(([k, v]) => (
          <div key={k}>
            <p
              style={{
                ...S,
                fontSize: "10px",
                color: THEME.textLabel,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.11em",
                margin: 0
              }}
            >
              {k}
            </p>

            <p
              style={{
                ...S,
                fontSize: "15px",
                color: THEME.sky,
                fontWeight: 500,
                marginTop: "5px",
                marginBottom: 0
              }}
            >
              {v}
            </p>
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
                fontWeight: filterClient === c ? 600 : 500,
                padding: "6px 11px",
                borderRadius: "2px",
                border: "1px solid",
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.08em",

                background:
                  filterClient === c
                    ? THEME.sky
                    : THEME.panelAlt,

                color:
                  filterClient === c
                    ? "var(--theme-selected-text)"
                    : THEME.controlText,

                borderColor:
                  filterClient === c
                    ? THEME.sky
                    : THEME.border
              }}
            >
              {clientLabel(c)}
            </button>
          ))}

          <select
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            style={{
              ...S,
              background: THEME.panelAlt,
              border: `1px solid ${THEME.border}`,
              color: THEME.textSecondary,
              borderRadius: "2px",
              padding: "6px 9px",
              fontSize: "10px",
              fontWeight: 500,
              outline: "none"
            }}
          >
            {months.map(m => (
              <option key={m} value={m}>
                {m === "ALL" ? "All months" : ML(m)}
              </option>
            ))}
          </select>
        </div>

        {canEdit && (
          <GoldBtn onClick={() => setShowModal(true)}>+ Add Obligation</GoldBtn>
        )}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--theme-border-soft)", borderRadius: "2px" }}>
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
              const bg = i % 2 === 0 ? "var(--theme-panel)" : "var(--theme-row-alt)";
              return (
                <tr key={o.id} style={{ borderBottom: "1px solid var(--theme-border-soft)", background: bg }} onMouseEnter={e => e.currentTarget.style.background = "var(--theme-panel-alt)"} onMouseLeave={e => e.currentTarget.style.background = bg}>
                  <td style={{ ...CG, fontSize: "14px", color: "var(--theme-text-primary)", padding: "9px 14px" }}>{ML(o.month)}</td>
                  <td style={{ padding: "9px 14px" }}><Badge color={cc(o.client)}>{clientLabel(o.client)}</Badge></td>
                  <td style={{ padding: "9px 14px" }}><Badge color={o.product === "CARBURANT" ? "sky" : "purple"}>{PARAMS[o.product].label}</Badge></td>
                  <td
                    style={{
                      padding: "9px 14px"
                    }}
                  >
                    {canEdit ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={
                          volumeDrafts[o.id] ??
                          o.volume_m3 ??
                          ""
                        }
                        onFocus={event => {
                          event.currentTarget.select();
                        }}
                        onChange={event => {
                          setVolumeDrafts(current => ({
                            ...current,
                            [o.id]: event.target.value
                          }));
                        }}
                        onBlur={() => {
                          saveVolume(o);
                        }}
                        onKeyDown={event => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }

                          if (event.key === "Escape") {
                            setVolumeDrafts(current => {
                              const next = { ...current };

                              delete next[o.id];

                              return next;
                            });

                            event.currentTarget.blur();
                          }
                        }}
                        title="Edit volume and press Enter to save"
                        style={{
                          ...S,
                          width: "110px",
                          background: THEME.panelAlt,
                          border: `1px solid ${THEME.border}`,
                          color: THEME.textPrimary,
                          borderRadius: "2px",
                          padding: "6px 8px",
                          fontSize: "11px",
                          fontWeight: 500,
                          outline: "none"
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          ...S,
                          fontSize: "11px",
                          color: THEME.textPrimary
                        }}
                      >
                        {N(o.volume_m3, 0)} m³
                      </span>
                    )}
                  </td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-blue)", padding: "9px 14px" }}>{N(o.clGwhc, 3)}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-amber)", padding: "9px 14px" }}>{N(o.prGwhc, 3)}</td>
                  <td style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{N(o.priceCl / 1000, 2)}</td>
                  <td style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>{N(o.pricePr / 1000, 2)}</td>
                  <td style={{ padding: "9px 14px" }}><Badge color={o.priced ? "green" : "red"}>{o.priced ? "Priced" : "Unpriced"}</Badge></td>
                  {canEdit && (
                    <td style={{ padding: "9px 14px" }}>
                      <button
                        onClick={() => onDelete(o.id)}
                        style={{
                          ...S,
                          fontSize: "9px",
                          color: "var(--theme-text-disabled)",
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
              <input type="checkbox" id="pr" checked={form.priced} onChange={e => setForm(f => ({ ...f, priced: e.target.checked }))} style={{ accentColor: "var(--theme-sky)" }} />
              <label htmlFor="pr" style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", cursor: "pointer" }}>Priced</label>
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
function Dashboard({
  trades,
  obligations,
  prices,
  curve,
  displayDate
}) {
  const latest = useMemo(() => {
    if (!prices.length) return { classique: curve.SPOT?.classique ?? 8.96, precarite: curve.SPOT?.precarite ?? 16.44, date: "(curve)" };
    const p = [...prices].sort((a, b) => b.date.localeCompare(a.date))[0];
    return { classique: p.classique, precarite: p.precarite, date: p.date };
  }, [prices, curve]);

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
        bg: THEME.panel,
        color: THEME.textMuted,
        border: THEME.border
      };
    }

    if (pct >= 120) {
      return {
        label: "Overcovered",
        bg: THEME.infoBg,
        color: THEME.infoText,
        border: THEME.infoBorder
      };
    }

    if (pct >= 100 - EPS) {
      return {
        label: "OK",
        bg: THEME.successBg,
        color: THEME.successText,
        border: THEME.successBorder
      };
    }

    if (pct >= COVERAGE_ALERT_THRESHOLD) {
      return {
        label: "Watchlist",
        bg: THEME.warningBg,
        color: THEME.warningText,
        border: THEME.warningBorder
      };
    }

    return {
      label: "Undercovered",
      bg: THEME.dangerBg,
      color: THEME.dangerText,
      border: THEME.dangerBorder
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
  
  const DashboardSectionTitle = ({ children }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "12px"
      }}
    >
      <span
        style={{
          width: "18px",
          height: "1px",
          background: THEME.sky,
          opacity: 0.65,
          flexShrink: 0
        }}
      />

      <p
        style={{
          ...S,
          fontSize: "10px",
          color: THEME.sectionTitle,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          margin: 0
        }}
      >
        {children}
      </p>
    </div>
  );
  
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "30px"
      }}
    >
      {pending > 0 && (
        <div style={{ background: "var(--theme-warning-bg)", border: "1px solid var(--theme-warning-border)", borderRadius: "2px", padding: "10px 16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "var(--theme-warning-text)", fontSize: "12px" }}>⚠</span>
          <span style={{ ...S, fontSize: "11px", color: "var(--theme-warning-text)" }}>
            {pending} trade{pending > 1 ? "s" : ""} awaiting four-eyes approval
          </span>
        </div>
      )}

      {operationalMetrics.unsignedContractsCount > 0 && (
        <div style={{
          background:"var(--theme-warning-bg)",
          border:"1px solid var(--theme-warning-border)",
          borderRadius:"2px",
          padding:"10px 16px",
          display:"flex",
          alignItems:"center",
          gap:"8px"
        }}>
          <span style={{ color:"var(--theme-warning-text)",fontSize:"12px" }}>⚠</span>
          <span style={{ ...S,fontSize:"11px",color:"var(--theme-warning-text)" }}>
            {operationalMetrics.unsignedContractsCount} material trade{operationalMetrics.unsignedContractsCount > 1 ? "s" : ""} without signed contract
            {" "}({N(operationalMetrics.unsignedContractsVolume,0)} GWhc)
          </span>
        </div>
      )}

      {operationalMetrics.remainingDepositVolume > 0 && (
        <div style={{
          background:"var(--theme-danger-bg)",
          border:"1px solid var(--theme-danger-border)",
          borderRadius:"2px",
          padding:"10px 16px",
          display:"flex",
          alignItems:"center",
          gap:"8px"
        }}>
          <span style={{ color:"var(--theme-red)",fontSize:"12px" }}>⚠</span>
          <span style={{ ...S,fontSize:"11px",color:"var(--theme-danger-text)" }}>
            {N(operationalMetrics.remainingDepositVolume,0)} GWhc still to be deposited across priced trades
          </span>
        </div>
      )}

      {coverageAlerts.length > 0 && (
        <div style={{ background: "var(--theme-danger-bg)", border: "1px solid var(--theme-danger-border)", borderRadius: "2px", padding: "10px 16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "var(--theme-red)", fontSize: "12px" }}>⚠</span>
          <span style={{ ...S, fontSize: "11px", color: "var(--theme-danger-text)" }}>
            {coverageAlerts.length} month{coverageAlerts.length > 1 ? "s" : ""} below the {COVERAGE_ALERT_THRESHOLD}% coverage threshold:{" "}
            {coverageAlerts.map(r => `${ML(r.month)} (${N(r.covPct, 1)}%)`).join(", ")}
          </span>
        </div>
      )}

      {dataQualityChecks.length > 0 && (
        <div style={{
          background: "var(--theme-danger-bg)",
          border: "1px solid var(--theme-danger-border)",
          borderRadius: "2px",
          padding: "10px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "6px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--theme-red)", fontSize: "12px" }}>⚠</span>
            <span style={{ ...S, fontSize: "11px", color: "var(--theme-danger-text)" }}>
              {dataQualityChecks.length} data issue{dataQualityChecks.length > 1 ? "s" : ""} detected
            </span>
          </div>

          <div style={{ ...S, fontSize: "10px", color: "var(--theme-danger-text)" }}>
            {dataQualityChecks.slice(0, 3).map((e, i) => (
              <div key={i}>
                • {e.type} — {e.detail}
              </div>
            ))}
            {dataQualityChecks.length > 3 && (
              <div style={{ color: "var(--theme-text-muted)" }}>
                … +{dataQualityChecks.length - 3} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PnL / MtM / Spot ── */}
      <div>
        <DashboardSectionTitle>
          PNL & Market Summary — {displayDate || "Loading…"}
        </DashboardSectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "12px" }}>
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
        <DashboardSectionTitle>
          Risk / Exposure View
        </DashboardSectionTitle>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px" }}>
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
        <DashboardSectionTitle>
          Operational Follow-up
        </DashboardSectionTitle>

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
        <DashboardSectionTitle>
          Monthly Coverage Heatmap — Priced Obligations
        </DashboardSectionTitle>

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
                    ? "0 0 0 1px var(--theme-red) inset"
                    : "none",
                  borderRadius: "2px",
                  padding: "10px 8px",
                  minHeight: "88px"
                }}
              >
                <p style={{ ...S, fontSize: "9px", color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
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

                <p style={{ ...S, fontSize: "8px", color: "var(--theme-text-muted)", marginBottom: "3px" }}>
                  {isEmpty ? "—" : `${N(r.bought, 0)} / ${N(r.obligation, 0)} GWhc`}
                </p>

                {!isEmpty && (
                  <p style={{ ...S, fontSize: "8px", color: net >= 0 ? "var(--theme-green)" : "var(--theme-red)" }}>
                    {net === 0 ? "0 GWhc" : `${net > 0 ? "+" : ""}${N(net, 0)} GWhc`}
                  </p>
                )}

                {!isEmpty && net !== 0 && (
                  <p style={{ ...S, fontSize: "8px", color: "var(--theme-text-muted)", marginTop: "3px" }}>
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
        <DashboardSectionTitle>
          Priced Position — Confirmed Purchases vs Fixed-Price Obligations
        </DashboardSectionTitle>

        <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", overflow: "hidden", marginBottom: "16px" }}>
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
                <tr key={label} style={{ borderBottom: "1px solid var(--theme-border-soft)" }}>
                  <td style={{ ...CG, fontSize: "14px", color: "var(--theme-text-primary)", padding: "10px 16px" }}>{label}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "10px 16px" }}>{N(obl, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-primary)", padding: "10px 16px" }}>{N(bought, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", padding: "10px 16px", color: net >= 0 ? "var(--theme-green)" : "var(--theme-red)", fontWeight: 600 }}>{net >= 0 ? "+" : ""}{N(net, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", padding: "10px 16px" }}>{fmtMWhc(avg)}</td>
                  <td style={{ padding: "10px 16px", minWidth: "140px" }}><CovBar pct={obl > 0 ? bought / obl * 100 : 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Unpriced Position ── */}
        <DashboardSectionTitle>
          Unpriced Position — Forward Exposure (Partial Mar + Apr–Dec, obligations without fixed price)
        </DashboardSectionTitle>

        <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", overflow: "hidden" }}>
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
                <tr key={label} style={{ borderBottom: "1px solid var(--theme-border-soft)" }}>
                  <td style={{ ...CG, fontSize: "14px", color: "var(--theme-text-primary)", padding: "10px 16px" }}>{label}</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-secondary)", padding: "10px 16px" }}>{N(obl, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-primary)", padding: "10px 16px" }}>{N(bought, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "12px", padding: "10px 16px", color: net >= 0 ? "var(--theme-green)" : "var(--theme-red)", fontWeight: 600 }}>{net >= 0 ? "+" : ""}{N(net, 1)} GWh</td>
                  <td style={{ ...S, fontSize: "11px", padding: "10px 16px", color: net < 0 ? "var(--theme-red)" : "var(--theme-green)" }}>{net < 0 ? "⚠ SHORT — uncovered obligations" : "✓ Long / balanced"}</td>
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
        background: view === id ? "var(--theme-sky)" : "transparent",
        color: view === id ? THEME.selectedText : "var(--theme-text-muted)",
        borderColor: view === id ? "var(--theme-sky)" : "var(--theme-border-soft)"
      }}
    >
      {children}
    </button>
  );

  const SectionTitle = ({ children }) => (
    <p style={{
      ...S,
      fontSize: "9px",
      color: "var(--theme-sky)",
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
        background: "var(--theme-panel)",
        border: "1px solid var(--theme-border-soft)",
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
            color: "var(--theme-sky)",
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            marginBottom: "6px"
          }}>
            Market & Curves
          </p>

          <p
            style={{
              ...S,
              fontSize: "12px",
              color: THEME.textSecondary,
              lineHeight: 1.5,
              fontWeight: 400,
              margin: 0,
              maxWidth: "760px"
            }}
          >
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
            background: "var(--theme-panel)",
            border: "1px solid var(--theme-border-soft)",
            borderRadius: "2px",
            padding: "18px"
          }}>
            <SectionTitle>Spot Market Price History — Classique vs Précarité</SectionTitle>

            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "var(--theme-text-secondary)" }} />
                <Line
                  type="monotone"
                  dataKey="classique"
                  name="Classique (€/MWhc)"
                  stroke="var(--theme-blue)"
                  strokeWidth={2}
                  dot={{ fill: "var(--theme-blue)", r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="precarite"
                  name="Précarité (€/MWhc)"
                  stroke="var(--theme-amber)"
                  strokeWidth={2}
                  dot={{ fill: "var(--theme-amber)", r: 3 }}
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

          <div style={{ border: "1px solid var(--theme-border-soft)", borderRadius: "2px", overflow: "hidden" }}>
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
                  const bg = i === 0 ? "var(--theme-panel-alt)" : "var(--theme-panel)";

                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--theme-border-soft)", background: bg }}>
                      <td style={{ ...S, fontSize: "12px", color: "var(--theme-text-primary)", padding: "10px 14px", fontWeight: 500 }}>
                        {p.date}
                        {i === 0 && (
                          <span style={{ marginLeft: "8px", fontSize: "9px", color: "var(--theme-sky)" }}>
                            LATEST
                          </span>
                        )}
                      </td>

                      <td style={{ ...S, fontSize: "13px", color: "var(--theme-blue)", padding: "10px 14px" }}>
                        {N(p.classique, 2)}
                      </td>

                      <td style={{ ...S, fontSize: "13px", color: "var(--theme-amber)", padding: "10px 14px" }}>
                        {N(p.precarite, 2)}
                      </td>

                      <td style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", padding: "10px 14px" }}>
                        {user?.name ?? p.enteredBy}
                      </td>

                      <td style={{ ...S, fontSize: "10px", color: "var(--theme-text-disabled)", padding: "10px 14px" }}>
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
            background: "var(--theme-panel)",
            border: "1px solid var(--theme-border-soft)",
            borderRadius: "2px",
            padding: "14px 16px"
          }}>
            <p style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", lineHeight: 1.6 }}>
              The CEE forward curve shows Classique and Précarité prices by maturity.
              It is used as a market reference for forward pricing, spot/term comparison and valuation analysis.
            </p>
          </div>

          <div style={{
            background: "var(--theme-panel)",
            border: "1px solid var(--theme-border-soft)",
            borderRadius: "2px",
            padding: "18px"
          }}>
            <SectionTitle>CEE Forward Curve — Classique vs Précarité by Maturity</SectionTitle>

            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={curveData}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                <XAxis
                  dataKey="tenor"
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "var(--theme-text-secondary)" }} />
                <Line
                  type="monotone"
                  dataKey="classique"
                  name="Classique Forward (€/MWhc)"
                  stroke="var(--theme-blue)"
                  strokeWidth={2}
                  dot={{ fill: "var(--theme-blue)", r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="precarite"
                  name="Précarité Forward (€/MWhc)"
                  stroke="var(--theme-amber)"
                  strokeWidth={2}
                  dot={{ fill: "var(--theme-amber)", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid var(--theme-border-soft)", borderRadius: "2px" }}>
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
                  const bg = "var(--theme-panel)";

                  return (
                    <tr
                      key={t}
                      style={{ borderBottom: "1px solid var(--theme-border-soft)", background: bg }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--theme-panel-alt)"}
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
                                background: "var(--theme-panel-alt)",
                                border: "1px solid #b8973a",
                                color: "var(--theme-text-primary)",
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
                                background: "var(--theme-panel-alt)",
                                border: "1px solid #b8973a",
                                color: "var(--theme-text-primary)",
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
                          <td style={{ ...S, fontSize: "13px", color: "var(--theme-blue)", padding: "9px 14px", fontWeight: 500 }}>
                            {fp ? N(fp.classique, 2) : "—"}
                          </td>

                          <td style={{ ...S, fontSize: "13px", color: "var(--theme-amber)", padding: "9px 14px", fontWeight: 500 }}>
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
                                  background: "var(--theme-sky)",
                                  color: THEME.selectedText,
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
                                  color: "var(--theme-text-muted)",
                                  border: "1px solid var(--theme-border)",
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
                                color: "var(--theme-text-muted)",
                                border: "1px solid var(--theme-border)",
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
            background: "var(--theme-panel)",
            border: "1px solid var(--theme-border-soft)",
            borderRadius: "2px",
            padding: "14px 16px"
          }}>
            <p style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", lineHeight: 1.6 }}>
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
            background: "var(--theme-panel)",
            border: "1px solid var(--theme-border-soft)",
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
            background: "var(--theme-panel)",
            border: "1px solid var(--theme-border-soft)",
            borderRadius: "2px",
            padding: "18px"
          }}>
            <SectionTitle>NPV Forward Price vs Spot by Maturity (€/MWhc)</SectionTitle>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={npvData} barGap={3}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                <XAxis
                  dataKey="tenor"
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "var(--theme-text-secondary)" }} />
                <ReferenceLine y={0} stroke="var(--theme-border-soft)" />
                <Bar
                  dataKey="clNpvVsSpotMWhc"
                  name="Classique NPV - Spot"
                  fill="var(--theme-blue)"
                  radius={[1, 1, 0, 0]}
                />
                <Bar
                  dataKey="prNpvVsSpotMWhc"
                  name="Précarité NPV - Spot"
                  fill="var(--theme-amber)"
                  radius={[1, 1, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{
            background: "var(--theme-panel)",
            border: "1px solid var(--theme-border-soft)",
            borderRadius: "2px",
            padding: "18px"
          }}>
           <SectionTitle>NPV Forward Impact vs Spot — Product Equivalent (€/m³)</SectionTitle>

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={npvData} barGap={3}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border-soft)" vertical={false} />
                <XAxis
                  dataKey="tenor"
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ ...S, fontSize: 9, fill: THEME.chartAxis }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ ...S, fontSize: 10, color: "var(--theme-text-secondary)" }} />
                <ReferenceLine y={0} stroke="var(--theme-border-soft)" />
                <Bar
                  dataKey="clFinancingM3"
                  name="Classique financing €/m³"
                  fill="var(--theme-blue)"
                  radius={[1, 1, 0, 0]}
                />
                <Bar
                  dataKey="prFinancingM3"
                  name="Précarité financing €/m³"
                  fill="var(--theme-amber)"
                  radius={[1, 1, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid var(--theme-border-soft)", borderRadius: "2px" }}>
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
                  <tr key={d.tenor} style={{ borderBottom: "1px solid var(--theme-border-soft)", background: "var(--theme-panel)" }}>
                    <td style={{ padding: "9px 14px" }}>
                      <Badge color={d.tenor === "SPOT" ? "gold" : "gray"}>{d.tenor}</Badge>
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>
                      {d.maturityDate}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>
                      {N(d.numberOfDays, 0)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-blue)", padding: "9px 14px" }}>
                      {N(d.clMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-amber)", padding: "9px 14px" }}>
                      {N(d.prMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-blue)", padding: "9px 14px" }}>
                      {N(d.clM3, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-amber)", padding: "9px 14px" }}>
                      {N(d.prM3, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-blue)", padding: "9px 14px" }}>
                      {N(d.clNpvMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: "var(--theme-amber)", padding: "9px 14px" }}>
                      {N(d.prNpvMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: d.clNpvVsSpotMWhc >= 0 ? "var(--theme-green)" : "var(--theme-red)", padding: "9px 14px" }}>
                      {d.clNpvVsSpotMWhc >= 0 ? "+" : ""}
                      {N(d.clNpvVsSpotMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: d.prNpvVsSpotMWhc >= 0 ? "var(--theme-green)" : "var(--theme-red)", padding: "9px 14px" }}>
                      {d.prNpvVsSpotMWhc >= 0 ? "+" : ""}
                      {N(d.prNpvVsSpotMWhc, 2)}
                    </td>

                    <td style={{ ...S, fontSize: "11px", color: d.totalNpvVsSpotM3 >= 0 ? "var(--theme-green)" : "var(--theme-red)", padding: "9px 14px", fontWeight: 700 }}>
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
            style={{ ...S, background: "var(--theme-panel-alt)", border: "1px solid var(--theme-border)", color: "var(--theme-text-primary)", borderRadius: "2px", padding: "7px 10px", fontSize: "10px", outline: "none", width: "220px" }}
          />

          <select
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            style={{ ...S, background: "var(--theme-panel-alt)", border: "1px solid var(--theme-border)", color: "var(--theme-text-secondary)", borderRadius: "2px", padding: "7px 10px", fontSize: "10px", outline: "none" }}
          >
            {auditUsers.map(u => {
              const user = u === "ALL" ? null : getUser(u);
              return <option key={u} value={u}>{u === "ALL" ? "All users" : user.name}</option>;
            })}
          </select>

          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            style={{ ...S, background: "var(--theme-panel-alt)", border: "1px solid var(--theme-border)", color: "var(--theme-text-secondary)", borderRadius: "2px", padding: "7px 10px", fontSize: "10px", outline: "none" }}
          >
            {actions.map(a => (
              <option key={a} value={a}>{a === "ALL" ? "All actions" : a.replace(/_/g, " ")}</option>
            ))}
          </select>

          <span style={{ ...S, fontSize: "10px", color: "var(--theme-text-muted)", alignSelf: "center" }}>
            {filteredAudit.length} / {audit.length} rows
          </span>
        </div>

        <GhostBtn onClick={handleExport}>↓ Export CSV</GhostBtn>
      </div>

      <div style={{ border: "1px solid var(--theme-border-soft)", borderRadius: "2px", overflow: "hidden" }}>
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
              const bg = "var(--theme-panel)";

              return (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--theme-border-soft)", background: bg }}>
                  <td style={{ ...S, fontSize: "10px", color: "var(--theme-text-muted)", padding: "9px 14px", whiteSpace: "nowrap" }}>
                    {new Date(a.ts).toLocaleString("fr-FR")}
                  </td>

                  <td style={{ padding: "9px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ ...S, width: "22px", height: "22px", borderRadius: "50%", background: "var(--theme-border-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "var(--theme-sky)", fontWeight: 600 }}>
                        {user.initials}
                      </span>
                      <span style={{ ...S, fontSize: "10px", color: "var(--theme-text-secondary)" }}>
                        {user.name}
                      </span>
                    </div>
                  </td>

                  <td style={{ padding: "9px 14px" }}>
                    <Badge color={AC[a.action] || "gray"}>
                      {(a.action || "UNKNOWN").replace(/_/g, " ")}
                    </Badge>
                  </td>

                  <td style={{ ...S, fontSize: "10px", color: "var(--theme-text-disabled)", padding: "9px 14px" }}>
                    {a.entity || "—"}
                  </td>

                  <td style={{ ...S, fontSize: "10px", color: "var(--theme-text-secondary)", padding: "9px 14px" }}>
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
      <td style={{ ...S, padding: "9px 12px", color: "var(--theme-text-secondary)", borderBottom: "1px solid var(--theme-border-soft)" }}>
        {label}
      </td>
      <td style={{
        ...S,
        padding: "9px 12px",
        color: highlight ? "var(--theme-green)" : "var(--theme-text-primary)",
        fontWeight: highlight ? 700 : 500,
        textAlign: "right",
        borderBottom: "1px solid var(--theme-border-soft)"
      }}>
        {value}
      </td>
    </tr>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "22px" }}>
        <p style={{ ...S, fontSize: "9px", color: "var(--theme-sky)", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: "8px" }}>
          CEE Tools
        </p>
        <h2 style={{ ...CG, fontSize: "24px", color: "var(--theme-text-primary)", marginBottom: "4px" }}>
          CEE PnL Calculator
        </h2>
        <p
          style={{
            ...S,
            fontSize: "12px",
            color: THEME.textSecondary,
            lineHeight: 1.5,
            fontWeight: 400,
            margin: 0,
            maxWidth: "760px"
          }}
        >
          PnL simulation including financing effect by product, CEE type, volume and maturity.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        <KPI label="PnL - EUR" value={N(result.pnlEur, 2) + " €"} color="emerald" large />
        <KPI label="PnL without Financing" value={N(result.pnlWithoutFinancing, 2) + " €"} color="sky" large />
        <KPI label="Net Financing Impact" value={N(result.netFinancingImpact, 2) + " €"} color={result.netFinancingImpact >= 0 ? "emerald" : "rose"} large />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "16px" }}>
        <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
          <p style={{ ...S, fontSize: "9px", color: "var(--theme-sky)", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "14px" }}>
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

        <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "18px" }}>
          <p style={{ ...S, fontSize: "9px", color: "var(--theme-sky)", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: "14px" }}>
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

      <div style={{ background: "var(--theme-panel)", border: "1px solid var(--theme-border-soft)", borderRadius: "2px", padding: "22px" }}>
        <p style={{ ...S, fontSize: "9px", color: "var(--theme-sky)", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: "8px" }}>
          CEE Conversion
        </p>

        <h2 style={{ ...CG, fontSize: "22px", color: "var(--theme-text-primary)", marginBottom: "4px" }}>
          €/MWhc → €/m³ Converter
        </h2>

        <p
          style={{
            ...S,
            fontSize: "12px",
            color: THEME.textSecondary,
            lineHeight: 1.5,
            fontWeight: 400,
            marginTop: 0,
            marginBottom: "18px",
            maxWidth: "760px"
          }}
        >
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
  const [appearance, setAppearance] = useState(() => {
    const savedAppearance =
      window.localStorage.getItem(
        "cee-dashboard-appearance"
      );

    return savedAppearance === "light"
      ? "light"
      : "dark";
  });
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
  const [lastModifiedAt, setLastModifiedAt] = useState(null);

  const activeTheme =
  THEME_PRESETS[appearance];

  const themeVariables = {
    "--theme-page": activeTheme.page,
    "--theme-panel": activeTheme.panel,
    "--theme-panel-alt": activeTheme.panelAlt,
    "--theme-table-header": activeTheme.tableHeader,
    "--theme-row-alt": activeTheme.rowAlt,

    "--theme-text-primary": activeTheme.textPrimary,
    "--theme-text-secondary": activeTheme.textSecondary,
    "--theme-text-muted": activeTheme.textMuted,
    "--theme-text-label": activeTheme.textLabel,
    "--theme-text-disabled": activeTheme.textDisabled,

    "--theme-section-title": activeTheme.sectionTitle,
    "--theme-control-text": activeTheme.controlText,

    "--theme-border": activeTheme.border,
    "--theme-border-soft": activeTheme.borderSoft,
    "--theme-hover": activeTheme.hover,

    "--theme-grid-line": activeTheme.gridLine,
    "--theme-chart-grid": activeTheme.chartGrid,
    "--theme-chart-axis": activeTheme.chartAxis,

    "--theme-blue": activeTheme.blue,
    "--theme-sky": activeTheme.sky,
    "--theme-green": activeTheme.green,
    "--theme-red": activeTheme.red,
    "--theme-amber": activeTheme.amber,
    "--theme-orange": activeTheme.orange,
    "--theme-purple": activeTheme.purple,
    "--theme-gold": activeTheme.gold,
    "--theme-teal": activeTheme.teal,

    "--theme-selected-text": activeTheme.selectedText,

    "--theme-success-bg": activeTheme.successBg,
    "--theme-success-border": activeTheme.successBorder,
    "--theme-success-text": activeTheme.successText,

    "--theme-warning-bg": activeTheme.warningBg,
    "--theme-warning-border": activeTheme.warningBorder,
    "--theme-warning-text": activeTheme.warningText,

    "--theme-danger-bg": activeTheme.dangerBg,
    "--theme-danger-border": activeTheme.dangerBorder,
    "--theme-danger-text": activeTheme.dangerText,

    "--theme-info-bg": activeTheme.infoBg,
    "--theme-info-border": activeTheme.infoBorder,
    "--theme-info-text": activeTheme.infoText,

    "--theme-neutral-bg": activeTheme.neutralBg,
    "--theme-neutral-border": activeTheme.neutralBorder,
    "--theme-neutral-text": activeTheme.neutralText,

    "--theme-purple-bg": activeTheme.purpleBg,
    "--theme-purple-border": activeTheme.purpleBorder,
    "--theme-purple-text": activeTheme.purpleText,

    "--theme-gold-bg": activeTheme.goldBg,
    "--theme-gold-border": activeTheme.goldBorder,
    "--theme-gold-text": activeTheme.goldText,

    "--theme-teal-bg": activeTheme.tealBg,
    "--theme-teal-border": activeTheme.tealBorder,
    "--theme-teal-text": activeTheme.tealText,

    "--theme-overlay": activeTheme.overlay,
    "--theme-shadow": activeTheme.shadow
  };

  useEffect(() => {
    window.localStorage.setItem(
      "cee-dashboard-appearance",
      appearance
    );

    document.documentElement.style.colorScheme =
      appearance;
  }, [appearance]);

  const isViewer = currentUser?.role === "viewer";
  const canEdit = currentUser?.role === "trader" || currentUser?.role === "approver";
  const canApprove = currentUser?.role === "approver";
  const canCreate = currentUser?.role === "trader";
  const canManageObligations =
    currentUser?.role === "trader";

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
        { data: ad, error: e6 },
        { data: md, error: e7 }
      ] = await Promise.all([
        supabase.from("users").select("*"),
        supabase.from("trades").select("*").order("created_at"),
        supabase.from("obligations").select("*").order("month"),
        supabase.from("market_prices").select("*").order("date"),
        supabase.from("forward_curve").select("*"),
        supabase
          .from("audit_log")
          .select("*")
          .order("ts", { ascending: false })
          .limit(200),
        supabase
          .from("app_metadata")
          .select("last_modified_at")
          .eq("id", "global")
          .maybeSingle()
      ]);

      if (e1 || e2 || e3 || e4 || e5 || e6 || e7) {
        throw new Error((e1 || e2 || e3 || e4 || e5 || e6 || e7).message);
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
        riskPerformanceMt:
          t.risk_performance_mt != null
            ? Number(t.risk_performance_mt)
            : 0,

        defaultRisk:
          t.default_risk != null
            ? Number(t.default_risk)
            : 0,

        regulatoryRisk:
          t.regulatory_risk != null
            ? Number(t.regulatory_risk)
            : 0,

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
      setLastModifiedAt(md?.last_modified_at ?? null);

    } catch (e) {
      setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }
  
  useEffect(() => {
    const metadataChannel = supabase
      .channel("global-last-modified")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_metadata",
          filter: "id=eq.global"
        },
        payload => {
          const updatedDate = payload.new?.last_modified_at;

          if (updatedDate) {
            setLastModifiedAt(updatedDate);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(metadataChannel);
    };
  }, []);

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

  const handleAddTrade = useCallback(
    async trade => {
      const {
        creditedVolume,
        uncreditedVolume
      } = getCreditingVolumes(trade);

      const {
        defaultRisk,
        regulatoryRisk
      } = calcPaidRiskSplit(trade);

      const tradeToSave = {
        ...trade,

        // Normalisation des alias utilisés dans le front
        volumeCredited:
          creditedVolume,

        volumeDeposited:
          creditedVolume,

        volumeRemainingToBeCredited:
          uncreditedVolume,

        volumeRemainingToBeDeposited:
          uncreditedVolume,

        riskPerformanceMt:
          Number(
            trade.riskPerformanceMt ?? 0
          ),

        defaultRisk,

        regulatoryRisk
      };

      // Ajout immédiat dans l'interface
      setTrades(currentTrades => [
        ...currentTrades,
        tradeToSave
      ]);

      await persist("trades", {
        id:
          tradeToSave.id,

        cee_type:
          tradeToSave.ceeType,

        vendor:
          tradeToSave.vendor,

        deal_type:
          tradeToSave.dealType,

        period:
          tradeToSave.period,

        volume:
          tradeToSave.volume,

        price:
          tradeToSave.price,

        month:
          tradeToSave.month,

        status:
          tradeToSave.status,

        priced:
          tradeToSave.priced,

        statut:
          tradeToSave.statut,

        ranking:
          tradeToSave.ranking,

        emmy_validated:
          tradeToSave.emmyValidated,

        created_by:
          tradeToSave.createdBy,

        approved_by:
          tradeToSave.approvedBy,

        created_at:
          tradeToSave.createdAt,

        year:
          tradeToSave.year ??
          (
            Number(
              String(
                tradeToSave.month || ""
              ).slice(0, 4)
            ) || null
          ),

        operation_type:
          tradeToSave.operationType ||
          "Achat",

        pricing_month:
          tradeToSave.pricingMonth ||
          null,

        comments:
          tradeToSave.comments ||
          null,

        sourcing:
          tradeToSave.sourcing ||
          null,

        tolerance_pct:
          tradeToSave.tolerancePct ??
          null,

        volume_m3_equivalent:
          tradeToSave.volumeM3Equivalent ??
          null,

        approval:
          tradeToSave.approval ||
          null,

        contract_yes_no:
          tradeToSave.contractYesNo,

        contract_signed:
          tradeToSave.contractSigned,

        contract_date:
          tradeToSave.contractDate ||
          null,

        payment_terms:
          tradeToSave.paymentTerms ||
          null,

        volume_deposited:
          tradeToSave.volumeCredited,

        volume_remaining_to_be_deposited:
          tradeToSave.volumeRemainingToBeCredited,

        validated:
          tradeToSave.validated,

        validation_date:
          tradeToSave.validationDate ||
          null,

        payment:
          tradeToSave.payment,

        payment_date:
          tradeToSave.paymentDate ||
          null,

        cp_ranking:
          tradeToSave.cpRanking ||
          null,

        risk_performance_mt:
          tradeToSave.riskPerformanceMt,

        default_risk:
          tradeToSave.defaultRisk,

        regulatory_risk:
          tradeToSave.regulatoryRisk
      });

      await addAudit({
        action: "TRADE_CREATED",
        entity: tradeToSave.id,
        detail:
          `BUY ${N(
            tradeToSave.volume,
            3
          )} GWhc ` +
          `${tradeToSave.ceeType} @ ` +
          `${N(
            tradeToSave.price,
            0
          )} — ${tradeToSave.vendor}`
      });
    },
    [
      persist,
      addAudit
    ]
  );

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

  const handleUpdateTrade = useCallback(
    async (id, patch) => {
      const tradeBefore = trades.find(
        trade => trade.id === id
      );

      if (!tradeBefore) {
        console.error(`Trade not found: ${id}`);
        return;
      }

      const updatedAt = new Date().toISOString();

      const tradeAfter = {
        ...tradeBefore,
        ...patch,
        updatedAt
      };

      // Synchronisation des alias métier / techniques
      if ("volumeCredited" in patch) {
        tradeAfter.volumeDeposited =
          patch.volumeCredited;
      }

      if ("volumeDeposited" in patch) {
        tradeAfter.volumeCredited =
          patch.volumeDeposited;
      }

      if ("volumeRemainingToBeCredited" in patch) {
        tradeAfter.volumeRemainingToBeDeposited =
          patch.volumeRemainingToBeCredited;
      }

      if ("volumeRemainingToBeDeposited" in patch) {
        tradeAfter.volumeRemainingToBeCredited =
          patch.volumeRemainingToBeDeposited;
      }

      // Recalcul de la répartition du risque payé
      const {
        defaultRisk,
        regulatoryRisk
      } = calcPaidRiskSplit(tradeAfter);

      tradeAfter.defaultRisk =
        defaultRisk;

      tradeAfter.regulatoryRisk =
        regulatoryRisk;

      // Optimistic update immédiat pour recalculer
      // le dashboard et le reporting sans attendre Supabase
      setTrades(currentTrades =>
        currentTrades.map(trade =>
          trade.id === id
            ? tradeAfter
            : trade
        )
      );

      const dbPatch = {};

      // Core trade fields
      if ("ceeType" in patch) {
        dbPatch.cee_type = patch.ceeType;
      }

      if ("vendor" in patch) {
        dbPatch.vendor = patch.vendor;
      }

      if ("dealType" in patch) {
        dbPatch.deal_type = patch.dealType;
      }

      if ("period" in patch) {
        dbPatch.period = patch.period;
      }

      if ("volume" in patch) {
        dbPatch.volume = patch.volume;
      }

      if ("price" in patch) {
        dbPatch.price = patch.price;
      }

      if ("month" in patch) {
        dbPatch.month = patch.month;
      }

      if ("status" in patch) {
        dbPatch.status = patch.status;
      }

      if ("priced" in patch) {
        dbPatch.priced = patch.priced;
      }

      if ("statut" in patch) {
        dbPatch.statut = patch.statut;
      }

      if ("ranking" in patch) {
        dbPatch.ranking = patch.ranking;
      }

      if ("emmyValidated" in patch) {
        dbPatch.emmy_validated =
          patch.emmyValidated;
      }

      // Extended Excel fields
      if ("year" in patch) {
        dbPatch.year = patch.year;
      }

      if ("operationType" in patch) {
        dbPatch.operation_type =
          patch.operationType;
      }

      if ("pricingMonth" in patch) {
        dbPatch.pricing_month =
          patch.pricingMonth;
      }

      if ("comments" in patch) {
        dbPatch.comments = patch.comments;
      }

      if ("sourcing" in patch) {
        dbPatch.sourcing = patch.sourcing;
      }

      if ("tolerancePct" in patch) {
        dbPatch.tolerance_pct =
          patch.tolerancePct;
      }

      if ("volumeM3Equivalent" in patch) {
        dbPatch.volume_m3_equivalent =
          patch.volumeM3Equivalent;
      }

      if ("approval" in patch) {
        dbPatch.approval = patch.approval;
      }

      if ("contractYesNo" in patch) {
        dbPatch.contract_yes_no =
          patch.contractYesNo;
      }

      if ("contractSigned" in patch) {
        dbPatch.contract_signed =
          patch.contractSigned;
      }

      if ("contractDate" in patch) {
        dbPatch.contract_date =
          patch.contractDate;
      }

      if ("paymentTerms" in patch) {
        dbPatch.payment_terms =
          patch.paymentTerms;
      }

      // Business wording = credited on EMMY
      // Technical DB column = volume_deposited
      if ("volumeDeposited" in patch) {
        dbPatch.volume_deposited =
          patch.volumeDeposited;
      }

      if ("volumeCredited" in patch) {
        dbPatch.volume_deposited =
          patch.volumeCredited;
      }

      if ("volumeRemainingToBeDeposited" in patch) {
        dbPatch.volume_remaining_to_be_deposited =
          patch.volumeRemainingToBeDeposited;
      }

      if ("volumeRemainingToBeCredited" in patch) {
        dbPatch.volume_remaining_to_be_deposited =
          patch.volumeRemainingToBeCredited;
      }

      if ("validated" in patch) {
        dbPatch.validated = patch.validated;
      }

      if ("validationDate" in patch) {
        dbPatch.validation_date =
          patch.validationDate;
      }

      if ("payment" in patch) {
        dbPatch.payment = patch.payment;
      }

      if ("paymentDate" in patch) {
        dbPatch.payment_date =
          patch.paymentDate;
      }

      if ("cpRanking" in patch) {
        dbPatch.cp_ranking =
          patch.cpRanking;
      }

      if ("riskPerformanceMt" in patch) {
        dbPatch.risk_performance_mt =
          patch.riskPerformanceMt;
      }

      if ("createdBy" in patch) {
        dbPatch.created_by =
          patch.createdBy;
      }

      if ("approvedBy" in patch) {
        dbPatch.approved_by =
          patch.approvedBy;
      }

      // Ces deux valeurs sont toujours recalculées,
      // même lorsque le patch porte uniquement sur le paiement,
      // le crédit EMMY, le volume ou le prix.
      dbPatch.default_risk =
        tradeAfter.defaultRisk;

      dbPatch.regulatory_risk =
        tradeAfter.regulatoryRisk;

      dbPatch.updated_at =
        updatedAt;

      const { data, error } =
        await supabase
          .from("trades")
          .update(dbPatch)
          .eq("id", id)
          .select(
            [
              "id",
              "priced",
              "default_risk",
              "regulatory_risk",
              "updated_at"
            ].join(", ")
          )
          .maybeSingle();

      if (error || !data) {
        console.error(
          "Trade update error:",
          error
        );

        alert(
          "You do not have permission to edit the blotter"
        );

        // Annule visuellement l'optimistic update
        // en rechargeant les données réelles de Supabase
        await loadAll({
          silent: true
        });

        return;
      }

      await addAudit({
        action: "TRADE_UPDATED",
        entity: id,
        detail:
          `Trade updated — ` +
          `${tradeBefore.vendor} · ` +
          `${tradeBefore.ceeType} · ` +
          `${N(tradeBefore.volume, 3)} GWhc`
      });
    },
    [
      trades,
      addAudit,
      loadAll
    ]
  );

  const handleAddObligation = useCallback(
    async obligation => {
      // Mise à jour immédiate de l'interface
      setObligations(currentObligations => [
        ...currentObligations,
        obligation
      ]);

      const { error } = await supabase
        .from("obligations")
        .insert({
          id: obligation.id,
          month: obligation.month,
          product: obligation.product,
          volume_m3: obligation.volume_m3,
          price_cl: obligation.priceCl,
          price_pr: obligation.pricePr,
          priced: obligation.priced,
          client: obligation.client,
          cl_gwhc: obligation.clGwhc,
          pr_gwhc: obligation.prGwhc
        });

      if (error) {
        console.error(
          "Obligation creation error:",
          error
        );

        alert(
          "The obligation could not be created."
        );

        // Annule l'ajout optimiste si Supabase refuse l'insertion
        await loadAll({
          silent: true
        });

        return;
      }

      await addAudit({
        action: "OBLIG_ADDED",
        entity: obligation.id,
        detail:
          `${obligation.month} · ` +
          `${obligation.product} · ` +
          `${N(obligation.volume_m3, 0)} m³`
      });
    },
    [
      addAudit,
      loadAll
    ]
  );

  const handleUpdateObligation = useCallback(
    async (id, rawVolumeM3) => {
      const obligationBefore = obligations.find(
        obligation => obligation.id === id
      );

      if (!obligationBefore) {
        return false;
      }

      const volumeM3 = Number(rawVolumeM3);

      if (
        !Number.isFinite(volumeM3) ||
        volumeM3 < 0
      ) {
        alert("Please enter a valid positive volume.");
        return false;
      }

      if (
        Math.abs(
          volumeM3 -
          Number(obligationBefore.volume_m3)
        ) < 0.000001
      ) {
        return true;
      }

      const cee = calcCEE(
        volumeM3,
        obligationBefore.product
      );

      const updatedObligation = {
        ...obligationBefore,
        volume_m3: volumeM3,
        clGwhc: cee.classique,
        prGwhc: cee.precarite
      };

      // Immediate refresh of every dashboard component
      setObligations(current =>
        current.map(obligation =>
          obligation.id === id
            ? updatedObligation
            : obligation
        )
      );

      const { data, error } = await supabase
        .from("obligations")
        .update({
          volume_m3: volumeM3,
          cl_gwhc: cee.classique,
          pr_gwhc: cee.precarite
        })
        .eq("id", id)
        .select(
          "id, volume_m3, cl_gwhc, pr_gwhc"
        )
        .maybeSingle();

      if (error || !data) {
        console.error(
          "Obligation update error:",
          error
        );

        alert(
          "The obligation could not be updated."
        );

        // Restore the real database state
        await loadAll({ silent: true });

        return false;
      }

      await addAudit({
        action: "OBLIG_UPDATED",
        entity: id,
        detail:
          `${obligationBefore.month} · ` +
          `${obligationBefore.client} · ` +
          `${N(obligationBefore.volume_m3, 0)} → ` +
          `${N(volumeM3, 0)} m³`
      });

      return true;
    },
    [
      obligations,
      addAudit,
      loadAll
    ]
  );

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
    <div style={{...themeVariables,background:THEME.page,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:THEME.textPrimary}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"Inter, sans-serif",fontSize:"32px",color:"var(--theme-sky)",marginBottom:"16px"}}>CEE Platform</div>
        <div style={{fontFamily:"IBM Plex Mono, monospace",fontSize:"11px",color:"var(--theme-text-muted)"}}>Connecting to database…</div>
      </div>
    </div>
  );

  if(error) return(
    <div style={{...themeVariables,background:THEME.page,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:THEME.textPrimary}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"Inter, sans-serif",fontSize:"28px",color:"var(--theme-red)",marginBottom:"12px"}}>Connection Error</div>
        <div style={{fontFamily:"IBM Plex Mono, monospace",fontSize:"11px",color:"var(--theme-text-secondary)"}}>{error}</div>
      </div>
    </div>
  );

  if (!currentUser) return (
    <div style={{ ...themeVariables,minHeight:"100vh",background:THEME.page,display:"flex",alignItems:"center",justifyContent:"center",color:THEME.textPrimary }}>
      <div style={{ width:"360px",background:"var(--theme-panel)",border:"1px solid var(--theme-border-soft)",borderRadius:"2px",padding:"26px" }}>
        <p style={{ ...S,fontSize:"9px",color:"var(--theme-sky)",letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:"8px" }}>
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
            style={{ ...S,background:"var(--theme-panel-alt)",border:"1px solid var(--theme-border)",color:"var(--theme-text-primary)",padding:"10px",borderRadius:"2px",outline:"none" }}
          />

          <input
            type="password"
            placeholder="Password"
            value={loginForm.password}
            onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
            style={{ ...S,background:"var(--theme-panel-alt)",border:"1px solid var(--theme-border)",color:"var(--theme-text-primary)",padding:"10px",borderRadius:"2px",outline:"none" }}
          />

          {loginError && (
            <p style={{ ...S,fontSize:"11px",color:"var(--theme-red)" }}>
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

  const appDisplayDate = (() => {
    if (!lastModifiedAt) return null;

    const date = new Date(lastModifiedAt);

    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Paris"
    });
  })();

  return(
    <div
      style={{
        ...themeVariables,
        minHeight: "100vh",
        background: THEME.page,
        color: THEME.textPrimary,
        transition:
          "background 0.2s ease, color 0.2s ease"
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage:
            `linear-gradient(${THEME.gridLine} 1px, transparent 1px), ` +
            `linear-gradient(90deg, ${THEME.gridLine} 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
          pointerEvents: "none",
          zIndex: 0
        }}
      />
      <div style={{ position:"relative",zIndex:1,maxWidth:"1400px",margin:"0 auto",padding:"0 28px 80px" }}>
        <header
          style={{
            padding: "28px 0 16px",
            borderBottom: `1px solid ${THEME.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: "20px"
          }}
        >
          <div>
            <p
              style={{
                ...S,
                fontSize: "9px",
                color: THEME.sky,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                margin: 0,
                marginBottom: "5px"
              }}
            >
              CEE Inventory Management · Position · PnL · P6 Obligation
            </p>

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "12px",
                flexWrap: "wrap"
              }}
            >
              <h1
                style={{
                  ...CG,
                  fontSize: "32px",
                  fontWeight: 700,
                  color: THEME.textPrimary,
                  lineHeight: 1,
                  margin: 0
                }}
              >
                CEE Dashboard
              </h1>

              <span
                style={{
                  ...S,
                  fontSize: "11px",
                  color: THEME.textMuted,
                  fontWeight: 500
                }}
              >
                {appDisplayDate
                  ? `Data as of ${appDisplayDate}`
                  : "Loading…"}
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px"
            }}
          >
            <button
              type="button"
              onClick={() =>
                setAppearance(current =>
                  current === "dark"
                    ? "light"
                    : "dark"
                )
              }
              title={
                appearance === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              aria-label={
                appearance === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "34px",
                height: "34px",
                padding: 0,
                background: THEME.panel,
                color: THEME.textPrimary,
                border: `1px solid ${THEME.border}`,
                borderRadius: "3px",
                cursor: "pointer",
                boxShadow:
                  appearance === "light"
                    ? "0 1px 4px rgba(15, 23, 42, 0.10)"
                    : "none",
                transition:
                  "background 0.2s ease, color 0.2s ease, border-color 0.2s ease"
              }}
            >
              {appearance === "dark" ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.42 1.42" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.42" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
                </svg>
              )}
            </button>

            <div
              style={{
                minWidth: "60px"
              }}
            >
              <p
                style={{
                  ...S,
                  fontSize: "11px",
                  color: THEME.textPrimary,
                  fontWeight: 600,
                  lineHeight: 1.25,
                  margin: 0
                }}
              >
                {currentUser.name}
              </p>

              <p
                style={{
                  ...S,
                  fontSize: "9px",
                  color: THEME.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  lineHeight: 1.25,
                  margin: 0,
                  marginTop: "2px"
                }}
              >
                {currentUser.role}
              </p>
            </div>

            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                setCurrentUser(null);
                setSession(null);
              }}
              style={{
                ...S,
                fontSize: "9px",
                padding: "7px 10px",
                background: THEME.panel,
                color: THEME.textSecondary,
                border: `1px solid ${THEME.border}`,
                borderRadius: "2px",
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                transition:
                  "background 0.2s ease, color 0.2s ease, border-color 0.2s ease"
              }}
            >
              Logout
            </button>
          </div>
        </header>

        <div style={{ display:"flex",gap:"16px",borderBottom:"1px solid var(--theme-border)",marginBottom:"22px",overflowX:"auto" }}>
          {TABS.map(t=>(
            <button
              key={t.id}
              onClick={()=>setTab(t.id)}
              style={{
                ...S,
                background: "none",
                border: "none",
                fontSize: "10px",
                fontWeight: tab === t.id ? 600 : 500,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                padding: "12px 0",
                cursor: "pointer",
                whiteSpace: "nowrap",

                color:
                  tab === t.id
                    ? THEME.sky
                    : THEME.controlText,

                borderBottom:
                  tab === t.id
                    ? "1px solid var(--theme-amber)"
                    : "1px solid transparent",

                transition: "color 0.2s ease"
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "dashboard" && (
          <Dashboard
            trades={trades}
            obligations={obligations}
            prices={prices}
            curve={curve}
            displayDate={appDisplayDate}
          />
        )}
        {tab === "reporting" && (
          <Reporting
            trades={trades}
            obligations={obligations}
            prices={prices}
            curve={curve}
            displayDate={appDisplayDate}
          />
        )}
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
        {tab === "obligation" && (
          <ObligationTab
            obligations={obligations}
            onAdd={handleAddObligation}
            onUpdate={handleUpdateObligation}
            onDelete={id =>
              setObligations(current =>
                current.filter(
                  obligation => obligation.id !== id
                )
              )
            }
            canEdit={canManageObligations}
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
      <Analytics />
      </div>
    </div>
  );
}

