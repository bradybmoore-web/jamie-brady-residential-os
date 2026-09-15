import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe.
 *
 * Deliberately says nothing beyond "the process is up". It previously reported
 * which integrations were connected, which is free reconnaissance for anyone
 * who finds the URL — it tells an attacker whether real client data is behind
 * this deployment and which credentials are worth hunting for.
 *
 * The same information is available to signed-in team members on
 * Settings → Integrations, where it is actually useful and access-controlled.
 */
export function GET() {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}
