import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { getStore } from "@/lib/data/store";
import { SESSION_COOKIE, isSupabaseAuthConfigured } from "./constants";
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
 * It is a shared passcode gate — not a substitute for real authentication, and
 * not for use with real client data.
 */

export class SessionSecretMissingError extends Error {
  constructor() {
    super(
      "SESSION_SECRET is not set. It is required whenever demo authentication is active in production. " +
        "Generate one with `openssl rand -base64 32`, or connect Supabase Auth.",
    );
    this.name = "SessionSecretMissingError";
  }
}

/**
 * A random key generated once per process, used only outside production.
 *
 * There is deliberately no hard-coded default. A checked-in default key is a
 * published credential: anyone reading the repository could forge a session for
 * any profile. An ephemeral random key keeps local development frictionless
 * (sign in, work, cookies simply do not survive a restart) while making a
 * forged cookie impossible for someone who has only seen the source.
 */
let developmentKeyCache: string | null = null;

function developmentKey(): string {
  if (!developmentKeyCache) {
    developmentKeyCache = randomBytes(32).toString("base64url");
    console.warn(
      "[auth] SESSION_SECRET is not set. Using a random per-process key for development. " +
        "Sessions will not survive a restart, and this configuration is refused in production.",
    );
  }
  return developmentKeyCache;
}

function signingKey(): string {
  if (env.sessionSecret) return env.sessionSecret;
  // Fail closed. Never sign or verify a production cookie with a guessable key.
  if (process.env.NODE_ENV === "production") throw new SessionSecretMissingError();
  return developmentKey();
}

function sign(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function demoAuthEnabled(): boolean {
  return !isSupabaseAuthConfigured();
}

export function encodeDemoSession(profile: Profile) {
  if (!demoAuthEnabled()) {
    throw new Error("Demo sessions are disabled because Supabase Auth is configured.");
  }
  const payload = Buffer.from(
    JSON.stringify({ profileId: profile.id, fullName: profile.fullName, email: profile.email }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeDemoSession(token: string): Session | null {
  if (!demoAuthEnabled()) return null;
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
  if (!demoAuthEnabled()) return false;
  // Hash both sides to a fixed width before comparing. Comparing the raw
  // buffers requires an early length check, which leaks the passcode length.
  const key = signingKey();
  const a = createHmac("sha256", key).update(input).digest();
  const b = createHmac("sha256", key).update(env.demoPasscode).digest();
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------- resolution */

export async function getSession(): Promise<Session | null> {
  // When Supabase Auth is configured it is the ONLY way in. There is no
  // fallback to the demo cookie: a failed or absent Supabase session must not
  // be rescued by a passcode cookie, or connecting Supabase would leave the
  // demo path open as a backdoor.
  if (isSupabaseAuthConfigured()) {
    return getSupabaseSession();
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    return decodeDemoSession(token);
  } catch (error) {
    // A missing signing secret in production must deny access, not crash into
    // an unauthenticated-but-rendered state.
    if (error instanceof SessionSecretMissingError) {
      console.error("[auth]", error.message);
      return null;
    }
    throw error;
  }
}

async function getSupabaseSession(): Promise<Session | null> {
  try {
    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email, approved")
      .eq("user_id", data.user.id)
      .maybeSingle();
    // No profile, or an unapproved one, is not a session. Row level security
    // would deny every query anyway; refusing here turns a confusingly empty
    // app into an honest "you do not have access".
    if (!profile || profile.approved !== true) return null;
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
 * The banner shown on the login screen. Surfaced there rather than thrown at
 * module load so a misconfiguration reads as a clear message instead of an
 * opaque build failure.
 */
export function demoAuthWarning(): string | null {
  if (isSupabaseAuthConfigured()) return null;
  if (process.env.NODE_ENV !== "production") return null;
  if (env.sessionSecret) {
    return "Running on shared-passcode demo authentication. Connect Supabase Auth before putting real client data in this deployment.";
  }
  return "Sign-in is disabled: SESSION_SECRET is not set and this is a production build. Set SESSION_SECRET, then connect Supabase Auth before putting real client data in this deployment.";
}

/** True when sign-in cannot work at all because of missing configuration. */
export function demoAuthBlocked(): boolean {
  return demoAuthEnabled() && process.env.NODE_ENV === "production" && !env.sessionSecret;
}
