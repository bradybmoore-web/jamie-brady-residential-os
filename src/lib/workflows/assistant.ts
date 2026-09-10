import "server-only";
import { getProvider } from "@/lib/ai";
import { recordRun } from "@/lib/ai/audit";
import { EvidenceLedger } from "@/lib/ai/grounding";
import { executeTool, toolDefinitions } from "@/lib/ai/tools";
import { getStore } from "@/lib/data/store";
import type { AIMessage, ToolLoopStep } from "@/lib/ai/provider";
import type { UUID } from "@/lib/types";

export const ASSISTANT_PROMPT_VERSION = "assistant@2";

const SYSTEM = `You are the assistant inside Jamie & Brady Moore's Residential OS, a private operating system for their
luxury residential real estate team in Austin, Texas. Jamie is the primary user.

You have tools that read her real book of business: contacts, leads, listings, buyers, tasks, calendar,
email, transactions and market comparables. Use them. Never answer a question about her data from memory or
assumption — call a tool and answer from what comes back.

How to work:
- Call the tools you need before answering. Several at once is fine.
- If a tool returns nothing, say so plainly rather than filling the gap.
- Cite the specifics: names, dates, numbers, addresses. Jamie will act on this.
- Be brief. She is reading between appointments. Lead with the answer, then the evidence.
- Use plain prose and short lists. No headers unless the answer genuinely has sections.

Hard limits:
- You cannot send email or text messages. \`draftEmail\` creates a draft for her to review and send herself.
  Never say you sent anything.
- You cannot change CRM stages, delete records, publish marketing, or move appointments.
- MLS data is currently a mock feed, not licensed data. Say so whenever you use it for comparables.
- Never invent a showing, an offer, a price, a market statistic, or something a client said. If you do not
  have it, say you do not have it.`;

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantResult {
  reply: string;
  steps: ToolLoopStep[];
  provider: "anthropic" | "mock";
  aiRunId: UUID;
}

/**
 * Workflow 6 — the AI Assistant.
 *
 * A tool-calling loop over the shared registry. The orchestration lives in the
 * provider (`runToolLoop`), so the same conversation works against Claude or
 * against the deterministic keyword router when no key is present.
 */
export async function runAssistant(
  history: AssistantTurn[],
  ownerId: UUID,
): Promise<AssistantResult> {
  const store = await getStore();
  const startedAt = performance.now();
  const provider = await getProvider();

  const messages: AIMessage[] = history
    .filter((t) => t.content.trim().length > 0)
    .map((t) => ({ role: t.role, content: [{ type: "text" as const, text: t.content }] }));

  if (messages.length === 0) {
    throw new Error("Ask a question to get started.");
  }

  const result = await provider.runToolLoop(
    {
      workflow: "assistant",
      promptVersion: ASSISTANT_PROMPT_VERSION,
      system: SYSTEM,
      messages,
      tools: toolDefinitions(),
      maxTokens: 2048,
    },
    (name, input) => executeTool(name, input, { ownerId }),
  );

  // The ledger for an assistant turn is the set of tools it actually ran —
  // that is the honest record of what it looked at.
  const ledger = new EvidenceLedger();
  for (const step of result.steps) {
    ledger.allow("task", deterministicToolId(step.toolName), `Tool ${step.toolName}`);
  }

  const run = await recordRun({
    store,
    workflow: "assistant",
    promptVersion: ASSISTANT_PROMPT_VERSION,
    model: result.model,
    provider: result.provider,
    ledger,
    ownerId,
    startedAt,
    usage: result.usage,
    outputSummary: `${history.at(-1)?.content.slice(0, 120) ?? "question"} → ${result.steps.length} tool call(s)`,
  });

  return { reply: result.text, steps: result.steps, provider: result.provider, aiRunId: run.id };
}

/**
 * A stable pseudo-id per tool so the ledger has something to key on. Tool calls
 * are not records, but the audit trail should still show what ran.
 */
function deterministicToolId(toolName: string): UUID {
  let hash = 0;
  for (let i = 0; i < toolName.length; i++) hash = (hash * 31 + toolName.charCodeAt(i)) >>> 0;
  const hex = hash.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-000000000000`;
}

/** Starter prompts shown on an empty assistant screen. */
export const SUGGESTED_QUESTIONS = [
  "Who should I call today?",
  "Which relationships are going cold?",
  "Which active buyers want a pool?",
  "Find everyone thinking about moving from Cedar Park.",
  "Prepare me for today's listing appointment.",
  "What is happening with 2700 Lothian?",
  "Which emails have I not answered?",
  "Create social marketing for Brackenridge.",
  "Who in our database might know a buyer for Lothian?",
  "What is due on my open transactions?",
];
