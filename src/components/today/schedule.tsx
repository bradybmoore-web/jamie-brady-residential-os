"use client";

import { useState, useTransition } from "react";
import { CalendarClock, MapPin, Sparkles, X } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { prepareAppointmentAction } from "@/app/actions/appointments";
import { APPOINTMENT_TYPE_LABELS, type AppointmentPrep, type CalendarEvent } from "@/lib/types";
import { formatTime } from "@/lib/utils";

export interface ScheduleItem {
  event: CalendarEvent;
  attendees: string[];
  listingAddress: string | null;
  prep: AppointmentPrep | null;
}

export function TodaySchedule({ items }: { items: ScheduleItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing on the calendar today"
          description="A clear day is the best day to work the follow-up list on the left."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <ScheduleRow key={item.event.id} item={item} />
      ))}
    </div>
  );
}

function ScheduleRow({ item }: { item: ScheduleItem }) {
  const [prep, setPrep] = useState<AppointmentPrep | null>(item.prep);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const prepare = () => {
    if (prep) {
      setOpen(true);
      return;
    }
    startTransition(async () => {
      const result = await prepareAppointmentAction(item.event.id);
      if (result.ok && result.data) {
        setPrep(result.data.prep);
        setOpen(true);
      } else if (!result.ok) {
        setError(result.error);
      }
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
        <div className="tabular w-[86px] shrink-0">
          <div className="text-[14px] font-semibold text-ink">{formatTime(item.event.startsAt)}</div>
          <div className="text-[11.5px] text-ink-faint">to {formatTime(item.event.endsAt)}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-medium text-ink">{item.event.title}</h3>
            <Badge tone="outline">{APPOINTMENT_TYPE_LABELS[item.event.type]}</Badge>
            {prep ? <Badge tone="good">Prepared</Badge> : null}
          </div>

          {item.attendees.length > 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-muted">With {item.attendees.join(", ")}</p>
          ) : null}

          {item.event.location ? (
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
              <MapPin className="size-3.5" strokeWidth={1.75} aria-hidden />
              {item.event.location}
            </p>
          ) : null}

          {error ? <p className="mt-2 text-[12px] text-urgent">{error}</p> : null}
        </div>

        <Button size="sm" variant={prep ? "secondary" : "primary"} onClick={prepare} disabled={pending} className="shrink-0">
          <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
          {pending ? "Preparing…" : prep ? "View Prep" : "Prepare Me"}
        </Button>
      </div>

      {open && prep ? <PrepPanel prep={prep} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function PrepPanel({ prep, onClose }: { prep: AppointmentPrep; onClose: () => void }) {
  return (
    <div className="border-t border-line bg-surface-sunk/40 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="eyebrow flex items-center gap-1.5">
          <CalendarClock className="size-3" strokeWidth={2} aria-hidden />
          Appointment preparation
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preparation"
          className="text-ink-faint transition-colors hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-ink">{prep.contactSummary}</p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <PrepList title="Talking points" items={prep.talkingPoints} emphasise />
        <PrepList title="Ask them" items={prep.outstandingQuestions} />
        <PrepList title="Known goals" items={prep.knownGoals} />
        <PrepList title="Recent communication" items={prep.recentCommunication} />
        <PrepList title="Prior notes" items={prep.priorNotes} />
      </div>

      {prep.evidence.length > 0 ? (
        <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-ink-faint">
          Built from {prep.evidence.length} record{prep.evidence.length === 1 ? "" : "s"}:{" "}
          {prep.evidence.map((e) => e.label).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function PrepList({ title, items, emphasise }: { title: string; items: string[]; emphasise?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="eyebrow">{title}</div>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li
            key={i}
            className={`text-[12.5px] leading-relaxed ${emphasise ? "text-ink" : "text-ink-muted"} before:mr-1.5 before:text-ink-faint before:content-['—']`}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
