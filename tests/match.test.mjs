import assert from "node:assert/strict";
import * as matcher from "../js/ai/matcher.js";
import { buildQuest, moveQuest } from "../js/quest/engine.js";
import { normalizeContext } from "../js/quest/model.js";
import { rankCandidates, FALLBACKS } from "../js/quest/fallback.js";
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("PASS", name); }, e => { console.log("FAIL", name, "\n ", e.message); process.exitCode = 1; });
// Deterministic stand-in for the embedding model: bag of words hashed into 128 dims, normalised.
const embedText = s => { const v = new Array(128).fill(0); for (const w of String(s).toLowerCase().match(/[a-z]+/g) || []) { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % 128] += 1; } const m = Math.hypot(...v) || 1; return v.map(x => x / m); };
let loaded = false, calls = 0;
const mock = { isLoaded: () => loaded, load: async () => { loaded = true; }, embed: async texts => { calls++; return texts.map(embedText); } };
matcher.__setProviderForTests(mock); await matcher.init();
const ctx = normalizeContext({ environment: "any", minutes: 20, energy: "low" });

await t("off: ranking is refused and quests come from the rules", async () => {
  await assert.rejects(() => matcher.rank(rankCandidates(ctx), ctx, ""), e => e.code === "off");
  const q = await buildQuest("m0", ctx, { ranker: matcher.rank }); assert.equal(q.source, "fallback"); assert.equal(q.matchError, "off");
});
await matcher.prepare();
await t("what the person types changes which quest they get", async () => {
  const cands = rankCandidates(normalizeContext({ environment: "any", minutes: 20, energy: "medium" }), { k: 12 });
  const calm = (await matcher.rank(cands, ctx, "anxious and stressed, want to calm down and breathe")).order[0];
  const play = (await matcher.rank(cands, ctx, "playful fun game")).order[0];
  assert.notEqual(calm.id, play.id); assert.match(calm.tags, /anxious|stressed|calm/); assert.match(play.tags, /playful|fun|game/);
});
await t("the matcher can only re-order: nothing outside the safe candidate list ever appears", async () => {
  const cands = rankCandidates(normalizeContext({ environment: "home", company: "solo" }), { k: 5 });
  const r = await matcher.rank(cands, ctx, "I want an adventure"); assert.deepEqual(r.order.map(f => f.id).sort(), cands.map(f => f.id).sort());
  const evil = async () => ({ order: [{ id: "not-in-list", steps: ["Climb the tree."], title: "x" }, ...cands], model: "evil" });
  const q = await buildQuest("m1", ctx, { ranker: evil }); assert.ok(cands.some(c => c.id === q.templateId));
});
await t("quest built with matching is labelled and respects place and group rules", async () => {
  const solo = normalizeContext({ environment: "street", company: "solo" });
  for (let i = 0; i < 12; i++) { const q = await buildQuest("m2", solo, { ranker: matcher.rank, mood: "calm" }); assert.equal(q.source, "matched"); assert.equal(q.model, "all-MiniLM-L6-v2"); const f = FALLBACKS.find(x => x.id === q.templateId); assert.ok(f.env.includes("street")); assert.ok(!f.groups); }
});
await t("a hung or failing matcher never blocks: quest appears from the rules within the time limit", async () => {
  const hang = () => new Promise(() => {}), t0 = Date.now();
  const q = await buildQuest("m3", ctx, { ranker: hang, rankMs: 150 }); assert.equal(q.source, "fallback"); assert.equal(q.matchError, "timeout"); assert.ok(Date.now() - t0 < 600);
  assert.equal((await buildQuest("m3", ctx, { ranker: async () => { throw new Error("oom"); } })).source, "fallback");
});
await t("'show me another' gives a different quest each time (no immediate repeats)", async () => {
  let q = await buildQuest("m4", ctx, { ranker: matcher.rank }); const seen = [q.templateId];
  for (let i = 0; i < 4; i++) { await moveQuest(q.id, "abandoned"); q = await buildQuest("m4", q.context, { ranker: matcher.rank }); assert.ok(!seen.includes(q.templateId), "repeat " + q.templateId); seen.push(q.templateId); }
});
await t("taste: finishing calm quests nudges neutral requests toward similar quests", async () => {
  const cands = rankCandidates(normalizeContext({ environment: "any", minutes: 20, energy: "medium" }), { k: 40 });
  const calmIds = FALLBACKS.filter(f => /calm|quiet|peaceful/.test(f.tags)).map(f => f.id).slice(0, 5);
  const base = (await matcher.rank(cands, ctx, "")).order.slice(0, 5).map(f => f.id);
  const liked = (await matcher.rank(cands, ctx, "", { liked: calmIds })).order.slice(0, 5);
  const calmish = liked.filter(f => /calm|quiet|peaceful/.test(f.tags)).length, calmBase = base.filter(id => /calm|quiet|peaceful/.test(FALLBACKS.find(f => f.id === id).tags)).length;
  assert.ok(calmish >= calmBase && calmish >= 3, `${calmish} vs ${calmBase}`);
});
await t("not ready yet: reports 'warming' instead of waiting, and works once the library is prepared", async () => {
  const { setMeta } = await import("../js/store.js"); await setMeta("lib-vectors", { sig: "stale", v: {} });
  const q = await buildQuest("m9", ctx, { ranker: matcher.rank }); assert.equal(q.source, "fallback"); assert.equal(q.matchError, "warming");
  await new Promise(r => setTimeout(r, 300)); assert.equal(await matcher.libraryReady(), true);
  assert.equal((await buildQuest("m9", ctx, { ranker: matcher.rank })).source, "matched");
});
await t("library vectors are computed once and cached", async () => { calls = 0; await matcher.rank(rankCandidates(ctx), ctx, "x"); const first = calls; calls = 0; await matcher.rank(rankCandidates(ctx), ctx, "y"); assert.ok(first <= 2 && calls === 1, `${first}/${calls}`); });
await t("context sentence includes the person's situation", () => { const s = matcher.contextSentence(normalizeContext({ company: "family", minutes: 40, energy: "high" }), new Date(2026, 9, 8, 9)); assert.match(s, /family/); assert.match(s, /40 minutes/); assert.match(s, /morning/); assert.match(s, /October/); });
console.log(n + " passed");
