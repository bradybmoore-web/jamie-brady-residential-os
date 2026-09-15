import "server-only";

/**
 * Best-effort client address for rate limiting.
 *
 * Forwarded headers are client-controllable, so this is not an identity — it is
 * a bucketing hint that makes casual abuse expensive. Anything that must be
 * trustworthy is keyed on the authenticated profile id instead.
 *
 * On Vercel, `x-forwarded-for` is set by the platform and its left-most entry
 * is the real client. Behind a different proxy, verify that assumption before
 * relying on it.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
