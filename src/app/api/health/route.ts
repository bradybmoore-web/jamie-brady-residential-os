import { NextResponse } from "next/server";
import { capabilities } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness plus a capability report. Deliberately reports only booleans —
 * never a key, a URL, or anything that would help someone probe the
 * deployment's configuration.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    capabilities: {
      database: capabilities.supabase ? "supabase" : "in-memory",
      ai: capabilities.anthropic ? "anthropic" : "deterministic-fallback",
      crm: capabilities.cloze ? "cloze" : "mock",
      google: capabilities.google ? "connected" : "mock",
      mls: capabilities.mls ? "live" : "mock",
    },
  });
}
