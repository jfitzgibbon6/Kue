import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBlP-0Wtv99ZNI0_5sXWPGTiIBbRbnskIY",
  authDomain: "kuem-15821.firebaseapp.com",
  databaseURL: "https://kuem-15821-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kuem-15821",
  storageBucket: "kuem-15821.firebasestorage.app",
  messagingSenderId: "353954474766",
  appId: "1:353954474766:web:877b08bb3048296c2f855f"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

export function initAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) { resolve(user); }
      else { signInAnonymously(auth).then(c => resolve(c.user)); }
    });
  });
}
