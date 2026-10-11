import assert from "node:assert/strict";
import * as ai from "../js/ai/engine.js";
import * as pantry from "../js/ai/pantry.js";
import { buildQuest } from "../js/quest/engine.js";
import { normalizeContext } from "../js/quest/model.js";
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("PASS", name); }, e => { console.log("FAIL", name, "\n ", e.message); process.exitCode = 1; });
const GOOD = "TITLE: Moss and stone\nINTRO: Slow looking.\nSTEP: Find a mossy stone.\nSTEP: Name it in three words.\nSTEP: Put it back.\nREFLECTION: Which word fits?";
const wait = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
const slow = (reply, ms = 40) => ({ id: "m", label: "mock-model", isLoaded: () => true, load: async () => {}, complete: async (m, o) => { calls++; await wait(15); o?.onToken?.("TITLE:", "TITLE:"); await wait(ms); return reply; } });
const ctx = normalizeContext({}); const other = normalizeContext({ minutes: 40 });
await ai.init(); ai.__setProviderForTests(slow(GOOD)); await ai.configure({ enabled: true });

await t("ensure writes ahead; take hands it over exactly once", async () => {
  await pantry.__reset(); pantry.ensure(ctx); await wait(10); assert.ok(pantry.isBusy()); await wait(120);
  assert.equal(await pantry.count(), 1); assert.equal((await pantry.take(ctx)).title, "Moss and stone"); assert.equal(await pantry.take(ctx), null);
});
await t("a ready draft makes quest creation instant and AI-written", async () => {
  await pantry.__reset(); pantry.ensure(ctx); await wait(120); calls = 0; const t0 = Date.now();
  const q = await buildQuest("p1", ctx, { generator: pantry.generator }); assert.equal(q.source, "ai"); assert.ok(Date.now() - t0 < 30); assert.equal(calls, 0);
});
await t("tapping while it is being written waits for that same draft (no second generation)", async () => {
  await pantry.__reset(); calls = 0; pantry.ensure(ctx); await wait(5); const seen = [];
  const q = await buildQuest("p2", ctx, { generator: (c, o) => pantry.generator(c, { ...o, onToken: (_, f) => seen.push(f) }) });
  assert.equal(q.source, "ai"); assert.equal(calls, 1); assert.ok(seen.length > 0);
});
await t("different choices than the stored draft: writes a fresh one instead of using a mismatch", async () => {
  await pantry.__reset(); pantry.ensure(ctx); await wait(120); calls = 0;
  const q = await buildQuest("p3", other, { generator: pantry.generator }); assert.equal(q.source, "ai"); assert.equal(calls, 1); assert.equal(await pantry.count(), 1); // the earlier draft is kept
});
await t("unsafe draft is never stored; quest falls back to the library", async () => {
  await pantry.__reset(); ai.__setProviderForTests(slow("TITLE: Tree race\nINTRO: Go.\nSTEP: Climb the tallest tree.\nSTEP: Wave.\nREFLECTION: How high?"));
  pantry.ensure(ctx); await wait(120); assert.equal(await pantry.count(), 0);
  const q = await buildQuest("p4", ctx, { generator: pantry.generator }); assert.equal(q.source, "fallback");
});
await t("skip (abort) frees the person immediately and the library is used", async () => {
  await pantry.__reset(); ai.__setProviderForTests(slow(GOOD, 400)); const ac = new AbortController(); setTimeout(() => ac.abort(), 20); const t0 = Date.now();
  const q = await buildQuest("p5", ctx, { generator: pantry.generator, signal: ac.signal }); assert.equal(q.source, "fallback"); assert.equal(q.aiError, "skipped"); assert.ok(Date.now() - t0 < 200);
  await wait(450);
});
await t("failure backs off: no hammering the model after an error", async () => {
  await pantry.__reset(); calls = 0; ai.__setProviderForTests({ ...slow(GOOD), complete: async () => { calls++; throw new Error("oom"); } });
  pantry.ensure(ctx); await wait(30); pantry.ensure(ctx); await wait(30); assert.equal(calls, 1);
});
await t("AI off: ensure does nothing", async () => { await pantry.__reset(); ai.__setProviderForTests(slow(GOOD)); await ai.configure({ enabled: false }); calls = 0; pantry.ensure(ctx); await wait(60); assert.equal(calls, 0); });
console.log(n + " passed");
