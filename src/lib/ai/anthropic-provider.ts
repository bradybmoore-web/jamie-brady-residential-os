import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import {
  extractJson,
  type AIContentBlock,
  type AIMessage,
  type AIProvider,
  type AIResult,
  type StructuredGenerationRequest,
  type TextGenerationRequest,
  type ToolExecutor,
  type ToolLoopRequest,
  type ToolLoopResult,
  type ToolLoopStep,
} from "./provider";

const MAX_TOOL_ITERATIONS = 6;

/**
 * Claude-backed provider.
 *
 * Every entry point degrades to the caller's deterministic fallback rather than
 * throwing. A transient model failure should never take a screen down — Jamie
 * still gets the templated version and the run is recorded with the error.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateText(req: TextGenerationRequest): Promise<AIResult<string>> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
        system: req.system,
        messages: [{ role: "user", content: buildUserPrompt(req.prompt, req.facts) }],
      });
      const text = textOf(response.content);
      if (!text.trim()) throw new Error("Empty response from model");
      return {
        value: text.trim(),
        usage: { tokensIn: response.usage?.input_tokens, tokensOut: response.usage?.output_tokens },
        usedFallback: false,
        model: this.model,
        provider: this.name,
      };
    } catch (error) {
      return {
        value: req.fallback(),
        usage: {},
        usedFallback: true,
        model: this.model,
        provider: this.name,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateStructured<T>(req: StructuredGenerationRequest<T>): Promise<AIResult<T>> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        system: `${req.system}\n\nRespond with a single JSON object and nothing else. No prose, no code fence.`,
        messages: [{ role: "user", content: buildUserPrompt(req.prompt, req.facts) }],
      });
      const parsed = req.schema.parse(extractJson(textOf(response.content)));
      return {
        value: parsed,
        usage: { tokensIn: response.usage?.input_tokens, tokensOut: response.usage?.output_tokens },
        usedFallback: false,
        model: this.model,
        provider: this.name,
      };
    } catch (error) {
      return {
        value: req.fallback(),
        usage: {},
        usedFallback: true,
        model: this.model,
        provider: this.name,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async runToolLoop(req: ToolLoopRequest, execute: ToolExecutor): Promise<ToolLoopResult> {
    const messages: Anthropic.MessageParam[] = req.messages.map(toAnthropicMessage);
    const steps: ToolLoopStep[] = [];
    let tokensIn = 0;
    let tokensOut = 0;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 2048,
        system: req.system,
        messages,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
      });
      tokensIn += response.usage?.input_tokens ?? 0;
      tokensOut += response.usage?.output_tokens ?? 0;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
        return {
          text: textOf(response.content).trim(),
          steps,
          usage: { tokensIn, tokensOut },
          model: this.model,
          provider: this.name,
        };
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const input = (use.input ?? {}) as Record<string, unknown>;
        try {
          const output = await execute(use.name, input);
          steps.push({ toolName: use.name, input, output });
          results.push({ type: "tool_result", tool_use_id: use.id, content: output });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          steps.push({ toolName: use.name, input, output: message, isError: true });
          results.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }

    return {
      text: "I gathered what I could but ran out of steps before finishing. Ask me something narrower and I will get further.",
      steps,
      usage: { tokensIn, tokensOut },
      model: this.model,
      provider: this.name,
    };
  }
}

function textOf(content: Anthropic.ContentBlock[]) {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Facts are handed to the model inside a clearly delimited block. The system
 * prompt tells it these are the only facts it may use.
 */
function buildUserPrompt(prompt: string, facts: Record<string, unknown>) {
  return `${prompt}\n\n<facts>\n${JSON.stringify(facts, null, 2)}\n</facts>`;
}

function toAnthropicMessage(message: AIMessage): Anthropic.MessageParam {
  return {
    role: message.role,
    content: message.content.map(toAnthropicBlock),
  };
}

function toAnthropicBlock(block: AIContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
  }
}

export function createAnthropicProvider(): AnthropicProvider | null {
  if (!env.anthropicApiKey) return null;
  return new AnthropicProvider(env.anthropicApiKey, env.anthropicModel);
}
