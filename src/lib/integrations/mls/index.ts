import "server-only";
import { env } from "@/lib/env";
import type { AdapterInfo } from "../types";
import { MockMlsProvider } from "./mock";
import type { MlsProvider } from "./types";

export * from "./types";

/**
 * Registry of *implemented* live MLS providers.
 *
 * This is deliberately empty. Setting `MLS_PROVIDER` / `MLS_API_URL` /
 * `MLS_API_KEY` does not make MLS data live — an implementation has to exist
 * too. Previously the UI keyed its "this is mock data" warnings off the
 * environment variables alone, which meant setting them silently removed the
 * warnings while the comparables stayed fabricated. That is exactly the failure
 * this registry prevents: everything that reports MLS status now derives it from
 * whether a provider here can actually serve the request.
 *
 * Adding a licensed feed means implementing `MlsProvider` (e.g.
 * `./mlsgrid.ts`), adding one entry below, and nothing else. Every status
 * indicator in the product flips truthfully at the same moment.
 */
const LIVE_PROVIDERS: Record<string, () => Promise<MlsProvider>> = {
  // mlsgrid: async () => new (await import("./mlsgrid")).MlsGridProvider(),
  // trestle: async () => new (await import("./trestle")).TrestleProvider(),
  // bridge: async () => new (await import("./bridge")).BridgeProvider(),
};

export type MlsMode = "mock" | "live";

/** True only when the configured provider is both credentialed AND implemented. */
function liveProviderAvailable(): boolean {
  const configured = env.mlsProvider !== "mock" && Boolean(env.mlsApiUrl && env.mlsApiKey);
  return configured && Object.hasOwn(LIVE_PROVIDERS, env.mlsProvider);
}

/**
 * The mode the product is actually operating in. This — never the presence of
 * environment variables — is what the UI, the health endpoint and the seller
 * update warnings must key off.
 */
export function mlsMode(): MlsMode {
  return liveProviderAvailable() ? "live" : "mock";
}

export function mlsIsMock(): boolean {
  return mlsMode() === "mock";
}

let cached: MlsProvider | null = null;

export async function getMlsProvider(): Promise<MlsProvider> {
  if (cached) return cached;

  if (liveProviderAvailable()) {
    cached = await LIVE_PROVIDERS[env.mlsProvider]();
    return cached;
  }

  if (env.mlsProvider !== "mock" && Boolean(env.mlsApiUrl && env.mlsApiKey)) {
    console.warn(
      `[mls] MLS_PROVIDER="${env.mlsProvider}" is configured but no implementation is registered. ` +
        "Serving the mock feed, and every screen will continue to label it as mock data.",
    );
  }

  cached = new MockMlsProvider();
  return cached;
}

/** Test seam — the provider is memoised for the process lifetime. */
export function __resetMlsProviderForTests() {
  cached = null;
}

export function mlsInfo(): AdapterInfo {
  const live = mlsMode() === "live";
  return {
    provider: "unlock_mls",
    mode: live ? "live" : "mock",
    status: live ? "connected" : "planned",
    requires: ["A signed Unlock MLS / RESO data licence", "MLS_PROVIDER", "MLS_API_URL", "MLS_API_KEY"],
    notes: live
      ? `Live data via ${env.mlsProvider}.`
      : "MLS data is licensed and this product does not scrape it. Comparables, buyer matching and seller updates run on a local mock feed — labelled as such on every screen — until an approved RESO Web API feed is both licensed and implemented.",
  };
}
