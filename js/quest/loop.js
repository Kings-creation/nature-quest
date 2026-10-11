// The outdoor loop: start -> (phone away) -> return -> finish. Finishing is the only place that
// records a completion and moves progress, and it is idempotent: repeat taps, reloads and a crash
// midway can never double-count or lose a completion.
import { get, put, enqueue, getProgress } from "../store.js";
import { moveQuest } from "./engine.js";
import { assessCompletion } from "./verify.js";

export const OUTCOMES = ["full", "partial", "skipped"];
export const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const prevDay = key => { const [y, m, d] = key.split("-").map(Number); return dayKey(new Date(y, m - 1, d - 1)); };

// Pure. A streak counts days outside (full or partial), once per local day.
export function applyCompletion(p, outcome, cid, ts) {
  const day = dayKey(ts);
  const n = { ...p, rev: p.rev + 1, updatedAt: ts, lastCompletionId: cid, partial: p.partial || 0 };
  if (outcome === "full") n.completed = (p.completed || 0) + 1; else n.partial += 1;
  if (p.lastCompletedDay !== day) { n.streak = p.lastCompletedDay && prevDay(day) === p.lastCompletedDay ? (p.streak || 0) + 1 : 1; n.lastCompletedDay = day; }
  return n;
}
// A streak that wasn't continued yesterday or today reads as 0.
export function currentStreak(p, now = Date.now()) {
  if (!p.lastCompletedDay) return 0;
  const today = dayKey(now); return p.lastCompletedDay === today || p.lastCompletedDay === prevDay(today) ? (p.streak || 0) : 0;
}

const locks = new Map();
const once = (key, fn) => { if (locks.has(key)) return locks.get(key); const p = Promise.resolve().then(fn).finally(() => locks.delete(key)); locks.set(key, p); return p; };
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export const startQuest = id => moveQuest(id, "active");
export async function returnQuest(id) {
  const q = await get("quests", id);
  if (!q || (q.state !== "active" && q.state !== "returned")) throw new Error("Quest hasn't been started");
  return moveQuest(id, "returned");
}
export const resumeQuest = id => moveQuest(id, "active"); // "not done yet, back outside"

export function finishQuest(questId, { outcome, discovery = "", followUp = null, photo = null, confirmedQuick = false, now = Date.now() } = {}) {
  return once("finish:" + questId, async () => {
    if (!OUTCOMES.includes(outcome)) throw new Error("Unknown outcome");
    const q = await get("quests", questId);
    if (!q) throw new Error("Quest not found");
    const owner = q.ownerId, cid = `${owner}:${questId}`;
    if (outcome === "skipped") { if (q.state !== "completed") await moveQuest(questId, "abandoned"); return { completion: null, progress: await getProgress(owner) }; }
    let completion = await get("completions", cid), recovered = false;
    if (!completion) {
      if (q.state !== "active" && q.state !== "returned") throw new Error("Quest can't be finished from " + q.state);
      const a = assessCompletion({ startedAt: q.startedAt || now, endedAt: now, durationMin: q.durationMin, photoOk: !!photo?.ok, discovery, confirmedQuick });
      if (outcome === "full" && a.needsConfirm) throw Object.assign(new Error("That was quick. Confirm you finished it, or choose \"Some of it\"."), { code: "quick-unconfirmed" });
      completion = { id: cid, ownerId: owner, questId, outcome, discovery: clip(discovery, 300), followUp: followUp ? clip(followUp, 240) : null, verification: { level: a.level, elapsedMin: a.elapsedMin, signals: a.signals, flags: a.flags }, thumb: photo?.ok ? photo.thumb : null, completedAt: now, createdAt: now, updatedAt: now, rev: 1 };
      await put("completions", completion); await enqueue(owner, "completion", cid, 1, "create", { ...completion, thumb: null }); // photos stay on the device
    } else recovered = true; // finishing again after a crash or double tap: finish the unfinished parts only
    let progress = await getProgress(owner);
    if (progress.lastCompletionId !== cid) { progress = applyCompletion(progress, completion.outcome, cid, completion.completedAt); await put("progress", progress); await enqueue(owner, "progress", progress.id, progress.rev, "upsert", progress); }
    let cur = await get("quests", questId);
    if (cur.state === "active") cur = await moveQuest(questId, "returned");
    if (cur.state === "returned") await moveQuest(questId, "completed");
    return { completion, progress, duplicate: recovered };
  });
}
