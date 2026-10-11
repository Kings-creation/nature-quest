// One place for failures: log, tell the user plainly, never crash the shell.
let notify = () => {};
export const setNotifier = fn => { notify = fn; };
const ring = [];
export function report(err, userMessage) {
  const entry = { at: new Date().toISOString(), message: String(err?.message || err) };
  ring.push(entry); if (ring.length > 30) ring.shift();
  console.error("[nature-quest]", err);
  if (userMessage) notify(userMessage, "error");
}
export const recentErrors = () => ring.slice();
export function installGlobalHandlers() {
  addEventListener("error", e => { if (e.message && !/ResizeObserver/.test(e.message)) report(e.error || e.message); });
  addEventListener("unhandledrejection", e => report(e.reason));
}
