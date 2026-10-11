// AI Engine: the only thing the rest of the app talks to. UI -> engine -> provider -> open model.
// Swapping model or runtime means adding a provider; nothing above this file changes.
import { getMeta, setMeta } from "../store.js";
import { buildQuestMessages, parseDraft } from "./prompt.js";
import { browserProvider, capability, MODELS } from "./providers/browser.js";
import { createEndpointProvider, ENDPOINT_DEFAULTS } from "./providers/endpoint.js";
import { checkText } from "../quest/safety.js";

const DEFAULT_CFG = { enabled: false, provider: "browser", device: "auto", model: "smol", downloadedModels: {}, endpoint: { ...ENDPOINT_DEFAULTS }, downloaded: false };
let cfg = { ...DEFAULT_CFG }, status = { state: "off", pct: 0, detail: "" }, override = null;
const listeners = new Set();
const setStatus = (s) => { status = { ...status, ...s }; listeners.forEach(f => { try { f(status); } catch {} }); };

export const getStatus = () => status;
export const getConfig = () => cfg;
export const onStatus = f => { listeners.add(f); return () => listeners.delete(f); };
export const isEnabled = () => cfg.enabled;
export const browserInfo = () => ({ ...MODELS[cfg.model], key: cfg.model, models: MODELS, capability: capability() });
export const modelDownloaded = () => !!cfg.downloadedModels?.[cfg.model];
export const __setProviderForTests = p => { override = p; };

const provider = () => override || (cfg.provider === "endpoint" ? createEndpointProvider(cfg.endpoint) : browserProvider);
export const activeLabel = () => provider().label;

export async function init() {
  cfg = { ...DEFAULT_CFG, ...(await getMeta("ai-config") || {}) };
  if (cfg.downloaded === true && !Object.keys(cfg.downloadedModels || {}).length) cfg.downloadedModels = { qwen: true }; // older installs downloaded the 0.5B model
  if (!MODELS[cfg.model]) cfg.model = "smol";
  if (!cfg.v2) { cfg.enabled = false; cfg.v2 = true; await save(); } // free-writing is experimental now: off unless chosen again
  browserProvider.setModel(cfg.model); browserProvider.setDevice(cfg.device);
  setStatus(cfg.enabled ? { state: provider().isLoaded() ? "ready" : "idle", pct: 0, detail: "" } : { state: "off", pct: 0, detail: "" });
}
async function save() { await setMeta("ai-config", cfg); }

export async function configure(patch) {
  cfg = { ...cfg, ...patch, endpoint: { ...cfg.endpoint, ...(patch.endpoint || {}) } };
  if (!MODELS[cfg.model]) cfg.model = "smol";
  browserProvider.setModel(cfg.model); browserProvider.setDevice(cfg.device); await save();
  setStatus(cfg.enabled ? { state: provider().isLoaded() ? "ready" : "idle", pct: 0, detail: "" } : { state: "off", pct: 0, detail: "" });
}

// Explicit, user-triggered. The browser model is only ever downloaded through here.
export async function prepare({ signal } = {}) {
  if (cfg.provider === "browser") { const c = capability(); if (c.level === "no") { setStatus({ state: "unsupported", detail: c.reason }); throw new Error("unsupported"); } }
  const p = provider();
  if (p.isLoaded()) { setStatus({ state: "ready", pct: 100 }); return; }
  setStatus({ state: modelDownloaded() || cfg.provider !== "browser" ? "loading" : "downloading", pct: 0, detail: "" });
  try {
    await p.load(e => setStatus({ state: e.phase === "download" ? "downloading" : "loading", pct: e.pct ?? status.pct }), { signal });
    if (cfg.provider === "browser" && !modelDownloaded()) { cfg.downloadedModels = { ...cfg.downloadedModels, [cfg.model]: true }; await save(); }
    setStatus({ state: "ready", pct: 100, detail: "" });
  } catch (e) {
    if (e?.code === "aborted") { setStatus({ state: "idle", pct: 0, detail: "" }); throw e; }
    setStatus({ state: "error", detail: cfg.provider === "endpoint" ? "Couldn't reach your local server. Is it running and allowing this site?" : "The model couldn't load. Check your connection and try again." });
    throw e;
  }
}

async function ask(messages, opts) {
  if (!cfg.enabled) throw new Error("ai-off");
  const p = provider();
  if (!p.isLoaded()) await prepare({ signal: opts?.signal });
  return p.complete(messages, opts);
}

/* --- Public AI interface (the UI never sees a model) --- */

// Used as the Quest Engine's `generator`.
export async function generateQuest(context, { attempt = 1, avoid = [], signal, onToken } = {}) {
  const text = await ask(buildQuestMessages(context, { avoid, attempt }), { maxTokens: 130, signal, onToken });
  // Unparseable text becomes an empty draft: the Quest Engine rejects it and retries, rather than treating it as a crash.
  return { ...(parseDraft(text) || {}), model: provider().label };
}

const SHORT = (q, extra) => [{ role: "system", content: "You help people enjoy being outdoors. Reply with one or two short, safe sentences only. No lists, no screen use, nothing dangerous." }, { role: "user", content: `Mission: "${q.title}". Steps: ${q.steps.map(s => s.text).join(" ")} ${extra}` }];
const oneLine = async (q, extra, fallback, signal) => {
  try {
    const t = (await ask(SHORT(q, extra), { maxTokens: 80, signal })).replace(/\s+/g, " ").trim();
    return t && t.length <= 240 && !checkText(t).length ? t : fallback; // unsafe or odd output: use the static text
  } catch { return fallback; }
};
export const generateClue = (q, signal) => oneLine(q, "Give one gentle hint, without giving the answer away, to help them with the first step.", q.steps[0]?.text || "", signal);
export const generateReflection = (q, answer, signal) => oneLine(q, `They said: "${String(answer).slice(0, 200)}". Ask one warm follow-up question about it.`, q.reflectionPrompt, signal);
// adaptQuest returns a full replacement draft (easier or harder) that still goes through safety in the Quest Engine.
export async function adaptQuest(q, direction, signal) {
  const ctx = { ...q.context, difficulty: direction === "easier" ? "easy" : direction === "harder" ? "hard" : q.context.difficulty, energy: direction === "easier" ? "low" : q.context.energy };
  return generateQuest(ctx, { attempt: direction === "easier" ? 2 : 1, avoid: [], signal });
}

// Step-by-step self test so a stuck or slow device can show exactly where time goes.
export async function diagnose(log) {
  const p = provider(), t0 = performance.now(), el = () => ((performance.now() - t0) / 1000).toFixed(1) + "s";
  const say = m => log(`[${el()}] ${m}`);
  say(`Runtime: ${p.id} (${p.label})`);
  if (!p.diagnose) { try { await p.load(); say("Server reachable."); } catch (e) { say("Server NOT reachable: " + (e?.message || e)); } return; }
  await p.diagnose(say);
}
