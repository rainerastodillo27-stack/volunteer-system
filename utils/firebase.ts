/**
 * Firebase app initialization.
 * Reads config from EXPO_PUBLIC_FIREBASE_* environment variables and
 * exports a ready-to-use Firestore `db` instance.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDCNwE9IOIDGnnoGwBTIY27KStmMVeZGzA',
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'capstone-4c12a.firebaseapp.com',
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'capstone-4c12a',
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'capstone-4c12a.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '163385365479',
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:163385365479:web:e55f97d53d4e4e289b6342',
};

// Prevent duplicate app initialization (e.g. hot-reload)
export const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db: Firestore = getFirestore(app);
