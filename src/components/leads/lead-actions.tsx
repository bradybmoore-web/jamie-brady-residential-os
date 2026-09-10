"use client";

import { useState, useTransition } from "react";
import { PhoneOff, Sparkles, UserCheck } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { analyzeLeadAction, recordLeadAttemptAction, updateLeadStageAction } from "@/app/actions/leads";
import { LEAD_STAGES, LEAD_STAGE_LABELS, type LeadStage } from "@/lib/types";

export function LeadActions({ leadId, stage }: { leadId: string; stage: LeadStage }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? (result.message ?? "Done.") : (result.error ?? "Something went wrong."));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => analyzeLeadAction(leadId))}>
          <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
          {pending ? "Working…" : "Re-analyse"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => recordLeadAttemptAction(leadId, "connected"))}
        >
          <UserCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
          Connected
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => recordLeadAttemptAction(leadId, "no_answer"))}
        >
          <PhoneOff className="size-3.5" strokeWidth={1.75} aria-hidden />
          No answer
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="stage" className="eyebrow mb-0">
          Stage
        </label>
        <Select
          id="stage"
          defaultValue={stage}
          disabled={pending}
          onChange={(e) => run(() => updateLeadStageAction(leadId, e.target.value))}
        >
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {message ? <p className="text-[12.5px] text-brass">{message}</p> : null}
    </div>
  );
}
