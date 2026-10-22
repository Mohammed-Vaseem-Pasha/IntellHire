
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyA3wdHgBQFJ7oFMNE_wfb_x_3STxr2TYco",
    authDomain: "intellihire-ai-9bb3d.firebaseapp.com",
    projectId: "intellihire-ai-9bb3d",
    storageBucket: "intellihire-ai-9bb3d.firebasestorage.app",
    messagingSenderId: "380743534393",
    appId: "1:380743534393:web:71aa36daede566eed40ae8",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: "select_account",
});
