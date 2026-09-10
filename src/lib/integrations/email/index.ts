import "server-only";
import { capabilities } from "@/lib/env";
import type { AdapterInfo } from "../types";
import { MockEmailAdapter } from "./mock";
import type { EmailAdapter } from "./types";

export * from "./types";

let cached: EmailAdapter | null = null;

export async function getEmailAdapter(): Promise<EmailAdapter> {
  if (cached) return cached;
  if (capabilities.google) {
    const { GmailAdapter } = await import("./gmail");
    cached = new GmailAdapter();
  } else {
    cached = new MockEmailAdapter();
  }
  return cached;
}

export function emailInfo(): AdapterInfo {
  return {
    provider: "gmail",
    mode: capabilities.google ? "live" : "mock",
    status: capabilities.google ? "connected" : "needs_setup",
    requires: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
    notes: "Read and draft only. This product never sends mail — drafts go to the approval queue and to your Gmail drafts folder.",
  };
}
