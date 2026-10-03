import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

const AuthContext = createContext(null);

// OAuth redirects back to the site root, so remember a deep link (e.g. /contest/<id>) across it.
function stashReturnPath() {
  try {
    if (window.location.pathname !== "/") sessionStorage.setItem("sparx_return_to", window.location.pathname);
  } catch {
    // best-effort only
  }
}

// Fills in profiles.country_code once, from the visitor's network (Vercel's
// edge geo header via /api/geo). Silent no-op where that endpoint doesn't
// exist (local dev) or the column isn't there yet.
async function detectCountry(userId, profile, setProfile) {
  try {
    const res = await fetch("/api/geo");
    if (!res.ok) return;
    const { country } = await res.json();
    if (!country) return;
    const { error } = await supabase.from("profiles").update({ country_code: country }).eq("id", userId);
    if (!error) setProfile({ ...profile, country_code: country });
  } catch {
    // best-effort only
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data || null);
    if (data && !data.country_code) detectCountry(userId, data, setProfile);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    supabase.auth.getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        await loadProfile(data.session?.user?.id);
      })
      .catch(() => {
        // getSession() can reject (storage/cookie issues, malformed OAuth
        // redirect hash, etc.) — fall through to onAuthStateChange, or just
        // stop showing the spinner and let the user retry signing in.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadProfile(newSession?.user?.id);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = {
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user || null,
    profile,
    isAdmin: profile?.role === "admin",
    refreshProfile: () => loadProfile(session?.user?.id),
    async signUpWithEmail(email, password, { username, name } = {}) {
      return supabase.auth.signUp({
        email,
        password,
        options: { data: { username, full_name: name } },
      });
    },
    async signInWithEmail(email, password) {
      return supabase.auth.signInWithPassword({ email, password });
    },
    async signInWithGoogle() {
      stashReturnPath();
      return supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
    },
    async signInWithGitHub() {
      stashReturnPath();
      return supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: window.location.origin },
      });
    },
    async signOut() {
      return supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
