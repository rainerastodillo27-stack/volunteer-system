/**
 * Firebase app initialization.
 * Reads config from EXPO_PUBLIC_FIREBASE_* environment variables and
 * exports a ready-to-use Firestore `db` instance.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Prevent duplicate app initialization (e.g. hot-reload)
const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db: Firestore = getFirestore(app);
