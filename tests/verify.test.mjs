import assert from "node:assert/strict";
import { assessCompletion, scorePixels } from "../js/quest/verify.js";
import { evaluate, unlockedNow, suggestDifficulty } from "../js/quest/achievements.js";
import { drain, remotePath } from "../js/sync.js";
import { reown } from "../js/claim.js";
import { buildQuest, getLiveQuest, getQuest } from "../js/quest/engine.js";
import { startQuest, finishQuest } from "../js/quest/loop.js";
import { all, getProgress, put, enqueue } from "../js/store.js";
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("PASS", name); }, e => { console.log("FAIL", name, "\n ", e.message); process.exitCode = 1; });
const M = 60000, D = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

await t("assess: long enough outdoors -> time checked; photo upgrades to evidence", () => {
  const base = { startedAt: 0, endedAt: 20 * M, durationMin: 20 };
  assert.equal(assessCompletion(base).level, "time"); assert.equal(assessCompletion({ ...base, photoOk: true }).level, "evidence");
  assert.deepEqual(assessCompletion({ ...base, discovery: "warm bark today" }).signals, ["time", "reflection"]);
});
await t("assess: too quick needs confirmation, never reports 'time checked'", () => {
  const a = assessCompletion({ startedAt: 0, endedAt: 1 * M, durationMin: 20 }); assert.ok(a.tooQuick && a.needsConfirm); assert.equal(a.level, "self");
  assert.equal(assessCompletion({ startedAt: 0, endedAt: M, durationMin: 20, confirmedQuick: true }).needsConfirm, false);
  assert.equal(assessCompletion({ startedAt: 0, endedAt: 5 * M, durationMin: 20 }).tooQuick, false);   // 25% of 20 = 5
  assert.equal(assessCompletion({ startedAt: 0, endedAt: 1.4 * M, durationMin: 4 }).need, 2);          // floor of 2 minutes
});
await t("photo check: blank/black/white rejected, real detail accepted", () => {
  const flat = v => new Uint8ClampedArray(64 * 64 * 4).fill(v), noisy = new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i * 37 + (i >> 3) * 91) % 200 + 20);
  assert.equal(scorePixels(flat(0)).reason, "dark"); assert.equal(scorePixels(flat(255)).reason, "bright"); assert.equal(scorePixels(flat(128)).reason, "blank"); assert.ok(scorePixels(noisy).ok);
});
const mk = async (o, env, company, mins, outcome, day, extra = {}) => { const q = await buildQuest(o, { environment: env, company, minutes: mins }); await startQuest(q.id); const startedAt = D(...day, 9) ; await put("quests", { ...(await getQuest(q.id)), startedAt }); return finishQuest(q.id, { outcome, now: startedAt + mins * M, ...extra }); };
await t("finish enforces quick-confirm for full; partial and confirmed pass; stores verification, keeps photo local", async () => {
  const q = await buildQuest("v1", {}); await startQuest(q.id);
  await assert.rejects(() => finishQuest(q.id, { outcome: "full" }), e => e.code === "quick-unconfirmed");
  assert.equal((await getQuest(q.id)).state, "active"); assert.equal((await getProgress("v1")).completed, 0);
  const r = await finishQuest(q.id, { outcome: "full", confirmedQuick: true, photo: { ok: true, thumb: "data:image/jpeg;base64,AAA" } });
  assert.equal(r.completion.verification.level, "evidence"); assert.ok(r.completion.verification.flags.includes("quick")); assert.equal(r.completion.thumb, "data:image/jpeg;base64,AAA");
  const out = (await all("outbox")).filter(o => o.recordId === "v1:" + q.id)[0]; assert.equal(out.payload.thumb, null);
  const q2 = await buildQuest("v1", {}); await startQuest(q2.id); assert.equal((await finishQuest(q2.id, { outcome: "partial" })).completion.outcome, "partial");
});
await t("invalid photo is ignored: completion is not upgraded to evidence", async () => {
  const q = await buildQuest("v2", {}); await startQuest(q.id); const r = await finishQuest(q.id, { outcome: "full", confirmedQuick: true, photo: { ok: false, reason: "blank" } });
  assert.ok(!r.completion.verification.signals.includes("photo")); assert.equal(r.completion.thumb, null);
});
await t("a full quest with enough time outside is time-checked", async () => { const r = await mk("v3", "park", "solo", 20, "full", [2026, 10, 8]); assert.equal(r.completion.verification.level, "time"); });
await t("achievements: derived, deterministic, unlockedAt is the triggering completion", async () => {
  await mk("g1", "park", "solo", 20, "full", [2026, 10, 1]); await mk("g1", "home", "family", 40, "full", [2026, 10, 2], { discovery: "a b c d" }); await mk("g1", "street", "solo", 10, "full", [2026, 10, 3]);
  const comps = await all("completions"), items = await Promise.all(comps.filter(c => c.ownerId === "g1").map(async completion => ({ completion, quest: await getQuest(completion.questId) })));
  const ev = Object.fromEntries(evaluate(items).map(a => [a.id, a])); assert.ok(ev["first-steps"].unlocked); assert.equal(ev["first-steps"].unlockedAt, items.map(i => i.completion.completedAt).sort()[0]);
  assert.ok(ev["three-outings"].unlocked && ev["streak-3"].unlocked && ev["long-outing"].unlocked && ev["together"].unlocked); assert.ok(!ev["streak-7"].unlocked && !ev["four-places"].unlocked);
  assert.deepEqual(evaluate(items).map(a => a.unlockedAt), evaluate([...items].reverse()).map(a => a.unlockedAt));
  assert.deepEqual(unlockedNow(items.slice(0, 2), items).map(a => a.id).sort(), ["streak-3", "three-outings"].sort());
});
await t("challenge progression: easy until 3 finished, then medium, then hard", () => {
  const it = (d, o = "full") => ({ completion: { outcome: o }, quest: { context: { difficulty: d } } });
  assert.equal(suggestDifficulty([]), "easy"); assert.equal(suggestDifficulty([it("easy"), it("easy")]), "easy"); assert.equal(suggestDifficulty([it("easy"), it("easy"), it("easy")]), "medium");
  assert.equal(suggestDifficulty([...Array(3).fill(it("easy")), ...Array(3).fill(it("medium"))]), "hard"); assert.equal(suggestDifficulty([it("easy", "partial"), it("easy", "partial"), it("easy", "partial")]), "easy");
});
const fake = (fail = () => false) => { const log = []; return { log, async upsert(p, d, rev) { if (fail(p)) throw Object.assign(new Error("net"), { code: "unavailable" }); log.push([p, rev, d]); } }; };
await t("sync: newest revision only, safe order, outbox emptied only after success, rerun is a no-op", async () => {
  const q = await buildQuest("s1", {}); await startQuest(q.id); await finishQuest(q.id, { outcome: "full", confirmedQuick: true });
  const r = fake(); const res = await drain({ remote: r, ownerId: "s1" }); assert.equal(res.error, false); assert.equal(res.left, 0);
  assert.deepEqual(r.log.map(x => x[0].split("/")[2]), ["quests", "completions", "progress"]); assert.equal(r.log[0][1], (await getQuest(q.id)).rev); assert.equal(r.log[1][2].thumb, null);
  const r2 = fake(); assert.equal((await drain({ remote: r2, ownerId: "s1" })).sent, 0); assert.equal(r2.log.length, 0);
});
await t("sync: offline failure keeps everything and retries later without duplicates", async () => {
  const q = await buildQuest("s2", {}); await startQuest(q.id); await finishQuest(q.id, { outcome: "full", confirmedQuick: true });
  const down = fake(() => true), a = await drain({ remote: down, ownerId: "s2" }); assert.equal(a.error, true); assert.ok(a.left >= 3);
  const part = fake(p => p.includes("/progress/")), b = await drain({ remote: part, ownerId: "s2" }); assert.equal(b.error, true); assert.equal(b.left, 1);
  const ok = fake(); const c = await drain({ remote: ok, ownerId: "s2" }); assert.equal(c.left, 0); assert.equal(ok.log.length, 1);
});
await t("sync: only the signed-in owner's data is sent", async () => { await buildQuest("s3", {}); const r = fake(); await drain({ remote: r, ownerId: "s1" }); assert.ok(r.log.every(x => x[0].startsWith("users/s1/"))); assert.equal(remotePath({ ownerId: "a", entity: "completion", recordId: "a:q" }), "users/a/completions/a:q"); });
await t("claim: local profile data moves to the new account, requeued, old owner empty", async () => {
  const q = await buildQuest("local-x", {}); await startQuest(q.id); await finishQuest(q.id, { outcome: "full", confirmedQuick: true });
  await reown("local-x", "acct-1");
  assert.equal((await getLiveQuest("local-x")), null); assert.equal((await getQuest(q.id)).ownerId, "acct-1");
  assert.equal((await getProgress("acct-1")).completed, 1); assert.equal((await getProgress("local-x")).completed, 0);
  assert.ok((await all("completions")).some(c => c.id === `acct-1:${q.id}` && c.ownerId === "acct-1")); assert.ok(!(await all("completions")).some(c => c.ownerId === "local-x"));
  assert.equal((await all("outbox")).filter(o => o.ownerId === "local-x").length, 0); assert.ok((await all("outbox")).filter(o => o.ownerId === "acct-1").length >= 3);
  const again = await finishQuest(q.id, { outcome: "full" }); assert.equal((await getProgress("acct-1")).completed, 1); // no double count after the move
});
console.log(n + " passed");
