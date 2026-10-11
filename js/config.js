// Firebase web client config. These values are public by design (security comes from
// Auth + Firestore rules, not from hiding them). No private keys belong in this repo.
export const firebaseConfig = {
  apiKey: "AIzaSyAQHRMn_xdzeAicO9GIMc94oa32Zc3PsTo",
  authDomain: "nature-quest-c14be.firebaseapp.com",
  projectId: "nature-quest-c14be",
  storageBucket: "nature-quest-c14be.firebasestorage.app",
  messagingSenderId: "368596744607",
  appId: "1:368596744607:web:2304ac9f1396c1d8b965aa"
};
export const FIREBASE_SDK_VERSION = "13.0.0";
export const firebaseConfigured = () => !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REPLACE_");
