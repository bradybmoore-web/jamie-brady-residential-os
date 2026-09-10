import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { ApprovalQueue } from "@/components/approvals/queue";
import { Card, CardContent, PageTitle, SectionTitle, Stat } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  await requireSession();
  const store = await getStore();
  const actions = await store.listAIActions();

  const waiting = actions.filter((a) => a.status === "needs_review" || a.status === "draft");
  const approved = actions.filter((a) => a.status === "approved");
  const settled = actions.filter((a) => a.status === "executed" || a.status === "rejected").slice(0, 10);

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Nothing goes out without you</p>
        <PageTitle className="mt-1.5">Approvals</PageTitle>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          Anything the system writes that would reach a client waits here. It can read, summarise, prioritise and
          draft on its own. Sending, publishing, changing a CRM stage, or moving an appointment needs your hand on
          it.
        </p>
      </header>

      <Card className="mt-6 overflow-hidden">
        <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
          <Stat label="Waiting on you" value={waiting.length} tone={waiting.length > 0 ? "warn" : "neutral"} />
          <Stat label="Approved, not sent" value={approved.length} />
          <Stat label="Handled" value={actions.filter((a) => a.status === "executed").length} tone="good" />
        </div>
      </Card>

      <section className="mt-7">
        <SectionTitle>Waiting for review</SectionTitle>
        <div className="mt-3">
          <ApprovalQueue items={waiting} />
        </div>
      </section>

      {approved.length > 0 ? (
        <section className="mt-8">
          <SectionTitle>Approved, ready to send</SectionTitle>
          <div className="mt-3">
            <ApprovalQueue items={approved} />
          </div>
        </section>
      ) : null}

      {settled.length > 0 ? (
        <section className="mt-8">
          <SectionTitle>Recently handled</SectionTitle>
          <Card className="mt-3">
            <CardContent className="pt-4">
              <ul className="flex flex-col divide-y divide-line">
                {settled.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="truncate text-[12.5px] text-ink">{a.title}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">
                      {a.status === "executed" ? "Sent" : "Rejected"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
