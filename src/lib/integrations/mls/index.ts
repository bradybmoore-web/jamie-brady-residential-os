import "server-only";
import { capabilities, env } from "@/lib/env";
import type { AdapterInfo } from "../types";
import { MockMlsProvider } from "./mock";
import type { MlsProvider } from "./types";

export * from "./types";

let cached: MlsProvider | null = null;

/**
 * Resolve the MLS provider.
 *
 * Only the mock ships today. Adding a licensed feed means implementing
 * `MlsProvider` (e.g. `src/lib/integrations/mls/mlsgrid.ts`) and adding one
 * branch here — no caller changes.
 */
export async function getMlsProvider(): Promise<MlsProvider> {
  if (cached) return cached;
  if (capabilities.mls) {
    // TODO(licensing): implement and register a RESO Web API provider here once
    // Unlock MLS access is approved. Candidates: MLS Grid, Trestle, Bridge.
    console.warn(
      `MLS_PROVIDER="${env.mlsProvider}" is configured but no live provider is implemented yet. Falling back to the mock feed.`,
    );
  }
  cached = new MockMlsProvider();
  return cached;
}

export function mlsInfo(): AdapterInfo {
  return {
    provider: "unlock_mls",
    mode: "mock",
    status: "planned",
    requires: ["A signed Unlock MLS / RESO data licence", "MLS_PROVIDER", "MLS_API_URL", "MLS_API_KEY"],
    notes:
      "MLS data is licensed and this product does not scrape it. Comparables, buyer matching and seller updates run on a local mock feed until an approved RESO Web API feed is connected.",
  };
}
