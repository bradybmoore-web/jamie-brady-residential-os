import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RATE_LIMITS,
  checkRateLimit,
  describeRetry,
  getRateLimitStore,
  setRateLimitStore,
  type RateLimitStore,
} from "@/lib/security/rate-limit";

/**
 * Rate limiting is the control that stops passcode grinding and runaway spend
 * on the metered AI endpoint. These tests pin the behaviour that matters.
 */

beforeEach(async () => {
  await getRateLimitStore().reset();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit and refuses the one after", async () => {
    const rule = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit("k", rule);
      expect(result.allowed, `request ${i + 1} should be allowed`).toBe(true);
    }
    const blocked = await checkRateLimit("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("counts down the remaining allowance", async () => {
    const rule = { limit: 3, windowMs: 60_000 };
    expect((await checkRateLimit("k", rule)).remaining).toBe(2);
    expect((await checkRateLimit("k", rule)).remaining).toBe(1);
    expect((await checkRateLimit("k", rule)).remaining).toBe(0);
  });

  it("keeps separate counters per key, so one user cannot lock out another", async () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect((await checkRateLimit("user:a", rule)).allowed).toBe(true);
    expect((await checkRateLimit("user:a", rule)).allowed).toBe(false);
    expect((await checkRateLimit("user:b", rule)).allowed).toBe(true);
  });

  it("lets the caller through again once the window has passed", async () => {
    const rule = { limit: 1, windowMs: 1_000 };
    const start = 1_000_000;
    expect((await checkRateLimit("k", rule, start)).allowed).toBe(true);
    expect((await checkRateLimit("k", rule, start + 500)).allowed).toBe(false);
    expect((await checkRateLimit("k", rule, start + 1_500)).allowed).toBe(true);
  });

  it("does not stop limiting under sustained pressure from many distinct keys", async () => {
    const rule = { limit: 1, windowMs: 60_000 };
    for (let i = 0; i < 2_000; i++) await checkRateLimit(`flood:${i}`, rule);
    // Eviction must not disable limiting for a key created afterwards.
    expect((await checkRateLimit("victim", rule)).allowed).toBe(true);
    expect((await checkRateLimit("victim", rule)).allowed).toBe(false);
  });
});

describe("configured limits", () => {
  it("throttles sign-in and the assistant endpoint at sane values", () => {
    expect(RATE_LIMITS.login.limit).toBeLessThanOrEqual(20);
    expect(RATE_LIMITS.login.windowMs).toBeGreaterThanOrEqual(60_000);
    expect(RATE_LIMITS.assistant.limit).toBeLessThanOrEqual(60);
    expect(RATE_LIMITS.assistant.windowMs).toBeGreaterThanOrEqual(60_000);
  });

  it("is actually applied at both call sites", () => {
    expect(readFileSync("src/app/api/assistant/route.ts", "utf8")).toContain("checkRateLimit");
    expect(readFileSync("src/app/actions/auth.ts", "utf8")).toContain("checkRateLimit");
  });

  it("throttles sign-in by address and by identifier", () => {
    const auth = readFileSync("src/app/actions/auth.ts", "utf8");
    expect(auth).toContain("login:ip:");
    expect(auth).toContain("login:id:");
    // Both sign-in paths must be covered, not just the demo one.
    expect(auth.match(/loginRateLimit\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keys the assistant limit on the authenticated profile, not a spoofable address", () => {
    expect(readFileSync("src/app/api/assistant/route.ts", "utf8")).toContain("assistant:${session.profileId}");
  });

  it("returns 429 with Retry-After when the assistant limit is hit", () => {
    const route = readFileSync("src/app/api/assistant/route.ts", "utf8");
    expect(route).toContain("status: 429");
    expect(route).toContain('"Retry-After"');
  });

  it("checks the limit only after authenticating, so it cannot be probed anonymously", () => {
    const route = readFileSync("src/app/api/assistant/route.ts", "utf8");
    // Compare against the call site, not the import at the top of the file.
    expect(route.indexOf("Not authenticated")).toBeLessThan(route.indexOf("await checkRateLimit"));
  });
});

describe("store seam", () => {
  it("can be replaced with a durable implementation", async () => {
    const calls: string[] = [];
    const fake: RateLimitStore = {
      async hit(key, windowMs, now) {
        calls.push(key);
        return { count: 99, resetAt: now + windowMs };
      },
      async reset() {},
    };
    const original = getRateLimitStore();
    setRateLimitStore(fake);
    try {
      const result = await checkRateLimit("through-the-seam", { limit: 5, windowMs: 1_000 });
      expect(calls).toEqual(["through-the-seam"]);
      expect(result.allowed).toBe(false);
    } finally {
      setRateLimitStore(original);
    }
  });
});

describe("describeRetry", () => {
  it("reads naturally for a person", () => {
    expect(describeRetry(1_000)).toBe("1 second");
    expect(describeRetry(30_000)).toBe("30 seconds");
    expect(describeRetry(600_000)).toBe("10 minutes");
    expect(describeRetry(60_000)).toBe("60 seconds");
  });
});
