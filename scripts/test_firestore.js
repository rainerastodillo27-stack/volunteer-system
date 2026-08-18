const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

// Read .env
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2 && !line.trim().startsWith('#')) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

const firebaseConfig = {
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

console.log("Firebase config loaded for project:", firebaseConfig.projectId);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testFirestore() {
  try {
    console.log("Testing write to Firestore direct_messages collection...");
    const testDocRef = await addDoc(collection(db, 'direct_messages', 'test_conv', 'messages'), {
      senderId: 'system_test',
      recipientId: 'user_test',
      content: 'Hello from Firebase Firestore integration test!',
      timestamp: new Date().toISOString(),
      read: false
    });
    console.log("SUCCESS! Firestore document written with ID:", testDocRef.id);
  } catch (error) {
    console.error("FAILED to write to Firestore:", error);
    process.exit(1);
  }
}

testFirestore();
