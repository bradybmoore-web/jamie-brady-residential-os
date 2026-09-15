/**
 * Test double for `next/headers`.
 *
 * `getSession()` reads cookies, which only exist inside a request. Stubbing the
 * module lets the security tests drive the real session-resolution code — the
 * code an attacker would actually hit — rather than testing a reimplementation
 * of it.
 */
let cookieJar = new Map<string, string>();
let headerBag = new Headers();

export function __setCookies(entries: Record<string, string>) {
  cookieJar = new Map(Object.entries(entries));
}

export function __setHeaders(entries: Record<string, string>) {
  headerBag = new Headers(entries);
}

export function __getCookies() {
  return Object.fromEntries(cookieJar);
}

export async function cookies() {
  return {
    get(name: string) {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll() {
      return [...cookieJar].map(([name, value]) => ({ name, value }));
    },
    set(name: string, value: string) {
      cookieJar.set(name, value);
    },
    delete(name: string) {
      cookieJar.delete(name);
    },
  };
}

export async function headers() {
  return headerBag;
}
