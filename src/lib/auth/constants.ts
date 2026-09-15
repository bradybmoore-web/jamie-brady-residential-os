/**
 * Auth constants and checks with no server-only dependencies.
 *
 * The middleware runs on the Edge runtime and cannot import `node:crypto`, the
 * data store, or `lib/env` (which is marked `server-only`), so anything the
 * middleware needs has to live here.
 */
export const SESSION_COOKIE = "rez_os_session";

/**
 * Whether Supabase Auth is configured, readable from the Edge runtime.
 *
 * Deliberately duplicated from `lib/env.ts` rather than imported: the
 * middleware must be able to answer this question, and `lib/env` cannot run at
 * the edge. Both read the same two variables, so they cannot disagree.
 *
 * This is the switch that disables demo authentication. When it returns true,
 * the demo cookie is not a credential anywhere in the system.
 */
export function isSupabaseAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}
