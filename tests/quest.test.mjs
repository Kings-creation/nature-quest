// node tests/quest.test.mjs  (store.js falls back to memory in Node)
import assert from "node:assert/strict";
import { normalizeContext, validateDraft, transition, makeQuest, DEFAULT_CONTEXT, OPTIONS } from "../js/quest/model.js";
import { checkDraft, checkText } from "../js/quest/safety.js";
import { FALLBACKS, fallbackDraft, pickFallback, rankCandidates } from "../js/quest/fallback.js";
import { buildQuest, moveQuest, getLiveQuest } from "../js/quest/engine.js";
import { all } from "../js/store.js";
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("PASS", name); }, e => { console.log("FAIL", name, "\n ", e.message); process.exitCode = 1; });

await t("every static quest passes safety and schema", () => {
  for (const f of FALLBACKS) { const d = { title: f.title, intro: f.intro, steps: f.steps, reflectionPrompt: f.reflection }; assert.deepEqual(validateDraft(d), [], f.id); const c = checkDraft(d); assert.ok(c.ok, f.id + " " + c.reasons); }
});
await t("every context combination yields a safe, valid quest in the right environment", () => {
  for (const environment of OPTIONS.environment) for (const company of OPTIONS.company) for (const energy of OPTIONS.energy) for (const minutes of OPTIONS.minutes) for (const activity of OPTIONS.activity) for (const difficulty of OPTIONS.difficulty) {
    const ctx = normalizeContext({ environment, company, energy, minutes, activity, difficulty });
    const d = fallbackDraft(ctx, "x", []); assert.deepEqual(validateDraft(d), []); assert.ok(checkDraft(d).ok);
    if (environment !== "any") assert.ok(FALLBACKS.find(f => f.id === d.templateId).env.includes(environment), `${d.templateId} not valid for ${environment}`);
  }
});
await t("safety rejects dangerous instructions", () => {
  for (const bad of ["Climb the tallest tree", "Taste the red berries", "Cross the road without looking", "Go swimming in the lake", "Walk alone after dark", "Light a campfire", "Talk to a stranger", "Walk along the railway", "Follow the fence into private property", "Touch the snake"]) assert.ok(checkText(bad).length, bad);
  assert.ok(!checkText("Find something rough, something smooth and something soft.").length);
});
await t("library has 100+ unique quests and every place/group combination has real variety", () => {
  assert.ok(FALLBACKS.length >= 100, "only " + FALLBACKS.length); assert.equal(new Set(FALLBACKS.map(f => f.id)).size, FALLBACKS.length);
  assert.equal(new Set(FALLBACKS.map(f => f.title)).size, FALLBACKS.length, "duplicate titles");
  for (const f of FALLBACKS) assert.ok(f.tags && f.tags.split(" ").length >= 4, f.id + " needs mood tags");
  for (const environment of OPTIONS.environment) for (const company of OPTIONS.company) {
    const n = rankCandidates(normalizeContext({ environment, company }), { k: 999 }).length; assert.ok(n >= 12, `${environment}/${company} only has ${n}`);
  }
  for (const act of OPTIONS.activity) assert.ok(FALLBACKS.filter(f => f.act === act).length >= 12, act + " is thin");
  for (const d of [1, 2, 3]) assert.ok(FALLBACKS.filter(f => f.diff === d).length >= 8, "difficulty " + d + " is thin");
});
await t("input normalization never lets junk through", () => {
  assert.deepEqual(normalizeContext({ minutes: 9999, environment: "<script>", company: 5 }), DEFAULT_CONTEXT);
  assert.equal(normalizeContext({ minutes: "40" }).minutes, 40);
});
await t("state machine allows legal moves, blocks illegal ones, is idempotent", () => {
  const q = makeQuest({ id: "a", ownerId: "u", source: "fallback", draft: fallbackDraft(DEFAULT_CONTEXT, "s", []), context: DEFAULT_CONTEXT });
  const a = transition(q, "active"); assert.equal(a.rev, 2); assert.ok(a.startedAt);
  assert.equal(transition(a, "active"), a);
  assert.throws(() => transition(q, "completed")); assert.throws(() => transition(transition(q, "abandoned"), "active"));
  const done = transition(transition(a, "returned"), "completed"); assert.throws(() => transition(done, "active"));
});
await t("selection is deterministic for same seed and respects exclusions", () => {
  const c = normalizeContext({}); assert.equal(pickFallback(c, "k").id, pickFallback(c, "k").id);
  assert.notEqual(pickFallback(c, "k", [pickFallback(c, "k").id]).id, pickFallback(c, "k").id);
});
await t("solo never receives a group-only quest", () => {
  for (let i = 0; i < 40; i++) assert.ok(!FALLBACKS.find(f => f.id === pickFallback(normalizeContext({ company: "solo" }), "s" + i).id).groups);
});
await t("engine: no generator -> fallback quest saved + one outbox entry", async () => {
  const q = await buildQuest("owner1", {}); assert.equal(q.source, "fallback"); assert.equal(q.state, "ready");
  const out = (await all("outbox")).filter(o => o.recordId === q.id); assert.equal(out.length, 1);
});
await t("engine: unsafe AI output is rejected, falls back after retries", async () => {
  let calls = 0; const bad = async () => { calls++; return { title: "Tree race", intro: "Be bold.", steps: ["Climb the highest tree you can find.", "Wave from the top."], reflectionPrompt: "How high?" }; };
  const q = await buildQuest("owner2", {}, { generator: bad }); assert.equal(q.source, "fallback"); assert.equal(calls, 2); assert.ok(q.aiRejections.includes("height"));
});
await t("engine: valid AI draft is used", async () => {
  const good = async () => ({ title: "Moss and stone", intro: "Slow looking.", steps: ["Find a mossy stone.", "Describe it in three words."], reflectionPrompt: "Which word fits best?", model: "test-model" });
  const q = await buildQuest("owner3", {}, { generator: good }); assert.equal(q.source, "ai"); assert.equal(q.model, "test-model");
});
await t("engine: generator that throws or returns junk falls back, never crashes", async () => {
  assert.equal((await buildQuest("o4", {}, { generator: async () => { throw new Error("oom"); } })).source, "fallback");
  assert.equal((await buildQuest("o5", {}, { generator: async () => ({ title: 5 }) })).source, "fallback");
});
await t("engine: lifecycle persists, repeat taps do not duplicate outbox or bump rev", async () => {
  const q = await buildQuest("owner6", {}); const a = await moveQuest(q.id, "active"); const b = await moveQuest(q.id, "active");
  assert.equal(a.rev, b.rev); assert.equal((await getLiveQuest("owner6")).state, "active");
  assert.equal((await all("outbox")).filter(o => o.recordId === q.id).length, 2);
  await assert.rejects(() => moveQuest(q.id, "completed"));
});
await t("engine: ownership isolation", async () => { assert.equal(await getLiveQuest("nobody"), null); });
console.log(n + " passed"); 
