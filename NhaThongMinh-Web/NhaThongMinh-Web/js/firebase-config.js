// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore,
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    getDoc,
    query,
    where,
    orderBy,
    limit,  // ← THÊM DÒNG NÀY
    onSnapshot,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Your web app's Firebase configuration
/*const firebaseConfig = {
  apiKey: "AIzaSyDcN3Hf78Vabgx5HMkp1xi3PaBW9aBxHIs",
  authDomain: "nhathongminh-631b1.firebaseapp.com",
  databaseURL: "https://nhathongminh-631b1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "nhathongminh-631b1",
  storageBucket: "nhathongminh-631b1.firebasestorage.app",
  messagingSenderId: "55193380563",
  appId: "1:55193380563:web:2b8527dff4aa4382671626",
  measurementId: "G-KR9HNFPLH9"
};

const firebaseConfig = {
  apiKey: "AIzaSyBT2ttDjuYGMDTo-MdXy2H5XZIOYtdjOn0",
  authDomain: "nhathongminh-8e701.firebaseapp.com",
  projectId: "nhathongminh-8e701",
  storageBucket: "nhathongminh-8e701.firebasestorage.app",
  messagingSenderId: "138336894702",
  appId: "1:138336894702:web:2d3852d2f313e6998cfdff",
  measurementId: "G-ZV9WKFDKNS"
};*/

const firebaseConfig = {
  apiKey: "AIzaSyCJ2NoHRFSzAMwdDiBFrU4OSYtwhODgx5g",
  authDomain: "nhathongminh-14261.firebaseapp.com",
  projectId: "nhathongminh-14261",
  storageBucket: "nhathongminh-14261.firebasestorage.app",
  messagingSenderId: "1062055907052",
  appId: "1:1062055907052:web:edd207d6d23fbad1bddfc9"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { 
    auth, 
    db, 
    onAuthStateChanged,
    signOut,
    // Firestore functions
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    getDoc,
    query,
    where,
    orderBy,
    limit,  // ← THÊM DÒNG NÀY
    onSnapshot,
    serverTimestamp,
    setDoc
};