// Quest Engine: builds a quest (AI draft if a generator exists, otherwise static fallback),
// enforces safety, persists locally, and queues a deterministic sync entry.
import { get, put, all, uuid, enqueue } from "../store.js";
import { normalizeContext, validateDraft, makeQuest, transition, isLive } from "./model.js";
import { checkDraft } from "./safety.js";
import { fallbackDraft, rankCandidates } from "./fallback.js";

export const MAX_AI_ATTEMPTS = 2;

// generator: async (context, {attempt, avoid}) => draft | throws. Provided by the AI layer in CP3.
export async function buildQuest(ownerId, rawContext, { generator = null, ranker = null, mood = "", signal = null, budgetMs = 100000, rankMs = 7000 } = {}) {
  const t0 = Date.now();
  const context = normalizeContext(rawContext);
  const recent = (await all("quests")).filter(q => q.ownerId === ownerId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map(q => q.templateId).filter(Boolean);
  let draft = null, source = "fallback", model = null, rejected = [], aiError = null;
  if (generator) {
    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS && !draft; attempt++) {
      if (signal?.aborted) { aiError = "skipped"; break; }
      if (attempt > 1 && Date.now() - t0 > budgetMs * 0.6) { aiError = aiError || "slow"; break; } // never stack a second slow attempt
      try {
        const d = await generator(context, { attempt, avoid: rejected, signal });
        const bad = validateDraft(d);
        const safety = bad.length ? null : checkDraft(d);
        if (!bad.length && safety.ok) { draft = d; source = "ai"; model = d.model || null; }
        else rejected.push(...(bad.length ? bad : safety.reasons));
      } catch (e) { rejected.push("generator-error"); aiError = signal?.aborted ? "skipped" : (e?.code || "failed"); break; }
    }
  }
  let matchError = null;
  if (!draft) {
    const cands = rankCandidates(context, { exclude: recent, seed: uuid(), k: 14 });
    let chosen = cands[0];
    if (ranker && !signal?.aborted) {
      try {
        const r = await Promise.race([ranker(cands, context, mood), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), rankMs))]);
        const pick = r?.order?.find(f => cands.some(c => c.id === f.id)); // only quests that already passed the rules
        if (pick) { chosen = cands.find(c => c.id === pick.id); source = "matched"; model = r.model || null; }
      } catch (e) { matchError = e?.code || "failed"; }
    }
    draft = fallbackDraft(context, "", [], chosen);
  }
  const quest = makeQuest({ id: uuid(), ownerId, source, model, draft, context });
  if (draft.templateId) quest.templateId = draft.templateId;
  quest.aiRejections = rejected; quest.aiError = source === "ai" ? null : aiError; quest.matchError = source === "matched" ? null : matchError;
  await put("quests", quest);
  await enqueue(ownerId, "quest", quest.id, quest.rev, "upsert", quest);
  return quest;
}

export async function getLiveQuest(ownerId) {
  const qs = (await all("quests")).filter(q => q.ownerId === ownerId && isLive(q)).sort((a, b) => b.updatedAt - a.updatedAt);
  return qs[0] || null;
}
export const getQuest = id => get("quests", id);

// Single choke point for lifecycle changes: re-reads the stored record so a stale UI can't clobber newer state.
export async function moveQuest(id, to) {
  const current = await get("quests", id);
  if (!current) throw new Error("Quest not found");
  const next = transition(current, to);
  if (next === current) return current;
  await put("quests", next);
  await enqueue(next.ownerId, "quest", next.id, next.rev, "upsert", next);
  return next;
}
