import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { RATE_LIMITS, checkRateLimit, describeRetry } from "@/lib/security/rate-limit";
import { runAssistant, type AssistantTurn } from "@/lib/workflows/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The assistant endpoint.
 *
 * A route handler rather than a server action because the conversation is
 * client-driven and needs a plain request/response shape. Authentication is
 * checked here, not in the middleware, which only redirects.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Keyed on the authenticated profile rather than the client address: each
  // turn can fan out into several tool calls and a metered model request, so
  // the cost belongs to whoever is signed in.
  const limit = await checkRateLimit(`assistant:${session.profileId}`, RATE_LIMITS.assistant);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `You have reached the assistant limit. Try again in ${describeRetry(limit.retryAfterMs)}.` },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }

  const history: AssistantTurn[] = messages
    .filter(
      (m): m is AssistantTurn =>
        typeof m === "object" &&
        m !== null &&
        (m as AssistantTurn).role !== undefined &&
        typeof (m as AssistantTurn).content === "string",
    )
    .slice(-12) // Bound the context; older turns rarely change the answer.
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  try {
    const result = await runAssistant(history, session.profileId);
    return NextResponse.json({
      reply: result.reply,
      steps: result.steps.map((s) => ({
        toolName: s.toolName,
        input: s.input,
        output: s.output.slice(0, 4000),
        isError: s.isError ?? false,
      })),
      provider: result.provider,
    });
  } catch (error) {
    console.error("[assistant]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The assistant could not answer that." },
      { status: 500 },
    );
  }
}
