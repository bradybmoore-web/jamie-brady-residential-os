"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, Mail, Plus, User } from "lucide-react";
import { Badge, Button, Card, UrgencyDot, buttonClasses } from "@/components/ui/primitives";
import { createTaskAction, dismissPriorityAction } from "@/app/actions/tasks";
import { CHANNEL_LABELS, type Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

const URGENCY_TONE = {
  critical: "urgent",
  high: "warn",
  medium: "brass",
  low: "neutral",
} as const;

/**
 * One person who needs Jamie today.
 *
 * The card leads with *why*, not what — the reason and its evidence are the
 * reason to trust the ranking. The suggested opener is right there because the
 * hardest part of the call is the first sentence.
 */
export function PriorityCard({ priority, rank }: { priority: Priority; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const markDone = () => {
    startTransition(async () => {
      const [, id] = priority.id.split(":");
      const result = await dismissPriorityAction({
        priorityKey: priority.id,
        personId: priority.personId ?? null,
        taskId: priority.id.startsWith("task:") ? id : null,
        leadId: priority.id.startsWith("lead:") ? id : null,
      });
      if (result.ok) setDone(true);
      else setNote(result.error);
    });
  };

  const addTask = () => {
    startTransition(async () => {
      const result = await createTaskAction({
        title: priority.recommendedAction,
        detail: priority.reason,
        contactId: priority.personId ?? undefined,
        urgency: priority.urgency,
      });
      setNote(result.ok ? "Added to your task list." : result.error);
    });
  };

  if (done) {
    return (
      <Card className="flex items-center gap-2.5 px-5 py-3 text-[13px] text-ink-muted">
        <Check className="size-3.5 text-good" strokeWidth={2} aria-hidden />
        <span>
          <strong className="font-medium text-ink">{priority.personName ?? priority.title}</strong> — handled.
        </span>
      </Card>
    );
  }

  return (
    <Card className="rise overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-4">
        <span className="tabular mt-0.5 w-4 shrink-0 text-[12px] font-semibold text-ink-faint">{rank}</span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{priority.title}</h3>
            <Badge tone={URGENCY_TONE[priority.urgency]}>
              <UrgencyDot urgency={priority.urgency} />
              {priority.urgency}
            </Badge>
            {priority.relationship ? (
              <span className="text-[12px] text-ink-faint">{priority.relationship}</span>
            ) : null}
          </div>

          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{priority.reason}</p>

          {priority.lastMeaningfulInteraction ? (
            <p className="mt-1 text-[12px] text-ink-faint">
              Last meaningful interaction: {priority.lastMeaningfulInteraction}
            </p>
          ) : null}
        </div>
      </div>

      {/* The recommended action and the words to open with. */}
      <div className="mx-5 mt-3.5 rounded-[4px] border border-line bg-surface-sunk/60 px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">Do this</span>
          <span className="text-[11px] text-ink-faint">· by {CHANNEL_LABELS[priority.recommendedChannel]}</span>
        </div>
        <p className="mt-1 text-[13px] font-medium leading-relaxed text-ink">{priority.recommendedAction}</p>

        {priority.suggestedMessage ? (
          <>
            <div className="eyebrow mt-3">Suggested opener</div>
            <p className="mt-1 border-l-2 border-brass/50 pl-3 text-[13px] italic leading-relaxed text-ink-muted">
              {priority.suggestedMessage}
            </p>
          </>
        ) : null}
      </div>

      {/* Evidence — the whole reason to believe the card. */}
      {priority.evidence.length > 0 ? (
        <div className="mx-5 mt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 text-[11.5px] font-medium text-ink-faint transition-colors hover:text-ink"
          >
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} strokeWidth={2} aria-hidden />
            {expanded ? "Hide" : "Show"} the {priority.evidence.length}{" "}
            {priority.evidence.length === 1 ? "record" : "records"} behind this
          </button>
          {expanded ? (
            <ul className="mt-2 flex flex-col gap-1.5 border-l border-line pl-3">
              {priority.evidence.map((e, i) => (
                <li key={`${e.recordType}-${e.recordId}-${i}`} className="text-[12px] leading-relaxed">
                  <span className="font-medium text-ink">{e.label}:</span>{" "}
                  <span className="text-ink-muted">{e.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {note ? <p className="mx-5 mt-3 text-[12px] text-brass">{note}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5">
        {priority.personId ? (
          <Link href={`/clients/${priority.personId}`} className={buttonClasses("secondary", "sm")}>
            <User className="size-3.5" strokeWidth={1.75} aria-hidden />
            View Contact
          </Link>
        ) : priority.id.startsWith("lead:") ? (
          <Link href={`/leads/${priority.id.split(":")[1]}`} className={buttonClasses("secondary", "sm")}>
            <User className="size-3.5" strokeWidth={1.75} aria-hidden />
            View Lead
          </Link>
        ) : null}

        <Link
          href={`/approvals/new?${new URLSearchParams({
            contactId: priority.personId ?? "",
            leadId: priority.id.startsWith("lead:") ? priority.id.split(":")[1] : "",
            title: priority.title,
            body: priority.suggestedMessage,
          })}`}
          className={buttonClasses("secondary", "sm")}
        >
          <Mail className="size-3.5" strokeWidth={1.75} aria-hidden />
          Draft Email
        </Link>

        <Button size="sm" variant="secondary" onClick={addTask} disabled={pending}>
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
          Add Task
        </Button>

        <Button size="sm" variant="primary" onClick={markDone} disabled={pending} className="ml-auto">
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
          {pending ? "Saving…" : "Mark Done"}
        </Button>
      </div>
    </Card>
  );
}
