// Pantry: quests written ahead of time. Small on-device models are slow, so while someone is on the home
// screen the app quietly writes the quest they are likely to ask for next and keeps it (on the device).
// Tapping "Give me a quest" then hands over an AI-written quest instantly. If none is ready, the person
// watches it being written (with a skip button) or gets the library. Drafts are validated and safety-checked
// before they are ever stored.
import { getMeta, setMeta } from "../store.js";
import * as ai from "./engine.js";
import { validateDraft } from "../quest/model.js";
import { checkDraft } from "../quest/safety.js";

const MAX = 3, RETRY_MS = 10 * 60 * 1000;
export const ctxKey = c => [c.company, c.minutes, c.environment, c.energy, c.activity, c.difficulty].join("|");
let inflight = null, lastFail = 0, lastCode = "failed";
const listeners = new Set();
const load = async () => (await getMeta("pantry")) || [];
export const count = async () => (await load()).length;
export const isBusy = () => !!inflight;
export const __reset = async () => { inflight = null; lastFail = 0; listeners.clear(); await setMeta("pantry", []); }; // tests only

async function store(entry) { const p = (await load()).filter(e => e.key !== entry.key); p.push(entry); await setMeta("pantry", p.slice(-MAX)); }
export async function take(ctx) {
  const p = await load(), i = p.findIndex(e => e.key === ctxKey(ctx));
  if (i < 0) return null;
  const [e] = p.splice(i, 1); await setMeta("pantry", p); return e.draft;
}

// One generation at a time. Returns a promise that resolves when the draft is stored (or failed).
function run(ctx) {
  if (inflight) return inflight.promise;
  const key = ctxKey(ctx);
  const promise = (async () => {
    try {
      const d = await ai.generateQuest(ctx, { attempt: 1, onToken: (_, full) => listeners.forEach(f => f(full)) });
      if (validateDraft(d).length || !checkDraft(d).ok) throw Object.assign(new Error("rejected"), { code: "rejected" });
      await store({ key, draft: d, at: Date.now() }); return true;
    } catch (e) { lastFail = Date.now(); lastCode = e?.code || "failed"; return false; }
    finally { inflight = null; }
  })();
  inflight = { promise, key };
  return promise;
}

// Called from the home screen. Quiet, and never while the app is hidden or the AI is off.
export function ensure(ctx) {
  if (!ai.isEnabled() || inflight || Date.now() - lastFail < RETRY_MS) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  load().then(p => { if (!p.some(e => e.key === ctxKey(ctx))) run(ctx); });
}

const abortable = signal => new Promise((_, rej) => { if (signal?.aborted) rej(Object.assign(new Error("aborted"), { code: "aborted" })); signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { code: "aborted" }))); });

// Used as the Quest Engine's generator: ready draft, else wait for the one being written, else write now.
export async function generator(ctx, { signal, onToken } = {}) {
  for (let round = 0; round < 2; round++) {
    const hit = await take(ctx); if (hit) return hit;
    const p = run(ctx), mine = inflight?.key === ctxKey(ctx), listen = onToken ? full => onToken("", full) : null;
    if (listen) listeners.add(listen);
    try { await Promise.race([p, signal ? abortable(signal) : new Promise(() => {})]); } finally { if (listen) listeners.delete(listen); }
    const got = await take(ctx); if (got) return got;
    if (mine || round === 1) throw Object.assign(new Error("no-draft"), { code: lastCode || "failed" }); // report the real reason (timeout, model-error...)
  }
}
