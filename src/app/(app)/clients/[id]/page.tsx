import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { buildContext } from "@/lib/scoring/context";
import { scoreRelationship } from "@/lib/scoring/relationship";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageTitle,
  SeedMarker,
  UrgencyDot,
  buttonClasses,
} from "@/components/ui/primitives";
import { ConfidenceMeter } from "@/components/ui/confidence";
import { CHANNEL_LABELS, CONTACT_TYPE_LABELS, contactName } from "@/lib/types";
import { formatCurrency, formatDate, relativeDays } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const store = await getStore();
  const contact = await store.getContact(id);
  return { title: contact ? contactName(contact) : "Contact" };
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const store = await getStore();
  const dataset = await store.snapshot();

  const contact = dataset.contacts.find((c) => c.id === id);
  if (!contact) notFound();

  const ctx = buildContext(dataset, session.profileId);
  const score = scoreRelationship(contact, ctx);
  const buyer = dataset.buyers.find((b) => b.contactId === contact.id);
  const listings = ctx.listingsBySellerContactId.get(contact.id) ?? [];
  const events = (ctx.emailEventsByContactId.get(contact.id) ?? []).slice(0, 12);
  const transactions = dataset.transactions.filter((t) => t.clientContactIds.includes(contact.id));

  return (
    <div className="px-4 py-7 lg:px-8">
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        All clients
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PageTitle>{contactName(contact)}</PageTitle>
            {contact.isSeed ? <SeedMarker /> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="outline">{CONTACT_TYPE_LABELS[contact.type]}</Badge>
            <span className="text-[12.5px] capitalize text-ink-muted">{contact.stage.replace(/_/g, " ")}</span>
            {contact.neighborhood ? (
              <span className="text-[12.5px] text-ink-muted">· {contact.neighborhood}</span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-ink-muted">
            {contact.phone ? (
              <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 hover:text-brass">
                <Phone className="size-3.5" strokeWidth={1.75} aria-hidden />
                {contact.phone}
              </a>
            ) : null}
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 hover:text-brass">
                <Mail className="size-3.5" strokeWidth={1.75} aria-hidden />
                {contact.email}
              </a>
            ) : null}
            <span>Last personal contact {relativeDays(contact.lastPersonalContactAt)}</span>
          </div>
        </div>

        <Link
          href={`/approvals/new?contactId=${contact.id}&title=${encodeURIComponent(`Email ${contactName(contact)}`)}`}
          className={buttonClasses("primary", "md")}
        >
          Draft an email
        </Link>
      </header>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          {score ? (
            <Card className="border-brass/30 bg-brass-soft/25">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <UrgencyDot urgency={score.urgency} />
                  <CardTitle>Why this relationship needs you</CardTitle>
                </div>
                <ConfidenceMeter value={score.confidence} />
              </CardHeader>
              <CardContent>
                <p className="text-[13.5px] leading-relaxed text-ink">{score.whyNow}</p>
                <div className="mt-3 rounded-[4px] border border-line bg-surface px-3.5 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="eyebrow">Do this</span>
                    <span className="text-[11px] text-ink-faint">
                      · by {CHANNEL_LABELS[score.recommendedChannel]}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] font-medium text-ink">{score.recommendedAction}</p>
                </div>
                <ul className="mt-3 flex flex-col gap-1 border-l border-line-strong pl-3">
                  {score.evidence.map((e, i) => (
                    <li key={i} className="text-[12px] leading-relaxed">
                      <span className="font-medium text-ink">{e.label}:</span>{" "}
                      <span className="text-ink-muted">{e.detail}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <p className="text-[13px] text-ink-muted">
                  Nothing is outstanding with {contact.firstName}. The relationship is inside its expected cadence.
                </p>
              </CardContent>
            </Card>
          )}

          {contact.statedPlans.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>What they have told you</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-line">
                  {contact.statedPlans.map((plan) => (
                    <li key={plan.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-[13px] leading-relaxed text-ink">&ldquo;{plan.statement}&rdquo;</p>
                      <p className="mt-1 text-[11.5px] text-ink-faint">
                        Said {formatDate(plan.statedAt)} · relevant from {formatDate(plan.maturesAt)} ·{" "}
                        <span className="capitalize">{plan.status}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <span className="text-[11.5px] text-ink-faint">{contact.notes.length}</span>
            </CardHeader>
            <CardContent>
              {contact.notes.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No notes recorded.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {contact.notes.map((note) => (
                    <li key={note.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-[13px] leading-relaxed text-ink">{note.body}</p>
                      <p className="mt-1 text-[11.5px] text-ink-faint">
                        {formatDate(note.createdAt)} · from {note.sourceSystem}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email activity</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No recorded email activity.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="tabular w-[76px] shrink-0 text-ink-faint">{formatDate(e.occurredAt)}</span>
                      <span className="text-ink-muted">
                        <span className="capitalize text-ink">{e.type.replace(/_/g, " ")}</span>
                        {e.subject ? ` — ${e.subject}` : e.campaignName ? ` — ${e.campaignName}` : ""}
                        {e.propertyAddress ? ` (${e.propertyAddress})` : ""}
                        {e.awaitingReply ? <span className="ml-1.5 font-medium text-urgent">awaiting reply</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {buyer ? (
            <Card>
              <CardHeader>
                <CardTitle>Buyer profile</CardTitle>
                <Link href="/buyers" className="text-[11.5px] text-brass hover:underline">
                  All buyers
                </Link>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-[13px] text-ink">
                  {formatCurrency(buyer.priceMin)} – {formatCurrency(buyer.priceMax)} · {buyer.minBeds}+ bed ·{" "}
                  {buyer.minBaths}+ bath
                </p>
                <Facts label="Looking in" items={buyer.targetLocations} />
                <Facts label="Must have" items={buyer.mustHaves} />
                <Facts label="Deal breakers" items={buyer.dealBreakers} tone="urgent" />
                <Facts label="Nice to have" items={buyer.niceToHaves} />
                {buyer.timeline ? (
                  <p className="text-[12.5px] text-ink-muted">
                    <span className="eyebrow mr-1.5 inline">Timeline</span>
                    {buyer.timeline}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {listings.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Their listings</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {listings.map((l) => (
                    <li key={l.id}>
                      <Link href={`/listings/${l.id}`} className="text-[13px] text-ink hover:text-brass">
                        {ctx.propertyById.get(l.propertyId)?.address}
                      </Link>
                      <p className="text-[11.5px] capitalize text-ink-faint">
                        {l.status.replace(/_/g, " ")} · {formatCurrency(l.listPrice)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {transactions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {transactions.map((t) => (
                    <li key={t.id} className="text-[12.5px]">
                      <span className="text-ink">{ctx.propertyById.get(t.propertyId)?.address}</span>
                      <p className="capitalize text-ink-faint">
                        {t.status.replace(/_/g, " ")} · closing {formatDate(t.closeDate)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2 text-[12.5px]">
                <Row label="Owner" value={ctx.dataset.profiles.find((p) => p.id === contact.ownerId)?.fullName ?? "—"} />
                <Row label="Source" value={contact.sourceSystem} />
                <Row label="Cloze ID" value={contact.clozeId ?? "Not synced"} />
                <Row label="Tags" value={contact.tags.join(", ") || "—"} />
                <Row label="Home" value={contact.homeAddress ?? "—"} />
                <Row
                  label="Purchased"
                  value={contact.homePurchaseDate ? formatDate(contact.homePurchaseDate) : "—"}
                />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Facts({ label, items, tone }: { label: string; items: string[]; tone?: "urgent" }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li key={i} className={`text-[12.5px] leading-relaxed ${tone === "urgent" ? "text-urgent" : "text-ink-muted"}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="eyebrow mb-0 shrink-0">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
