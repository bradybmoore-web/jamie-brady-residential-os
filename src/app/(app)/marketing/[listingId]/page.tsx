import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getStore } from "@/lib/data/store";
import { capabilities } from "@/lib/env";
import { MarketingStudio } from "@/components/marketing/studio";
import { PageTitle } from "@/components/ui/primitives";
import { MARKETING_KIND_LABELS, type MarketingAssetKind } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ listingId: string }> }): Promise<Metadata> {
  const { listingId } = await params;
  const store = await getStore();
  const listing = await store.getListing(listingId);
  const property = listing ? await store.getProperty(listing.propertyId) : null;
  return { title: property ? `Studio — ${property.address}` : "Listing Studio" };
}

export default async function ListingStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  await requireSession();
  const [{ listingId }, { kind }] = await Promise.all([params, searchParams]);

  const store = await getStore();
  const listing = await store.getListing(listingId);
  if (!listing) notFound();
  const property = await store.getProperty(listing.propertyId);
  const allMarketing = await store.listListingMarketing();

  // Newest first, one per kind — the studio always edits the latest version.
  const assets = allMarketing
    .filter((m) => m.listingId === listingId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((m, i, arr) => arr.findIndex((x) => x.kind === m.kind) === i);

  const initialKind =
    kind && kind in MARKETING_KIND_LABELS ? (kind as MarketingAssetKind) : undefined;

  return (
    <div className="px-4 py-7 lg:px-8">
      <Link href="/marketing" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        All listings
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Listing Studio</p>
          <PageTitle className="mt-1.5">{property?.address}</PageTitle>
          <p className="mt-1.5 text-[13.5px] text-ink-muted">
            {property?.neighborhood ?? property?.city} · {formatCurrency(listing.listPrice)} ·{" "}
            <Link href={`/listings/${listing.id}`} className="text-brass hover:underline">
              listing detail
            </Link>
          </p>
        </div>
      </header>

      <div className="mt-7">
        <MarketingStudio
          listingId={listing.id}
          address={property?.address ?? ""}
          initialAssets={assets}
          initialKind={initialKind}
          usingMockAI={!capabilities.anthropic}
        />
      </div>
    </div>
  );
}
