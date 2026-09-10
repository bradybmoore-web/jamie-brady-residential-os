import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined, opts?: { compact?: boolean }) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: opts?.compact ? "compact" : "standard",
  }).format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

/** Dates are stored as ISO strings; render them in the team's timezone. */
export const TEAM_TIME_ZONE = "America/Chicago";

export function formatDate(iso: string | null | undefined, style: "short" | "medium" | "long" = "medium") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "numeric", day: "numeric" }
      : style === "long"
        ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: TEAM_TIME_ZONE }).format(d);
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TEAM_TIME_ZONE,
  }).format(d);
}

export function daysBetween(from: string | Date, to: string | Date = new Date()) {
  const a = typeof from === "string" ? new Date(from) : from;
  const b = typeof to === "string" ? new Date(to) : to;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function daysAgo(iso: string | null | undefined) {
  if (!iso) return null;
  const n = daysBetween(iso);
  return Number.isFinite(n) ? n : null;
}

export function relativeDays(iso: string | null | undefined) {
  const n = daysAgo(iso);
  if (n === null) return "no record";
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 0) return `in ${Math.abs(n)} days`;
  return `${n} days ago`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function pluralize(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Same day in the team's timezone. */
export function isSameLocalDay(a: string | Date, b: string | Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TIME_ZONE });
  return fmt.format(new Date(a)) === fmt.format(new Date(b));
}

export function localDayKey(d: string | Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TIME_ZONE }).format(new Date(d));
}

export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build an ISO instant for a wall-clock time in the team's timezone, offset by
 * `dayOffset` days from today. Seed data and workflow scheduling both need
 * "3pm Austin time today" to be correct regardless of the server's timezone.
 */
export function teamDayAt(dayOffset: number, hour: number, minute = 0, from: Date = new Date()) {
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TIME_ZONE }).format(
    new Date(from.getTime() + dayOffset * 86_400_000),
  );
  const [y, m, d] = dayKey.split("-").map(Number);
  // Guess UTC, measure how the zone renders it, then correct by the delta.
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const rendered = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(rendered.find((p) => p.type === t)?.value ?? 0);
  const renderedUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return new Date(guess + (guess - renderedUtc)).toISOString();
}

/** ISO instant `days` days before now (fractional days allowed). */
export function daysBeforeNow(days: number, from: Date = new Date()) {
  return new Date(from.getTime() - days * 86_400_000).toISOString();
}
