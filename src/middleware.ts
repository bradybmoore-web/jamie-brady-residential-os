import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isSupabaseAuthConfigured } from "@/lib/auth/constants";

/**
 * Route protection.
 *
 * This is a redirect, not an authorization decision — it only checks that a
 * plausible session marker is present. Real verification (HMAC signature check,
 * Supabase session lookup, row level security) happens server-side on every
 * request in `getSession()`.
 *
 * It does, however, honour the same demo-auth switch as the rest of the system:
 * when Supabase Auth is configured, a demo cookie is not a session marker.
 */
const PUBLIC_PATHS = ["/login", "/api/health"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const supabaseAuth = isSupabaseAuthConfigured();
  const hasSupabaseCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  const hasDemoCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const hasMarker = supabaseAuth ? hasSupabaseCookie : hasDemoCookie;

  if (!hasMarker) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    const response = NextResponse.redirect(url);
    // Clear a stale demo cookie once Supabase owns authentication, so a
    // leftover credential cannot linger in a browser after the cutover.
    if (supabaseAuth && hasDemoCookie) response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico)$).*)"],
};
