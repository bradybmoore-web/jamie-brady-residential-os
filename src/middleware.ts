import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isSupabaseAuthConfigured } from "@/lib/auth/constants";

/**
 * Route protection and session refresh.
 *
 * Two jobs:
 *
 * 1. **Refresh the Supabase session.** A Supabase access token lasts about an
 *    hour. `supabase.auth.getUser()` transparently exchanges an expiring token
 *    for a fresh one and hands back new cookies, which are written onto the
 *    response. Without this the app logged people out roughly hourly — the
 *    `supabase/server.ts` comment claimed the middleware did this; it did not.
 *
 * 2. **Redirect anyone without a session** to the login screen. This is a
 *    redirect, not an authorization decision: whether the person is *approved*
 *    is decided server-side in `getAuthState()` against row level security, and
 *    is deliberately not checked here (it needs a database read on every
 *    request, and RLS denies regardless).
 *
 * The demo-auth switch is honoured here as everywhere else: when Supabase Auth
 * is configured, a demo cookie is not a session marker.
 */

/** Reachable with no session at all. */
const PUBLIC_PATHS = ["/login", "/api/health", "/auth"];

/** Reachable with a session that is not yet approved. */
const PENDING_PATHS = ["/pending-approval"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isSupabaseAuthConfigured()) return demoMiddleware(request, pathname);

  // --- Supabase: refresh first, so a valid-but-expiring session survives. ---
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write refreshed cookies onto both the forwarded request (so server
          // components in this same pass see the new token) and the response
          // (so the browser stores it).
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // This call is what performs the refresh. Do not remove it, and do not run
  // any logic between creating the client and calling it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A leftover demo cookie is not a credential once Supabase owns auth.
  if (request.cookies.get(SESSION_COOKIE)?.value) response.cookies.delete(SESSION_COOKIE);

  if (isPublic(pathname) || PENDING_PATHS.includes(pathname)) return response;

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    const redirect = NextResponse.redirect(url);
    // Carry the refreshed cookies through the redirect so a recovered session
    // is not thrown away.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}

/** Demo mode: no Supabase, so nothing to refresh — only the cookie marker. */
function demoMiddleware(request: NextRequest, pathname: string) {
  if (isPublic(pathname)) return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico)$).*)"],
};
