import type {
  AIProvider,
  AIResult,
  StructuredGenerationRequest,
  TextGenerationRequest,
  ToolExecutor,
  ToolLoopRequest,
  ToolLoopResult,
  ToolLoopStep,
} from "./provider";

/**
 * The provider used when no `ANTHROPIC_API_KEY` is configured.
 *
 * It does not pretend to be a model. It returns the deterministic fallback that
 * every call site is required to supply — a template built from the same
 * grounded facts the model would have received. The result is that the whole
 * product is demonstrable offline, and that nothing on screen is ever invented.
 *
 * The UI labels output from this provider so it is never mistaken for the real
 * thing.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock" as const;
  readonly model = "deterministic-fallback";

  async generateText(req: TextGenerationRequest): Promise<AIResult<string>> {
    return {
      value: req.fallback(),
      usage: {},
      usedFallback: true,
      model: this.model,
      provider: this.name,
    };
  }

  async generateStructured<T>(req: StructuredGenerationRequest<T>): Promise<AIResult<T>> {
    return {
      value: req.fallback(),
      usage: {},
      usedFallback: true,
      model: this.model,
      provider: this.name,
    };
  }

  /**
   * A keyword router over the same tool registry the real model uses. It picks
   * the tools whose names or descriptions best match the question, runs them,
   * and reports what it found. Not clever — but it exercises the real tools
   * against real data, so the Assistant screen genuinely answers questions.
   */
  async runToolLoop(req: ToolLoopRequest, execute: ToolExecutor): Promise<ToolLoopResult> {
    const question = lastUserText(req).toLowerCase();
    const chosen = pickTools(question, req.tools.map((t) => t.name));
    const steps: ToolLoopStep[] = [];

    for (const name of chosen) {
      const input = inferInput(name, question);
      try {
        const output = await execute(name, input);
        steps.push({ toolName: name, input, output });
      } catch (error) {
        steps.push({
          toolName: name,
          input,
          output: error instanceof Error ? error.message : String(error),
          isError: true,
        });
      }
    }

    return {
      text: composeAnswer(question, steps),
      steps,
      usage: {},
      model: this.model,
      provider: this.name,
    };
  }
}

function lastUserText(req: ToolLoopRequest) {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const message = req.messages[i];
    if (message.role !== "user") continue;
    const text = message.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    if (text) return text;
  }
  return "";
}

/** Keyword → tool routing table. Order matters: first match wins per group. */
const ROUTES: { match: RegExp; tools: string[] }[] = [
  // Ordered most specific first, and each pattern is anchored on words that
  // only appear when that really is the question being asked. Two tools is the
  // cap per answer — a keyword router that fires four tools produces a wall of
  // output rather than an answer.
  { match: /\b(cold|going cold|lost touch|slipping|haven'?t (talked|spoken|heard))\b/, tools: ["getOpportunities"] },
  { match: /\b(unanswered|no reply|not replied|haven'?t replied|inbox)\b/, tools: ["searchEmails"] },
  { match: /\b(buyers?|pool|bedrooms?|price range)\b/, tools: ["getBuyers"] },
  { match: /\b(leads?|inquir(y|ies|ed))\b/, tools: ["getLeads"] },
  { match: /\b(prepare|appointment|meeting|schedule|calendar|today'?s events)\b/, tools: ["getCalendarEvents"] },
  { match: /\b(transactions?|closing|under contract|option period)\b/, tools: ["getTransactions"] },
  { match: /\b(listings?|lothian|brackenridge|american|cavalier|pecan|pending|coming soon)\b/, tools: ["getListings"] },
  { match: /\b(marketing|caption|instagram|social|hashtags?)\b/, tools: ["getListings"] },
  { match: /\b(who should|call today|priorit|needs? (me|you|attention))\b/, tools: ["getDailyPriorities"] },
  { match: /\b(tasks?|to.?dos?|overdue|due)\b/, tools: ["getTasks"] },
  { match: /\b(follow.?up)\b/, tools: ["getOpportunities"] },
  { match: /\b(contacts?|database|sphere|past clients?)\b/, tools: ["searchContacts"] },
];

function pickTools(question: string, available: string[]): string[] {
  const picked: string[] = [];
  for (const route of ROUTES) {
    if (!route.match.test(question)) continue;
    for (const tool of route.tools) {
      if (available.includes(tool) && !picked.includes(tool)) picked.push(tool);
    }
  }
  if (picked.length === 0) {
    // Nothing matched: give the broadest useful view.
    for (const tool of ["getDailyPriorities", "getOpportunities"]) {
      if (available.includes(tool)) picked.push(tool);
    }
  }
  return picked.slice(0, 2);
}

function inferInput(tool: string, question: string): Record<string, unknown> {
  if (tool === "searchContacts") {
    const area = question.match(/\bfrom ([a-z ]{3,25})\b/)?.[1]?.trim();
    return { query: area ?? question.slice(0, 60) };
  }
  if (tool === "searchEmails") return { query: question.slice(0, 60), awaitingReplyOnly: /unanswered|no reply|haven'?t replied/.test(question) };
  if (tool === "getListings") {
    const address = question.match(/\b(lothian|brackenridge|american|cavalier|pecan)\b/)?.[1];
    return address ? { query: address } : {};
  }
  if (tool === "getBuyers") return { requirement: /pool/.test(question) ? "pool" : undefined };
  return {};
}

function composeAnswer(question: string, steps: ToolLoopStep[]) {
  const header =
    "No Anthropic API key is configured, so this answer is assembled directly from your data rather than written by a model.";
  if (steps.length === 0) {
    return `${header}\n\nI could not match that question to any of the available tools. Try asking about today's priorities, leads, listings, buyers, or relationships going cold.`;
  }
  const body = steps
    .map((s) => `**${s.toolName}**\n\n${s.output}`)
    .join("\n\n---\n\n");
  return `${header}\n\n${body}`;
}
