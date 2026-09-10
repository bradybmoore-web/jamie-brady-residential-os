import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * UI primitives.
 *
 * Hand-built rather than pulled from shadcn/ui: these are almost all static
 * presentation, and owning them outright keeps the visual language tight and
 * the dependency tree small. The prop shapes deliberately match shadcn's, so a
 * real Radix component can replace any of these later without touching call
 * sites.
 */

/* ------------------------------------------------------------------ card */

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-[6px] border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-[15px] font-semibold tracking-[-0.01em] text-ink", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-[13px] leading-relaxed text-ink-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 border-t border-line px-5 py-3", className)}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[4px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-[#33312d]",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-sunk",
  ghost: "text-ink-muted hover:bg-surface-sunk hover:text-ink",
  danger: "border border-[#e6c9c4] bg-urgent-soft text-urgent hover:bg-[#f6e2de]",
  link: "text-brass underline-offset-4 hover:underline p-0 h-auto",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-9 px-3.5 text-[13px]",
};

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, variant = "secondary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(BUTTON_BASE, variant !== "link" && BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className)}
      {...props}
    />
  );
}

/* ----------------------------------------------------------------- badge */

type BadgeTone = "neutral" | "brass" | "urgent" | "warn" | "good" | "info" | "outline";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunk text-ink-muted",
  brass: "bg-brass-soft text-brass",
  urgent: "bg-urgent-soft text-urgent",
  warn: "bg-warn-soft text-warn",
  good: "bg-good-soft text-good",
  info: "bg-info-soft text-info",
  outline: "border border-line-strong text-ink-muted",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.07em]",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ text */

export function Eyebrow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("eyebrow", className)} {...props} />;
}

export function PageTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn("display text-[28px] leading-tight text-ink", className)} {...props} />;
}

export function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2 className={cn("text-[13px] font-semibold uppercase tracking-[0.09em] text-ink-faint", className)} {...props} />
  );
}

/* ------------------------------------------------------------- form bits */

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-[4px] border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-faint",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[4px] border border-line-strong bg-surface p-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 rounded-[4px] border border-line-strong bg-surface px-2 text-[13px] text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("eyebrow mb-1.5 block", className)} {...props} />;
}

/* --------------------------------------------------------------- layout */

export function Separator({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="separator" className={cn("h-px w-full bg-line", className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {description ? <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[3px] bg-surface-sunk", className)} />;
}

/* ----------------------------------------------------------------- table */

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-line px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-faint",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-3 py-2.5 align-top text-ink", className)} {...props} />;
}

/* ------------------------------------------------------------ indicators */

export function UrgencyDot({ urgency }: { urgency: "low" | "medium" | "high" | "critical" }) {
  const color =
    urgency === "critical"
      ? "bg-urgent"
      : urgency === "high"
        ? "bg-warn"
        : urgency === "medium"
          ? "bg-brass"
          : "bg-line-strong";
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", color)} />;
}

export function SeedMarker({ className }: { className?: string }) {
  return (
    <span
      title="Demo record. Not production data."
      className={cn(
        "inline-flex items-center rounded-[3px] border border-line-strong px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint",
        className,
      )}
    >
      Demo
    </span>
  );
}

/** A small labelled figure, used across the metric strips. */
export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "urgent" | "warn" | "good";
  hint?: string;
}) {
  const valueColor =
    tone === "urgent" ? "text-urgent" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink";
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="eyebrow">{label}</span>
      <span className={cn("tabular text-[24px] font-semibold leading-none", valueColor)}>{value}</span>
      {hint ? <span className="text-[11.5px] text-ink-faint">{hint}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------ link button */

/**
 * A link styled as a button. Kept separate from `Button` rather than using an
 * `asChild` polymorphic prop — navigation and actions behave differently
 * enough (prefetch, middle-click, keyboard) that conflating them causes bugs.
 */
export function LinkButton({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: React.ComponentProps<"a"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <a
      className={cn(BUTTON_BASE, variant !== "link" && BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className)}
      {...props}
    />
  );
}

export const buttonClasses = (variant: ButtonVariant = "secondary", size: ButtonSize = "md") =>
  cn(BUTTON_BASE, variant !== "link" && BUTTON_SIZES[size], BUTTON_VARIANTS[variant]);
