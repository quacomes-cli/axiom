import { create } from "zustand";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from "firebase/auth";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { auth } from "../lib/firebase";
import { ipc } from "../lib/ipc";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface AuthState {
  user: AuthUser | null;
  googleIdToken: string | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;

  init: () => () => void;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

function toAuthUser(u: User): AuthUser {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
  };
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? "";

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  googleIdToken: localStorage.getItem("axiom_google_id_token"),
  loading: false,
  initialized: false,
  error: null,

  init: () => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      set({
        user: firebaseUser ? toAuthUser(firebaseUser) : null,
        initialized: true,
        loading: false,
      });
    });
    return unsubscribe;
  },

  signInEmail: async (email, password) => {
    set({ loading: true, error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: mapFirebaseError(msg), loading: false });
      throw e;
    }
  },

  signUpEmail: async (email, password, name) => {
    set({ loading: true, error: null });
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      set({ user: toAuthUser(cred.user) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: mapFirebaseError(msg), loading: false });
      throw e;
    }
  },

  signInGoogle: async () => {
    set({ loading: true, error: null });
    try {
      const { authUrl, port } = await ipc.oauthLocalhostStart(
        "google",
        GOOGLE_CLIENT_ID,
        "https://accounts.google.com/o/oauth2/v2/auth",
        "openid email profile",
      );

      await openUrl(authUrl);

      const code = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timeout")), 120_000);
        listen<{ provider: string; code: string | null }>("oauth-callback", (event) => {
          clearTimeout(timeout);
          if (event.payload.code) resolve(event.payload.code);
          else reject(new Error("no_code"));
        });
      });

      const redirectUri = `http://localhost:${port}`;
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResp.ok) {
        throw new Error("token_exchange_failed");
      }

      const tokens = await tokenResp.json();
      const credential = GoogleAuthProvider.credential(tokens.id_token);
      await signInWithCredential(auth, credential);

      set({ googleIdToken: tokens.id_token });
      localStorage.setItem("axiom_google_id_token", tokens.id_token);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: mapFirebaseError(msg), loading: false });
      throw e;
    }
  },

  signOut: async () => {
    await firebaseSignOut(auth);
    localStorage.removeItem("axiom_google_id_token");
    set({ user: null, googleIdToken: null });
  },

  clearError: () => set({ error: null }),
}));

function mapFirebaseError(msg: string): string {
  if (msg.includes("email-already-in-use")) return "Bu e-posta adresi zaten kullanımda.";
  if (msg.includes("invalid-email")) return "Geçersiz e-posta adresi.";
  if (msg.includes("weak-password")) return "Şifre en az 6 karakter olmalı.";
  if (msg.includes("user-not-found")) return "Bu e-posta ile kayıtlı hesap bulunamadı.";
  if (msg.includes("wrong-password") || msg.includes("invalid-credential")) return "E-posta veya şifre hatalı.";
  if (msg.includes("too-many-requests")) return "Çok fazla deneme. Lütfen biraz bekle.";
  if (msg.includes("popup-closed") || msg.includes("no_code")) return "Giriş penceresi kapatıldı.";
  if (msg.includes("network-request-failed")) return "İnternet bağlantısı yok.";
  if (msg.includes("timeout")) return "Google girişi zaman aşımına uğradı.";
  if (msg.includes("token_exchange_failed")) return "Google token alınamadı. Lütfen tekrar dene.";
  return "Bir hata oluştu. Lütfen tekrar dene.";
}
