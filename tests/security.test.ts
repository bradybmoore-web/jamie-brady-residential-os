import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security regression tests for Security Phase 1.
 *
 * These encode properties the product must not lose. If one fails, the fix is
 * the code — never the test.
 *
 * `env.ts` reads `process.env` once at module scope, so every test that varies
 * configuration must `vi.resetModules()` and re-import.
 */

/** The signing key that used to be hard-coded, and is now published in git history. */
const LEAKED_DEFAULT_KEY = "residential-os-development-only-secret";

const SUPABASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-tests",
};

const DEMO_PROFILE = {
  id: "11111111-0000-4000-8000-000000000001",
  fullName: "Jamie Moore",
  email: "jamie@moorehomeaustin.com",
} as const;

function forgeCookie(key: string, profile = DEMO_PROFILE) {
  const payload = Buffer.from(JSON.stringify(profile)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function loadSession() {
  return import("@/lib/auth/session");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Start every test from "no configuration at all".
  for (const key of [
    "SESSION_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "MLS_PROVIDER",
    "MLS_API_URL",
    "MLS_API_KEY",
  ]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/* ============================ 1. session signing ========================== */

describe("session signing secret", () => {
  it("has no hard-coded default key anywhere in the source tree", () => {
    const hits = grepSource(LEAKED_DEFAULT_KEY, ["src"]);
    expect(hits, `leaked key still present in: ${hits.join(", ")}`).toEqual([]);
  });

  it("refuses to mint a session in production when SESSION_SECRET is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { encodeDemoSession, SessionSecretMissingError } = await loadSession();
    expect(() => encodeDemoSession(profileFixture())).toThrow(SessionSecretMissingError);
  });

  it("reports sign-in as blocked in production without a secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { demoAuthBlocked } = await loadSession();
    expect(demoAuthBlocked()).toBe(true);
  });

  it("does not block sign-in in production once a secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "a-real-per-deployment-secret");
    const { demoAuthBlocked, encodeDemoSession } = await loadSession();
    expect(demoAuthBlocked()).toBe(false);
    expect(encodeDemoSession(profileFixture())).toContain(".");
  });

  it("still works in development without a secret, using a key nobody can predict", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { encodeDemoSession } = await loadSession();
    const token = encodeDemoSession(profileFixture());
    const [payload, signature] = token.split(".");

    // The signature must NOT match what the published default key would produce.
    const leaked = createHmac("sha256", LEAKED_DEFAULT_KEY).update(payload).digest("base64url");
    expect(signature).not.toBe(leaked);
  });
});

/* ======================= 2. authentication bypass ========================= */

describe("authentication bypass attempts", () => {
  it("rejects a cookie forged with the previously published default key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", "the-real-secret-for-this-deployment");

    const { __setCookies } = await import("./stubs/next-headers");
    const { getSession, SESSION_COOKIE } = await loadSession();

    __setCookies({ [SESSION_COOKIE]: forgeCookie(LEAKED_DEFAULT_KEY) });
    await expect(getSession()).resolves.toBeNull();
  });

  it("rejects a cookie signed with any wrong key", async () => {
    vi.stubEnv("SESSION_SECRET", "correct-secret");
    const { __setCookies } = await import("./stubs/next-headers");
    const { getSession, SESSION_COOKIE } = await loadSession();

    __setCookies({ [SESSION_COOKIE]: forgeCookie("attacker-guess") });
    await expect(getSession()).resolves.toBeNull();
  });

  it("rejects a cookie whose payload was edited after signing", async () => {
    vi.stubEnv("SESSION_SECRET", "correct-secret");
    const { __setCookies } = await import("./stubs/next-headers");
    const { getSession, encodeDemoSession, SESSION_COOKIE } = await loadSession();

    const valid = encodeDemoSession(profileFixture());
    const [, signature] = valid.split(".");
    // Keep the signature, swap in a different profile id.
    const tampered = Buffer.from(
      JSON.stringify({ ...DEMO_PROFILE, profileId: "99999999-0000-4000-8000-000000000999" }),
    ).toString("base64url");

    __setCookies({ [SESSION_COOKIE]: `${tampered}.${signature}` });
    await expect(getSession()).resolves.toBeNull();
  });

  it("rejects malformed cookies instead of throwing", async () => {
    vi.stubEnv("SESSION_SECRET", "correct-secret");
    const { __setCookies } = await import("./stubs/next-headers");
    const { getSession, SESSION_COOKIE } = await loadSession();

    for (const value of ["", "no-dot", "a.b.c.d", "....", "%%%.%%%"]) {
      __setCookies({ [SESSION_COOKIE]: value });
      await expect(getSession()).resolves.toBeNull();
    }
  });

  it("accepts only a correctly signed cookie", async () => {
    vi.stubEnv("SESSION_SECRET", "correct-secret");
    const { __setCookies } = await import("./stubs/next-headers");
    const { getSession, encodeDemoSession, SESSION_COOKIE } = await loadSession();

    __setCookies({ [SESSION_COOKIE]: encodeDemoSession(profileFixture()) });
    const session = await getSession();
    expect(session?.profileId).toBe(DEMO_PROFILE.id);
    expect(session?.mode).toBe("demo");
  });

  it("denies access in production when the secret is missing, rather than erroring open", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { __setCookies } = await import("./stubs/next-headers");
    const { getSession, SESSION_COOKIE } = await loadSession();

    __setCookies({ [SESSION_COOKIE]: forgeCookie(LEAKED_DEFAULT_KEY) });
    await expect(getSession()).resolves.toBeNull();
  });
});

/* ================= 3. demo auth disabled under Supabase ================== */

describe("demo authentication is disabled when Supabase Auth is configured", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(SUPABASE_ENV)) vi.stubEnv(key, value);
    vi.stubEnv("SESSION_SECRET", "a-valid-secret");
  });

  it("reports demo auth as disabled", async () => {
    const { demoAuthEnabled } = await loadSession();
    expect(demoAuthEnabled()).toBe(false);
  });

  it("refuses to mint a demo session", async () => {
    const { encodeDemoSession } = await loadSession();
    expect(() => encodeDemoSession(profileFixture())).toThrow(/disabled/i);
  });

  it("rejects the correct passcode", async () => {
    vi.stubEnv("DEMO_PASSCODE", "residential");
    const { verifyDemoPasscode } = await loadSession();
    expect(verifyDemoPasscode("residential")).toBe(false);
  });

  it("does not fall back to a validly signed demo cookie — the core backdoor", async () => {
    const { __setCookies } = await import("./stubs/next-headers");
    const { getSession, SESSION_COOKIE } = await loadSession();

    // A cookie signed with the deployment's real secret: valid in demo mode.
    __setCookies({ [SESSION_COOKIE]: forgeCookie("a-valid-secret") });

    // Supabase cannot resolve a session in this test environment, so if any
    // fallback existed this would return a session. It must not.
    await expect(getSession()).resolves.toBeNull();
  });

  it("shows no demo warning, because demo auth is not in play", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { demoAuthWarning, demoAuthBlocked } = await loadSession();
    expect(demoAuthWarning()).toBeNull();
    expect(demoAuthBlocked()).toBe(false);
  });
});

describe("passcode verification", () => {
  it("accepts the configured passcode and rejects others", async () => {
    vi.stubEnv("DEMO_PASSCODE", "a-chosen-passcode");
    vi.stubEnv("SESSION_SECRET", "secret");
    const { verifyDemoPasscode } = await loadSession();
    expect(verifyDemoPasscode("a-chosen-passcode")).toBe(true);
    expect(verifyDemoPasscode("wrong")).toBe(false);
    // Must not leak length by comparing raw buffers of differing size.
    expect(verifyDemoPasscode("")).toBe(false);
    expect(verifyDemoPasscode("a-chosen-passcode-longer")).toBe(false);
  });
});

/* ====================== 4. Supabase authorization ======================== */

describe("Supabase authorization denies by default", () => {
  const migration = readFileSync("supabase/migrations/0003_approved_team_members.sql", "utf8");

  it("defaults profiles.approved to false", () => {
    expect(migration).toMatch(/add column if not exists approved boolean not null default false/i);
  });

  it("requires an approved profile for team membership", () => {
    const fn = section(migration, "create or replace function public.is_team_member()", "$$;");
    expect(fn).toMatch(/and p\.approved/);
  });

  it("does not approve a new signup unless the address is allowlisted", () => {
    const fn = section(migration, "create or replace function public.handle_new_user()", "$$;");
    expect(fn).toContain("allowed_team_emails");
    expect(fn).toMatch(/is_allowed/);
    // Must never insert a literal approved=true.
    expect(fn).not.toMatch(/approved\s*\)\s*values[^;]*true/i);
  });

  it("strips the authenticated role's ability to write approval columns", () => {
    expect(migration).toMatch(/revoke insert, update on public\.profiles from authenticated/i);
    const grants = migration.match(/grant (insert|update) \([^)]*\) on public\.profiles to authenticated/gi) ?? [];
    expect(grants.length).toBe(2);
    for (const grant of grants) {
      for (const forbidden of ["approved", "approved_at", "approved_by"]) {
        expect(grant, `${forbidden} must not be grantable`).not.toContain(forbidden);
      }
    }
  });

  it("refuses a self-inserted profile that claims to be approved", () => {
    const policy = section(migration, "create policy profiles_insert_self", ";");
    expect(policy).toMatch(/approved = false/);
  });

  it("does not let a signed-in user call the approval helpers", () => {
    expect(migration).toMatch(
      /revoke all on function public\.approve_team_member\(text\) from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.revoke_team_member\(text\) from public, anon, authenticated/i,
    );
  });

  it("makes the allowlist read-only for the authenticated role", () => {
    const policies = migration.match(/create policy \w+ on public\.allowed_team_emails\s+for (\w+)/gi) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.toLowerCase()).toContain("for select");
    }
    expect(migration).toMatch(/alter table public\.allowed_team_emails enable row level security/i);
  });

  it("refuses an unapproved profile at the application layer too", () => {
    const source = readFileSync("src/lib/auth/session.ts", "utf8");
    expect(source).toContain("profile.approved !== true");
  });
});

/* ============================== 5. MLS mode ============================== */

describe("mock MLS data can never be presented as live", () => {
  it("is mock with no configuration at all", async () => {
    const { mlsMode, mlsIsMock, mlsInfo } = await import("@/lib/integrations/mls");
    expect(mlsMode()).toBe("mock");
    expect(mlsIsMock()).toBe(true);
    expect(mlsInfo().mode).toBe("mock");
    expect(mlsInfo().status).not.toBe("connected");
  });

  it("stays mock even when every MLS environment variable is set", async () => {
    // This is the exact configuration that used to silently remove the
    // "this is not real data" warnings while the data stayed fabricated.
    vi.stubEnv("MLS_PROVIDER", "mlsgrid");
    vi.stubEnv("MLS_API_URL", "https://api.mlsgrid.example/v2");
    vi.stubEnv("MLS_API_KEY", "a-key-that-looks-real");

    const { mlsMode, mlsIsMock, mlsInfo, getMlsProvider } = await import("@/lib/integrations/mls");
    expect(mlsMode()).toBe("mock");
    expect(mlsIsMock()).toBe(true);
    expect(mlsInfo().mode).toBe("mock");
    expect(mlsInfo().status).not.toBe("connected");
    expect(mlsInfo().notes).toMatch(/mock/i);

    const provider = await getMlsProvider();
    expect(provider.mode).toBe("mock");
    expect(provider.name).toBe("mock");
  });

  it("serves mock comparables while reporting mock mode, never diverging", async () => {
    vi.stubEnv("MLS_PROVIDER", "trestle");
    vi.stubEnv("MLS_API_URL", "https://api.trestle.example");
    vi.stubEnv("MLS_API_KEY", "key");

    const { getMlsProvider, mlsMode } = await import("@/lib/integrations/mls");
    const provider = await getMlsProvider();
    const comps = await provider.getComparables({ postalCode: "78613" });

    expect(comps.actives.length).toBeGreaterThan(0);
    expect(provider.mode).toBe(mlsMode());
    expect(provider.mode).toBe("mock");
  });

  it("does not key the seller-update warning off environment variables", () => {
    const page = readFileSync("src/app/(app)/listings/[id]/page.tsx", "utf8");
    expect(page).toContain("mlsIsMock()");
    expect(page).not.toMatch(/capabilities\.mls\b/);
  });

  it("names the capability flag so it cannot be mistaken for liveness", async () => {
    const { capabilities } = await import("@/lib/env");
    expect(capabilities).not.toHaveProperty("mls");
    expect(capabilities).toHaveProperty("mlsConfigured");
  });

  it("never reports MLS as live from any screen while the registry is empty", () => {
    // Anything rendering MLS status must go through mlsMode()/mlsIsMock()/provider.mode.
    const offenders = grepSource("capabilities.mls", ["src"]).filter((f) => !f.includes("env.ts"));
    expect(offenders).toEqual([]);
  });
});

/* ========================= 6. outbound send ban ========================== */

describe("the application cannot send email", () => {
  it("contains no Gmail send endpoint or send scope anywhere in source", () => {
    const patterns = [
      "messages/send",
      "gmail.send",
      "auth/gmail.send",
      "sendMessage(",
      "smtp",
      "nodemailer",
      "sendgrid",
      "twilio",
    ];
    for (const pattern of patterns) {
      expect(grepSource(pattern, ["src"]), `found "${pattern}"`).toEqual([]);
    }
  });

  it("exposes no send operation on the email adapter interface", () => {
    const types = readFileSync("src/lib/integrations/email/types.ts", "utf8");
    expect(types).toContain("draftEmail");
    expect(types).not.toMatch(/^\s*send\w*\s*\(/m);
  });

  it("only writes drafts from the Gmail adapter", () => {
    const gmail = readFileSync("src/lib/integrations/email/gmail.ts", "utf8");
    const writes = gmail.match(/method: "(POST|PUT|PATCH|DELETE)"/g) ?? [];
    expect(writes.length).toBe(1);
    expect(gmail).toContain('this.request<{ id: string }>("/drafts"');
  });

  it("no longer claims that gmail.compose cannot send", () => {
    for (const file of ["src/lib/integrations/email/gmail.ts", "README.md", ".env.example"]) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} still claims compose cannot send`).not.toMatch(
        /compose[^.]*\bcannot send\b|not `?gmail\.send`? — deliberately/i,
      );
    }
    const gmail = readFileSync("src/lib/integrations/email/gmail.ts", "utf8");
    expect(gmail).toMatch(/does permit sending|DOES permit sending/);
  });

  it("keeps the database-level approval constraint on outbound action types", () => {
    const migration = readFileSync("supabase/migrations/0001_init.sql", "utf8");
    expect(migration).toMatch(/ai_actions_outbound_requires_approval/);
    expect(migration).toMatch(/check \(requires_approval or type not in \('email_draft','text_draft','stage_change'\)\)/);
  });
});

/* =========================== 7. health endpoint ========================== */

describe("public health endpoint", () => {
  it("reports liveness only, disclosing no integration status", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    for (const [key, value] of Object.entries(SUPABASE_ENV)) vi.stubEnv(key, value);

    const { GET } = await import("@/app/api/health/route");
    const body = await GET().json();

    expect(Object.keys(body).sort()).toEqual(["status", "timestamp"]);
    expect(JSON.stringify(body)).not.toMatch(/supabase|anthropic|cloze|google|mls|capabilit/i);
  });
});

/* ============================ 8. demo labelling ========================== */

describe("demo data is labelled wherever it is shown", () => {
  it("reports seed data presence from the store", async () => {
    const { MemoryStore } = await import("@/lib/data/memory-store");
    await expect(new MemoryStore().hasSeedData()).resolves.toBe(true);
  });

  it("renders a demo banner on every aggregate screen", () => {
    for (const page of [
      "src/app/(app)/today/page.tsx",
      "src/app/(app)/opportunities/page.tsx",
      "src/app/(app)/marketing/page.tsx",
      "src/app/(app)/approvals/page.tsx",
    ]) {
      expect(readFileSync(page, "utf8"), `${page} is missing the demo banner`).toContain("DemoDataBanner");
    }
  });

  it("marks individual seed rows on the record screens", () => {
    for (const page of [
      "src/app/(app)/leads/page.tsx",
      "src/app/(app)/clients/page.tsx",
      "src/app/(app)/listings/page.tsx",
      "src/app/(app)/buyers/page.tsx",
      "src/app/(app)/transactions/page.tsx",
      "src/app/(app)/marketing/page.tsx",
    ]) {
      expect(readFileSync(page, "utf8"), `${page} is missing SeedMarker`).toContain("SeedMarker");
    }
  });
});

/* ================================ helpers ================================ */

function profileFixture() {
  const now = new Date().toISOString();
  return {
    id: DEMO_PROFILE.id,
    createdAt: now,
    updatedAt: now,
    sourceSystem: "seed" as const,
    userId: DEMO_PROFILE.id,
    fullName: DEMO_PROFILE.fullName,
    email: DEMO_PROFILE.email,
    role: "agent" as const,
    approved: true,
  };
}

/** Files under `roots` containing `needle`. Comments count — claims matter too. */
function grepSource(needle: string, roots: string[]): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mjs|sql)$/.test(entry)) {
        if (readFileSync(full, "utf8").includes(needle)) hits.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  return hits;
}

/** The text from `start` up to the first `end` after it. */
function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  if (from === -1) throw new Error(`Could not find "${start}"`);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to === -1 ? undefined : to + end.length);
}
