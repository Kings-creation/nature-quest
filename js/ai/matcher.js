// Smart matching: an on-device open embedding model re-orders the already-safe candidate quests by how well their
// meaning fits the person (what they typed, time of day, season, company, energy). It never writes the quest, so
// it cannot ramble, and it can never add something the rules did not already allow.
import { getMeta, setMeta } from "../store.js";
import { embedProvider, EMBED_MODEL } from "./providers/embed.js";
import { FALLBACKS } from "../quest/fallback.js";

let cfg = { enabled: false, downloaded: false, dismissed: false }, status = { state: "off", pct: 0, detail: "" }, override = null;
const listeners = new Set();
const setStatus = s => { status = { ...status, ...s }; listeners.forEach(f => { try { f(status); } catch {} }); };
export const getStatus = () => status;
export const getConfig = () => cfg;
export const onStatus = f => { listeners.add(f); return () => listeners.delete(f); };
export const isOn = () => cfg.enabled;
export const info = () => EMBED_MODEL;
export const __setProviderForTests = p => { override = p; };
const prov = () => override || embedProvider;
const save = () => setMeta("match-config", cfg);

export async function init() { cfg = { ...cfg, ...(await getMeta("match-config") || {}) }; setStatus({ state: cfg.enabled ? (prov().isLoaded() ? "ready" : "idle") : "off", pct: 0 }); }
export async function dismiss() { cfg.dismissed = true; await save(); }
export async function turnOff() { cfg.enabled = false; await save(); setStatus({ state: "off", pct: 0 }); }

export async function prepare({ signal } = {}) {
  const p = prov();
  if (p.isLoaded()) { setStatus({ state: "ready", pct: 100 }); return; }
  setStatus({ state: cfg.downloaded ? "loading" : "downloading", pct: 0, detail: "" });
  try {
    await p.load(e => setStatus({ state: e.phase === "download" ? "downloading" : "loading", pct: e.pct ?? status.pct }), { signal });
    cfg.downloaded = true; cfg.enabled = true; await save();
    setStatus({ state: "loading", pct: 100, detail: "" });
    try { if (!(await cachedVectors())) await computeVectors(signal); } catch (e) { if (e?.code === "aborted") throw e; } // retried in the background if it fails
    setStatus({ state: "ready", pct: 100, detail: "" });
  } catch (e) { setStatus({ state: e.code === "aborted" ? "idle" : "error", detail: "Couldn't load the matching model. Check your connection and try again." }); throw e; }
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const libText = f => `${f.title}. ${f.intro} ${f.steps.join(" ")} ${f.tags || ""}`;
const sig = () => EMBED_MODEL.id + ":v2:" + FALLBACKS.map(f => f.id + libText(f).length).join(",");

// Library vectors are computed once (in small batches), kept on the device, and prepared in the background so a match
// never has to wait for them. Until they exist, quests are picked by the app's rules.
let warming = null;
const cachedVectors = async () => { const c = await getMeta("lib-vectors"); return c?.sig === sig() ? c.v : null; };
function computeVectors(signal) {
  warming ||= (async () => {
    const p = prov(); if (!p.isLoaded()) await p.load(() => {}, { signal });
    const texts = FALLBACKS.map(libText), vecs = [];
    for (let i = 0; i < texts.length; i += 24) vecs.push(...await p.embed(texts.slice(i, i + 24), { signal }));
    const v = Object.fromEntries(FALLBACKS.map((f, i) => [f.id, vecs[i]]));
    await setMeta("lib-vectors", { sig: sig(), v }); return v;
  })().finally(() => { warming = null; });
  return warming;
}
export const warm = () => { if (cfg.enabled) cachedVectors().then(v => { if (!v) computeVectors().catch(() => {}); }).catch(() => {}); };
export const libraryReady = async () => !!(await cachedVectors());

const W = { company: { solo: "a person on their own", family: "a family", friends: "friends" }, activity: { observe: "looking closely", listen: "listening", move: "walking and moving", create: "making something" }, energy: { low: "low energy and tired", medium: "medium energy", high: "plenty of energy" } };
export function contextSentence(ctx, now = new Date()) {
  const h = now.getHours(), part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  return `${W.company[ctx.company]} with ${ctx.minutes} minutes, ${W.energy[ctx.energy]}, feeling like ${W.activity[ctx.activity]}, in the ${part} in ${now.toLocaleDateString("en", { month: "long" })}.`;
}

// candidates: already-safe quests in heuristic order. Returns the same quests re-ordered by meaning.
// liked: ids of quests the person finished before; the app leans (gently) toward similar ones.
export async function rank(candidates, ctx, mood = "", { signal, liked = [] } = {}) {
  if (!cfg.enabled) throw Object.assign(new Error("off"), { code: "off" });
  const p = prov();
  if (!p.isLoaded()) await prepare({ signal });
  const lib = await cachedVectors();
  if (!lib) { computeVectors().catch(() => {}); throw Object.assign(new Error("still preparing the quest library"), { code: "warming" }); }
  const text = String(mood || "").trim().slice(0, 120);
  const [qc, qm] = await p.embed(text ? [contextSentence(ctx), text] : [contextSentence(ctx)], { signal });
  let taste = null;
  const lv = liked.map(id => lib[id]).filter(Boolean);
  if (lv.length) { taste = new Array(lv[0].length).fill(0); for (const v of lv) for (let i = 0; i < v.length; i++) taste[i] += v[i] / lv.length; const m = Math.hypot(...taste) || 1; taste = taste.map(x => x / m); }
  const scored = candidates.map((f, i) => {
    const v = lib[f.id]; if (!v) return { f, s: -1 };
    const sim = text ? 0.7 * dot(qm, v) + 0.3 * dot(qc, v) : dot(qc, v);
    return { f, s: sim + (taste ? 0.12 * dot(taste, v) : 0) + 0.02 * (candidates.length - i) / candidates.length * 4 }; // small prior: the rule-based order still counts
  }).sort((a, b) => b.s - a.s);
  return { order: scored.map(x => x.f), model: EMBED_MODEL.label };
}

export async function diagnose(log) {
  const t0 = performance.now(), el = () => ((performance.now() - t0) / 1000).toFixed(1) + "s";
  log(`[${el()}] Matching model: ${EMBED_MODEL.label}. Library: ${FALLBACKS.length} quests. Online: ${navigator.onLine}`);
  try {
    log(`[${el()}] Loading...`); await prepare();
    log(`[${el()}] Loaded. Preparing the quest library...`);
    const ctx = { company: "solo", minutes: 20, environment: "any", energy: "low", activity: "listen", difficulty: "easy" };
    const t1 = performance.now(); const r = await rank(FALLBACKS.slice(0, 8), ctx, "stressed after work, want something calm");
    log(`[${el()}] Matched in ${(performance.now() - t1).toFixed(0)} ms. Top pick: "${r.order[0].title}"`);
    const t2 = performance.now(); await rank(FALLBACKS.slice(0, 8), ctx, "feeling playful with the kids");
    log(`[${el()}] Second match took ${(performance.now() - t2).toFixed(0)} ms.`);
    log("RESULT: good. Matching works on this device.");
  } catch (e) { log(`RESULT: FAILED (${e.code || "error"}): ${e.message}`); }
}
