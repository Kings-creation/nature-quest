// When someone who used Nature Quest without an account signs in, their local quests, completions and
// progress move to the new account. Everything is re-queued for backup under the new owner.
import { all, put, del, get, enqueue, getMeta, setMeta } from "./store.js";

export async function reown(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  for (const q of (await all("quests")).filter(x => x.ownerId === oldId)) { const n = { ...q, ownerId: newId, rev: q.rev + 1, updatedAt: Date.now() }; await put("quests", n); await enqueue(newId, "quest", n.id, n.rev, "upsert", n); }
  for (const c of (await all("completions")).filter(x => x.ownerId === oldId)) {
    const n = { ...c, id: `${newId}:${c.questId}`, ownerId: newId }; await put("completions", n); await del("completions", c.id); await enqueue(newId, "completion", n.id, n.rev, "create", n);
  }
  const op = await get("progress", `${oldId}:progress`);
  if (op) {
    const ex = await get("progress", `${newId}:progress`);
    const n = ex ? { ...ex, completed: ex.completed + op.completed, partial: (ex.partial || 0) + (op.partial || 0), streak: Math.max(ex.streak, op.streak), lastCompletedDay: [ex.lastCompletedDay, op.lastCompletedDay].filter(Boolean).sort().pop() || null, lastCompletionId: op.lastCompletionId, rev: ex.rev + 1, updatedAt: Date.now() }
      : { ...op, id: `${newId}:progress`, ownerId: newId, rev: op.rev + 1, lastCompletionId: op.lastCompletionId ? op.lastCompletionId.replace(oldId, newId) : null, updatedAt: Date.now() };
    await put("progress", n); await del("progress", op.id); await enqueue(newId, "progress", n.id, n.rev, "upsert", n);
  }
  for (const o of (await all("outbox")).filter(x => x.ownerId === oldId)) await del("outbox", o.id);
  const ld = await getMeta("lastDone"); if (ld && ld.startsWith(oldId + ":")) await setMeta("lastDone", ld.replace(oldId, newId));
}
