import { useState, useMemo, useCallback, useEffect } from "react";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// PARAMS
// ─────────────────────────────────────────────────────────────────────────────
const PARAMS = {
  CARBURANT: { label:"Carburant (Road Fuel)", kwhc_per_m3:8718,  coeff_precarite:0.364, coeff_correctif:0.847 },
  FOD:       { label:"FOD (Fuel Oil Dom.)",   kwhc_per_m3:11078, coeff_precarite:0.364, coeff_correctif:0.847 },
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
  { id:"u1", name:"Sophie Martin",  role:"trader",   initials:"SM" },
  { id:"u2", name:"Julien Dufour",  role:"trader",   initials:"JD" },
  { id:"u3", name:"Clara Bernard",  role:"approver", initials:"CB" },
];

// ─────────────────────────────────────────────────────────────────────────────
// REAL DATA FROM CEE_DASHBOARD_06032026.xlsx
// ─────────────────────────────────────────────────────────────────────────────
const MONTHS_LIST = ["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09","2026-10","2026-11","2026-12"];

const REAL_TRADES = [
  // ── CEE Classique (CEE Classique sheet) ──
  { id:"t01", ceeType:"CLASSIQUE", vendor:"Stock P5",                     dealType:"Fixed Price", period:"P6", volume:559.329645,       price:7310.155411,  month:"2026-01", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-01-02T09:00:00Z", ranking:"AAA", statut:"Attribué",              priced:true, emmyValidated:true },
  { id:"t02", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026)",            dealType:"Fixed Price", period:"P6", volume:263.952,          price:8350,  month:"2026-01", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-01-05T09:00:00Z", ranking:"BBB", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t03", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026)",            dealType:"Fixed Price", period:"P6", volume:236.048,          price:8350,  month:"2026-02", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-02-03T09:00:00Z", ranking:"BBB", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t04", ceeType:"CLASSIQUE", vendor:"ACT (Mandat 2026)",             dealType:"Fixed Price", period:"P6", volume:333.19,           price:9000,  month:"2026-02", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-02-04T09:00:00Z", ranking:"AAA", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t05", ceeType:"CLASSIQUE", vendor:"ACT (Mandat 2026)",             dealType:"Fixed Price", period:"P6", volume:1416.81,          price:9000,  month:"2026-03", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-02T09:00:00Z", ranking:"AAA", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t06", ceeType:"CLASSIQUE", vendor:"ACT (Contrat de Regroupement)", dealType:"Fixed Price", period:"P6", volume:1000,             price:9200,  month:"2026-03", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-03T09:00:00Z", ranking:"AAA", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t07", ceeType:"CLASSIQUE", vendor:"OTC France",                    dealType:"Fixed Price", period:"P6", volume:440,              price:9100,  month:"2026-03", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-04T09:00:00Z", ranking:"AAA", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t08", ceeType:"CLASSIQUE", vendor:"ACT (Mandat 2026)",             dealType:"Fixed Price", period:"P6", volume:250,              price:8600,  month:"2026-03", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-04T10:00:00Z", ranking:null,  statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t09", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Spot)",      dealType:"Fixed Price", period:"P6", volume:250,              price:8200,  month:"2026-03", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-05T09:00:00Z", ranking:"A+",  statut:"Pas encore contracté", priced:true, emmyValidated:false },
  { id:"t10", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-03", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t11", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-04", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t12", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-05", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t13", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-06", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t14", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-07", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t15", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-08", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t16", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-09", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t17", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-10", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t18", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-11", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t19", ceeType:"CLASSIQUE", vendor:"Eco-Environnement (Délég.)",    dealType:"Floating",   period:"P6", volume:181.818181818182,  price:8234,  month:"2026-12", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:"A+",  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t20", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026 - Indexé)",   dealType:"Floating",   period:"P6", volume:83.3333333333333,  price:7984,  month:"2026-07", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:null,  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t21", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026 - Indexé)",   dealType:"Floating",   period:"P6", volume:83.3333333333333,  price:7984,  month:"2026-08", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:null,  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t22", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026 - Indexé)",   dealType:"Floating",   period:"P6", volume:83.3333333333333,  price:7984,  month:"2026-09", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:null,  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t23", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026 - Indexé)",   dealType:"Floating",   period:"P6", volume:83.3333333333333,  price:7984,  month:"2026-10", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:null,  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t24", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026 - Indexé)",   dealType:"Floating",   period:"P6", volume:83.3333333333333,  price:7984,  month:"2026-11", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:null,  statut:"Attribué",              priced:false, emmyValidated:false },
  { id:"t25", ceeType:"CLASSIQUE", vendor:"OAAN (Mandat 2026 - Indexé)",   dealType:"Floating",   period:"P6", volume:83.3333333333333,  price:7984,  month:"2026-12", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-03-06T09:00:00Z", ranking:null,  statut:"Attribué",              priced:false, emmyValidated:false },
  // ── CEE Précarité (CEE Preca Achetés sheet) ──
  { id:"t30", ceeType:"PRECARITE", vendor:"Stock P5",                      dealType:"Fixed Price", period:"P6", volume:174.37509,         price:10248.985176, month:"2026-01", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-01-02T09:00:00Z", ranking:"AAA", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t31", ceeType:"PRECARITE", vendor:"ACT (Mandat 2026)",             dealType:"Fixed Price", period:"P6", volume:120,               price:14500, month:"2026-01", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-01-05T09:00:00Z", ranking:"AAA", statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t32", ceeType:"PRECARITE", vendor:"ACT (Mandat 2026)",             dealType:"Fixed Price", period:"P6", volume:5.3,               price:14500, month:"2026-01", status:"APPROVED", createdBy:"u1", approvedBy:"u3", createdAt:"2026-01-06T09:00:00Z", ranking:null,  statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t33", ceeType:"PRECARITE", vendor:"ACT (Mandat 2026)",             dealType:"Fixed Price", period:"P6", volume:74.7,              price:14500, month:"2026-02", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-02-03T09:00:00Z", ranking:null,  statut:"Attribué",              priced:true, emmyValidated:false },
  { id:"t34", ceeType:"PRECARITE", vendor:"Eco-Environnement",             dealType:"Fixed Price", period:"P6", volume:100,               price:14500, month:"2026-02", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-02-05T09:00:00Z", ranking:null,  statut:"Pas encore contracté", priced:true, emmyValidated:false },
  { id:"t35", ceeType:"PRECARITE", vendor:"Eco-Environnement",             dealType:"Fixed Price", period:"P6", volume:32.5,              price:14300, month:"2026-02", status:"APPROVED", createdBy:"u2", approvedBy:"u3", createdAt:"2026-02-06T09:00:00Z", ranking:null,  statut:"Pas encore contracté", priced:true, emmyValidated:false },
  { id:"t36", ceeType:"PRECARITE", vendor:"Eco-Environnement",             dealType:"Fixed Price", period:"P6", volume:467.5,             price:14300, month:"2026-03", status:"APPROVED", createdBy:"u2", approvedBy:"u3",  createdAt:"2026-03-06T09:00:00Z", ranking:null,  statut:"Pas encore contracté", priced:true, emmyValidated:false },
];

// Real daily prices from Quotation C2E Market sheet
const REAL_PRICES = [
  { id:"p01",  date:"2026-01-02", classique:9.36, precarite:16.03, enteredBy:"u1", enteredAt:"2026-01-02T08:00:00Z" },
  { id:"p02",  date:"2026-01-05", classique:9.15, precarite:16.03, enteredBy:"u1", enteredAt:"2026-01-05T08:00:00Z" },
  { id:"p03",  date:"2026-01-06", classique:9.11, precarite:16.03, enteredBy:"u1", enteredAt:"2026-01-06T08:00:00Z" },
  { id:"p04",  date:"2026-01-07", classique:9.11, precarite:16.03, enteredBy:"u1", enteredAt:"2026-01-07T08:00:00Z" },
  { id:"p05",  date:"2026-01-08", classique:9.15, precarite:16.03, enteredBy:"u1", enteredAt:"2026-01-08T08:00:00Z" },
  { id:"p06",  date:"2026-01-12", classique:9.10, precarite:16.03, enteredBy:"u1", enteredAt:"2026-01-12T08:00:00Z" },
  { id:"p07",  date:"2026-01-13", classique:9.07, precarite:16.03, enteredBy:"u1", enteredAt:"2026-01-13T08:00:00Z" },
  { id:"p08",  date:"2026-01-14", classique:9.02, precarite:16.15, enteredBy:"u1", enteredAt:"2026-01-14T08:00:00Z" },
  { id:"p09",  date:"2026-01-21", classique:9.02, precarite:16.20, enteredBy:"u1", enteredAt:"2026-01-21T08:00:00Z" },
  { id:"p10",  date:"2026-01-28", classique:9.02, precarite:16.39, enteredBy:"u1", enteredAt:"2026-01-28T08:00:00Z" },
  { id:"p11",  date:"2026-01-30", classique:8.97, precarite:16.39, enteredBy:"u1", enteredAt:"2026-01-30T08:00:00Z" },
  { id:"p12",  date:"2026-02-02", classique:9.02, precarite:16.39, enteredBy:"u2", enteredAt:"2026-02-02T08:00:00Z" },
  { id:"p13",  date:"2026-02-04", classique:9.03, precarite:16.38, enteredBy:"u2", enteredAt:"2026-02-04T08:00:00Z" },
  { id:"p14",  date:"2026-02-06", classique:8.91, precarite:16.38, enteredBy:"u2", enteredAt:"2026-02-06T08:00:00Z" },
  { id:"p15",  date:"2026-02-09", classique:9.02, precarite:16.38, enteredBy:"u2", enteredAt:"2026-02-09T08:00:00Z" },
  { id:"p16",  date:"2026-02-10", classique:8.96, precarite:16.38, enteredBy:"u2", enteredAt:"2026-02-10T08:00:00Z" },
  { id:"p17",  date:"2026-02-11", classique:8.95, precarite:16.55, enteredBy:"u1", enteredAt:"2026-02-11T08:00:00Z" },
  { id:"p18",  date:"2026-02-13", classique:8.95, precarite:16.55, enteredBy:"u1", enteredAt:"2026-02-13T08:00:00Z" },
  { id:"p19",  date:"2026-03-06", classique:8.96, precarite:16.44, enteredBy:"u1", enteredAt:"2026-03-06T08:00:00Z" },
];

const SEED_CURVE = {
  SPOT:    { classique:8.96,  precarite:16.44 },
  "S1-26": { classique:8.96,  precarite:16.05 },
  "S2-26": { classique:8.93,  precarite:15.81 },
  "S1-27": { classique:8.95,  precarite:15.85 },
  "S2-27": { classique:8.93,  precarite:15.08 },
  "S1-28": { classique:8.95,  precarite:15.04 },
  "S2-28": { classique:8.94,  precarite:14.64 },
};
const TENORS = ["SPOT","S1-26","S2-26","S1-27","S2-27","S1-28","S2-28"];

// Real obligations — GWhc taken EXACTLY from Obligation CEE sheet
// Jan: priced CL=823.2816, PR=299.6745 (incl. negative adjustment rows)
// Feb: priced CL=569.2397, PR=207.2033
// Mar: priced CL=549.7037, PR=200.0922 | unpriced CL=356.1979, PR=129.656
// Apr-Dec: all unpriced (obl_priced=0 → PnL=0, MtM=0)
const REAL_OBLIGATIONS = [
  // ── Jan 2026 — all priced (total: CL=823.2816, PR=299.6745) ──
  { id:"o01", month:"2026-01", product:"CARBURANT", volume_m3: 45308.873, priceCl:9100, pricePr:16000, priced:true,  client:"Spot",        clGwhc: 395.0028, prGwhc: 143.7810 },
  { id:"o02", month:"2026-01", product:"FOD",       volume_m3: 25463.256, priceCl:9100, pricePr:16000, priced:true,  client:"Spot",        clGwhc: 238.9234, prGwhc:  86.9681 },
  { id:"o03", month:"2026-01", product:"CARBURANT", volume_m3:  -500,     priceCl:9100, pricePr:16000, priced:true,  client:"Spot",        clGwhc:  -4.3590, prGwhc:  -1.5867 },
  { id:"o04", month:"2026-01", product:"FOD",       volume_m3:  -500,     priceCl:9100, pricePr:16000, priced:true,  client:"Spot",        clGwhc:  -4.6915, prGwhc:  -1.7077 },
  { id:"o05", month:"2026-01", product:"CARBURANT", volume_m3: 22758.2,   priceCl:8600, pricePr:15150, priced:true,  client:"Certas",      clGwhc: 198.4060, prGwhc:  72.2198 },
  // ── Feb 2026 — all priced (total: CL=569.2397, PR=207.2033) ──
  { id:"o06", month:"2026-02", product:"CARBURANT", volume_m3: 18764,     priceCl:9100, pricePr:16000, priced:true,  client:"Spot",        clGwhc: 163.5846, prGwhc:  59.5448 },
  { id:"o07", month:"2026-02", product:"FOD",       volume_m3:  5301,     priceCl:9100, pricePr:16000, priced:true,  client:"Spot",        clGwhc:  49.7396, prGwhc:  18.1052 },
  { id:"o08", month:"2026-02", product:"CARBURANT", volume_m3: 14905,     priceCl:9000, pricePr:15000, priced:true,  client:"Spot",        clGwhc: 129.9418, prGwhc:  47.2988 },
  { id:"o09", month:"2026-02", product:"FOD",       volume_m3:  2207,     priceCl:9000, pricePr:15000, priced:true,  client:"Spot",        clGwhc:  20.7084, prGwhc:   7.5379 },
  { id:"o10", month:"2026-02", product:"CARBURANT", volume_m3: 23545,     priceCl:8775, pricePr:16070, priced:true,  client:"Certas",      clGwhc: 205.2653, prGwhc:  74.7166 },
  // ── Mar 2026 — priced: CL=549.7037, PR=200.0922 | unpriced: CL=356.1979, PR=129.656 ──
  { id:"o11", month:"2026-03", product:"CARBURANT", volume_m3: 17143,     priceCl:9000, pricePr:15000, priced:true,  client:"Spot",        clGwhc: 149.4527, prGwhc:  54.4008 },
  { id:"o12", month:"2026-03", product:"FOD",       volume_m3:  3695,     priceCl:9000, pricePr:15000, priced:true,  client:"Spot",        clGwhc:  34.6704, prGwhc:  12.6200 },
  { id:"o13", month:"2026-03", product:"CARBURANT", volume_m3: 28690.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot",        clGwhc: 250.1223, prGwhc:  91.0445 },
  { id:"o14", month:"2026-03", product:"FOD",       volume_m3: 11305,     priceCl:9000, pricePr:15000, priced:false, client:"Spot",        clGwhc: 106.0756, prGwhc:  38.6115 },
  { id:"o15", month:"2026-03", product:"CARBURANT", volume_m3: 25269,     priceCl:8921, pricePr:14900, priced:true,  client:"Certas",      clGwhc: 220.2951, prGwhc:  80.1874 },
  { id:"o16", month:"2026-03", product:"CARBURANT", volume_m3: 16665,     priceCl:8921, pricePr:14900, priced:true,  client:"Certas Lyon", clGwhc: 145.2855, prGwhc:  52.8839 },
  // ── Apr–Jun (unpriced: CL=935.2111, PR=340.4168 per month) ──
  { id:"o_2026-04_s1", month:"2026-04", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-04_s2", month:"2026-04", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-04_c1", month:"2026-04", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-04_c2", month:"2026-04", product:"CARBURANT", volume_m3:18295.953, priceCl:8984, pricePr:16030, priced:false, client:"Certas Lyon", clGwhc:159.5041, prGwhc:58.0595 },
  { id:"o_2026-05_s1", month:"2026-05", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-05_s2", month:"2026-05", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-05_c1", month:"2026-05", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-05_c2", month:"2026-05", product:"CARBURANT", volume_m3:18295.953, priceCl:8984, pricePr:16030, priced:false, client:"Certas Lyon", clGwhc:159.5041, prGwhc:58.0595 },
  { id:"o_2026-06_s1", month:"2026-06", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-06_s2", month:"2026-06", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-06_c1", month:"2026-06", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-06_c2", month:"2026-06", product:"CARBURANT", volume_m3:18295.953, priceCl:8984, pricePr:16030, priced:false, client:"Certas Lyon", clGwhc:159.5041, prGwhc:58.0595 },
  // ── Jul–Sep (unpriced: CL=935.2111, PR=340.4168) ──
  { id:"o_2026-07_s1", month:"2026-07", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-07_s2", month:"2026-07", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-07_c1", month:"2026-07", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-07_c2", month:"2026-07", product:"CARBURANT", volume_m3:18295.953, priceCl:8984, pricePr:16030, priced:false, client:"Certas Lyon", clGwhc:159.5041, prGwhc:58.0595 },
  { id:"o_2026-08_s1", month:"2026-08", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-08_s2", month:"2026-08", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-08_c1", month:"2026-08", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-08_c2", month:"2026-08", product:"CARBURANT", volume_m3:18295.953, priceCl:8984, pricePr:16030, priced:false, client:"Certas Lyon", clGwhc:159.5041, prGwhc:58.0595 },
  { id:"o_2026-09_s1", month:"2026-09", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-09_s2", month:"2026-09", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-09_c1", month:"2026-09", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-09_c2", month:"2026-09", product:"CARBURANT", volume_m3:18295.953, priceCl:8984, pricePr:16030, priced:false, client:"Certas Lyon", clGwhc:159.5041, prGwhc:58.0595 },
  // ── Oct–Dec (unpriced: CL=775.707, PR=282.3573, no Certas Lyon) ──
  { id:"o_2026-10_s1", month:"2026-10", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-10_s2", month:"2026-10", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-10_c1", month:"2026-10", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-11_s1", month:"2026-11", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-11_s2", month:"2026-11", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-11_c1", month:"2026-11", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
  { id:"o_2026-12_s1", month:"2026-12", product:"CARBURANT", volume_m3:45833.333, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:399.575, prGwhc:145.4453 },
  { id:"o_2026-12_s2", month:"2026-12", product:"FOD", volume_m3:15000, priceCl:9000, pricePr:15000, priced:false, client:"Spot", clGwhc:140.746, prGwhc:51.2315 },
  { id:"o_2026-12_c1", month:"2026-12", product:"CARBURANT", volume_m3:27000, priceCl:8984, pricePr:16030, priced:false, client:"Certas", clGwhc:235.386, prGwhc:85.6805 },
];

const REAL_AUDIT = [
  { id:"a01", ts:"2026-01-02T09:00:00Z", user:"u1", action:"TRADE_CREATED",  entity:"t01", detail:"Import initial — Stock P5 Classique 559.33 GWhc @ 7 310 €/MWhc" },
  { id:"a02", ts:"2026-01-02T09:01:00Z", user:"u3", action:"TRADE_APPROVED", entity:"t01", detail:"Auto-approuvé (import)" },
  { id:"a03", ts:"2026-01-02T09:01:00Z", user:"u1", action:"TRADE_CREATED",  entity:"t30", detail:"Import initial — Stock P5 Précarité 174.375 GWhc @ 10 249 €/MWhc" },
  { id:"a04", ts:"2026-03-06T08:00:00Z", user:"u1", action:"PRICE_ADDED",    entity:"p19", detail:"Prix du jour 2026-03-06 : CL 8.96 — PR 16.44 €/MWhc" },
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
const S  = { fontFamily:"'IBM Plex Mono',monospace" };
const CG = { fontFamily:"'Cormorant Garamond',serif" };
const CHART_COLORS = { classique:"#5bc2e7", precarite:"#d4a843", green:"#6db87a", red:"#c96b6b", gold:"#b8973a", bg:"#161410", grid:"#1e1c18" };

function Badge({ children, color }) {
  const m={green:"#0f2e1a;#6db87a;#1d4a2a",red:"#2e1010;#c96b6b;#4a1c1c",amber:"#2e2410;#d4a843;#4a3a18",blue:"#101e2e;#6aace8;#1a3050",sky:"#0e2030;#5bc2e7;#1a3848",gray:"#1e1c18;#6b6350;#2e2b24",purple:"#1e1028;#b07ee8;#3a2050",gold:"#2a2010;#b8973a;#3a3020",teal:"#0e2820;#5bd4b4;#1a4838"}[color]||"#1e1c18;#6b6350;#2e2b24";
  const [bg,fg,bc]=m.split(";");
  return <span style={{ display:"inline-flex",alignItems:"center",padding:"2px 7px",borderRadius:"2px",fontSize:"10px",fontWeight:600,border:`1px solid ${bc}`,background:bg,color:fg,...S,letterSpacing:"0.06em" }}>{children}</span>;
}
function KPI({ label, value, sub, color, large }) {
  const c={emerald:"#6db87a",rose:"#c96b6b",sky:"#5bc2e7",amber:"#d4a843",gold:"#b8973a",gray:"#3a3428"}[color]||"#3a3428";
  return (
    <div style={{ background:"#161410",border:"1px solid #252219",borderLeft:`2px solid ${c}`,borderRadius:"2px",padding:large?"20px 22px":"15px 18px" }}>
      <p style={{ ...S,fontSize:"9px",color:"#4a4438",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:"5px" }}>{label}</p>
      <p style={{ ...S,fontSize:large?"26px":"20px",fontWeight:500,color:"#e8dfc8" }}>{value}</p>
      {sub&&<p style={{ ...S,fontSize:"10px",color:"#4a4438",marginTop:"3px" }}>{sub}</p>}
    </div>
  );
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(8,7,6,0.9)",backdropFilter:"blur(6px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#161410",border:"1px solid #2e2b24",borderRadius:"2px",width:"100%",maxWidth:wide?"860px":"520px",maxHeight:"92vh",overflowY:"auto",position:"relative" }}>
        <div style={{ position:"absolute",top:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent,#b8973a55,transparent)" }}/>
        <div style={{ padding:"20px 26px 14px",borderBottom:"1px solid #1e1c18",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <h3 style={{ ...CG,fontSize:"20px",fontWeight:600,color:"#e8dfc8" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#4a4438",fontSize:"20px",cursor:"pointer" }}>×</button>
        </div>
        <div style={{ padding:"18px 26px 22px" }}>{children}</div>
      </div>
    </div>
  );
}
function FL({ children }) { return <p style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:"5px" }}>{children}</p>; }
function FI({ label, ...p }) { return <div><FL>{label}</FL><input style={{ ...S,background:"#1a1815",border:"1px solid #2e2b24",color:"#e8dfc8",borderRadius:"2px",padding:"8px 10px",fontSize:"12px",width:"100%",outline:"none" }} {...p}/></div>; }
function FS({ label, children, ...p }) { return <div><FL>{label}</FL><select style={{ ...S,background:"#1a1815",border:"1px solid #2e2b24",color:"#e8dfc8",borderRadius:"2px",padding:"8px 10px",fontSize:"12px",width:"100%",outline:"none" }} {...p}>{children}</select></div>; }
function GoldBtn({ children, onClick }) { return <button onClick={onClick} style={{ background:"linear-gradient(135deg,#b8973a,#d4af55)",color:"#0e0d0b",border:"none",borderRadius:"2px",...S,fontSize:"11px",fontWeight:500,letterSpacing:"0.1em",textTransform:"uppercase",padding:"9px 18px",cursor:"pointer" }}>{children}</button>; }
function GhostBtn({ children, onClick }) { return <button onClick={onClick} style={{ background:"transparent",color:"#6b6350",border:"1px solid #2e2b24",borderRadius:"2px",...S,fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase",padding:"8px 14px",cursor:"pointer" }}>{children}</button>; }
function TH({ children }) { return <th style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.1em",padding:"9px 14px",textAlign:"left",whiteSpace:"nowrap",background:"#121110",borderBottom:"1px solid #1e1c18" }}>{children}</th>; }
function CovBar({ pct }) {
  const c=pct>=100?"#6db87a":pct>=70?"#d4a843":"#c96b6b";
  return <div style={{ display:"flex",alignItems:"center",gap:"8px" }}><div style={{ flex:1,height:"5px",background:"#1e1c18",borderRadius:"1px",overflow:"hidden" }}><div style={{ width:`${Math.min(pct,100)}%`,height:"100%",background:c,borderRadius:"1px" }}/></div><span style={{ ...S,fontSize:"10px",color:c,minWidth:"38px",textAlign:"right" }}>{N(pct,1)}%</span></div>;
}

// Custom chart tooltip
function ChartTip({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  return (
    <div style={{ background:"#1a1815",border:"1px solid #2e2b24",borderRadius:"2px",padding:"10px 14px" }}>
      <p style={{ ...S,fontSize:"10px",color:"#b8973a",marginBottom:"6px" }}>{label}</p>
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

  const SectionTitle = ({children}) => <p style={{ ...S,fontSize:"9px",color:"#b8973a",textTransform:"uppercase",letterSpacing:"0.18em",marginBottom:"14px",marginTop:"8px" }}>{children}</p>;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"16px" }}>
      {/* Report selector */}
      <div style={{ display:"flex",gap:"8px",flexWrap:"wrap" }}>
        {REPORTS.map(r=>(
          <button key={r.id} onClick={()=>setReport(r.id)} style={{ ...S,fontSize:"10px",padding:"7px 14px",borderRadius:"2px",border:"1px solid",cursor:"pointer",letterSpacing:"0.08em",textTransform:"uppercase",background:report===r.id?"#b8973a":"transparent",color:report===r.id?"#0e0d0b":"#4a4438",borderColor:report===r.id?"#b8973a":"#2e2b24" }}>{r.label}</button>
        ))}
      </div>

      {/* ── EXECUTIVE SUMMARY ── */}
      {report==="executive" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"22px 26px" }}>
            <p style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"4px" }}>Rapport de Gestion CEE — P6</p>
            <h2 style={{ ...CG,fontSize:"28px",fontWeight:700,color:"#e8dfc8",marginBottom:"2px" }}>Tableau de Bord Exécutif</h2>
            <p style={{ ...S,fontSize:"10px",color:"#4a4438" }}>Au {REAL_PRICES.slice(-1)[0]?.date ?? "2026-03-06"} · Période de référence: 2026 (P6)</p>
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
            <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>Couverture Globale 2026</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={[{name:"Couvert",value:Math.round(totalBought)},{name:"Non pricé",value:Math.round(totalUnpriced)},{name:"Découvert",value:Math.max(0,Math.round(totalOblP-totalBought))}]} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    <Cell fill="#6db87a"/><Cell fill="#c96b6b"/><Cell fill="#d4a843"/>
                  </Pie>
                  <Tooltip content={<ChartTip/>}/>
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ ...S,fontSize:"10px",color:"#6b6350" }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>Position Nette Mensuelle (GWhc) — Pricés</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barSize={18}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                  <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={40}/>
                  <Tooltip content={<ChartTip/>}/>
                  <ReferenceLine y={0} stroke="#2e2b24"/>
                  <Bar dataKey="netPos" name="Position nette" fill="#5bc2e7" radius={[1,1,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* PnL Bar + Cum line */}
          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>PnL Mensuel Réalisé (k€) + Cumulé</SectionTitle>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cumPnlData} barSize={20}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                <YAxis yAxisId="left"  tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={44}/>
                <YAxis yAxisId="right" orientation="right" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<ChartTip/>}/>
                <ReferenceLine yAxisId="left" y={0} stroke="#2e2b24"/>
                <Bar yAxisId="left" dataKey="pnl" name="PnL mensuel (k€)" fill="#6db87a" radius={[1,1,0,0]}/>
                <Line yAxisId="right" type="monotone" dataKey="cumPnl" name="Cumulé (k€)" stroke="#b8973a" strokeWidth={2} dot={false}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Vendor breakdown */}
          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Achats par Vendeur (GWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={vendorData} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" horizontal={false}/>
                <XAxis type="number" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{ ...S,fontSize:9,fill:"#8a7d62" }} axisLine={false} tickLine={false} width={170}/>
                <Tooltip content={<ChartTip/>}/>
                <Bar dataKey="vol" name="Volume (GWhc)" fill="#b8973a" radius={[0,1,1,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── POSITION & COUVERTURE ── */}
      {report==="position" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Obligation vs Achats par Mois (GWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<ChartTip/>}/>
                <Legend iconSize={8} wrapperStyle={{ ...S,fontSize:10,color:"#6b6350" }}/>
                <Bar dataKey="oblClP" name="Oblig. CL Pricée" fill="#1a3848" radius={[1,1,0,0]} stackId="obl"/>
                <Bar dataKey="oblPrP" name="Oblig. PR Pricée" fill="#2e2410" radius={[1,1,0,0]} stackId="obl"/>
                <Bar dataKey="bCl"    name="Acheté CL"        fill="#5bc2e7" radius={[1,1,0,0]} stackId="buy" fillOpacity={0.85}/>
                <Bar dataKey="bPr"    name="Acheté PR"        fill="#d4a843" radius={[1,1,0,0]} stackId="buy" fillOpacity={0.85}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>% Couverture par Mois</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyData}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={40} unit="%"/>
                <Tooltip content={<ChartTip/>}/>
                <ReferenceLine y={100} stroke="#6db87a" strokeDasharray="4 2" label={{ value:"100%",fill:"#6db87a",fontSize:9,...S }}/>
                <Area type="monotone" dataKey="covPct" name="Couverture %" stroke="#5bc2e7" fill="#5bc2e711" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Obligation Non Pricée (Forward) — GWhc à couvrir</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData.map(d=>({ ...d, unpriced:d.oblCl+d.oblPr-d.oblClP-d.oblPrP }))}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<ChartTip/>}/>
                <Bar dataKey="unpriced" name="Non pricé (GWhc)" fill="#c96b6b" radius={[1,1,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── PNL & MTM ── */}
      {report==="pnl" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px" }}>
            <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>PnL Réalisé Mensuel (k€)</SectionTitle>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData} barGap={3}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                  <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip content={<ChartTip/>}/>
                  <ReferenceLine y={0} stroke="#2e2b24"/>
                  <Bar dataKey="pnlCl" name="PnL Classique (k€)" fill="#5bc2e7" radius={[1,1,0,0]}/>
                  <Bar dataKey="pnlPr" name="PnL Précarité (k€)" fill="#d4a843" radius={[1,1,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
              <SectionTitle>MtM Open Position Mensuel (k€)</SectionTitle>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                  <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip content={<ChartTip/>}/>
                  <ReferenceLine y={0} stroke="#2e2b24"/>
                  <Bar dataKey="mtm" name="MtM (k€)" fill="#b8973a" radius={[1,1,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>PnL Cumulé YTD (k€)</SectionTitle>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cumPnlData}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                <XAxis dataKey="month" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={50}/>
                <Tooltip content={<ChartTip/>}/>
                <ReferenceLine y={0} stroke="#2e2b24"/>
                <Area type="monotone" dataKey="cumPnl" name="PnL cumulé (k€)" stroke="#6db87a" fill="#6db87a22" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── PRIX MARCHÉ ── */}
      {report==="market" && (
        <div style={{ display:"flex",flexDirection:"column",gap:"20px" }}>
          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Historique Prix C2E Market — Classique vs Précarité (€/MWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                <XAxis dataKey="date" tick={{ ...S,fontSize:8,fill:"#4a4438" }} axisLine={false} tickLine={false} interval={3}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={40} domain={["auto","auto"]}/>
                <Tooltip content={<ChartTip/>}/>
                <Legend iconSize={8} wrapperStyle={{ ...S,fontSize:10,color:"#6b6350" }}/>
                <Line type="monotone" dataKey="cl" name="Classique (€/MWhc)" stroke="#5bc2e7" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="pr" name="Précarité (€/MWhc)" stroke="#d4a843" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"18px" }}>
            <SectionTitle>Courbe Forward (€/MWhc)</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={TENORS.map(t=>({ tenor:t, cl:curve[t]?.classique, pr:curve[t]?.precarite }))}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e1c18" vertical={false}/>
                <XAxis dataKey="tenor" tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ ...S,fontSize:9,fill:"#4a4438" }} axisLine={false} tickLine={false} width={40} domain={["auto","auto"]}/>
                <Tooltip content={<ChartTip/>}/>
                <Legend iconSize={8} wrapperStyle={{ ...S,fontSize:10,color:"#6b6350" }}/>
                <Line type="monotone" dataKey="cl" name="Classique" stroke="#5bc2e7" strokeWidth={2} dot={{ fill:"#5bc2e7",r:3 }}/>
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
  // latestSpot in €/GWhc (trade prices are €/GWhc; market prices are €/MWhc → ×1000)
  const latestSpot = useMemo(()=>{
    if(!prices.length) return { classique:(curve.SPOT?.classique??8.96)*1000, precarite:(curve.SPOT?.precarite??16.44)*1000 };
    const p=[...prices].sort((a,b)=>b.date.localeCompare(a.date))[0];
    return { classique:p.classique*1000, precarite:p.precarite*1000 };
  },[prices,curve]);

  const rows = useMemo(()=>MONTHS_LIST.map(month=>{
    // Obligation volumes (priced = obligat. avec prix fixé; total = priced + non pricé)
    const oblClP = oblMonth(obligations,month,"CLASSIQUE",true);
    const oblPrP = oblMonth(obligations,month,"PRECARITE",true);
    const oblClT = oblMonth(obligations,month,"CLASSIQUE");
    const oblPrT = oblMonth(obligations,month,"PRECARITE");
    // Achats PRICÉS (trade.priced===true) vs totaux
    const bClP = sumVol(trades,"CLASSIQUE",month,true);
    const bPrP = sumVol(trades,"PRECARITE",month,true);
    const bCl  = sumVol(trades,"CLASSIQUE",month);      // tous (pour affichage total)
    const bPr  = sumVol(trades,"PRECARITE",month);
    // Prix moyens PRICÉS seulement pour PnL et MtM
    const aClP = wAvg(trades,"CLASSIQUE",month,true);
    const aPrP = wAvg(trades,"PRECARITE",month,true);
    // Prix moyens totaux (pour info)
    const aCl  = wAvg(trades,"CLASSIQUE",month);
    const aPr  = wAvg(trades,"PRECARITE",month);
    // Prix de vente moyen (avgSell des obligations pricées)
    const sCl = avgSellMonth(obligations,month,"CLASSIQUE");
    const sPr = avgSellMonth(obligations,month,"PRECARITE");
    // Position nette PRICÉE
    const netCl = bClP - oblClP;
    const netPr = bPrP - oblPrP;
    // Couverture sur base pricée
    const covPct = (oblClP+oblPrP)>0 ? (bClP+bPrP)/(oblClP+oblPrP)*100 : 0;
    // PnL = (avgSell - avgBuyPricé) × min(achetéPricé, oblPricée)
    const matchCl = Math.min(bClP, oblClP);
    const matchPr = Math.min(bPrP, oblPrP);
    const pnlCl = (oblClP>0.001 && aClP>0 && sCl>0) ? (sCl - aClP) * matchCl : 0;
    const pnlPr = (oblPrP>0.001 && aPrP>0 && sPr>0) ? (sPr - aPrP) * matchPr : 0;
    // MtM = (spot - avgBuyPricé) × position ouverte PRICÉE (achetéPricé > oblPricée)
    const openCl = (oblClP>0.001 && netCl>0) ? netCl : 0;
    const openPr = (oblPrP>0.001 && netPr>0) ? netPr : 0;
    const mtmCl = openCl>0 ? openCl * (latestSpot.classique*1000 - aClP) : 0;
    const mtmPr = openPr>0 ? openPr * (latestSpot.precarite*1000  - aPrP) : 0;
    // Non pricés
    const oblClU = oblClT - oblClP;
    const oblPrU = oblPrT - oblPrP;
    // Achats non pricés = achats totaux sur mois non pricés (trade.priced===false)
    const bClU = bCl - bClP;
    const bPrU = bPr - bPrP;
    return { month, oblClP, oblPrP, oblClT, oblPrT,
             bCl, bPr, bClP, bPrP, bClU, bPrU,
             aCl, aPr, aClP, aPrP, sCl, sPr,
             netCl, netPr, covPct, pnlCl, pnlPr, mtmCl, mtmPr,
             oblClU, oblPrU,
             unpricedBoughtCl:bClU, unpricedBoughtPr:bPrU };
  }),[trades,obligations,latestSpot]);

  const tot = useMemo(()=>({ oblCl:rows.reduce((s,r)=>s+r.oblClP,0), oblPr:rows.reduce((s,r)=>s+r.oblPrP,0), bCl:rows.reduce((s,r)=>s+r.bCl,0), bPr:rows.reduce((s,r)=>s+r.bPr,0), pnlCl:rows.reduce((s,r)=>s+r.pnlCl,0), pnlPr:rows.reduce((s,r)=>s+r.pnlPr,0), mtmCl:rows.reduce((s,r)=>s+r.mtmCl,0), mtmPr:rows.reduce((s,r)=>s+r.mtmPr,0), oblClU:rows.reduce((s,r)=>s+r.oblClU,0), oblPrU:rows.reduce((s,r)=>s+r.oblPrU,0) }),[rows]);

  const VIEWS=[{id:"position",label:"Position & Couverture"},{id:"pnl",label:"PnL Réalisé & MtM"},{id:"unpriced",label:"Oblig. Non Pricées"}];

  const pc=(v,color)=>v!=null?(<span style={{ ...S,fontSize:"12px",color:v>0?CHART_COLORS.green:v<0?CHART_COLORS.red:"#4a4438",fontWeight:v!==0?600:400 }}>{v>0?"+":""}{N(v,2)}</span>):"—";
  const pk=(v)=>v!=null?(<span style={{ ...S,fontSize:"12px",color:v>0?CHART_COLORS.green:v<0?CHART_COLORS.red:"#4a4438",fontWeight:v!==0?600:400 }}>{fK(v)}</span>):"—";

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ display:"flex",gap:"14px",borderBottom:"1px solid #1e1c18" }}>
        {VIEWS.map(v=><button key={v.id} onClick={()=>setView(v.id)} style={{ ...S,background:"none",border:"none",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",padding:"10px 0",cursor:"pointer",whiteSpace:"nowrap",color:view===v.id?"#b8973a":"#4a4438",borderBottom:view===v.id?"1px solid #b8973a":"1px solid transparent" }}>{v.label}</button>)}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px" }}>
        {view==="position" && <><KPI label="Oblig. CL Pricée" value={N(tot.oblCl,0)+" GWhc"} color="sky"/><KPI label="Acheté CL" value={N(tot.bCl,0)+" GWhc"} color="sky"/><KPI label="Oblig. PR Pricée" value={N(tot.oblPr,0)+" GWhc"} color="amber"/><KPI label="Acheté PR" value={N(tot.bPr,0)+" GWhc"} color="amber"/></>}
        {view==="pnl"      && <><KPI label="PnL Réalisé CL" value={fK(tot.pnlCl)} color={tot.pnlCl>=0?"emerald":"rose"}/><KPI label="PnL Réalisé PR" value={fK(tot.pnlPr)} color={tot.pnlPr>=0?"emerald":"rose"}/><KPI label="MtM CL" value={fK(tot.mtmCl)} color={tot.mtmCl>=0?"emerald":"rose"}/><KPI label="MtM PR" value={fK(tot.mtmPr)} color={tot.mtmPr>=0?"emerald":"rose"}/></>}
        {view==="unpriced" && <><KPI label="Non Pricée CL" value={N(tot.oblClU,0)+" GWhc"} color="rose"/><KPI label="Non Pricée PR" value={N(tot.oblPrU,0)+" GWhc"} color="rose"/><KPI label="Total Non Pricé" value={N(tot.oblClU+tot.oblPrU,0)+" GWhc"} color="amber"/><KPI label="Valeur Spot Estimée" value={fM(tot.oblClU*latestSpot.classique*1000 + tot.oblPrU*latestSpot.precarite*1000)} color="gray"/></>}
      </div>
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
              const bg=i%2===0?"#161410":"#141210";
              const isForecast=r.month>"2026-03";
              return (
                <tr key={r.month} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#1a1815"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                  <td style={{ ...CG,fontSize:"15px",color:"#e8dfc8",padding:"9px 14px",fontWeight:600,whiteSpace:"nowrap" }}>
                    {ML(r.month)}{isForecast&&<span style={{ ...S,fontSize:"8px",color:"#2e2b24",marginLeft:"6px" }}>FCST</span>}
                  </td>
                  {view==="position"&&<>
                    <td style={{ ...S,fontSize:"12px",color:"#5bc2e7",padding:"9px 14px" }}>{N(r.oblClP,2)}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"9px 14px" }}>{N(r.oblPrP,2)}</td>
                    <td style={{ ...S,fontSize:"12px",color:r.bCl>0?"#e8dfc8":"#3d3830",padding:"9px 14px" }}>{N(r.bCl,2)}</td>
                    <td style={{ ...S,fontSize:"12px",color:r.bPr>0?"#e8dfc8":"#3d3830",padding:"9px 14px" }}>{N(r.bPr,2)}</td>
                    <td style={{ padding:"9px 14px" }}>{pc(r.netCl)}</td>
                    <td style={{ padding:"9px 14px" }}>{pc(r.netPr)}</td>
                    <td style={{ padding:"9px 14px",minWidth:"120px" }}>{(r.oblClP+r.oblPrP)>0?<CovBar pct={r.covPct}/>:<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#6b6350",padding:"9px 14px" }}>{r.aCl>0?N(r.aCl/1000,2):"—"}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#6b6350",padding:"9px 14px" }}>{r.sCl>0?N(r.sCl/1000,2):"—"}</td>
                  </>}
                  {view==="pnl"&&<>
                    <td style={{ ...S,fontSize:"12px",color:"#6b6350",padding:"9px 14px" }}>{r.aCl>0?N(r.aCl/1000,2):"—"}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#6b6350",padding:"9px 14px" }}>{r.sCl>0?N(r.sCl/1000,2):"—"}</td>
                    <td style={{ padding:"9px 14px" }}>{r.pnlCl!==0?pk(r.pnlCl):<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#6b6350",padding:"9px 14px" }}>{r.aPr>0?N(r.aPr/1000,2):"—"}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#6b6350",padding:"9px 14px" }}>{r.sPr>0?N(r.sPr/1000,2):"—"}</td>
                    <td style={{ padding:"9px 14px" }}>{r.pnlPr!==0?pk(r.pnlPr):<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{r.mtmCl!==0?pk(r.mtmCl):<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{r.mtmPr!==0?pk(r.mtmPr):<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{pk(r.pnlCl+r.pnlPr+r.mtmCl+r.mtmPr)}</td>
                  </>}
                  {view==="unpriced"&&<>
                    <td style={{ ...S,fontSize:"12px",color:"#5bc2e7",padding:"9px 14px" }}>{N(r.oblClT,2)}</td>
                    <td style={{ padding:"9px 14px" }}>{r.oblClU>0.01?<span style={{ ...S,fontSize:"12px",color:"#c96b6b",fontWeight:600 }}>{N(r.oblClU,2)}</span>:<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"9px 14px" }}>{N(r.oblPrT,2)}</td>
                    <td style={{ padding:"9px 14px" }}>{r.oblPrU>0.01?<span style={{ ...S,fontSize:"12px",color:"#c96b6b",fontWeight:600 }}>{N(r.oblPrU,2)}</span>:<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ padding:"9px 14px" }}>{(r.oblClU+r.oblPrU)>0.01?<span style={{ ...S,fontSize:"12px",color:"#c96b6b",fontWeight:600 }}>{N(r.oblClU+r.oblPrU,2)}</span>:<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:r.unpricedBoughtCl>0?"#e8dfc8":"#3d3830",padding:"9px 14px" }}>{r.unpricedBoughtCl>0.01?N(r.unpricedBoughtCl,2):"—"}</td>
                    <td style={{ padding:"9px 14px" }}>{(r.oblClU+r.oblPrU)>0.01?pc(r.unpricedBoughtCl+r.unpricedBoughtPr - r.oblClU - r.oblPrU):<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>—</span>}</td>
                    <td style={{ ...S,fontSize:"12px",color:"#8a7d62",padding:"9px 14px" }}>{(r.oblClU+r.oblPrU)>0.01?fK(r.oblClU*latestSpot.classique*1000 + r.oblPrU*latestSpot.precarite*1000):"—"}</td>
                  </>}
                </tr>
              );
            })}
            <tr style={{ background:"#1e1c18",borderTop:"1px solid #2e2b24" }}>
              <td style={{ ...S,fontSize:"10px",color:"#b8973a",padding:"10px 14px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em" }}>Total 2026</td>
              {view==="position"&&<><td style={{ ...S,fontSize:"12px",color:"#5bc2e7",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblCl,0)}</td><td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblPr,0)}</td><td style={{ ...S,fontSize:"12px",color:"#e8dfc8",padding:"10px 14px",fontWeight:700 }}>{N(tot.bCl,0)}</td><td style={{ ...S,fontSize:"12px",color:"#e8dfc8",padding:"10px 14px",fontWeight:700 }}>{N(tot.bPr,0)}</td><td colSpan={5}/></>}
              {view==="pnl"&&<><td colSpan={2}/><td style={{ padding:"10px 14px" }}>{pk(tot.pnlCl)}</td><td colSpan={2}/><td style={{ padding:"10px 14px" }}>{pk(tot.pnlPr)}</td><td style={{ padding:"10px 14px" }}>{pk(tot.mtmCl)}</td><td style={{ padding:"10px 14px" }}>{pk(tot.mtmPr)}</td><td style={{ padding:"10px 14px" }}>{pk(tot.pnlCl+tot.pnlPr+tot.mtmCl+tot.mtmPr)}</td></>}
              {view==="unpriced"&&<><td/><td style={{ ...S,fontSize:"12px",color:"#c96b6b",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblClU,0)}</td><td/><td style={{ ...S,fontSize:"12px",color:"#c96b6b",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblPrU,0)}</td><td style={{ ...S,fontSize:"13px",color:"#c96b6b",padding:"10px 14px",fontWeight:700 }}>{N(tot.oblClU+tot.oblPrU,0)}</td><td colSpan={3}/></>}
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
function Blotter({ trades, currentUser, onAdd, onApprove, onReject }) {
  const [filter, setFilter] = useState("ALL");
  const [showModal, setShowModal] = useState(false);
  const blank = { ceeType:"CLASSIQUE", vendor:"", dealType:"Fixed Price", period:"P6", volume:"", price:"", month:"", ranking:"", statut:"Attribué" };
  const [form, setForm] = useState(blank);
  const filtered = useMemo(()=>{
    let l=[...trades].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(filter==="PENDING")   l=l.filter(t=>t.status==="PENDING");
    if(filter==="APPROVED")  l=l.filter(t=>t.status==="APPROVED");
    if(filter==="CLASSIQUE") l=l.filter(t=>t.ceeType==="CLASSIQUE");
    if(filter==="PRECARITE") l=l.filter(t=>t.ceeType==="PRECARITE");
    return l;
  },[trades,filter]);
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
          {["ALL","PENDING","APPROVED","CLASSIQUE","PRECARITE"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{ ...S,fontSize:"10px",padding:"5px 10px",borderRadius:"2px",border:"1px solid",cursor:"pointer",letterSpacing:"0.08em",textTransform:"uppercase",background:filter===f?"#b8973a":"transparent",color:filter===f?"#0e0d0b":"#4a4438",borderColor:filter===f?"#b8973a":"#2e2b24" }}>{f}</button>)}
        </div>
        <GoldBtn onClick={()=>setShowModal(true)}>+ Nouvel Achat</GoldBtn>
      </div>
      <div style={{ overflowX:"auto",border:"1px solid #1e1c18",borderRadius:"2px" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr>{["Type","Vendeur","Deal Type","Période","Volume (GWhc)","Prix (€/GWhc)","Mois","Pricé","Statut Contrat","Ranking","EMMY","Approbation","Actions"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
          <tbody>
            {filtered.map(t=>{
              const can=currentUser.role==="approver"&&t.status==="PENDING"&&t.createdBy!==currentUser.id;
              const bg="#161410";
              return(
                <tr key={t.id} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#1a1815"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.ceeType==="CLASSIQUE"?"sky":"amber"}>{t.ceeType}</Badge></td>
                  <td style={{ ...CG,fontSize:"14px",color:"#e8dfc8",padding:"9px 14px",maxWidth:"180px" }}>{t.vendor}</td>
                  <td style={{ ...S,fontSize:"10px",color:"#6b6350",padding:"9px 14px" }}>{t.dealType}</td>
                  <td style={{ ...S,fontSize:"10px",color:"#4a4438",padding:"9px 14px" }}>{t.period}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e8dfc8",padding:"9px 14px" }}>{N(t.volume,3)}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e8dfc8",padding:"9px 14px" }}>{N(t.price,0)}</td>
                  <td style={{ ...S,fontSize:"11px",color:"#6b6350",padding:"9px 14px",whiteSpace:"nowrap" }}>{ML(t.month)}</td>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.priced===true?"emerald":"gray"}>{t.priced===true?"✓ Oui":"Non"}</Badge></td>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.statut==="Attribué"?"green":"amber"}>{t.statut}</Badge></td>
                  <td style={{ ...S,fontSize:"10px",color:"#b8973a",padding:"9px 14px" }}>{t.ranking||"—"}</td>
                  <td style={{ padding:"9px 14px" }}><Badge color={t.emmyValidated?"green":"gray"}>{t.emmyValidated?"✓ EMMY":"En attente"}</Badge></td>
                  <td style={{ padding:"9px 14px" }}>{SB(t.status)}</td>
                  <td style={{ padding:"9px 14px" }}>
                    {can&&<div style={{ display:"flex",gap:"5px" }}><button onClick={()=>onApprove(t.id,currentUser.id)} style={{ ...S,fontSize:"10px",padding:"4px 8px",background:"#0f2e1a",color:"#6db87a",border:"1px solid #1d4a2a",borderRadius:"2px",cursor:"pointer" }}>✓ OK</button><button onClick={()=>onReject(t.id)} style={{ ...S,fontSize:"10px",padding:"4px 8px",background:"#2e1010",color:"#c96b6b",border:"1px solid #4a1c1c",borderRadius:"2px",cursor:"pointer" }}>✗</button></div>}
                    {t.status==="PENDING"&&!can&&<span style={{ ...S,fontSize:"10px",color:"#2e2b24" }}>Attente approbateur</span>}
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
            <FI label="Prix (€/MWhc)" type="number" step="1" placeholder="9000" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))}/>
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
      <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",padding:"12px 18px",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"14px" }}>
        {[["Carburant kWhc/m³","8 718"],["FOD kWhc/m³","11 078"],["Coeff. Précarité","0.364"],["Coeff. Correctif","0.847"]].map(([k,v])=><div key={k}><p style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.1em" }}>{k}</p><p style={{ ...S,fontSize:"14px",color:"#b8973a",marginTop:"3px" }}>{v}</p></div>)}
      </div>
      <div style={{ display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:"10px" }}>
        <div style={{ display:"flex",gap:"5px",flexWrap:"wrap" }}>
          {clients.map(c=><button key={c} onClick={()=>setFilterClient(c)} style={{ ...S,fontSize:"10px",padding:"5px 10px",borderRadius:"2px",border:"1px solid",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",background:filterClient===c?"#b8973a":"transparent",color:filterClient===c?"#0e0d0b":"#4a4438",borderColor:filterClient===c?"#b8973a":"#2e2b24" }}>{c}</button>)}
          <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{ ...S,background:"#1a1815",border:"1px solid #2e2b24",color:"#8a7d62",borderRadius:"2px",padding:"5px 8px",fontSize:"10px",outline:"none" }}>
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
              const bg=i%2===0?"#161410":"#141210";
              return(
                <tr key={o.id} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#1a1815"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                  <td style={{ ...CG,fontSize:"14px",color:"#e8dfc8",padding:"9px 14px" }}>{ML(o.month)}</td>
                  <td style={{ padding:"9px 14px" }}><Badge color={cc(o.client)}>{o.client}</Badge></td>
                  <td style={{ padding:"9px 14px" }}><Badge color={o.product==="CARBURANT"?"sky":"purple"}>{PARAMS[o.product].label}</Badge></td>
                  <td style={{ ...S,fontSize:"12px",color:"#8a7d62",padding:"9px 14px" }}>{N(o.volume_m3,0)}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#5bc2e7",padding:"9px 14px" }}>{N(o.clGwhc,3)}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#d4a843",padding:"9px 14px" }}>{N(o.prGwhc,3)}</td>
                  <td style={{ ...S,fontSize:"11px",color:"#6b6350",padding:"9px 14px" }}>{N(o.priceCl/1000,2)}</td>
                  <td style={{ ...S,fontSize:"11px",color:"#6b6350",padding:"9px 14px" }}>{N(o.pricePr/1000,2)}</td>
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
            <div style={{ display:"flex",alignItems:"center",gap:"10px",paddingTop:"18px" }}><input type="checkbox" id="pr" checked={form.priced} onChange={e=>setForm(f=>({...f,priced:e.target.checked}))} style={{ accentColor:"#b8973a" }}/><label htmlFor="pr" style={{ ...S,fontSize:"11px",color:"#8a7d62",cursor:"pointer" }}>Pricé</label></div>
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

  const pending=trades.filter(t=>t.status==="PENDING").length;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"22px" }}>
      {pending>0&&<div style={{ background:"#2e2000",border:"1px solid #5a4000",borderRadius:"2px",padding:"10px 16px",display:"flex",alignItems:"center",gap:"8px" }}><span style={{ color:"#f0b429",fontSize:"12px" }}>⚠</span><span style={{ ...S,fontSize:"11px",color:"#f0b429" }}>{pending} trade{pending>1?"s":""} en attente d'approbation (4-yeux)</span></div>}

      {/* ── PnL / MtM / Spot ── */}
      <div>
        <p style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"10px" }}>Résumé PnL & Marché — 06/03/2026</p>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:"10px" }}>
          <KPI label="Spot Classique"   value={`${N(spotCl)} €/MWhc`} color="sky"   sub="Prix spot C2E"/>
          <KPI label="Spot Précarité"   value={`${N(spotPr)} €/MWhc`} color="amber" sub="Prix spot C2E"/>
          <KPI label="PnL Réalisé YTD"  value={fM(pnlClYTD+pnlPrYTD)} color={(pnlClYTD+pnlPrYTD)>=0?"emerald":"rose"} sub={`CL: ${fK(pnlClYTD)} · PR: ${fK(pnlPrYTD)}`}/>
          <KPI label="MtM Pos. Ouverte" value={fK(mtmCl+mtmPr)} color={(mtmCl+mtmPr)>=0?"emerald":"rose"} sub={`CL: ${fK(mtmCl)} · PR: ${fK(mtmPr)}`}/>
          <KPI label="Net PnL+MtM YTD"  value={fM(pnlClYTD+pnlPrYTD+mtmCl+mtmPr)} color={(pnlClYTD+pnlPrYTD+mtmCl+mtmPr)>=0?"emerald":"rose"} sub="Réalisé + MtM"/>
          <KPI label="En attente"       value={pending>0?`⚠ ${pending}`:"✓ 0"} color={pending>0?"amber":"emerald"} sub="Trades 4-yeux"/>
        </div>
      </div>

      {/* ── Position PRICÉE (Jan-Mar) ── */}
      <div>
        <p style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"8px" }}>Position PRICÉE — Achats confirmés vs Obligation avec prix fixé (Jan–Mar)</p>
        <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",overflow:"hidden",marginBottom:"16px" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead><tr>{["Type","Oblig. Pricée","Acheté Pricé","Position Nette","Avg Buy","Couverture"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
            <tbody>
              {[["CEE Classique",totalOblClP,bClP,netClP,aClP,"sky"],
                ["CEE Précarité",totalOblPrP,bPrP,netPrP,aPrP,"amber"],
                ["TOTAL",totalOblP,bClP+bPrP,netClP+netPrP,(bClP*aClP+bPrP*aPrP)/((bClP+bPrP)||1),"neutral"]].map(([label,obl,bought,net,avg])=>(
                <tr key={label} style={{ borderBottom:"1px solid #1a1815" }}>
                  <td style={{ ...CG,fontSize:"14px",color:"#e8dfc8",padding:"10px 16px" }}>{label}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#8a7d62",padding:"10px 16px" }}>{N(obl,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e8dfc8",padding:"10px 16px" }}>{N(bought,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",padding:"10px 16px",color:net>=0?"#6db87a":"#c96b6b",fontWeight:600 }}>{net>=0?"+":""}{N(net,1)} GWh</td>
                  <td style={{ ...S,fontSize:"11px",color:"#8a7d62",padding:"10px 16px" }}>{avg>0?N(avg/1000,2)+" €/MWhc":"—"}</td>
                  <td style={{ padding:"10px 16px",minWidth:"140px" }}><CovBar pct={obl>0?bought/obl*100:0}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Position NON PRICÉE ── */}
        <p style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:"8px" }}>Position NON PRICÉE — Exposition Forward (Mar partiel + Avr–Déc, obligation sans prix fixé)</p>
        <div style={{ background:"#161410",border:"1px solid #252219",borderRadius:"2px",overflow:"hidden" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead><tr>{["Type","Oblig. Non Pricée","Acheté Non Pricé","Position Nette","Statut"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
            <tbody>
              {[["CEE Classique",totalOblClU,bClU,netClU],
                ["CEE Précarité",totalOblPrU,bPrU,netPrU],
                ["TOTAL",totalOblClU+totalOblPrU,bClU+bPrU,netClU+netPrU]].map(([label,obl,bought,net])=>(
                <tr key={label} style={{ borderBottom:"1px solid #1a1815" }}>
                  <td style={{ ...CG,fontSize:"14px",color:"#e8dfc8",padding:"10px 16px" }}>{label}</td>
                  <td style={{ ...S,fontSize:"12px",color:"#8a7d62",padding:"10px 16px" }}>{N(obl,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",color:"#e8dfc8",padding:"10px 16px" }}>{N(bought,1)} GWh</td>
                  <td style={{ ...S,fontSize:"12px",padding:"10px 16px",color:net>=0?"#6db87a":"#c96b6b",fontWeight:600 }}>{net>=0?"+":""}{N(net,1)} GWh</td>
                  <td style={{ ...S,fontSize:"11px",padding:"10px 16px",color:net<0?"#c96b6b":"#6db87a" }}>{net<0?"⚠ SHORT — oblig. non couvertes":"✓ Long / équilibré"}</td>
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
            {TENORS.map(t=>{const fp=curve[t],m=mtm(t),isE=editing===t,bg="#161410";return(
              <tr key={t} style={{ borderBottom:"1px solid #1a1815",background:bg }} onMouseEnter={e=>e.currentTarget.style.background="#1a1815"} onMouseLeave={e=>e.currentTarget.style.background=bg}>
                <td style={{ padding:"9px 14px" }}><Badge color={t==="SPOT"?"gold":"gray"}>{t}</Badge></td>
                {isE?<><td style={{ padding:"7px 14px" }}><input value={draft.classique} onChange={e=>setDraft(d=>({...d,classique:e.target.value}))} style={{ ...S,background:"#1a1815",border:"1px solid #b8973a",color:"#e8dfc8",borderRadius:"2px",padding:"5px 8px",fontSize:"12px",width:"80px",outline:"none" }}/></td><td style={{ padding:"7px 14px" }}><input value={draft.precarite} onChange={e=>setDraft(d=>({...d,precarite:e.target.value}))} style={{ ...S,background:"#1a1815",border:"1px solid #b8973a",color:"#e8dfc8",borderRadius:"2px",padding:"5px 8px",fontSize:"12px",width:"80px",outline:"none" }}/></td></>:<><td style={{ ...S,fontSize:"13px",color:"#5bc2e7",padding:"9px 14px",fontWeight:500 }}>{fp?N(fp.classique):"—"}</td><td style={{ ...S,fontSize:"13px",color:"#d4a843",padding:"9px 14px",fontWeight:500 }}>{fp?N(fp.precarite):"—"}</td></>}
                <td style={{ ...S,fontSize:"12px",padding:"9px 14px",color:m&&m.mCl>=0?"#6db87a":"#c96b6b" }}>{m?fK(m.mCl):"—"}</td>
                <td style={{ ...S,fontSize:"12px",padding:"9px 14px",color:m&&m.mPr>=0?"#6db87a":"#c96b6b" }}>{m?fK(m.mPr):"—"}</td>
                <td style={{ ...S,fontSize:"13px",padding:"9px 14px",fontWeight:700,color:m&&m.tot>=0?"#6db87a":"#c96b6b" }}>{m?fK(m.tot):"—"}</td>
                <td style={{ padding:"9px 14px" }}>{isE?<button onClick={()=>{onUpdate(t,{classique:parseFloat(draft.classique),precarite:parseFloat(draft.precarite)});setEditing(null);}} style={{ ...S,fontSize:"10px",padding:"4px 10px",background:"#b8973a",color:"#0e0d0b",border:"none",borderRadius:"2px",cursor:"pointer" }}>✓</button>:<button onClick={()=>{setEditing(t);setDraft({classique:String(fp?.classique??""),precarite:String(fp?.precarite??"")});}} style={{ ...S,fontSize:"10px",padding:"4px 10px",background:"transparent",color:"#4a4438",border:"1px solid #2e2b24",borderRadius:"2px",cursor:"pointer" }}>Modifier</button>}</td>
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
  const [form,setForm]=useState({date:"",classique:"",precarite:""});
  const handleAdd=()=>{if(!form.date||!form.classique||!form.precarite)return;onAdd({id:"p"+uid(),date:form.date,classique:parseFloat(form.classique),precarite:parseFloat(form.precarite),enteredBy:currentUser.id,enteredAt:new Date().toISOString()});setShowModal(false);setForm({date:"",classique:"",precarite:""});};
  const sorted=[...prices].sort((a,b)=>b.date.localeCompare(a.date));
  return(
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ display:"flex",justifyContent:"flex-end" }}><GoldBtn onClick={()=>setShowModal(true)}>+ Ajouter Prix</GoldBtn></div>
      <div style={{ border:"1px solid #1e1c18",borderRadius:"2px",overflow:"hidden" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr>{["Date","Classique (€/MWhc)","Précarité (€/MWhc)","Saisi par","Horodatage"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
          <tbody>
            {sorted.map((p,i)=>{const user=USERS.find(u=>u.id===p.enteredBy);const bg=i===0?"#1a1815":"#161410";return(
              <tr key={p.id} style={{ borderBottom:"1px solid #1a1815",background:bg }}>
                <td style={{ ...S,fontSize:"12px",color:"#e8dfc8",padding:"10px 14px",fontWeight:500 }}>{p.date}{i===0&&<span style={{ marginLeft:"8px",fontSize:"9px",color:"#b8973a" }}>DERNIER</span>}</td>
                <td style={{ ...S,fontSize:"13px",color:"#5bc2e7",padding:"10px 14px" }}>{N(p.classique)}</td>
                <td style={{ ...S,fontSize:"13px",color:"#d4a843",padding:"10px 14px" }}>{N(p.precarite)}</td>
                <td style={{ ...S,fontSize:"11px",color:"#6b6350",padding:"10px 14px" }}>{user?.name??p.enteredBy}</td>
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

function AuditLog({ audit }) {
  const AC={TRADE_CREATED:"blue",TRADE_APPROVED:"green",TRADE_REJECTED:"red",PRICE_ADDED:"amber",OBLIG_ADDED:"sky",CURVE_UPDATED:"purple"};
  const handleExport=()=>{const rows=[...audit].sort((a,b)=>b.ts.localeCompare(a.ts)).map(a=>`"${a.ts}","${USERS.find(u=>u.id===a.user)?.name??a.user}","${a.action}","${a.entity}","${a.detail}"`);const blob=new Blob(["Timestamp,User,Action,Entity,Detail\n"+rows.join("\n")],{type:"text/csv"});const url=URL.createObjectURL(blob);const l=document.createElement("a");l.href=url;l.download="cee_audit.csv";l.click();URL.revokeObjectURL(url);};
  return(
    <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
      <div style={{ display:"flex",justifyContent:"flex-end" }}><GhostBtn onClick={handleExport}>↓ Exporter CSV</GhostBtn></div>
      <div style={{ border:"1px solid #1e1c18",borderRadius:"2px",overflow:"hidden" }}>
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr>{["Horodatage","Utilisateur","Action","Entité","Détail"].map(h=><TH key={h}>{h}</TH>)}</tr></thead>
          <tbody>
            {[...audit].sort((a,b)=>b.ts.localeCompare(a.ts)).map(a=>{const user=USERS.find(u=>u.id===a.user);const bg="#161410";return(
              <tr key={a.id} style={{ borderBottom:"1px solid #1a1815",background:bg }}>
                <td style={{ ...S,fontSize:"10px",color:"#4a4438",padding:"9px 14px",whiteSpace:"nowrap" }}>{new Date(a.ts).toLocaleString("fr-FR")}</td>
                <td style={{ padding:"9px 14px" }}><div style={{ display:"flex",alignItems:"center",gap:"6px" }}><span style={{ ...S,width:"22px",height:"22px",borderRadius:"50%",background:"#252219",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",color:"#b8973a",fontWeight:600 }}>{user?.initials??""}</span><span style={{ ...S,fontSize:"10px",color:"#6b6350" }}>{user?.name??a.user}</span></div></td>
                <td style={{ padding:"9px 14px" }}><Badge color={AC[a.action]||"gray"}>{a.action.replace(/_/g," ")}</Badge></td>
                <td style={{ ...S,fontSize:"10px",color:"#3d3830",padding:"9px 14px" }}>{a.entity}</td>
                <td style={{ ...S,fontSize:"10px",color:"#6b6350",padding:"9px 14px" }}>{a.detail}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser,setCurrentUser]=useState(USERS[0]);
  const [trades,setTrades]          =useState(REAL_TRADES);
  const [prices,setPrices]          =useState(REAL_PRICES);
  const [curve,setCurve]            =useState(SEED_CURVE);
  const [obligations,setObligations]=useState(REAL_OBLIGATIONS);
  const [audit,setAudit]            =useState(REAL_AUDIT);
  const [tab,setTab]                =useState("dashboard");

  // Load updates from data.json if available (Phase 1 shared data)
  useEffect(()=>{
    fetch("./data.json")
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(!d) return;
        if(d.trades?.length)      setTrades(d.trades);
        if(d.prices?.length)      setPrices(d.prices);
        if(d.curve)               setCurve(d.curve);
        if(d.obligations?.length) setObligations(d.obligations);
        if(d.audit?.length)       setAudit(d.audit);
        if(d.users?.length)       setCurrentUser(d.users[0]);
      }).catch(()=>{});
  },[]);

  const addAudit=useCallback(e=>setAudit(a=>[...a,{...e,id:"a"+uid(),ts:new Date().toISOString()}]),[]);
  const handleAddTrade=useCallback(t=>{setTrades(ts=>[...ts,t]);addAudit({user:currentUser.id,action:"TRADE_CREATED",entity:t.id,detail:`BUY ${N(t.volume,3)} GWhc ${t.ceeType} @ ${N(t.price,0)} €/MWhc — ${t.vendor}`});},[currentUser,addAudit]);
  const handleApproveTrade=useCallback((id,aid)=>{setTrades(ts=>ts.map(t=>t.id===id?{...t,status:"APPROVED",approvedBy:aid}:t));addAudit({user:aid,action:"TRADE_APPROVED",entity:id,detail:`Trade ${id} approuvé par ${USERS.find(u=>u.id===aid)?.name}`});},[addAudit]);
  const handleRejectTrade=useCallback(id=>{setTrades(ts=>ts.map(t=>t.id===id?{...t,status:"REJECTED"}:t));addAudit({user:currentUser.id,action:"TRADE_REJECTED",entity:id,detail:`Trade ${id} rejeté`});},[currentUser,addAudit]);
  const handleAddPrice=useCallback(p=>{setPrices(ps=>[...ps,p]);addAudit({user:currentUser.id,action:"PRICE_ADDED",entity:p.id,detail:`Prix ${p.date}: CL ${p.classique} — PR ${p.precarite} €/MWhc`});},[currentUser,addAudit]);
  const handleUpdateCurve=useCallback((tenor,px)=>{setCurve(c=>({...c,[tenor]:px}));addAudit({user:currentUser.id,action:"CURVE_UPDATED",entity:tenor,detail:`Courbe ${tenor} mise à jour`});},[currentUser,addAudit]);
  const handleAddObligation=useCallback(o=>{setObligations(os=>[...os,o]);addAudit({user:currentUser.id,action:"OBLIG_ADDED",entity:o.id,detail:`Oblig ${ML(o.month)} — ${o.client} — ${PARAMS[o.product].label} ${N(o.volume_m3,0)} m³`});},[currentUser,addAudit]);

  const pending=trades.filter(t=>t.status==="PENDING").length;

  const TABS=[
    {id:"dashboard",  label:"Dashboard"},
    {id:"reporting",  label:"📊 Reporting"},
    {id:"position",   label:"Position CEE"},
    {id:"blotter",    label:`Blotter${pending>0?` (${pending})`:""}`},
    {id:"obligation", label:"Obligation"},
    {id:"curve",      label:"Courbe Forward"},
    {id:"prices",     label:"Prix Marché"},
    {id:"audit",      label:"Audit Log"},
  ];

  return(
    <div style={{ minHeight:"100vh",background:"#0e0d0b",color:"#e8dfc8" }}>
      <div style={{ position:"fixed",inset:0,backgroundImage:"linear-gradient(#1a181506 1px,transparent 1px),linear-gradient(90deg,#1a181506 1px,transparent 1px)",backgroundSize:"40px 40px",pointerEvents:"none",zIndex:0 }}/>
      <div style={{ position:"relative",zIndex:1,maxWidth:"1400px",margin:"0 auto",padding:"0 28px 80px" }}>
        <header style={{ padding:"28px 0 16px",borderBottom:"1px solid #1e1c18",display:"flex",justifyContent:"space-between",alignItems:"flex-end" }}>
          <div>
            <p style={{ ...S,fontSize:"9px",color:"#b8973a",letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:"4px" }}>Gestion Stock CEE · Position · PnL · Obligation P6</p>
            <h1 style={{ ...CG,fontSize:"32px",fontWeight:700,color:"#e8dfc8",lineHeight:1 }}>CEE Dashboard <span style={{ ...S,fontSize:"11px",color:"#4a4438",fontWeight:400,marginLeft:"12px" }}>Données au 06/03/2026</span></h1>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
            <div style={{ display:"flex",gap:"4px" }}>
              {USERS.map(u=><button key={u.id} onClick={()=>setCurrentUser(u)} title={`${u.name} — ${u.role}`} style={{ width:"30px",height:"30px",borderRadius:"50%",border:currentUser.id===u.id?"2px solid #b8973a":"1px solid #2e2b24",background:currentUser.id===u.id?"#252219":"#1a1815",color:currentUser.id===u.id?"#b8973a":"#4a4438",...S,fontSize:"9px",fontWeight:600,cursor:"pointer" }}>{u.initials}</button>)}
            </div>
            <div><p style={{ ...S,fontSize:"11px",color:"#e8dfc8" }}>{currentUser.name}</p><p style={{ ...S,fontSize:"9px",color:"#4a4438",textTransform:"uppercase",letterSpacing:"0.08em" }}>{currentUser.role}</p></div>
          </div>
        </header>
        <div style={{ display:"flex",gap:"16px",borderBottom:"1px solid #1e1c18",marginBottom:"22px",overflowX:"auto" }}>
          {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{ ...S,background:"none",border:"none",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",padding:"12px 0",cursor:"pointer",whiteSpace:"nowrap",color:tab===t.id?"#b8973a":"#4a4438",borderBottom:tab===t.id?"1px solid #b8973a":"1px solid transparent",transition:"color 0.2s" }}>{t.label}</button>)}
        </div>
        {tab==="dashboard"  && <Dashboard     trades={trades} obligations={obligations} prices={prices} curve={curve}/>}
        {tab==="reporting"  && <Reporting     trades={trades} obligations={obligations} prices={prices} curve={curve}/>}
        {tab==="position"   && <PositionView  trades={trades} obligations={obligations} curve={curve} prices={prices}/>}
        {tab==="blotter"    && <Blotter       trades={trades} currentUser={currentUser} onAdd={handleAddTrade} onApprove={handleApproveTrade} onReject={handleRejectTrade}/>}
        {tab==="obligation" && <ObligationTab obligations={obligations} onAdd={handleAddObligation} onDelete={id=>setObligations(os=>os.filter(o=>o.id!==id))}/>}
        {tab==="curve"      && <CurveTab      curve={curve} onUpdate={handleUpdateCurve} trades={trades}/>}
        {tab==="prices"     && <PricesTab     prices={prices} currentUser={currentUser} onAdd={handleAddPrice}/>}
        {tab==="audit"      && <AuditLog      audit={audit}/>}
      </div>
    </div>
  );
}

export default App;
