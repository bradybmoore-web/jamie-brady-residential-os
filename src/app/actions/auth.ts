"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { encodeDemoSession, verifyDemoPasscode } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { capabilities } from "@/lib/env";

export interface LoginState {
  error?: string;
}

/**
 * Demo sign-in.
 *
 * Only reachable when Supabase is not configured. With Supabase connected, the
 * login page renders the Supabase Auth form instead and this action refuses.
 */
export async function signInWithPasscode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (capabilities.supabase) {
    return { error: "Supabase Auth is configured. Sign in with your email and password." };
  }

  const profileId = String(formData.get("profileId") ?? "");
  const passcode = String(formData.get("passcode") ?? "");

  if (!profileId) return { error: "Choose who you are signing in as." };
  if (!verifyDemoPasscode(passcode)) return { error: "That passcode is not correct." };

  const store = await getStore();
  const profile = await store.getProfile(profileId);
  if (!profile) return { error: "That team member no longer exists." };

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, encodeDemoSession(profile), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  redirect("/today");
}

export async function signInWithSupabase(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!capabilities.supabase) return { error: "Supabase is not configured on this deployment." };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const { getSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect("/today");
}

export async function signOut() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);

  if (capabilities.supabase) {
    try {
      const { getSupabaseServerClient } = await import("@/lib/supabase/server");
      const supabase = await getSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // Signing out locally is what matters; a failed remote revoke should not
      // leave the user stuck on a page they wanted to leave.
    }
  }

  redirect("/login");
}
