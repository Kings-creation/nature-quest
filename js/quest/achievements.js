// Achievements are DERIVED from completions, never stored, so they can't be duplicated, lost or farmed.
// unlockedAt = the completion that first satisfied the rule.
import { dayKey } from "./loop.js";

const ctxOf = items => {
  const full = items.filter(i => i.completion.outcome === "full");
  const days = [...new Set(items.map(i => dayKey(i.completion.completedAt)))].sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) { const [y, m, dd] = d.split("-").map(Number); const p = prev && dayKey(new Date(y, m - 1, dd - 1)) === prev; run = p ? run + 1 : 1; prev = d; best = Math.max(best, run); }
  const envs = new Set(full.map(i => i.quest?.context?.environment).filter(Boolean));
  return { full: full.length, maxStreak: best, envs: envs.size, longFull: full.some(i => (i.quest?.durationMin || 0) >= 40), withCompany: full.some(i => i.quest?.context?.company && i.quest.context.company !== "solo"), reflections: items.filter(i => (i.completion.discovery || "").trim().split(/\s+/).filter(Boolean).length >= 3).length, photos: items.filter(i => i.completion.verification?.signals?.includes("photo")).length };
};

export const ACHIEVEMENTS = [
  { id: "first-steps", title: "First steps", text: "Finished your first quest", test: c => c.full >= 1 },
  { id: "three-outings", title: "Getting the habit", text: "Finished 3 quests", test: c => c.full >= 3 },
  { id: "seven-outings", title: "Regular", text: "Finished 7 quests", test: c => c.full >= 7 },
  { id: "streak-3", title: "Three days running", text: "Went outside 3 days in a row", test: c => c.maxStreak >= 3 },
  { id: "streak-7", title: "A whole week", text: "Went outside 7 days in a row", test: c => c.maxStreak >= 7 },
  { id: "four-places", title: "All kinds of places", text: "Finished quests in 4 different places", test: c => c.envs >= 4 },
  { id: "long-outing", title: "The long way", text: "Finished a 40+ minute quest", test: c => c.longFull },
  { id: "together", title: "Better together", text: "Finished a quest with family or friends", test: c => c.withCompany },
  { id: "storyteller", title: "Storyteller", text: "Wrote 5 reflections", test: c => c.reflections >= 5 },
  { id: "evidence", title: "Show and tell", text: "Attached 3 photos", test: c => c.photos >= 3 }
];

// items: [{completion, quest}] in any order.
export function evaluate(items) {
  const sorted = [...items].sort((a, b) => a.completion.completedAt - b.completion.completedAt);
  return ACHIEVEMENTS.map(a => {
    let at = null;
    for (let i = 1; i <= sorted.length && at === null; i++) if (a.test(ctxOf(sorted.slice(0, i)))) at = sorted[i - 1].completion.completedAt;
    return { ...a, test: undefined, unlocked: at !== null, unlockedAt: at };
  });
}
export const unlockedNow = (itemsBefore, itemsAfter) => { const b = new Set(evaluate(itemsBefore).filter(a => a.unlocked).map(a => a.id)); return evaluate(itemsAfter).filter(a => a.unlocked && !b.has(a.id)); };

// Challenge progression: after 3 finished quests at a level, offer the next one.
export function suggestDifficulty(items) {
  const order = ["easy", "medium", "hard"], count = { easy: 0, medium: 0, hard: 0 };
  for (const i of items) if (i.completion.outcome === "full" && i.quest?.context?.difficulty) count[i.quest.context.difficulty]++;
  let level = 0; while (level < 2 && count[order[level]] >= 3) level++;
  return order[level];
}

export async function loadItems(ownerId, { all, get }) {
  const comps = (await all("completions")).filter(c => c.ownerId === ownerId);
  return Promise.all(comps.map(async completion => ({ completion, quest: await get("quests", completion.questId) })));
}
