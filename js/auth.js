// Auth wrapper. The app never waits on Firebase: the session lives in local storage and the
// Firebase SDK loads lazily and only when online. Offline launch = restored local session.
import { firebaseConfig, firebaseConfigured, FIREBASE_SDK_VERSION } from "./config.js";
import { getMeta, setMeta, delMeta, uuid } from "./store.js";
import { reown } from "./claim.js";

let sdk = null, sdkPromise = null, listeners = new Set(), current = null;
export const authAvailable = () => firebaseConfigured();
export const getSession = () => current;
export const ensureSdk = loadSdk;
export const firebaseApp = async () => (await loadSdk()).auth.app;
export const onSession = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(current); } catch (e) { console.error(e); } });

async function setSession(s) { const prev = current; if (prev?.kind === "local" && s?.kind === "account") await reown(prev.uid, s.uid); current = s; if (s) await setMeta("session", s); else await delMeta("session"); emit(); }

async function loadSdk() {
  if (sdk) return sdk;
  if (!firebaseConfigured()) throw Object.assign(new Error("not-configured"), { code: "nq/not-configured" });
  if (!navigator.onLine) throw Object.assign(new Error("offline"), { code: "nq/offline" });
  sdkPromise ||= (async () => {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
    const [appM, authM] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-auth.js")]);
    const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(firebaseConfig);
    const auth = authM.getAuth(app);
    sdk = { auth, m: authM };
    return sdk;
  })().catch(e => { sdkPromise = null; throw e; });
  return sdkPromise;
}

const fromUser = u => ({ kind: "account", uid: u.uid, name: u.displayName || (u.email ? u.email.split("@")[0] : "Explorer"), email: u.email || null, provider: u.providerData?.[0]?.providerId || "password", since: Date.now() });

// Restore instantly from disk, then (quietly) reconcile with Firebase when it is reachable.
export async function init() {
  current = await getMeta("session");
  emit();
  if (firebaseConfigured() && navigator.onLine) {
    loadSdk().then(({ auth, m }) => {
      m.onAuthStateChanged(auth, async u => {
        if (u) { const s = fromUser(u); if (!current || current.uid !== s.uid || current.kind !== "account") await setSession({ ...s, since: current?.since || s.since }); }
        // A null user never signs the person out locally: offline-first means local state survives.
      });
    }).catch(() => {});
  }
  return current;
}

export async function continueLocal() {
  const s = { kind: "local", uid: "local-" + uuid(), name: "Explorer", email: null, provider: "local", since: Date.now() };
  await setSession(s); return s;
}

async function run(fn) {
  const { auth, m } = await loadSdk();
  const cred = await fn(auth, m);
  const s = fromUser(cred.user); await setSession(s); return s;
}
export const signInEmail = (email, pw) => run((a, m) => m.signInWithEmailAndPassword(a, email, pw));
export const signUpEmail = (email, pw) => run((a, m) => m.createUserWithEmailAndPassword(a, email, pw));
export const signInGoogle = () => run((a, m) => m.signInWithPopup(a, new m.GoogleAuthProvider()));
export const signInApple = () => run((a, m) => { const p = new m.OAuthProvider("apple.com"); p.addScope("email"); p.addScope("name"); return m.signInWithPopup(a, p); });

export async function signOut() {
  try { if (sdk) await sdk.m.signOut(sdk.auth); } catch (e) { console.warn(e); }
  await setSession(null);
}

export function friendlyAuthError(e) {
  const c = e?.code || "";
  const map = {
    "nq/not-configured": "Sign-in isn't switched on in this build yet. You can continue without an account.",
    "nq/offline": "You're offline. Sign-in needs a connection, but you can continue without an account.",
    "auth/invalid-credential": "That email and password don't match.",
    "auth/wrong-password": "That email and password don't match.",
    "auth/user-not-found": "No account with that email. Try creating one.",
    "auth/email-already-in-use": "That email already has an account. Try signing in.",
    "auth/weak-password": "Use at least 6 characters for the password.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/popup-closed-by-user": "Sign-in was closed before it finished.",
    "auth/cancelled-popup-request": "Sign-in was closed before it finished.",
    "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups and try again.",
    "auth/network-request-failed": "Couldn't reach the network. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/operation-not-allowed": "This sign-in method isn't enabled for the project yet."
  };
  return map[c] || "Sign-in didn't work. Try again, or continue without an account.";
}
