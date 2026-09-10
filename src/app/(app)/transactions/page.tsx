import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageTitle,
  SectionTitle,
  SeedMarker,
  Stat,
} from "@/components/ui/primitives";
import { contactName, type Transaction } from "@/lib/types";
import { daysBetween, formatCurrency, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<Transaction["status"], string> = {
  under_contract: "Under Contract",
  option_period: "Option Period",
  financing: "Financing",
  clear_to_close: "Clear to Close",
  closed: "Closed",
  terminated: "Terminated",
};

export default async function TransactionsPage() {
  await requireSession();
  const store = await getStore();
  const [transactions, properties, contacts] = await Promise.all([
    store.listTransactions(),
    store.listProperties(),
    store.listContacts(),
  ]);
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const now = new Date();
  const open = transactions.filter((t) => t.status !== "closed" && t.status !== "terminated");
  const settled = transactions.filter((t) => t.status === "closed" || t.status === "terminated");
  const volume = open.reduce((sum, t) => sum + t.contractPrice, 0);
  const urgent = open.filter((t) =>
    t.milestones.some((m) => !m.complete && daysBetween(m.dueAt, now) >= -2),
  ).length;

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Under contract</p>
        <PageTitle className="mt-1.5">Transactions</PageTitle>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          Every open contract and what is due next on it.
        </p>
      </header>

      <Card className="mt-6 overflow-hidden">
        <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
          <Stat label="Open contracts" value={open.length} />
          <Stat label="Volume in play" value={formatCurrency(volume, { compact: true })} />
          <Stat label="Deadlines within 48 hours" value={urgent} tone={urgent > 0 ? "urgent" : "neutral"} />
        </div>
      </Card>

      <section className="mt-7">
        <SectionTitle>Open</SectionTitle>
        {open.length === 0 ? (
          <Card className="mt-3">
            <EmptyState title="Nothing under contract" description="Transactions appear here once a contract is executed." />
          </Card>
        ) : (
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            {open.map((t) => {
              const property = propertyById.get(t.propertyId);
              const clients = t.clientContactIds.map((id) => contactById.get(id)).filter((c) => c !== undefined);
              const nextMilestone = t.milestones
                .filter((m) => !m.complete)
                .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];

              return (
                <Card key={t.id}>
                  <CardHeader>
                    <div>
                      <CardTitle>
                        {t.listingId ? (
                          <Link href={`/listings/${t.listingId}`} className="hover:text-brass">
                            {property?.address}
                          </Link>
                        ) : (
                          property?.address
                        )}
                        {t.isSeed ? <SeedMarker className="ml-1.5" /> : null}
                      </CardTitle>
                      <p className="mt-0.5 text-[12px] text-ink-faint">
                        {t.side} side · {formatCurrency(t.contractPrice)} · closing {formatDate(t.closeDate)}
                      </p>
                    </div>
                    <Badge tone={t.status === "clear_to_close" ? "good" : "brass"}>{STATUS_LABELS[t.status]}</Badge>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3">
                    {clients.length > 0 ? (
                      <p className="text-[12.5px] text-ink-muted">
                        <span className="eyebrow mr-1.5 inline">Client</span>
                        {clients.map((c) => (
                          <Link key={c.id} href={`/clients/${c.id}`} className="text-ink hover:text-brass">
                            {contactName(c)}
                          </Link>
                        ))}
                      </p>
                    ) : null}

                    {nextMilestone ? (
                      <div
                        className={`rounded-[4px] border px-3.5 py-2.5 ${
                          daysBetween(nextMilestone.dueAt, now) >= -2
                            ? "border-[#e6c9c4] bg-urgent-soft"
                            : "border-line bg-surface-sunk/60"
                        }`}
                      >
                        <div className="eyebrow">Next deadline</div>
                        <p className="mt-0.5 text-[13px] font-medium text-ink">{nextMilestone.label}</p>
                        <p className="text-[12px] text-ink-muted">
                          Due {formatDate(nextMilestone.dueAt)}
                          {daysBetween(nextMilestone.dueAt, now) >= 0 ? " — overdue" : ""}
                        </p>
                      </div>
                    ) : null}

                    <ol className="flex flex-col gap-1.5">
                      {t.milestones.map((m, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                          <span
                            aria-hidden
                            className={`mt-1 size-1.5 shrink-0 rounded-full ${m.complete ? "bg-good" : "bg-line-strong"}`}
                          />
                          <span className={m.complete ? "text-ink-faint line-through" : "text-ink"}>{m.label}</span>
                          <span className="ml-auto shrink-0 text-ink-faint">{formatDate(m.dueAt)}</span>
                        </li>
                      ))}
                    </ol>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[12px]">
                      <Row label="Title" value={t.titleCompany ?? "—"} />
                      <Row label="Lender" value={t.lender ?? "—"} />
                    </dl>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {settled.length > 0 ? (
        <section className="mt-8">
          <SectionTitle>Closed and terminated</SectionTitle>
          <Card className="mt-3">
            <CardContent className="pt-4">
              <ul className="flex flex-col divide-y divide-line">
                {settled.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-[12.5px] text-ink">{propertyById.get(t.propertyId)?.address}</span>
                    <span className="text-[11.5px] text-ink-faint">
                      {STATUS_LABELS[t.status]} · {formatDate(t.closeDate)}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="eyebrow mb-0">{label}</dt>
      <dd className="truncate text-ink">{value}</dd>
    </div>
  );
}
