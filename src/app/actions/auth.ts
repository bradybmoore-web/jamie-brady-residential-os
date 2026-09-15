"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import {
  SessionSecretMissingError,
  demoAuthBlocked,
  demoAuthEnabled,
  encodeDemoSession,
  verifyDemoPasscode,
} from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { capabilities } from "@/lib/env";
import { RATE_LIMITS, checkRateLimit, describeRetry } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";

export interface LoginState {
  error?: string;
}

/**
 * Demo sign-in.
 *
 * Unreachable once Supabase Auth is configured — the login page renders the
 * Supabase form instead, and every layer below (this action, `encodeDemoSession`,
 * `verifyDemoPasscode`, `decodeDemoSession`, the middleware) independently
 * refuses. The redundancy is deliberate: this is the backdoor, so more than one
 * thing has to fail before it opens.
 */
export async function signInWithPasscode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!demoAuthEnabled()) {
    return { error: "Supabase Auth is configured. Sign in with your email and password." };
  }
  if (demoAuthBlocked()) {
    return { error: "Sign-in is disabled until SESSION_SECRET is configured on this deployment." };
  }

  const limit = await loginRateLimit("passcode");
  if (!limit.allowed) return { error: limit.message };

  const profileId = String(formData.get("profileId") ?? "");
  const passcode = String(formData.get("passcode") ?? "");

  if (!profileId) return { error: "Choose who you are signing in as." };
  if (!verifyDemoPasscode(passcode)) return { error: "That passcode is not correct." };

  const store = await getStore();
  const profile = await store.getProfile(profileId);
  if (!profile) return { error: "That team member no longer exists." };

  let token: string;
  try {
    token = encodeDemoSession(profile);
  } catch (error) {
    if (error instanceof SessionSecretMissingError) {
      return { error: "Sign-in is disabled until SESSION_SECRET is configured on this deployment." };
    }
    throw error;
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
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

  // Throttle per address as well as per IP, so one account cannot be ground
  // down from a rotating set of addresses.
  const limit = await loginRateLimit(email.toLowerCase());
  if (!limit.allowed) return { error: limit.message };

  const { getSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect("/today");
}

/**
 * Login throttling. Keyed on the client address *and* on whatever identifies
 * the attempt, so neither dimension alone is enough to brute-force.
 */
async function loginRateLimit(identifier: string): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const ip = clientIp(await headers());
  for (const key of [`login:ip:${ip}`, `login:id:${identifier}`]) {
    const result = await checkRateLimit(key, RATE_LIMITS.login);
    if (!result.allowed) {
      return {
        allowed: false,
        message: `Too many sign-in attempts. Try again in ${describeRetry(result.retryAfterMs)}.`,
      };
    }
  }
  return { allowed: true };
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
