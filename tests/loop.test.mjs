import assert from "node:assert/strict";
import { buildQuest, getQuest, getLiveQuest } from "../js/quest/engine.js";
import { startQuest, returnQuest, resumeQuest, finishQuest, applyCompletion, currentStreak, dayKey } from "../js/quest/loop.js";
import { getProgress, all, put } from "../js/store.js";
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("PASS", name); }, e => { console.log("FAIL", name, "\n ", e.message); process.exitCode = 1; });
const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const fresh = async o => { const q = await buildQuest(o, {}); await startQuest(q.id); return q; };

await t("full completion: record + progress + quest completed, exactly once", async () => {
  const q = await fresh("u1"); await returnQuest(q.id);
  const r = await finishQuest(q.id, { outcome: "full", confirmedQuick: true, discovery: "  the moss   was warm ", now: D(2026, 10, 8) });
  assert.equal(r.completion.discovery, "the moss was warm"); assert.equal(r.progress.completed, 1); assert.equal(r.progress.streak, 1);
  assert.equal((await getQuest(q.id)).state, "completed"); assert.equal(await getLiveQuest("u1"), null);
});
await t("double tap / concurrent finish never double-counts", async () => {
  const q = await fresh("u2"); const [a, b] = await Promise.all([finishQuest(q.id, { outcome: "full", confirmedQuick: true }), finishQuest(q.id, { outcome: "full", confirmedQuick: true })]);
  assert.equal(a, b); assert.equal((await getProgress("u2")).completed, 1);
  const again = await finishQuest(q.id, { outcome: "full", confirmedQuick: true }); assert.equal(again.duplicate, true); assert.equal((await getProgress("u2")).completed, 1);
  assert.equal((await all("completions")).filter(c => c.ownerId === "u2").length, 1);
});
await t("repeat finish cannot be used to farm rewards via a different outcome", async () => {
  const q = await fresh("u3"); await finishQuest(q.id, { outcome: "partial" }); await finishQuest(q.id, { outcome: "full", confirmedQuick: true });
  const p = await getProgress("u3"); assert.equal(p.completed, 0); assert.equal(p.partial, 1);
});
await t("crash recovery: completion saved but progress/quest not updated -> finish repairs once", async () => {
  const q = await fresh("u4"); const cid = "u4:" + q.id;
  await put("completions", { id: cid, ownerId: "u4", questId: q.id, outcome: "full", confirmedQuick: true, discovery: "", followUp: null, completedAt: D(2026, 10, 8), createdAt: 1, updatedAt: 1, rev: 1 });
  await finishQuest(q.id, { outcome: "full", confirmedQuick: true }); await finishQuest(q.id, { outcome: "full", confirmedQuick: true });
  assert.equal((await getProgress("u4")).completed, 1); assert.equal((await getQuest(q.id)).state, "completed");
});
await t("skipped: quest abandoned, no completion, no progress", async () => {
  const q = await fresh("u5"); await returnQuest(q.id); const r = await finishQuest(q.id, { outcome: "skipped" });
  assert.equal(r.completion, null); assert.equal((await getQuest(q.id)).state, "abandoned"); assert.equal((await getProgress("u5")).completed, 0);
});
await t("cannot finish a quest that was never started or already abandoned", async () => {
  const q = await buildQuest("u6", {}); await assert.rejects(() => finishQuest(q.id, { outcome: "full", confirmedQuick: true }));
  await assert.rejects(() => returnQuest(q.id));
  await startQuest(q.id); await finishQuest(q.id, { outcome: "skipped" }); await assert.rejects(() => finishQuest(q.id, { outcome: "full", confirmedQuick: true }));
});
await t("not done yet: returned quest can resume, then finish", async () => {
  const q = await fresh("u7"); await returnQuest(q.id); assert.equal((await resumeQuest(q.id)).state, "active");
  await returnQuest(q.id); await finishQuest(q.id, { outcome: "full", confirmedQuick: true }); assert.equal((await getProgress("u7")).completed, 1);
});
await t("invalid outcome rejected", async () => { const q = await fresh("u8"); await assert.rejects(() => finishQuest(q.id, { outcome: "hax" })); });
await t("streak: consecutive days grow, same day doesn't, gap resets", () => {
  let p = { rev: 0, completed: 0, streak: 0, lastCompletedDay: null };
  p = applyCompletion(p, "full", "a", D(2026, 10, 8)); assert.equal(p.streak, 1);
  p = applyCompletion(p, "full", "b", D(2026, 10, 8, 20)); assert.equal(p.streak, 1);
  p = applyCompletion(p, "partial", "c", D(2026, 10, 9)); assert.equal(p.streak, 2);
  p = applyCompletion(p, "full", "d", D(2026, 10, 11)); assert.equal(p.streak, 1);
  p = applyCompletion(p, "full", "e", D(2026, 11, 1)); p = applyCompletion(p, "full", "f", D(2026, 11, 2)); assert.equal(p.streak, 2);
  const m = applyCompletion({ rev: 0, streak: 4, lastCompletedDay: "2026-02-28" }, "full", "g", D(2026, 3, 1)); assert.equal(m.streak, 5); // month boundary
});
await t("displayed streak lapses when a day is missed", () => {
  const p = { streak: 5, lastCompletedDay: dayKey(D(2026, 10, 6)) };
  assert.equal(currentStreak(p, D(2026, 10, 7)), 5); assert.equal(currentStreak(p, D(2026, 10, 8)), 0);
});
await t("outbox: each change queued once, ids are deterministic", async () => {
  const q = await fresh("u9"); await finishQuest(q.id, { outcome: "full", confirmedQuick: true }); await finishQuest(q.id, { outcome: "full", confirmedQuick: true });
  const out = (await all("outbox")).filter(o => o.ownerId === "u9"); const ids = out.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length); assert.equal(out.filter(o => o.entity === "completion").length, 1); assert.equal(out.filter(o => o.entity === "progress").length, 1);
});
console.log(n + " passed");
