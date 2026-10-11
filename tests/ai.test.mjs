import assert from "node:assert/strict";
import http from "node:http";
import { buildQuestMessages, parseDraft } from "../js/ai/prompt.js";
import * as ai from "../js/ai/engine.js";
import { createEndpointProvider } from "../js/ai/providers/endpoint.js";
import { buildQuest } from "../js/quest/engine.js";
import { normalizeContext } from "../js/quest/model.js";
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("PASS", name); }, e => { console.log("FAIL", name, "\n ", e.message); process.exitCode = 1; });
const GOOD = "TITLE: Moss and stone\nINTRO: Slow looking beats fast scrolling.\nSTEP: Find a mossy stone.\nSTEP: Describe it in three words.\nSTEP: Put it back exactly as it was.\nREFLECTION: Which word fits best?";
const mock = (reply, calls = []) => ({ id: "mock", label: "mock-model", isLoaded: () => true, load: async () => {}, complete: async (m) => { calls.push(m); return typeof reply === "function" ? reply(calls.length) : reply; } });

await t("prompt carries the person's context and safety rules", () => {
  const m = buildQuestMessages(normalizeContext({ company: "family", minutes: 40, environment: "trail", energy: "high" }), { avoid: ["height"] });
  const u = m[1].content; assert.match(u, /family/); assert.match(u, /40 minutes/); assert.match(u, /trail/); assert.match(u, /height/); assert.match(m[0].content, /No climbing/);
});
await t("parser: tagged lines, bullets, bold, numbering", () => {
  const d = parseDraft("**TITLE:** Sky watch\n- INTRO: Look up.\n1. STEP: Sit down.\nSTEP 2: Watch for five minutes.\nREFLECTION: What moved?");
  assert.equal(d.title, "Sky watch"); assert.deepEqual(d.steps, ["Sit down.", "Watch for five minutes."]); assert.equal(d.reflectionPrompt, "What moved?");
});
await t("parser: JSON inside prose and code fences", () => {
  const d = parseDraft('Sure!\n```json\n{"title":"A","intro":"B","steps":["one","two"],"reflectionPrompt":"C"}\n```'); assert.equal(d.title, "A"); assert.equal(d.steps.length, 2);
});
await t("parser: garbage returns null", () => { assert.equal(parseDraft("I cannot help with that."), null); assert.equal(parseDraft(null), null); });
await t("AI off: generateQuest refuses; quest engine uses library", async () => {
  await ai.init(); await assert.rejects(() => ai.generateQuest(normalizeContext({})));
  assert.equal((await buildQuest("a1", {}, { generator: ai.isEnabled() ? ai.generateQuest : null })).source, "fallback");
});
await t("AI on (mock runtime): quest is AI-written, tagged with the model", async () => {
  ai.__setProviderForTests(mock(GOOD)); await ai.configure({ enabled: true });
  const q = await buildQuest("a2", { environment: "trail" }, { generator: ai.generateQuest });
  assert.equal(q.source, "ai"); assert.equal(q.model, "mock-model"); assert.equal(q.title, "Moss and stone"); assert.equal(q.steps.length, 3);
});
await t("unsafe model output is rejected, retried with the reasons, then library fallback", async () => {
  const calls = []; ai.__setProviderForTests(mock("TITLE: Big climb\nINTRO: Go high.\nSTEP: Climb the tallest tree.\nSTEP: Wave.\nREFLECTION: How high?", calls));
  const q = await buildQuest("a3", {}, { generator: ai.generateQuest }); assert.equal(q.source, "fallback"); assert.equal(calls.length, 2);
  assert.match(calls[1][1].content, /height/);
});
await t("model that gets safe on the retry is accepted", async () => {
  ai.__setProviderForTests(mock(c => c === 1 ? "no idea" : GOOD));
  assert.equal((await buildQuest("a4", {}, { generator: ai.generateQuest })).source, "ai");
});
await t("runtime error never crashes quest creation", async () => {
  ai.__setProviderForTests({ ...mock(""), complete: async () => { throw new Error("out of memory"); } });
  assert.equal((await buildQuest("a5", {}, { generator: ai.generateQuest })).source, "fallback");
});
await t("clue/reflection: safe text used, unsafe or failing output replaced by static text", async () => {
  const q = await buildQuest("a6", {}); 
  ai.__setProviderForTests(mock("Look closely at the bark.")); assert.equal(await ai.generateClue(q), "Look closely at the bark.");
  ai.__setProviderForTests(mock("Try tasting the berries.")); assert.equal(await ai.generateReflection(q, "fun"), q.reflectionPrompt);
  ai.__setProviderForTests({ ...mock(""), complete: async () => { throw new Error("x"); } }); assert.equal(await ai.generateClue(q), q.steps[0].text);
});
await t("adaptQuest asks for the easier variant", async () => {
  const calls = []; ai.__setProviderForTests(mock(GOOD, calls)); const q = await buildQuest("a7", { difficulty: "hard", energy: "high" });
  await ai.adaptQuest(q, "easier"); assert.match(calls.at(-1)[1].content, /easy/); assert.match(calls.at(-1)[1].content, /low energy/);
});
await t("endpoint provider speaks OpenAI-compatible HTTP (real local server test)", async () => {
  let seen; const srv = http.createServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end('{"data":[{"id":"gpt-oss:20b"}]}'); seen = JSON.parse(b); res.end(JSON.stringify({ choices: [{ message: { content: GOOD } }] })); }); });
  await new Promise(r => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/v1`;
  try {
    const p = createEndpointProvider({ baseUrl: base, model: "gpt-oss:20b" }); await p.load();
    ai.__setProviderForTests(p); await ai.configure({ enabled: true });
    const q = await buildQuest("a8", { company: "friends" }, { generator: ai.generateQuest });
    assert.equal(q.source, "ai"); assert.equal(q.model, "gpt-oss:20b"); assert.equal(seen.model, "gpt-oss:20b"); assert.equal(seen.stream, false);
    await assert.rejects(() => createEndpointProvider({ baseUrl: "http://127.0.0.1:1/v1" }).load());
  } finally { srv.close(); }
});
await t("capability gate", async () => { globalThis.Worker ||= class {}; const { capability } = await import("../js/ai/providers/browser.js"); assert.equal(capability().level, "ok"); });
console.log(n + " passed");
