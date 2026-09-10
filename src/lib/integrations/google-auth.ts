import "server-only";
import { env } from "@/lib/env";

/**
 * Google OAuth token exchange.
 *
 * Uses the installed-app refresh token flow: a one-time consent produces a
 * refresh token stored as a server-side secret, and this exchanges it for a
 * short-lived access token per request. No token ever reaches the browser.
 *
 * TODO(credentials): see README → "Connecting Google" for obtaining the refresh
 * token. A per-user OAuth flow with stored tokens in `integration_connections`
 * is the natural next step once more than two people use this.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cache: CachedToken | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now() + 60_000) return cache.accessToken;

  if (!env.googleClientId || !env.googleClientSecret || !env.googleRefreshToken) {
    throw new Error(
      "Google is not connected. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.",
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: env.googleRefreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cache.accessToken;
}
