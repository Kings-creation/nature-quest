// Verification: what we can honestly know. We check time spent outdoors against the quest length and
// whether a photo was attached and looks like a real photo. We never claim the AI "saw" the quest done.
export const MIN_FRACTION = 0.25, MIN_MINUTES = 2;
export const LEVELS = { self: "Self-reported", time: "Time on quest checked", evidence: "Photo attached" };
const words = s => String(s || "").trim().split(/\s+/).filter(Boolean).length;

export function assessCompletion({ startedAt, endedAt, durationMin, photoOk = false, discovery = "", confirmedQuick = false }) {
  const elapsedMin = Math.max(0, Math.round((endedAt - startedAt) / 60000));
  const need = Math.max(MIN_MINUTES, Math.round(durationMin * MIN_FRACTION));
  const tooQuick = elapsedMin < need;
  const signals = [];
  if (!tooQuick) signals.push("time");
  if (photoOk) signals.push("photo");
  if (words(discovery) >= 3) signals.push("reflection");
  const level = signals.includes("photo") ? "evidence" : signals.includes("time") ? "time" : "self";
  return { level, elapsedMin, need, tooQuick, needsConfirm: tooQuick && !confirmedQuick, signals, flags: tooQuick ? ["quick"] : [] };
}

// Pure pixel check so it is testable without a browser. Rejects blank, black, white or lens-covered shots.
export function scorePixels(rgba) {
  let n = 0, sum = 0, sq = 0;
  for (let i = 0; i < rgba.length; i += 64) { const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]; sum += l; sq += l * l; n++; }
  if (!n) return { ok: false, reason: "unreadable" };
  const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  if (mean < 15) return { ok: false, reason: "dark" };
  if (mean > 242) return { ok: false, reason: "bright" };
  if (std < 10) return { ok: false, reason: "blank" };
  return { ok: true, reason: "" };
}
export const PHOTO_MESSAGES = { dark: "That photo is almost black. Try again with more light, or skip it.", bright: "That photo is almost white. Try again, or skip it.", blank: "That photo looks blank. Point the camera at what you found, or skip it.", unreadable: "Couldn't read that photo. Try another, or skip it." };

// Browser only: downsizes to a small JPEG kept on the device (never uploaded) and runs the pixel check.
export async function analyzeImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 320 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, c.width, c.height);
    const r = scorePixels(g.getImageData(0, 0, c.width, c.height).data);
    return { ok: r.ok, reason: r.reason, thumb: r.ok ? c.toDataURL("image/jpeg", 0.6) : null };
  } catch { return { ok: false, reason: "unreadable", thumb: null }; }
}
