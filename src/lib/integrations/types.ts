import type { IntegrationStatus } from "@/lib/types";

/**
 * Every external system is reached through an adapter with three parts:
 * a typed interface, a mock implementation, and a real implementation. The
 * application only ever sees the interface, so connecting a real vendor is a
 * configuration change rather than a refactor.
 */

export interface AdapterInfo {
  provider: string;
  /** "mock" until credentials exist. */
  mode: "mock" | "live";
  status: IntegrationStatus;
  /** Exactly what is needed to move from mock to live. */
  requires: string[];
  notes?: string;
}

export interface IntegrationDescriptor {
  key: string;
  name: string;
  category: "crm" | "email" | "calendar" | "marketing" | "mls" | "documents" | "automation" | "storage";
  summary: string;
  /** What this unlocks in the product once it is connected. */
  unlocks: string[];
  envVars: { name: string; description: string; required: boolean }[];
  setupSteps: string[];
  docsUrl?: string;
}
