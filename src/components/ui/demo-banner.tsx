import { TriangleAlert } from "lucide-react";

/**
 * The demo-data banner.
 *
 * Rendered on every screen that aggregates records rather than listing them
 * individually — Today, Opportunities, Marketing, Approvals — where a per-row
 * "Demo" chip either has nowhere to sit or is easy to miss. The rule this
 * serves: no screen may present mocked data as real.
 */
export function DemoDataBanner({ present, context }: { present: boolean; context?: string }) {
  if (!present) return null;
  return (
    <div
      role="note"
      className="mt-5 flex items-start gap-2.5 rounded-[6px] border border-[#d8c89f] bg-warn-soft px-4 py-3"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
      <p className="text-[12.5px] leading-relaxed text-warn">
        <strong className="font-semibold">This is demo data.</strong> The people, properties and activity
        shown here are fictional seed records, not real clients.
        {context ? ` ${context}` : ""} Rows drawn from seed data are marked{" "}
        <span className="mx-0.5 inline-flex items-center rounded-[3px] border border-line-strong bg-surface px-1 py-px align-middle text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Demo
        </span>
        . Connect Supabase and Cloze to work from the real database.
      </p>
    </div>
  );
}
