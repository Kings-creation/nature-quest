// Local-first storage: IndexedDB with an in-memory fallback (private mode / blocked storage).
// Every record carries ownerId, createdAt, updatedAt. Writes that must reach the cloud also
// enqueue a deterministic outbox entry (see enqueue) so sync can be replayed without duplicates.
const DB_NAME = "nature-quest";
const DB_VERSION = 1;
export const STORES = ["meta", "quests", "sessions", "completions", "progress", "outbox"];

let dbPromise = null;
const mem = Object.fromEntries(STORES.map(s => [s, new Map()]));
export const storage = { persistent: false };

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === "meta" ? "key" : "id" });
    };
    req.onsuccess = () => { storage.persistent = true; resolve(req.result); };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
  });
}

export async function get(store, key) {
  const db = await open();
  if (!db) return mem[store].get(key) ?? null;
  return (await tx(db, store, "readonly", s => s.get(key))) ?? null;
}
export async function put(store, value) {
  const db = await open();
  if (!db) { mem[store].set(value[store === "meta" ? "key" : "id"], value); return value; }
  await tx(db, store, "readwrite", s => s.put(value));
  return value;
}
export async function del(store, key) {
  const db = await open();
  if (!db) { mem[store].delete(key); return; }
  await tx(db, store, "readwrite", s => s.delete(key));
}
export async function all(store) {
  const db = await open();
  if (!db) return [...mem[store].values()];
  return (await tx(db, store, "readonly", s => s.getAll())) || [];
}

// meta key/value helpers
export const getMeta = async key => (await get("meta", key))?.value ?? null;
export const setMeta = (key, value) => put("meta", { key, value, updatedAt: Date.now() });
export const delMeta = key => del("meta", key);

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// Stable outbox id: same logical change always produces the same id, so a retry or double tap
// overwrites instead of duplicating. `rev` is the record's own revision counter.
export function outboxId(ownerId, entity, recordId, rev) { return `${ownerId}|${entity}|${recordId}|${rev}`; }
export async function enqueue(ownerId, entity, recordId, rev, op, payload) {
  return put("outbox", { id: outboxId(ownerId, entity, recordId, rev), ownerId, entity, recordId, rev, op, payload, createdAt: Date.now(), attempts: 0 });
}

// Progress is per owner, created on demand.
export async function getProgress(ownerId) {
  const id = `${ownerId}:progress`;
  return (await get("progress", id)) || { id, ownerId, completed: 0, streak: 0, lastCompletedDay: null, rev: 0, createdAt: Date.now(), updatedAt: Date.now() };
}

export async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
