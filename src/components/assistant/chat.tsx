"use client";

import { useRef, useState } from "react";
import { ArrowUp, ChevronDown, Wrench } from "lucide-react";
import { Badge, Button, Card, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface ToolStep {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  steps?: ToolStep[];
}

export function AssistantChat({
  suggestions,
  usingMockAI,
}: {
  suggestions: string[];
  usingMockAI: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    const next: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((t) => ({ role: t.role, content: t.content })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The assistant could not answer that.");
      setTurns([...next, { role: "assistant", content: data.reply, steps: data.steps ?? [] }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 ? (
        <Card className="px-5 py-6">
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            Ask about anything in the business. The assistant reads your real records through the same tools the
            rest of the product uses — it does not answer from memory.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-[4px] border border-line-strong bg-surface px-2.5 py-1.5 text-left text-[12.5px] text-ink-muted transition-colors hover:border-brass/50 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
          {usingMockAI ? (
            <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-faint">
              No Anthropic key is configured. Questions are routed to the matching tools by keyword and the
              results are shown directly — accurate, but not conversational. Connect Claude in Settings for the
              real thing.
            </p>
          ) : null}
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[75%] rounded-[6px] bg-ink px-4 py-2.5 text-[13.5px] leading-relaxed text-white">
                  {turn.content}
                </div>
              </div>
            ) : (
              <Card key={i} className="rise px-5 py-4">
                {turn.steps && turn.steps.length > 0 ? <ToolTrace steps={turn.steps} /> : null}
                <div className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                  {stripMarkdownBold(turn.content)}
                </div>
              </Card>
            ),
          )}
          {busy ? (
            <Card className="px-5 py-4">
              <p className="text-[13px] text-ink-faint">Reading your records…</p>
            </Card>
          ) : null}
          <div ref={endRef} />
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded-[4px] bg-urgent-soft px-3 py-2 text-[12.5px] text-urgent">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4"
      >
        <div className="flex items-end gap-2 rounded-[6px] border border-line-strong bg-surface p-2 shadow-[0_2px_8px_rgba(28,27,25,0.05)]">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about your leads, listings, buyers, calendar or relationships…"
            aria-label="Ask the assistant"
            className="min-h-[38px] resize-none border-0 bg-transparent p-1.5"
          />
          <Button type="submit" variant="primary" size="sm" disabled={busy || !input.trim()} aria-label="Send">
            <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden />
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * What the assistant actually looked at.
 *
 * Shown by default rather than hidden behind a toggle: if Jamie is going to act
 * on an answer, she should be able to see which records produced it.
 */
function ToolTrace({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 border-b border-line pb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <Wrench className="size-3 text-ink-faint" strokeWidth={2} aria-hidden />
        <span className="eyebrow">Looked at</span>
        <span className="flex flex-wrap gap-1">
          {steps.map((s, i) => (
            <Badge key={i} tone={s.isError ? "urgent" : "outline"} className="normal-case tracking-normal">
              {s.toolName}
            </Badge>
          ))}
        </span>
        <ChevronDown
          className={cn("ml-auto size-3 text-ink-faint transition-transform", open && "rotate-180")}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {steps.map((s, i) => (
            <div key={i}>
              <div className="font-mono text-[11px] text-ink-faint">
                {s.toolName}({Object.keys(s.input).length > 0 ? JSON.stringify(s.input) : ""})
              </div>
              <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-[4px] bg-surface-sunk px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-muted">
                {s.output}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The tool output uses **bold** markers; render them as plain text rather than pulling in a markdown renderer. */
function stripMarkdownBold(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}
