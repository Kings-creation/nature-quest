// Tiny on-device embedding model (all-MiniLM-L6-v2, Apache-2.0, about 25 MB). It turns text into numbers so the app
// can pick the quest whose meaning is closest to how the person feels. Fast (milliseconds), runs in its own worker,
// guarded by the same kind of watchdog as the writing model.
export const EMBED_MODEL = { id: "Xenova/all-MiniLM-L6-v2", dtype: "q8", label: "all-MiniLM-L6-v2", license: "Apache-2.0", approxMB: 25 };
const cfg = { workerUrl: new URL("../worker.js", import.meta.url).href, loadIdleMs: 60000, loadTotalMs: 300000, embedIdleMs: 20000, embedTotalMs: 30000 };
export const __tune = o => Object.assign(cfg, o);
let worker = null, loaded = false;
const err = (code, message) => Object.assign(new Error(message || code), { code });
const kill = () => { try { worker?.terminate(); } catch {} worker = null; loaded = false; };

function request(msg, { onMessage, idleMs, totalMs, signal }) {
  return new Promise((resolve, reject) => {
    if (!worker) { try { worker = new Worker(cfg.workerUrl, { type: "module" }); } catch (e) { return reject(err("worker-failed", String(e?.message || e))); } }
    const w = worker; let idle, total, done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(idle); clearTimeout(total); w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); signal?.removeEventListener("abort", onAbort); fn(v); };
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => { kill(); finish(reject, err("timeout")); }, idleMs); };
    const onMsg = ({ data }) => { bump(); if (data.type === "error") { kill(); return finish(reject, err("model-error", data.message)); } const r = onMessage(data); if (r !== undefined) finish(resolve, r); };
    const onErr = e => { kill(); finish(reject, err("worker-crashed", e?.message)); };
    const onAbort = () => finish(reject, err("aborted"));
    w.addEventListener("message", onMsg); w.addEventListener("error", onErr); signal?.addEventListener("abort", onAbort);
    total = setTimeout(() => { kill(); finish(reject, err("timeout")); }, totalMs); bump(); w.postMessage(msg);
  });
}
export const embedProvider = {
  id: "embed", ...EMBED_MODEL,
  isLoaded: () => loaded,
  async load(onProgress = () => {}, { signal } = {}) {
    if (loaded) return;
    await request({ type: "embed-load", model: EMBED_MODEL.id, dtype: EMBED_MODEL.dtype }, { idleMs: cfg.loadIdleMs, totalMs: cfg.loadTotalMs, signal,
      onMessage: d => { if (d.type === "progress") onProgress({ phase: "download", pct: d.pct }); else if (d.type === "phase") onProgress({ phase: "init", label: d.phase }); else if (d.type === "loaded") { loaded = true; return true; } } });
  },
  async embed(texts, { signal } = {}) {
    if (!loaded) throw err("not-loaded");
    return request({ type: "embed", texts }, { idleMs: cfg.embedIdleMs, totalMs: cfg.embedTotalMs, signal, onMessage: d => (d.type === "embedded" ? d.vectors : undefined) });
  },
  unload: async () => kill()
};
