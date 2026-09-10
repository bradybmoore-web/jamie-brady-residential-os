/**
 * Auth constants with no server-only dependencies.
 *
 * The middleware runs on the Edge runtime and cannot import `node:crypto` or
 * the data store, so the cookie name lives here on its own rather than in
 * `session.ts`.
 */
export const SESSION_COOKIE = "rez_os_session";
