// In-browser open-weight inference: Transformers.js (ONNX Runtime Web) + Qwen2.5-0.5B-Instruct, running in a
// Web Worker. A watchdog watches the worker: if it goes silent or runs too long it is terminated and the
// caller gets a clear error, so the app can never sit "loading" forever.
// Two open models. The small one is the default because mid-range phones run the 0.5B model on CPU at
// well under one token per second, which is too slow for a whole quest.
export const MODELS = {
  smol: { id: "HuggingFaceTB/SmolLM2-135M-Instruct", dtype: "q4", label: "SmolLM2-135M-Instruct", license: "Apache-2.0", approxMB: 200, short: "Fast (SmolLM2, 200 MB)", blurb: "Small and quick. Simpler wording." },
  qwen: { id: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q4", label: "Qwen2.5-0.5B-Instruct", license: "Apache-2.0", approxMB: 450, short: "Better writing (Qwen2.5, 450 MB)", blurb: "Nicer wording, but several times slower on many phones." }
};

const cfg = { workerUrl: new URL("../worker.js", import.meta.url).href, loadIdleMs: 150000, loadTotalMs: 1200000, genIdleMs: 60000, genTotalMs: 120000 };
export const __tune = o => Object.assign(cfg, o); // used by tests

let modelKey = "smol", worker = null, loaded = false, busy = false, chain = Promise.resolve(), device = "auto", active = null, gpuBroken = false, lastTps = null;
const err = (code, message) => Object.assign(new Error(message || code), { code });

export function capability() {
  if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") return { level: "no", reason: "This browser can't run on-device AI." };
  const mem = navigator.deviceMemory; // Chromium only
  if (mem && mem < 2) return { level: "no", reason: "This device has too little memory for on-device AI." };
  if (mem && mem < 4) return { level: "limited", reason: "This device has limited memory. The AI may be slow or the page may reload." };
  return { level: "ok", reason: "" };
}

function kill() { try { worker?.terminate(); } catch {} worker = null; loaded = false; busy = false; }

// Sends one request and resolves on its terminal message. Rejects on idle/total timeout, worker error or abort.
function request(msg, { onMessage, idleMs, totalMs, signal, killOnAbort = false }) {
  return new Promise((resolve, reject) => {
    if (!worker) { try { worker = new Worker(cfg.workerUrl, { type: "module" }); } catch (e) { return reject(err("worker-failed", String(e?.message || e))); } }
    const w = worker; let idle, total, done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(idle); clearTimeout(total); w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); signal?.removeEventListener("abort", onAbort); fn(v); };
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => { kill(); finish(reject, err("timeout", "No response from the AI for a while.")); }, idleMs); };
    const onMsg = ({ data }) => {
      bump();
      if (data.type === "error") { kill(); return finish(reject, err("model-error", data.message)); }
      const r = onMessage(data); if (r !== undefined) finish(resolve, r);
    };
    const onErr = e => { kill(); finish(reject, err("worker-crashed", e?.message || "The AI worker crashed.")); };
    const onAbort = () => { if (killOnAbort) kill(); else try { w.postMessage({ type: "interrupt" }); } catch {} finish(reject, err("aborted")); };
    w.addEventListener("message", onMsg); w.addEventListener("error", onErr);
    signal?.addEventListener("abort", onAbort);
    total = setTimeout(() => { kill(); finish(reject, err("timeout", "The AI took too long.")); }, totalMs);
    bump(); w.postMessage(msg);
  });
}

// navigator.gpu can exist while no adapter is available (older Android), so ask for one.
async function gpuAdapter() { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; } }

export const lastSpeed = () => lastTps;
export const activeDevice = () => active;

export const browserProvider = {
  setModel(k) { if (MODELS[k] && k !== modelKey) { modelKey = k; kill(); active = null; } },
  get label() { return MODELS[modelKey].label; }, get license() { return MODELS[modelKey].license; }, get approxMB() { return MODELS[modelKey].approxMB; },
  setDevice(d) { if (d !== device) { device = d; kill(); active = null; } },
  get device() { return active; },
  id: "browser",
  isLoaded: () => loaded,
  // Tries the GPU first (much faster on phones that have one), then falls back to CPU (WebAssembly).
  async load(onProgress = () => {}, { signal } = {}) {
    if (loaded) return;
    const hasGpu = device !== "wasm" && !gpuBroken && await gpuAdapter();
    const order = device === "auto" ? (hasGpu ? ["webgpu", "wasm"] : ["wasm"]) : [device];
    let last;
    for (const d of order) {
      const t0 = performance.now();
      try {
        await request({ type: "load", model: MODELS[modelKey].id, dtype: MODELS[modelKey].dtype, device: d }, {
          idleMs: cfg.loadIdleMs, totalMs: cfg.loadTotalMs, signal, killOnAbort: true,
          onMessage: m => {
            if (m.type === "progress") onProgress({ phase: "download", pct: m.pct });
            else if (m.type === "phase") onProgress({ phase: "init", label: m.phase, t: (performance.now() - t0) / 1000 });
            else if (m.type === "loaded") { loaded = true; return true; }
          }
        });
        active = d; return;
      } catch (e) {
        last = e; if (e.code === "aborted") throw e;
        kill(); if (d === "webgpu") gpuBroken = true;
        onProgress({ phase: "init", label: `${d} did not start (${e.code || "error"}), trying the next option`, t: (performance.now() - t0) / 1000 });
      }
    }
    throw last;
  },
  // Requests are queued one after another (the model can only write one thing at a time).
  complete(messages, opts = {}) {
    const job = chain.catch(() => {}).then(() => this._complete(messages, opts));
    chain = job.catch(() => {});
    return job;
  },
  async _complete(messages, { maxTokens = 230, timeoutMs, signal, onToken } = {}) {
    if (signal?.aborted) throw err("aborted");
    if (!loaded) throw err("not-loaded");
    busy = true; let text = "", n = 0, first = null;
    try {
      const out = await request({ type: "generate", messages, maxTokens }, {
        idleMs: cfg.genIdleMs, totalMs: timeoutMs || cfg.genTotalMs, signal,
        onMessage: d => { if (d.type === "token") { if (first === null) first = performance.now(); n++; text += d.text; onToken?.(d.text, text); } else if (d.type === "done") return d.text || text; }
      });
      if (n > 4 && first) lastTps = n / Math.max((performance.now() - first) / 1000, 0.1);
      return out;
    } catch (e) { if (active === "webgpu" && e.code === "model-error") gpuBroken = true; throw e; }
    finally { busy = false; }
  },
  async unload() { kill(); },
  async diagnose(say) {
    say(`Model: ${MODELS[modelKey].label}. Device memory: ${navigator.deviceMemory ?? "unknown"} GB, CPU cores: ${navigator.hardwareConcurrency ?? "unknown"}, WebGPU adapter: ${await gpuAdapter()}`);
    say(`Speed mode: ${device}. Online: ${navigator.onLine}`);
    say(`Browser: ${navigator.userAgent}`);
    let last = -1;
    try {
      say("Loading the AI library and model...");
      await this.load(e => { if (e.phase === "download" && e.pct !== last && e.pct % 20 === 0) { last = e.pct; say(`Model files ${e.pct}%`); } if (e.phase === "init") say(`Step: ${e.label}`); });
      say(`Model ready on: ${active}. Writing a test...`);
      const t = performance.now(); let n = 0, first = null;
      const out = await this.complete([{ role: "user", content: "Write the numbers one to twelve as words, separated by commas." }], { maxTokens: 48, timeoutMs: 90000, onToken: () => { n++; if (first === null) { first = (performance.now() - t) / 1000; say(`First word after ${first.toFixed(1)}s`); } } });
      const secs = (performance.now() - t) / 1000, rate = n > 1 ? (n - 1) / Math.max(secs - first, 0.1) : 0;
      say(`Done: ${n} pieces in ${secs.toFixed(1)}s, about ${rate.toFixed(1)} per second.`);
      say(`Reply: "${out.trim().slice(0, 70)}"`);
      say(rate >= 4 ? "RESULT: good. Quests should write in under a minute." : rate >= 1.5 ? "RESULT: works but slow. Quests may take a minute or two." : "RESULT: too slow in this mode. Try a different speed mode.");
    } catch (e) { say(`RESULT: FAILED (${e.code || "error"}): ${e.message}`); }
  }
};
