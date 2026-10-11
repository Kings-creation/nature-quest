// Outbox drain. Sends only the newest revision of each record, in a safe order, and removes an entry
// only after the remote confirmed it. Nothing is deleted on failure, so no silent data loss.
import { all, del, put } from "./store.js";
import { FIREBASE_SDK_VERSION } from "./config.js";

const ORDER = { quest: 0, completion: 1, progress: 2 }, COL = { quest: "quests", completion: "completions", progress: "progress" };
export const remotePath = o => `users/${o.ownerId}/${COL[o.entity]}/${o.recordId}`;
export const pendingCount = async ownerId => (await all("outbox")).filter(o => o.ownerId === ownerId).length;

export async function drain({ remote, ownerId }) {
  const mine = (await all("outbox")).filter(o => o.ownerId === ownerId);
  const latest = new Map();
  for (const o of mine) { const k = o.entity + "|" + o.recordId, cur = latest.get(k); if (!cur || o.rev > cur.rev) latest.set(k, o); }
  const queue = [...latest.values()].sort((a, b) => (ORDER[a.entity] - ORDER[b.entity]) || (a.createdAt - b.createdAt));
  let sent = 0;
  for (const o of queue) {
    try { await remote.upsert(remotePath(o), { ...o.payload, thumb: null }, o.rev); }
    catch (e) { await put("outbox", { ...o, attempts: (o.attempts || 0) + 1, lastError: String(e?.code || e?.message || e) }); return { sent, left: (await pendingCount(ownerId)), error: true }; }
    for (const old of mine) if (old.entity === o.entity && old.recordId === o.recordId && old.rev <= o.rev) await del("outbox", old.id);
    sent++;
  }
  return { sent, left: await pendingCount(ownerId), error: false };
}

// Real Firestore adapter. Newest revision wins; an older write never overwrites a newer one.
export async function createFirestoreRemote(getApp) {
  const fs = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`);
  const db = fs.getFirestore(await getApp());
  return { async upsert(path, data, rev) {
    const ref = fs.doc(db, path);
    await fs.runTransaction(db, async tx => { const snap = await tx.get(ref); if (snap.exists() && (snap.data().rev || 0) >= rev) return; tx.set(ref, data); });
  } };
}
