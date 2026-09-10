import "server-only";
import { capabilities, env } from "@/lib/env";
import type { AdapterInfo } from "../types";
import { MockClozeAdapter } from "./mock";
import type { ClozeAdapter } from "./types";

export * from "./types";

let cached: ClozeAdapter | null = null;

export async function getClozeAdapter(): Promise<ClozeAdapter> {
  if (cached) return cached;
  if (capabilities.cloze) {
    const { RestClozeAdapter } = await import("./rest");
    cached = new RestClozeAdapter();
  } else {
    cached = new MockClozeAdapter();
  }
  return cached;
}

export function clozeInfo(): AdapterInfo {
  return {
    provider: "cloze",
    mode: capabilities.cloze ? "live" : "mock",
    status: capabilities.cloze ? "connected" : "needs_setup",
    requires: ["CLOZE_API_KEY", "CLOZE_USER_EMAIL"],
    notes: env.clozeMcpUrl
      ? "CLOZE_MCP_URL is set. The REST adapter is used by default; see the README for routing calls through MCP instead."
      : "Cloze remains the CRM system of record. This app caches contacts for scoring and writes tasks and notes back.",
  };
}
