import "server-only";

/**
 * Environment access. Nothing here is exported to the client bundle except the
 * two `NEXT_PUBLIC_` values, and those are read through `publicEnv()`.
 *
 * The app is designed to run with *none* of these set — every capability that
 * needs a credential degrades to a mock adapter and says so in the UI.
 */

function read(name: string) {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const env = {
  supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),

  anthropicApiKey: read("ANTHROPIC_API_KEY"),
  anthropicModel: read("ANTHROPIC_MODEL") ?? "claude-sonnet-5",

  clozeApiKey: read("CLOZE_API_KEY"),
  clozeUserEmail: read("CLOZE_USER_EMAIL"),
  clozeApiUrl: read("CLOZE_API_URL") ?? "https://api.cloze.com/v1",
  clozeMcpUrl: read("CLOZE_MCP_URL"),

  googleClientId: read("GOOGLE_CLIENT_ID"),
  googleClientSecret: read("GOOGLE_CLIENT_SECRET"),
  googleRefreshToken: read("GOOGLE_REFRESH_TOKEN"),

  activepipeApiKey: read("ACTIVEPIPE_API_KEY"),

  zapierMcpUrl: read("ZAPIER_MCP_URL"),

  mlsProvider: read("MLS_PROVIDER") ?? "mock",
  mlsApiUrl: read("MLS_API_URL"),
  mlsApiKey: read("MLS_API_KEY"),

  docusignIntegrationKey: read("DOCUSIGN_INTEGRATION_KEY"),

  demoPasscode: read("DEMO_PASSCODE") ?? "residential",
  sessionSecret: read("SESSION_SECRET"),
} as const;

export const capabilities = {
  supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
  supabaseAdmin: Boolean(env.supabaseUrl && env.supabaseServiceRoleKey),
  anthropic: Boolean(env.anthropicApiKey),
  cloze: Boolean(env.clozeApiKey || env.clozeMcpUrl),
  google: Boolean(env.googleClientId && env.googleClientSecret && env.googleRefreshToken),
  activepipe: Boolean(env.activepipeApiKey),
  zapier: Boolean(env.zapierMcpUrl),
  mls: env.mlsProvider !== "mock" && Boolean(env.mlsApiUrl && env.mlsApiKey),
  docusign: Boolean(env.docusignIntegrationKey),
} as const;

export type CapabilityName = keyof typeof capabilities;

/**
 * Warnings shown on the Integrations page. Missing credentials are not errors —
 * they are a checklist.
 */
export function environmentReport() {
  const notes: { key: string; ok: boolean; detail: string }[] = [
    {
      key: "Supabase",
      ok: capabilities.supabase,
      detail: capabilities.supabase
        ? "Connected. Reads and writes go to Postgres."
        : "Not set. Running on in-memory seed data — changes reset when the server restarts.",
    },
    {
      key: "Anthropic",
      ok: capabilities.anthropic,
      detail: capabilities.anthropic
        ? `Connected. Using ${env.anthropicModel}.`
        : "Not set. AI surfaces render deterministic sample output from the mock provider.",
    },
    {
      key: "Cloze",
      ok: capabilities.cloze,
      detail: capabilities.cloze ? "Connected." : "Not set. Contacts come from seed data.",
    },
    {
      key: "Google",
      ok: capabilities.google,
      detail: capabilities.google ? "Connected." : "Not set. Mail and calendar come from seed data.",
    },
    {
      key: "MLS",
      ok: capabilities.mls,
      detail: capabilities.mls
        ? `Connected via ${env.mlsProvider}.`
        : "Mock provider. Requires a licensed RESO Web API feed.",
    },
  ];
  return notes;
}
