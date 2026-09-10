import type { ZodType } from "zod";
import type { AIWorkflowName } from "@/lib/types";

/**
 * Provider-neutral AI interface.
 *
 * The application never imports the Anthropic SDK directly. Swapping providers,
 * or running with no provider at all, is a change to `getProvider()` only.
 *
 * Design rule enforced throughout: *the model writes language, not facts*.
 * Scoring, ranking, evidence gathering and metrics are deterministic TypeScript.
 * The model is asked to phrase things. That is why every request carries a
 * `fallback` — the deterministic version of the same output, which is what runs
 * when no API key is configured, and what we fall back to if a call fails.
 */

export type AIContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface AIMessage {
  role: "user" | "assistant";
  content: AIContentBlock[];
}

export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GenerationRequest {
  workflow: AIWorkflowName;
  /** Identifies the specific generation, e.g. `marketing:instagram_caption`. */
  task: string;
  promptVersion: string;
  system: string;
  prompt: string;
  /**
   * The grounded facts handed to the model. Recorded on the AI run so any
   * output can be traced back to exactly what the model was allowed to see.
   */
  facts: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface TextGenerationRequest extends GenerationRequest {
  fallback: () => string;
}

export interface StructuredGenerationRequest<T> extends GenerationRequest {
  schema: ZodType<T>;
  fallback: () => T;
}

export interface ToolLoopRequest {
  workflow: AIWorkflowName;
  promptVersion: string;
  system: string;
  messages: AIMessage[];
  tools: AIToolDefinition[];
  maxTokens?: number;
}

export interface AIUsage {
  tokensIn?: number;
  tokensOut?: number;
}

export interface AIResult<T> {
  value: T;
  usage: AIUsage;
  /** True when the deterministic fallback produced this rather than a model. */
  usedFallback: boolean;
  model: string;
  provider: "anthropic" | "mock";
  error?: string;
}

export interface ToolLoopStep {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  isError?: boolean;
}

export interface ToolLoopResult {
  text: string;
  steps: ToolLoopStep[];
  usage: AIUsage;
  model: string;
  provider: "anthropic" | "mock";
}

export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

export interface AIProvider {
  readonly name: "anthropic" | "mock";
  readonly model: string;
  generateText(req: TextGenerationRequest): Promise<AIResult<string>>;
  generateStructured<T>(req: StructuredGenerationRequest<T>): Promise<AIResult<T>>;
  runToolLoop(req: ToolLoopRequest, execute: ToolExecutor): Promise<ToolLoopResult>;
}

/** Pull the first JSON object or array out of a model response. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Models occasionally wrap JSON in a sentence. Take the outermost braces.
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start === -1 || end <= start) throw new Error("No JSON found in model response");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}
