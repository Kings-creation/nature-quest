// Safety is enforced by the app, not trusted to a model. Any quest text (AI or static) must pass.
// Each rule has a reason so a rejection is explainable and testable.
const RULES = [
  ["height", /\b(climb\w*|cliffs?|ledges?|rooftops?|roofs?|scal(e|ing) |edge of)\b/i],
  ["restricted", /\b(trespass\w*|private (property|land|garden)|fenced?|restricted|no entry|keep out|break in)\b/i],
  ["water", /\b(swim\w*|wad(e|ing)|div(e|ing)|paddl\w*|jump (in|into)|enter the water|into the water|cross (a |the )?(river|stream|lake))\b/i],
  ["traffic", /\b(highways?|motorways?|traffic|railways?|rail tracks?|train tracks?|cross (a |the )?(road|street))\b/i],
  ["ingestion", /\b(eat\w*|tast(e|es|ing)|swallow\w*|chew\w*|forag\w*|mushrooms?|edible|drink from)\b/i],
  ["animals", /\b(snakes?|wasps?|hornets?|bees?|beehives?|hives?|nests?|scorpions?|spiders?|chase|feed the|pet (a|the)|catch (a|the))\b/i],
  ["hazards", /\b(fires?|campfires?|flames?|matches|lighter|knife|knives|blades?|axe|chemicals?|needles?|syringes?|broken|glass|poison\w*|thorns?|nettles?|ivy|sharp|rusty)\b/i],
  ["darkness", /\b(night|midnight|after dark|in the dark|dusk|overnight|twilight)\b/i],
  ["survival", /\b(surviv\w*|wilderness|get lost|lost in|build a shelter|alone in the (woods|forest))\b/i],
  ["strangers", /\b(strangers?|unknown (person|people)|approach someone)\b/i],
  ["running", /\b(sprint\w*|race (each other|them)|dash\b)/i]
];

export function checkText(text) {
  const reasons = [];
  for (const [name, re] of RULES) if (re.test(text)) reasons.push(name);
  return reasons;
}
// Scans every player-facing field of a draft or quest.
export function checkDraft(d) {
  const parts = [d.title, d.intro, d.reflectionPrompt, ...(d.steps || []).map(s => (typeof s === "string" ? s : s?.text))].filter(Boolean);
  const reasons = new Set();
  for (const p of parts) for (const r of checkText(String(p))) reasons.add(r);
  return { ok: reasons.size === 0, reasons: [...reasons] };
}
