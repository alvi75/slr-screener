import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDwCSKURpLjGEf5e9QR9pSa2COVP9PkJv0",
  authDomain: "slr-screener.firebaseapp.com",
  projectId: "slr-screener",
  storageBucket: "slr-screener.firebasestorage.app",
  messagingSenderId: "1012525338290",
  appId: "1:1012525338290:web:d17cdded0c3b4a707283ab",
  measurementId: "G-WBFE8KWF06"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export default app;
