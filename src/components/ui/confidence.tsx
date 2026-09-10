import { cn } from "@/lib/utils";

/**
 * Confidence is rendered as a discrete four-step meter rather than a
 * percentage. A model that says "82%" invites false precision; four steps say
 * "how much would I bet on this", which is the actual question.
 */
export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const steps = Math.max(1, Math.min(4, Math.ceil(value * 4)));
  const label = ["Low", "Moderate", "Good", "Strong"][steps - 1];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={`Confidence: ${label}`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("h-2.5 w-1 rounded-[1px]", i <= steps ? "bg-brass" : "bg-line-strong")}
          />
        ))}
      </span>
      <span className="text-[11px] text-ink-faint">{label} confidence</span>
    </span>
  );
}
