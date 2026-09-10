import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { buildContext } from "@/lib/scoring/context";
import { scoreAllRelationships } from "@/lib/scoring/relationship";
import {
  Badge,
  Card,
  EmptyState,
  PageTitle,
  SeedMarker,
  Table,
  Td,
  Th,
  UrgencyDot,
} from "@/components/ui/primitives";
import { CONTACT_TYPE_LABELS, contactName, type ContactType } from "@/lib/types";
import { relativeDays } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

const TYPE_ORDER: ContactType[] = ["active_seller", "active_buyer", "past_client", "sphere", "lead", "agent", "vendor"];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const session = await requireSession();
  const params = await searchParams;
  const store = await getStore();
  const dataset = await store.snapshot();
  const ctx = buildContext(dataset, session.profileId);

  // The relationship score doubles as an "attention" column here.
  const scores = new Map(scoreAllRelationships(ctx, { ownerOnly: false }).map((s) => [s.contact.id, s]));

  const filterType = TYPE_ORDER.includes(params.type as ContactType) ? (params.type as ContactType) : null;
  const contacts = dataset.contacts
    .filter((c) => (filterType ? c.type === filterType : true))
    .sort((a, b) => (scores.get(b.id)?.score ?? 0) - (scores.get(a.id)?.score ?? 0));

  const counts = TYPE_ORDER.map((type) => ({
    type,
    count: dataset.contacts.filter((c) => c.type === type).length,
  })).filter((t) => t.count > 0);

  return (
    <div className="px-4 py-7 lg:px-8">
      <header>
        <p className="eyebrow">Relationships</p>
        <PageTitle className="mt-1.5">Clients</PageTitle>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          {dataset.contacts.length} people. Cloze remains the system of record — this is the working view, ordered
          by who most needs to hear from you.
        </p>
      </header>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-line" aria-label="Contact types">
        <FilterTab href="/clients" label="All" count={dataset.contacts.length} active={!filterType} />
        {counts.map((t) => (
          <FilterTab
            key={t.type}
            href={`/clients?type=${t.type}`}
            label={CONTACT_TYPE_LABELS[t.type]}
            count={t.count}
            active={filterType === t.type}
          />
        ))}
      </nav>

      <Card className="mt-5 overflow-hidden">
        {contacts.length === 0 ? (
          <EmptyState title="No contacts here" description="Connect Cloze to sync the real database." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Relationship</Th>
                <Th className="hidden md:table-cell">Area</Th>
                <Th>Last personal contact</Th>
                <Th className="hidden lg:table-cell">Needs attention</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const score = scores.get(contact.id);
                return (
                  <tr key={contact.id} className="transition-colors hover:bg-surface-sunk/50">
                    <Td>
                      <Link href={`/clients/${contact.id}`} className="font-medium text-ink hover:text-brass">
                        {contactName(contact)}
                      </Link>
                      {contact.isSeed ? <SeedMarker className="ml-1.5" /> : null}
                      {contact.email ? (
                        <div className="text-[11.5px] text-ink-faint">{contact.email}</div>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone="outline">{CONTACT_TYPE_LABELS[contact.type]}</Badge>
                    </Td>
                    <Td className="hidden text-[12.5px] text-ink-muted md:table-cell">
                      {contact.neighborhood ?? contact.city ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-[12.5px] text-ink-muted">
                      {relativeDays(contact.lastPersonalContactAt)}
                      {contact.lastPersonalContactChannel ? (
                        <div className="text-[11px] capitalize text-ink-faint">
                          {contact.lastPersonalContactChannel.replace(/_/g, " ")}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="hidden max-w-[340px] lg:table-cell">
                      {score ? (
                        <div className="flex items-start gap-1.5">
                          <span className="mt-1.5">
                            <UrgencyDot urgency={score.urgency} />
                          </span>
                          <span className="text-[12px] leading-relaxed text-ink-muted">{score.whyNow}</span>
                        </div>
                      ) : (
                        <span className="text-[12px] text-ink-faint">Current</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function FilterTab({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors ${
        active ? "border-brass font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {label}
      <span className="tabular text-[11px] text-ink-faint">{count}</span>
    </Link>
  );
}
