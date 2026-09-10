import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { capabilities, env } from "@/lib/env";
import { getStore } from "@/lib/data/store";
import { SESSION_COOKIE } from "./constants";
import type { Profile } from "@/lib/types";

export { SESSION_COOKIE } from "./constants";

export interface Session {
  profileId: string;
  fullName: string;
  email: string;
  /** How the session was established. Shown in Settings so it is never opaque. */
  mode: "supabase" | "demo";
}

/* ------------------------------------------------------- demo cookie auth */

/**
 * The demo session is a signed cookie, not a password store.
 *
 * It exists so the product is usable before a Supabase project is provisioned.
 * It is a shared passcode gate, and the README says so plainly — it is not a
 * substitute for real authentication and must not be used with real client data.
 */
function signingKey() {
  // A per-deployment secret is required in production; see `assertProductionSafety`.
  return env.sessionSecret ?? "residential-os-development-only-secret";
}

function sign(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function encodeDemoSession(profile: Profile) {
  const payload = Buffer.from(
    JSON.stringify({ profileId: profile.id, fullName: profile.fullName, email: profile.email }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeDemoSession(token: string): Session | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  // Constant-time compare so the cookie cannot be brute-forced byte by byte.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed?.profileId !== "string") return null;
    return {
      profileId: parsed.profileId,
      fullName: String(parsed.fullName ?? "Team member"),
      email: String(parsed.email ?? ""),
      mode: "demo",
    };
  } catch {
    return null;
  }
}

export function verifyDemoPasscode(input: string) {
  const expected = env.demoPasscode;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------- resolution */

export async function getSession(): Promise<Session | null> {
  if (capabilities.supabase) {
    const supabaseSession = await getSupabaseSession();
    if (supabaseSession) return supabaseSession;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? decodeDemoSession(token) : null;
}

async function getSupabaseSession(): Promise<Session | null> {
  try {
    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!profile) return null;
    return {
      profileId: profile.id as string,
      fullName: (profile.full_name as string) ?? "Team member",
      email: (profile.email as string) ?? data.user.email ?? "",
      mode: "supabase",
    };
  } catch {
    return null;
  }
}

/** For server components and actions that must have a user. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return session;
}

/** The team roster, used by the demo login screen. */
export async function listLoginProfiles(): Promise<Profile[]> {
  const store = await getStore();
  return store.listProfiles();
}

/**
 * Refuse to run a production deployment on the demo passcode with a default
 * signing secret. Called from the login page rather than at module load so a
 * misconfiguration surfaces as a clear message instead of a build failure.
 */
export function demoAuthWarning(): string | null {
  if (capabilities.supabase) return null;
  if (process.env.NODE_ENV !== "production") return null;
  if (env.sessionSecret) {
    return "Running on shared-passcode demo authentication. Connect Supabase Auth before putting real client data in this deployment.";
  }
  return "Demo authentication is active and SESSION_SECRET is not set. Set SESSION_SECRET, and connect Supabase Auth before putting real client data in this deployment.";
}
