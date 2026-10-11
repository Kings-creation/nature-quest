import { init as initAuth, getSession, onSession, continueLocal, signInEmail, signUpEmail, signInGoogle, signInApple, signOut, authAvailable, friendlyAuthError, firebaseApp } from "./auth.js";
import { getProgress, requestPersistence, storage, all } from "./store.js";
import { buildQuest, getLiveQuest, getQuest, moveQuest } from "./quest/engine.js";
import { OPTIONS, DEFAULT_CONTEXT } from "./quest/model.js";
import * as ai from "./ai/engine.js";
import * as pantry from "./ai/pantry.js";
import * as matcher from "./ai/matcher.js";
import { __tune as __tuneEmbed, embedProvider } from "./ai/providers/embed.js";
import { startQuest, returnQuest, resumeQuest, finishQuest, currentStreak } from "./quest/loop.js";
import { getMeta, setMeta, get } from "./store.js";
import { assessCompletion, analyzeImage, LEVELS, PHOTO_MESSAGES } from "./quest/verify.js";
import { evaluate, unlockedNow, suggestDifficulty, loadItems } from "./quest/achievements.js";
import { __tune } from "./ai/providers/browser.js";
import { drain, createFirestoreRemote, pendingCount } from "./sync.js";
import { installGlobalHandlers, setNotifier, report } from "./errors.js";

const $app = document.getElementById("app");
const $toasts = document.getElementById("toasts");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/></svg>',
  journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6zM6 4v16M10 8h5M10 12h5"/></svg>',
  you: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.4-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
  google: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.600-4.1H3.100v2.600A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.400 13.900a6 6 0 0 1 0-3.800V7.500H3.100a10 10 0 0 0 0 9z"/><path fill="#EA4335" d="M12 5.900c1.500 0 2.800.5 3.800 1.500l2.800-2.800A10 10 0 0 0 3.100 7.500l3.300 2.600C7.200 7.700 9.400 5.900 12 5.900z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.700c0-2.300 1.900-3.400 2-3.500-1.100-1.600-2.800-1.800-3.400-1.800-1.400-.1-2.800.9-3.500.9s-1.800-.8-3-.8c-1.500 0-3 .9-3.800 2.300-1.600 2.800-.4 7 1.200 9.300.8 1.100 1.700 2.400 2.900 2.300 1.200 0 1.600-.8 3-.8s1.800.8 3 .7c1.300 0 2.100-1.100 2.800-2.200.9-1.300 1.300-2.500 1.300-2.600-.1 0-2.500-1-2.500-3.800zM14.200 5.800c.6-.8 1.100-1.900.9-3-.9 0-2.100.6-2.700 1.400-.6.700-1.100 1.800-1 2.900 1.100.1 2.200-.5 2.800-1.300z"/></svg>'
};

const state = { linking: false, syncing: false, awayMs: 8000, cleanup: null, online: navigator.onLine, updateReady: null, mode: "signin", busy: false, progress: null, questCount: 0 };

/* ---------- toasts ---------- */
function toast(text, kind = "info", action) {
  const el = document.createElement("div");
  el.className = "toast " + kind; el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `<span>${esc(text)}</span>`;
  if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = () => { action.run(); el.remove(); }; el.append(b); }
  $toasts.append(el);
  if (!action) setTimeout(() => el.remove(), kind === "error" ? 6000 : 3500);
  return el;
}
setNotifier(toast);
installGlobalHandlers();

/* ---------- splash (shown right after sign-in) ---------- */
function showSplash(name, minMs = 1400) {
  const el = document.createElement("div");
  el.className = "splash"; el.setAttribute("role", "status");
  el.innerHTML = `<div class="splash-leaf" aria-hidden="true"></div><h2>Nature Quest</h2><p>Getting ready${name ? ", " + esc(name) : ""}</p>`;
  document.body.append(el);
  return { done: () => new Promise(r => { setTimeout(() => { el.classList.add("out"); setTimeout(() => { el.remove(); r(); }, 400); }, minMs); }) };
}

/* ---------- router ---------- */

const routes = { "/welcome": viewWelcome, "/home": viewHome, "/you": viewYou, "/new": viewNew, "/quest": viewQuest, "/ai": viewAI, "/away": viewAway, "/done": viewDone, "/journal": viewJournal };
function path() { const p = location.hash.replace(/^#/, "") || "/"; return routes[p] ? p : "/"; }
function go(p) { if (location.hash === "#" + p) render(); else location.hash = p; }
async function render() {
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
  const session = getSession();
  let p = path();
  if (!session) p = "/welcome"; else if ((p === "/" || p === "/welcome") && !state.linking) p = "/home";
  if (location.hash !== "#" + p) { history.replaceState(null, "", "#" + p); }
  try { await routes[p](session); } catch (e) { report(e, "Something went wrong drawing this screen."); }
  $app.hidden = false;
  const boot = document.getElementById("boot"); if (boot) { boot.classList.add("done"); setTimeout(() => boot.remove(), 450); }
  window.scrollTo(0, 0);
}
addEventListener("hashchange", render);
addEventListener("online", () => { state.online = true; toast("Back online."); render(); trySync(); });
addEventListener("offline", () => { state.online = false; toast("You're offline. Everything still works."); render(); });

/* ---------- views ---------- */
function viewWelcome() {
  const signup = state.mode === "signup";
  $app.innerHTML = `
  <main class="screen welcome">
    <div class="stack" style="gap:18px">
      <h1>Go outside. The phone can wait.</h1>
      <p class="lede">${state.linking ? "Sign in to back up your quests. Everything you've done so far moves with you." : "Nature Quest writes you a short mission with an AI that runs on your device, then gets out of your way."}</p>
      ${state.linking ? "" : '<ol class="how"><li>Get a quest</li><li>Put the phone away</li><li>Come back and tell us</li></ol>'}
    </div>
    <div class="sheet">
      <div class="stack">
        <button class="btn" data-act="google">${ICON.google}Continue with Google</button>
        <button class="btn" data-act="apple">${ICON.apple}Continue with Apple</button>
      </div>
      <div class="or">or use email</div>
      <form id="emailForm" class="stack" novalidate>
        <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required></div>
        <p class="msg" id="authMsg" role="alert"></p>
        <button class="btn primary" type="submit">${signup ? "Create account" : "Sign in"}</button>
        <button class="btn quiet" type="button" data-act="toggle">${signup ? "I already have an account" : "Create an account"}</button>
      </form>
      ${state.linking ? '<button class="btn quiet" data-act="cancel">Not now</button>' : '<button class="btn quiet" data-act="local">Continue without an account</button>'}
    </div>
  </main>`;
  const msg = t => { const m = document.getElementById("authMsg"); if (m) m.textContent = t || ""; };
  const attempt = async fn => {
    if (state.busy) return; state.busy = true; msg("");
    $app.querySelectorAll("button").forEach(b => b.disabled = true);
    try { const sess = await fn(); const sp = showSplash(sess?.kind === "account" ? sess.name : ""); const ready = sp.done(); { const s2 = getSession(); if (s2) await loadStats(s2); } state.linking = false; go("/home"); await ready; trySync(); }
    catch (e) { msg(friendlyAuthError(e)); $app.querySelectorAll("button").forEach(b => b.disabled = false); }
    finally { state.busy = false; }
  };
  $app.onclick = e => {
    const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
    if (act === "google") attempt(signInGoogle);
    else if (act === "apple") attempt(signInApple);
    else if (act === "local") attempt(continueLocal);
    else if (act === "cancel") { state.linking = false; go("/home"); }
    else if (act === "toggle") { state.mode = signup ? "signin" : "signup"; viewWelcome(); }
  };
  document.getElementById("emailForm").onsubmit = e => {
    e.preventDefault();
    const em = document.getElementById("em").value.trim(), pw = document.getElementById("pw").value;
    if (!em || !pw) return msg("Enter your email and a password.");
    attempt(() => (signup ? signUpEmail : signInEmail)(em, pw));
  };
}

const nav = cur => `<nav class="nav" aria-label="Main">
  <a href="#/home" ${cur === "home" ? 'aria-current="page"' : ""}>${ICON.home}Home</a>
  <a href="#/journal" ${cur === "journal" ? 'aria-current="page"' : ""}>${ICON.journal}Journal</a>
  <a href="#/you" ${cur === "you" ? 'aria-current="page"' : ""}>${ICON.you}You</a></nav>`;
const status = () => state.online ? "" : `<span class="pill off"><i></i>Offline</span>`;
const greet = () => { const h = new Date().getHours(); return h < 5 ? "Still up?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const ENV = { any: "anywhere nearby", home: "home or garden", street: "neighbourhood", park: "park", trail: "trail or countryside" };
const PREF_KEYS = ["company", "minutes", "environment", "energy", "activity"];
const OUTCOME = { full: "Finished", partial: "Some of it" };

async function loadStats(s) { state.progress = await getProgress(s.uid); }
const items = s => loadItems(s.uid, { all, get });
async function quickContext(s) { const prefs = (await getMeta("prefs")) || {}; return { ...DEFAULT_CONTEXT, ...prefs, difficulty: suggestDifficulty(await items(s)) }; }

async function trySync() {
  const s = getSession();
  if (!s || s.kind !== "account" || !authAvailable() || !navigator.onLine || state.syncing) return;
  state.syncing = true;
  try { const r = await drain({ remote: await createFirestoreRemote(firebaseApp), ownerId: s.uid }); state.syncError = r.error; }
  catch (e) { state.syncError = true; console.warn("sync", e); }
  finally { state.syncing = false; }
}

async function viewHome(s) {
  await loadStats(s);
  const p = state.progress, live = await getLiveQuest(s.uid);
  const recent = evaluate(await items(s)).filter(a => a.unlocked).sort((a, b) => b.unlockedAt - a.unlockedAt)[0];
  $app.innerHTML = `
  <main class="screen home has-nav">
    <div class="top"><span class="hello">${esc(greet())}, ${esc(s.name)}</span>${status()}</div>
    <h1>Ready to go outside?</h1>
    <section class="quest-card" aria-labelledby="qt">
      <div><h2 id="qt">${live ? (live.state === "ready" ? esc(live.title) : "Your quest is underway") : "Today's quest"}</h2></div>
      <p>${live ? (live.state === "ready" ? esc(live.intro) : live.state === "active" ? "Tap when you're back and tell us how it went." : "Finish up and you're done.") : "Tap once and Nature Quest picks a quest for you, then you go outside."}</p>
      <button class="btn" id="startQuest">${live ? (live.state === "ready" ? "Open your quest" : live.state === "active" ? "I'm back" : "Finish your quest") : "Give me a quest"}</button>
    </section>
    ${live ? "" : '<a class="btn quiet" href="#/new">Choose what I feel like</a>'}
    ${!matcher.isOn() && !matcher.getConfig().dismissed && !live ? `<section class="sheet" id="mcard"><h2 class="h2s">Make it smarter</h2><p class="note">An open AI model (25 MB, one time) can pick quests that fit how you feel. It runs on your phone and works offline.</p><p class="note" id="mstat"></p><div class="stack"><button class="btn primary" id="mOn">Turn on on-device AI</button><button class="btn quiet" id="mNo">Not now</button></div></section>` : ""}
    <div class="stats" aria-label="Your progress">
      <div class="stat"><b>${p.completed}</b><span>quests done</span></div>
      <div class="stat"><b>${currentStreak(p)}</b><span>day streak</span></div>
    </div>
    ${recent ? `<p class="achv"><span aria-hidden="true">🌿</span> Latest: <b>${esc(recent.title)}</b></p>` : ""}
  </main>${nav("home")}`;
  document.getElementById("startQuest").onclick = async e => { e.target.disabled = true; if (live) go("/quest"); else makeQuest(s, await quickContext(s)); };
  document.getElementById("mNo")?.addEventListener("click", async () => { await matcher.dismiss(); viewHome(s); });
  document.getElementById("mOn")?.addEventListener("click", async e => {
    e.target.disabled = true; const st = document.getElementById("mstat"); const un = matcher.onStatus(x => { st.textContent = mText(x); });
    try { await matcher.prepare(); toast("On-device AI is on."); } catch (err) { report(err); toast("Couldn't turn it on. Check your connection and try again.", "error"); }
    un(); viewHome(s);
  });
  if (!live) quickContext(s).then(c => pantry.ensure(c)).catch(() => {});
}

const mText = st => ({ off: "Off.", idle: "On. It loads when you make a quest.", downloading: `Downloading, ${st.pct}%`, loading: "Waking it up…", ready: "Ready", error: st.detail || "Something went wrong." }[st.state] || "");
const statusText = st => ({
  off: "Off. Quests come from the built-in library.",
  idle: "On. The model loads when you make a quest.",
  downloading: `Downloading the model, ${st.pct}%`,
  loading: "Waking the model up. The first time can take a minute.",
  ready: "Ready",
  error: st.detail || "Something went wrong.",
  unsupported: st.detail || "Not supported on this device."
}[st.state] || "");

async function viewAI() {
  const cfg = ai.getConfig(), info = ai.browserInfo(), st = ai.getStatus();
  const isBrowser = cfg.provider === "browser";
  $app.innerHTML = `<main class="screen has-nav ai">
    <a class="back" href="#/you">You</a>
    <h1>On-device AI</h1>
    <div class="sheet" id="mbox"><h2 class="h2s">Smart matching</h2>
      <p class="note">${esc(matcher.info().label)} (open weights, ${esc(matcher.info().license)}), about ${matcher.info().approxMB} MB. Picks the quest that fits how you feel. Fast, and it works offline.</p>
      <p class="note" id="mStatus" role="status">${esc(mText(matcher.getStatus()))}</p>
      <div class="stack"><button class="btn primary" id="mOn">${matcher.isOn() ? "Check and load now" : "Download and turn on"}</button>
        ${matcher.isOn() ? '<button class="btn" id="mOff">Turn off</button>' : ""}<button class="btn" id="mTest">Test matching</button></div>
      <pre id="mLog" class="log" hidden></pre></div>
    <h2 class="h2s" style="margin-top:28px">Creative writing (experimental)</h2>
    <p class="lede">A small model writes a whole quest from scratch. It is slower and less reliable, so it is off by default. An open-weight model writes your quests. Nothing is sent to a paid service, and once it's downloaded it works without a signal. While you're on the home screen it writes your next quest ahead of time, so it's ready when you are. If it ever takes too long, Nature Quest stops waiting and uses the built-in library.</p>
    <fieldset class="group"><legend>Where should it run?</legend><div class="chips">
      <label class="chip"><input type="radio" name="prov" value="browser" ${isBrowser ? "checked" : ""}><span>On this device</span></label>
      <label class="chip"><input type="radio" name="prov" value="endpoint" ${!isBrowser ? "checked" : ""}><span>My own computer</span></label></div></fieldset>
    <div class="sheet" id="provBox">
      ${isBrowser ? `<p><b>${esc(info.label)}</b><br><span class="note">Open weights, ${esc(info.license)}. One-time download of roughly ${info.approxMB} MB, so use Wi-Fi.</span></p>
        ${info.capability.level !== "ok" ? `<p class="msg">${esc(info.capability.reason)}</p>` : ""}
        <fieldset class="group"><legend>Model</legend><div class="chips">
          ${Object.entries(info.models).map(([k, m]) => `<label class="chip"><input type="radio" name="mdl" value="${k}" ${info.key === k ? "checked" : ""}><span>${esc(m.short)}</span></label>`).join("")}</div>
          <p class="note">${esc(info.models[info.key].blurb)}</p></fieldset>
        <fieldset class="group"><legend>Speed mode</legend><div class="chips">
          ${[["auto", "Auto"], ["webgpu", "Fast (graphics chip)"], ["wasm", "Compatible (CPU)"]].map(([v, l]) => `<label class="chip"><input type="radio" name="dev" value="${v}" ${(cfg.device || "auto") === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
          <p class="note">Auto tries the graphics chip first and falls back to the CPU. Your phone's graphics chip is much faster.</p></fieldset>`
      : `<div class="field"><label for="bu">Server address</label><input id="bu" value="${esc(cfg.endpoint.baseUrl)}" autocapitalize="off" autocomplete="off"></div>
         <div class="field"><label for="mn">Model name</label><input id="mn" value="${esc(cfg.endpoint.model)}" autocapitalize="off" autocomplete="off"></div>
         <p class="note">Works with any OpenAI-compatible server you run, such as Ollama with gpt-oss-20b. The server must allow this site's address.</p>`}
      <p id="aiStatus" class="note" role="status">${esc(statusText(st))}</p>
      <div class="stack">
        <button class="btn primary" id="aiOn">${cfg.enabled ? "Check and load now" : isBrowser ? "Download and turn on" : "Connect and turn on"}</button>
        ${cfg.enabled ? '<button class="btn" id="aiOff">Turn off</button>' : ""}
        <button class="btn" id="aiTest">Test the AI on this device</button>
      </div>
      <pre id="aiLog" class="log" hidden></pre>
      <button class="btn quiet" id="aiCopy" hidden>Copy test results</button>
    </div></main>${nav("you")}`;
  const unsub = ai.onStatus(x => { const el = document.getElementById("aiStatus"); if (el) el.textContent = statusText(x); else unsub(); });
  const mun = matcher.onStatus(x => { const el = document.getElementById("mStatus"); if (el) el.textContent = mText(x); else mun(); });
  document.getElementById("mOn").onclick = async e => { e.target.disabled = true; try { await matcher.prepare(); toast("Smart matching is on."); } catch (err) { report(err); } viewAI(); };
  document.getElementById("mOff")?.addEventListener("click", async () => { await matcher.turnOff(); viewAI(); });
  document.getElementById("mTest").onclick = async e => { const log = document.getElementById("mLog"); e.target.disabled = true; log.hidden = false; log.textContent = ""; await matcher.diagnose(l => { log.textContent += l + "\n"; }); e.target.disabled = false; };
  document.querySelectorAll("input[name=mdl]").forEach(r => r.onchange = async () => { await ai.configure({ model: r.value, enabled: false }); viewAI(); });
  document.querySelectorAll("input[name=dev]").forEach(r => r.onchange = async () => { await ai.configure({ device: r.value }); viewAI(); });
  document.querySelectorAll("input[name=prov]").forEach(r => r.onchange = async () => { await ai.configure({ provider: r.value, enabled: false }); viewAI(); });
  document.getElementById("aiOff")?.addEventListener("click", async () => { await ai.configure({ enabled: false }); viewAI(); });
  document.getElementById("aiTest").onclick = async e => {
    const log = document.getElementById("aiLog"), copy = document.getElementById("aiCopy"); e.target.disabled = true; log.hidden = false; log.textContent = "";
    if (!isBrowser) await ai.configure({ endpoint: { baseUrl: document.getElementById("bu").value.trim(), model: document.getElementById("mn").value.trim() } });
    await ai.diagnose(line => { log.textContent += line + "\n"; log.scrollTop = log.scrollHeight; });
    e.target.disabled = false; copy.hidden = false; copy.onclick = () => navigator.clipboard?.writeText(log.textContent).then(() => toast("Copied."));
  };
  document.getElementById("aiOn").onclick = async () => {
    const b = document.getElementById("aiOn");
    if (isBrowser) {
      if (info.capability.level === "no") return toast(info.capability.reason, "error");
      if (info.capability.level === "limited" && !confirm(info.capability.reason + " Continue?")) return;
      if (!ai.modelDownloaded() && !confirm(`Download about ${info.approxMB} MB now? Wi-Fi is recommended.`)) return;
    } else { await ai.configure({ endpoint: { baseUrl: document.getElementById("bu").value.trim(), model: document.getElementById("mn").value.trim() } }); }
    b.disabled = true;
    try { await ai.configure({ enabled: true }); await ai.prepare(); toast("AI is ready."); } catch (e) { report(e); }
    b.disabled = false; viewAI();
  };
}

const LABELS = {
  company: ["Who is going?", { solo: "Just me", family: "Family", friends: "Friends" }],
  minutes: ["How long do you have?", v => v + " min"],
  environment: ["Where will you be?", { any: "Anywhere nearby", home: "Home or garden", street: "Neighbourhood", park: "Park", trail: "Trail or countryside" }],
  energy: ["How much energy?", { low: "Low", medium: "Medium", high: "High" }],
  activity: ["What do you feel like?", { observe: "Look closely", listen: "Listen", move: "Move", create: "Make something" }],
  difficulty: ["How hard?", { easy: "Easy", medium: "Medium", hard: "Challenging" }]
};
async function viewNew(s) {
  const def = await quickContext(s);
  const group = k => { const [q, map] = LABELS[k]; return `<fieldset class="group"><legend>${q}</legend><div class="chips">${OPTIONS[k].map(v => `<label class="chip"><input type="radio" name="${k}" value="${v}" ${String(def[k]) === String(v) ? "checked" : ""}><span>${esc(typeof map === "function" ? map(v) : map[v])}</span></label>`).join("")}</div></fieldset>`; };
  $app.innerHTML = `<main class="screen new">
    <a class="back" href="#/home">Back</a>
    <h1>What do you feel like?</h1><p class="lede">Optional. Skip this and Nature Quest picks for you.</p>
    <a class="aiLine" href="#/ai"><span class="pill ${ai.isEnabled() ? "" : "off"}"><i></i>AI writer: ${ai.isEnabled() ? esc(ai.activeLabel()) : "off, using the library"}</span></a>
    <form id="qf"><div class="field" style="margin-bottom:22px"><label for="mood">In a few words, how are you feeling? (optional)</label><input id="mood" name="mood" maxlength="120" placeholder="tired after work, want something calm" autocomplete="off"><p class="note" style="margin:4px 0 0">${matcher.isOn() ? "On-device AI uses this to pick your quest." : 'Turn on on-device AI (<a href="#/ai">here</a>) to use this.'}</p></div>${Object.keys(LABELS).map(group).join("")}<button class="btn primary" type="submit">Write my quest</button></form></main>`;
  document.getElementById("qf").onsubmit = async e => {
    e.preventDefault();
    const ctx = Object.fromEntries(new FormData(e.target).entries()), mood = (ctx.mood || "").trim();
    await setMeta("prefs", Object.fromEntries(PREF_KEYS.map(k => [k, ctx[k]])));
    makeQuest(s, ctx, mood);
  };
}

// Writing screen: live text while the AI works, elapsed time, and an escape hatch that always works.
async function makeQuest(s, ctx, mood = "") {
  const ac = new AbortController(), t0 = Date.now(), useWrite = ai.isEnabled(), useMatch = !useWrite && matcher.isOn();
  $app.innerHTML = `<main class="screen"><div class="writing" role="status">
    <div class="dots" aria-hidden="true"><i></i><i></i><i></i></div><p id="wmsg">${useWrite ? "Writing your quest" : useMatch ? "Choosing the quest that fits you" : "Choosing your quest"}</p>
    <p class="stream" id="wstream" aria-hidden="true"></p><p class="note" id="wtime"></p>
    ${useWrite ? '<button class="btn" id="wskip">Use a ready-made quest instead</button>' : ""}</div></main>`;
  const msg = document.getElementById("wmsg"), stream = document.getElementById("wstream"), tm = document.getElementById("wtime");
  const tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); if (useWrite) tm.textContent = sec < 20 ? "" : sec < 60 ? `${sec}s. Phones can take a minute for the first quest.` : `${sec}s. Still working. You can use a ready-made quest instead.`; }, 1000);
  const unsubA = ai.onStatus(x => { if (!useWrite) return; if (x.state === "downloading" || x.state === "loading") msg.textContent = statusText(x); else if (x.state === "ready") msg.textContent = "Writing your quest"; });
  const unsubM = matcher.onStatus(x => { if (useMatch && (x.state === "downloading" || x.state === "loading")) msg.textContent = mText(x); });
  const stop = () => { clearInterval(tick); unsubA(); unsubM(); };
  state.cleanup = () => { stop(); ac.abort(); };
  document.getElementById("wskip")?.addEventListener("click", () => ac.abort());
  const generator = useWrite ? (c, o) => pantry.generator(c, { signal: o.signal, onToken: (_, full) => { msg.textContent = "Writing your quest"; stream.textContent = full.slice(-220); } }) : null;
  const liked = useMatch ? (await items(s)).filter(i => i.completion.outcome === "full").map(i => i.quest?.templateId).filter(Boolean) : [];
  const ranker = useMatch ? (cands, c, m) => matcher.rank(cands, c, m, { signal: ac.signal, liked }) : null;
  try { await buildQuest(s.uid, ctx, { generator, ranker, mood, signal: ac.signal }); state.cleanup = null; stop(); trySync(); go("/quest"); }
  catch (err) { stop(); state.cleanup = null; report(err, "Couldn't create a quest. Please try again."); go("/home"); }
}

const AI_NOTE = { timeout: "The AI took too long, so this quest is from the built-in library.", slow: "The AI took too long, so this quest is from the built-in library.", skipped: "You chose a ready-made quest.", failed: "The AI couldn't write this one, so it's from the built-in library.", "model-error": "The AI hit an error on this device, so this quest is from the built-in library. Try the test under You, then On-device AI.", "worker-crashed": "The AI stopped unexpectedly on this device, so this quest is from the built-in library.", "worker-failed": "The AI couldn't start on this device, so this quest is from the built-in library." };

async function viewQuest(s) {
  const q = await getLiveQuest(s.uid);
  if (!q) return go("/home");
  if (q.state === "returned") return viewReturn(s, q);
  const active = q.state === "active";
  const src = q.source === "ai" ? "Written by " + esc(q.model || "AI") : q.source === "matched" ? "Picked for you by " + esc(q.model || "AI") : "From the library";
  const note = q.aiError && !active && AI_NOTE[q.aiError] ? AI_NOTE[q.aiError] : (q.source === "fallback" && q.matchError && matcher.isOn() && !active ? (q.matchError === "warming" ? "The matching model is still preparing the quest library, so the app picked this one." : "The matching model didn't answer in time, so the app picked this one.") : "");
  $app.innerHTML = `<main class="screen quest">
    <a class="back" href="#/home">Home</a>
    <h1>${esc(q.title)}</h1>
    <div class="meta"><span class="pill">${q.durationMin} min</span><span class="pill">${esc(ENV[q.context.environment] || q.context.environment)}</span><span class="pill">${active ? "In progress" : "Ready"}</span><span class="pill">${src}</span></div>
    ${active ? '<p class="lede">Your quest is underway. Phone away, eyes up.</p>' : ""}
    <section class="kv"><h2>Why this</h2><p>${esc(q.intro)}</p></section>
    <section class="kv"><h2>Your task</h2><ol class="steps">${q.steps.map(st => `<li>${esc(st.text)}</li>`).join("")}</ol></section>
    <section class="kv"><h2>Time</h2><p>About ${q.durationMin} minutes</p></section>
    ${note ? `<p class="note">${esc(note)}</p>` : ""}
    <p class="note">${esc(q.safetyNote)}</p>
    <div class="stack">
      ${active ? '<button class="btn primary" id="back2">I\'m back</button>' : '<button class="btn primary" id="go">Start quest</button><button class="btn" id="another">Show me another</button>'}
      <button class="btn quiet" id="drop">Drop this quest</button>
    </div></main>`;
  document.getElementById("go")?.addEventListener("click", async e => { e.target.disabled = true; await startQuest(q.id); go("/away"); });
  document.getElementById("another")?.addEventListener("click", async e => { e.target.disabled = true; await moveQuest(q.id, "abandoned"); makeQuest(s, q.context, ""); });
  document.getElementById("back2")?.addEventListener("click", async e => { e.target.disabled = true; await returnQuest(q.id); viewQuest(s); });
  document.getElementById("drop").onclick = async () => { await moveQuest(q.id, "abandoned"); go("/home"); };
}

// The deliberate leave-the-screen moment. After a few seconds the screen rests; tapping wakes it.
async function viewAway(s) {
  const q = await getLiveQuest(s.uid);
  if (!q || q.state !== "active") return go("/quest");
  $app.innerHTML = `<main class="away" id="away" tabindex="0" role="button" aria-label="Wake the screen. Your quest is underway.">
    <div class="away-in"><p class="away-small">${esc(q.title)} · about ${q.durationMin} min</p>
    <h1>Your quest is ready.</h1><p class="away-big">Now put the phone away. 🌿</p>
    <p class="away-small">Tap anywhere when you're back.</p></div></main>`;
  const el = document.getElementById("away");
  const wake = () => go("/quest");
  el.onclick = wake; el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") wake(); };
  const t = setTimeout(() => el.classList.add("rest"), state.awayMs);
  state.cleanup = () => clearTimeout(t);
}

function viewReturn(s, q) {
  const a0 = assessCompletion({ startedAt: q.startedAt || Date.now(), endedAt: Date.now(), durationMin: q.durationMin });
  let photo = null;
  $app.innerHTML = `<main class="screen quest">
    <h1>Welcome back.</h1><p class="lede">${esc(q.title)}. You were out for about ${a0.elapsedMin} min.</p>
    <form id="rf">
      <fieldset class="group"><legend>Did you complete it?</legend><div class="chips">
        <label class="chip"><input type="radio" name="outcome" value="full" checked><span>Yes, all of it</span></label>
        <label class="chip"><input type="radio" name="outcome" value="partial"><span>Some of it</span></label>
        <label class="chip"><input type="radio" name="outcome" value="skipped"><span>Not this time</span></label></div></fieldset>
      ${a0.tooQuick ? '<label class="check" id="qk"><input type="checkbox" id="cq"><span>I finished it, just quickly</span></label>' : ""}
      <div class="field" id="disc"><label for="dd">${esc(q.reflectionPrompt)}</label><textarea id="dd" maxlength="300" rows="3" placeholder="A few words is plenty"></textarea></div>
      <div class="field" id="photoBox"><input id="ph" type="file" accept="image/*" capture="environment" hidden>
        <label for="ph" class="btn">Add a photo (optional)</label><img id="pht" class="thumb" alt="Your photo" hidden><p class="note" id="phs">Stays on your phone.</p></div>
      <p class="msg" id="rmsg" role="alert"></p>
      <div class="stack"><button class="btn primary" type="submit" id="fin">Finish</button>
      <button class="btn quiet" type="button" id="resume">Not done yet, back outside</button></div>
    </form></main>`;
  const form = document.getElementById("rf"), msg = t => { document.getElementById("rmsg").textContent = t || ""; };
  form.onchange = () => { const sk = form.outcome.value === "skipped"; document.getElementById("disc").hidden = sk; document.getElementById("photoBox").hidden = sk; if (document.getElementById("qk")) document.getElementById("qk").hidden = form.outcome.value !== "full"; };
  document.getElementById("ph").onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const phs = document.getElementById("phs"), pht = document.getElementById("pht");
    phs.textContent = "Checking the photo…"; const r = await analyzeImage(f);
    if (r.ok) { photo = r; pht.src = r.thumb; pht.hidden = false; phs.textContent = "Photo attached. It stays on your phone."; }
    else { photo = null; pht.hidden = true; e.target.value = ""; phs.textContent = PHOTO_MESSAGES[r.reason] || PHOTO_MESSAGES.unreadable; }
  };
  document.getElementById("resume").onclick = async () => { await resumeQuest(q.id); go("/away"); };
  form.onsubmit = async e => {
    e.preventDefault(); msg("");
    const outcome = form.outcome.value, discovery = document.getElementById("dd").value, confirmedQuick = !!document.getElementById("cq")?.checked;
    if (outcome === "full" && a0.tooQuick && !confirmedQuick) return msg("That was quick. Tick the box if you really finished it, or choose \"Some of it\".");
    const fin = document.getElementById("fin"); fin.disabled = true;
    try {
      let followUp = null;
      if (outcome !== "skipped" && discovery.trim() && ai.isEnabled()) {
        fin.textContent = "One moment…";
        const t = await Promise.race([ai.generateReflection(q, discovery), new Promise(r => setTimeout(() => r(null), 8000))]);
        followUp = t && t !== q.reflectionPrompt ? t : null; // only show it if the AI really wrote something new
      }
      const r = await finishQuest(q.id, { outcome, discovery, followUp, photo, confirmedQuick });
      if (outcome === "skipped") { toast("No problem. The outdoors will still be there."); return go("/home"); }
      await setMeta("lastDone", r.completion.id); trySync(); go("/done");
    } catch (err) { fin.disabled = false; fin.textContent = "Finish"; if (err.code === "quick-unconfirmed") msg(err.message); else report(err, "Couldn't save that. Please try again."); }
  };
}

async function viewDone(s) {
  const cid = await getMeta("lastDone"), c = cid ? await get("completions", cid) : null;
  if (!c || c.ownerId !== s.uid) return go("/home");
  const q = await get("quests", c.questId), p = await getProgress(s.uid);
  const all_ = await items(s), fresh = unlockedNow(all_.filter(i => i.completion.id !== c.id), all_);
  const v = c.verification;
  $app.innerHTML = `<main class="screen done">
    <h1>${c.outcome === "full" ? "Quest complete." : "Good outing."}</h1>
    <p class="lede">${esc(q?.title || "")}${v ? ` · ${esc(LEVELS[v.level])}, ${v.elapsedMin} min outside` : ""}</p>
    ${c.thumb ? `<img class="thumb" src="${c.thumb}" alt="Your photo">` : ""}
    ${c.discovery ? `<blockquote>${esc(c.discovery)}</blockquote>` : ""}
    ${c.followUp ? `<p class="follow">${esc(c.followUp)}</p>` : ""}
    ${fresh.map(a => `<p class="achv"><span aria-hidden="true">🌿</span> New: <b>${esc(a.title)}</b>. ${esc(a.text)}.</p>`).join("")}
    <div class="stats"><div class="stat"><b>${p.completed}</b><span>quests done</span></div><div class="stat"><b>${currentStreak(p)}</b><span>day streak</span></div></div>
    <div class="stack" style="margin-top:34px"><button class="btn primary" id="ok">Enough screen for now 🌿</button></div></main>`;
  document.getElementById("ok").onclick = () => go("/home");
}

async function viewJournal(s) {
  const list = (await items(s)).sort((a, b) => b.completion.completedAt - a.completion.completedAt);
  const ev = evaluate(list), got = ev.filter(a => a.unlocked);
  $app.innerHTML = `<main class="screen has-nav journal"><h1>Journal</h1>
    ${list.length ? `<section aria-label="Achievements"><div class="chips">${got.map(a => `<span class="pill" title="${esc(a.text)}">🌿 ${esc(a.title)}</span>`).join("")}${got.length < ev.length ? `<span class="pill off">${ev.length - got.length} more to find</span>` : ""}</div></section>
    <ol class="entries">${list.map(({ completion: c, quest: q }) => `<li class="entry"><div class="entry-top"><b>${esc(q?.title || "Quest")}</b><span>${esc(new Date(c.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }))}</span></div>
      <p class="note">${esc(OUTCOME[c.outcome] || "")}${c.verification ? ` · ${esc(LEVELS[c.verification.level])} · ${c.verification.elapsedMin} min` : ""}</p>
      ${c.discovery ? `<p>${esc(c.discovery)}</p>` : ""}${c.thumb ? `<img class="thumb" src="${c.thumb}" alt="Your photo">` : ""}</li>`).join("")}</ol>`
    : `<div class="writing"><p>Your journal fills up as you go outside.</p><a class="btn primary" href="#/home">Make your first quest</a></div>`}
  </main>${nav("journal")}`;
}

async function viewYou(s) {
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const pend = s.kind === "account" ? await pendingCount(s.uid) : 0;
  const rows = [
    ["Name", esc(s.name)],
    ["Account", s.kind === "account" ? esc(s.email || s.provider) : "On this device only"],
    ["Saved on this device", storage.persistent ? (persisted ? "Yes, protected" : "Yes") : "Not available in this browser"],
    ["Connection", state.online ? "Online" : "Offline"],
    ["Backup", s.kind === "account" ? (pend ? `${pend} waiting for a connection` : "Up to date") : "Sign in to back up"]
  ];
  $app.innerHTML = `
  <main class="screen you has-nav">
    <h1>You</h1>
    <div class="rows">${rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join("")}</div>
    <div class="stack">
      <a class="btn" href="#/ai">On-device AI</a>
      ${s.kind === "local" && authAvailable() ? '<button class="btn primary" id="signin">Sign in to back up</button>' : ""}
      <button class="btn" id="out">${s.kind === "local" ? "Leave this profile" : "Sign out"}</button>
    </div>
  </main>${nav("you")}`;
  document.getElementById("signin")?.addEventListener("click", () => { state.linking = true; state.mode = "signin"; go("/welcome"); });
  document.getElementById("out").onclick = async () => {
    if (s.kind === "local" && !confirm("This profile only exists on this device. Leaving it removes your access to it. Continue?")) return;
    await signOut(); state.mode = "signin"; go("/welcome");
  };
}

/* ---------- service worker + update strategy ---------- */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const hadController = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register("sw.js");
    const offer = w => { if (state.updateReady) return; state.updateReady = toast("A new version is ready.", "info", { label: "Reload", run: () => w.postMessage("SKIP_WAITING") }); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloaded || !hadController) return; reloaded = true; location.reload(); });
  } catch (e) { report(e); }
}

/* ---------- boot ---------- */
(async function boot() {
  try { await initAuth(); await ai.init(); await matcher.init(); matcher.warm(); } catch (e) { report(e); }
  onSession(() => { if (!state.busy) render(); });
  requestPersistence();
  await render();
  registerSW(); trySync();
})();
window.__nq = { state, go, render, ai, pantry, matcher, embed: embedProvider, tuneAI: (o) => { __tune(o); __tuneEmbed(o); } };
