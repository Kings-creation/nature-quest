// Prompt building + tolerant parsing. Tiny models rarely emit perfect JSON, so the primary
// format is tagged lines (TITLE:/INTRO:/STEP:/REFLECTION:); JSON is accepted too.
import { FALLBACKS } from "../quest/fallback.js";

const WORDS = {
  company: { solo: "one person on their own", family: "a family together", friends: "a group of friends" },
  environment: { any: "anywhere outdoors close to where they are: outside their door or a nearby public place", home: "at home: a doorstep, balcony or garden", street: "in a neighbourhood, on pavements and paths", park: "in a public park", trail: "on a public trail or countryside path" },
  energy: { low: "low energy, gentle pace", medium: "medium energy", high: "high energy, happy to walk" },
  activity: { observe: "looking closely", listen: "listening", move: "moving and walking", create: "making something small from found natural things" },
  difficulty: { easy: "easy", medium: "a little challenging", hard: "challenging but safe" }
};

const EXAMPLE = `TITLE: Five greens
INTRO: Green is not one colour.
STEP: Find five shades of green.
STEP: Rank them, light to dark.
STEP: Leave everything in place.
REFLECTION: Which green is your favourite?`;

const SYSTEM = `You write short outdoor missions. Reply ONLY in this format, each line under 10 words. Real-world actions only. No climbing, water, roads, eating plants, animals, fire, darkness or strangers.

${EXAMPLE}`;

export function buildQuestMessages(ctx, { avoid = [], attempt = 1 } = {}) {
  const lines = [
    `Write a mission for ${WORDS.company[ctx.company]}.`,
    `Time available: ${ctx.minutes} minutes.`,
    `Place: ${WORDS.environment[ctx.environment]}.`,
    `Energy: ${WORDS.energy[ctx.energy]}.`,
    `They feel like: ${WORDS.activity[ctx.activity]}.`,
    `Difficulty: ${WORDS.difficulty[ctx.difficulty]}.`,
    `Season/date: ${new Date().toLocaleDateString("en", { month: "long" })}.`
  ];
  if (ctx.company !== "solo") lines.push("Make the last step: compare what each person found.");
  if (avoid.length) lines.push(`Your last attempt broke these rules: ${[...new Set(avoid)].join(", ")}. Write a different, safer mission.`);
  if (attempt > 1) lines.push("Keep it simpler and gentler than before.");
  return [{ role: "system", content: SYSTEM }, { role: "user", content: lines.join("\n") }];
}

const clean = s => s.replace(/^[\s\-*•\d.)]+/, "").replace(/\*\*/g, "").replace(/^["“]|["”]$/g, "").trim();

export function parseDraft(text) {
  if (typeof text !== "string") return null;
  const j = text.match(/\{[\s\S]*\}/);
  if (j) {
    try {
      const o = JSON.parse(j[0]);
      const steps = o.steps || o.Steps;
      if (o && (o.title || o.Title) && Array.isArray(steps)) return { title: clean(String(o.title || o.Title)), intro: clean(String(o.intro || o.Intro || "")), steps: steps.map(s => clean(String(s))), reflectionPrompt: clean(String(o.reflectionPrompt || o.reflection || o.Reflection || "")) };
    } catch { /* fall through to tagged lines */ }
  }
  const d = { title: "", intro: "", steps: [], reflectionPrompt: "" };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.replace(/\*\*/g, "").match(/^\s*(?:[-*•]\s*|\d+[.)]\s*)?(TITLE|INTRO|STEP(?:\s*\d+)?|REFLECTION)\s*[:：]\s*(.+)$/i);
    if (!m) continue;
    const k = m[1].toUpperCase(), v = clean(m[2]);
    if (!v) continue;
    if (k === "TITLE" && !d.title) d.title = v; else if (k === "INTRO" && !d.intro) d.intro = v;
    else if (k.startsWith("STEP")) d.steps.push(v); else if (k === "REFLECTION" && !d.reflectionPrompt) d.reflectionPrompt = v;
  }
  return d.title || d.steps.length ? d : null;
}
