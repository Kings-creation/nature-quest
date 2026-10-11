// Stand-in for js/ai/worker.js so the watchdog and UI can be tested without a real model.
// ?mode=ok | hang | hang-gen | crash | gpu-fail
const mode = new URL(self.location.href).searchParams.get("mode") || "ok";
const GOOD = "TITLE: Moss and stone\nINTRO: Slow looking beats fast scrolling.\nSTEP: Find a mossy stone.\nSTEP: Describe it in three words.\nSTEP: Put it back exactly as it was.\nREFLECTION: Which word fits best?";
const say = m => postMessage(m), wait = ms => new Promise(r => setTimeout(r, ms));
const embedText = t => { const v = new Array(128).fill(0); for (const w of String(t).toLowerCase().match(/[a-z]+/g) || []) { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % 128] += 1; } const m = Math.hypot(...v) || 1; return v.map(x => x / m); };
self.onmessage = async ({ data }) => {
  if (data.type === "embed-load") { if (mode === "hang") return; say({ type: "progress", pct: 50 }); await wait(30); return say({ type: "loaded" }); }
  if (data.type === "embed") { if (mode === "hang") return; return say({ type: "embedded", vectors: data.texts.map(embedText) }); }
  if (mode === "crash") return setTimeout(() => { throw new Error("boom"); }, 10);
  if (data.type === "load") {
    if (mode === "gpu-fail" && data.device === "webgpu") return say({ type: "error", message: "webgpu unavailable" });
    if (mode === "hang") return; // never answers
    say({ type: "phase", phase: "library-ok" }); say({ type: "progress", pct: 60 }); await wait(50); say({ type: "phase", phase: "session-ok" }); say({ type: "loaded" });
  } else if (data.type === "generate") {
    if (mode === "hang-gen") { say({ type: "token", text: "TITLE:" }); return; }
    for (const w of GOOD.split(/(?<=\s)/)) { say({ type: "token", text: w }); await wait(15); }
    say({ type: "done", text: GOOD });
  }
};
