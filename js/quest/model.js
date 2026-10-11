// Quest data model + state machine. Pure functions: no storage, no DOM.
export const STATES = ["ready", "active", "returned", "completed", "abandoned"];
// ready -> active -> returned -> completed ; ready/active -> abandoned. Terminal: completed, abandoned.
export const TRANSITIONS = { ready: ["active", "abandoned"], active: ["returned", "abandoned"], returned: ["completed", "active", "abandoned"], completed: [], abandoned: [] };

export const OPTIONS = {
  company: ["solo", "family", "friends"],
  minutes: [10, 20, 40, 60],
  environment: ["any", "home", "street", "park", "trail"],
  energy: ["low", "medium", "high"],
  activity: ["observe", "listen", "move", "create"],
  difficulty: ["easy", "medium", "hard"]
};
export const DEFAULT_CONTEXT = { company: "solo", minutes: 20, environment: "any", energy: "medium", activity: "observe", difficulty: "easy" };

// Anything outside the allowed lists falls back to the default: user input never reaches a prompt unchecked.
export function normalizeContext(input = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_CONTEXT)) {
    const v = input[k];
    out[k] = OPTIONS[k].includes(k === "minutes" ? Number(v) : v) ? (k === "minutes" ? Number(v) : v) : DEFAULT_CONTEXT[k];
  }
  return out;
}

export const SAFETY_NOTE = "Stay on public paths, keep your distance from animals, and stop if anything feels unsafe.";

export function validateDraft(d) {
  const errs = [];
  const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (!d || typeof d !== "object") return ["draft is not an object"];
  if (!str(d.title, 80)) errs.push("title");
  if (!str(d.intro, 300)) errs.push("intro");
  if (!Array.isArray(d.steps) || d.steps.length < 2 || d.steps.length > 6 || !d.steps.every(s => str(s, 220))) errs.push("steps");
  if (!str(d.reflectionPrompt, 200)) errs.push("reflectionPrompt");
  return errs;
}

export function makeQuest({ id, ownerId, source, model = null, draft, context }) {
  const now = Date.now();
  return {
    id, ownerId, source, model,
    title: draft.title.trim(), intro: draft.intro.trim(),
    steps: draft.steps.map((t, i) => ({ id: `s${i + 1}`, text: t.trim() })),
    reflectionPrompt: draft.reflectionPrompt.trim(),
    safetyNote: SAFETY_NOTE,
    context, durationMin: context.minutes,
    state: "ready", rev: 1, createdAt: now, updatedAt: now,
    startedAt: null, returnedAt: null, completedAt: null
  };
}

export function transition(quest, to) {
  if (quest.state === to) return quest; // idempotent: repeat taps never bump the revision
  if (!TRANSITIONS[quest.state]?.includes(to)) throw new Error(`Illegal quest transition ${quest.state} -> ${to}`);
  const now = Date.now();
  const next = { ...quest, state: to, rev: quest.rev + 1, updatedAt: now };
  if (to === "active" && !quest.startedAt) next.startedAt = now;
  if (to === "returned") next.returnedAt = now;
  if (to === "completed") next.completedAt = now;
  return next;
}
export const isLive = q => q.state === "ready" || q.state === "active" || q.state === "returned";
