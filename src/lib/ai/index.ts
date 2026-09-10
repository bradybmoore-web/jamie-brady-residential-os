import "server-only";
import { capabilities } from "@/lib/env";
import { MockProvider } from "./mock-provider";
import type { AIProvider } from "./provider";

let cached: AIProvider | null = null;

/** Claude when a key is configured, otherwise the deterministic fallback provider. */
export async function getProvider(): Promise<AIProvider> {
  if (cached) return cached;
  if (capabilities.anthropic) {
    const { createAnthropicProvider } = await import("./anthropic-provider");
    const provider = createAnthropicProvider();
    if (provider) {
      cached = provider;
      return cached;
    }
  }
  cached = new MockProvider();
  return cached;
}

export function __setProviderForTests(provider: AIProvider | null) {
  cached = provider;
}

export * from "./provider";
