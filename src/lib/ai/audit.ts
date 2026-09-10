import "server-only";
import type { DataStore } from "@/lib/data/store";
import type { AIRun, AIWorkflowName, UUID } from "@/lib/types";
import type { AIUsage } from "./provider";
import type { EvidenceLedger } from "./grounding";

/**
 * Every workflow run is recorded. The point is that an AI recommendation in
 * this product is never a black box: for any card on screen you can see which
 * workflow produced it, from which prompt version, on which model, over which
 * records, and how confident it was.
 */
export interface RecordRunInput {
  store: DataStore;
  workflow: AIWorkflowName;
  promptVersion: string;
  model: string;
  provider: "anthropic" | "mock";
  ledger: EvidenceLedger;
  ownerId: UUID;
  startedAt: number;
  outputSummary: string;
  usage?: AIUsage;
  error?: string;
}

export async function recordRun(input: RecordRunInput): Promise<AIRun> {
  return input.store.createAIRun({
    workflow: input.workflow,
    promptVersion: input.promptVersion,
    model: input.model,
    provider: input.provider,
    inputRecordIds: input.ledger.inputRecordIds(),
    status: input.error ? "error" : "success",
    latencyMs: Math.max(0, Math.round(performance.now() - input.startedAt)),
    tokensIn: input.usage?.tokensIn ?? null,
    tokensOut: input.usage?.tokensOut ?? null,
    error: input.error ?? null,
    outputSummary: input.outputSummary,
    startedAt: new Date(Date.now() - Math.round(performance.now() - input.startedAt)).toISOString(),
    ownerId: input.ownerId,
    sourceSystem: "ai",
  });
}

export async function audit(
  store: DataStore,
  entry: {
    actorId: UUID;
    actorType: "user" | "ai" | "system";
    action: string;
    entityType: string;
    entityId: UUID;
    metadata?: Record<string, unknown>;
  },
) {
  return store.appendAudit({
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata ?? {},
    sourceSystem: entry.actorType === "ai" ? "ai" : "manual",
  });
}
