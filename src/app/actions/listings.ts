"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/ai/audit";
import { generateListingMarketing } from "@/lib/workflows/listing-marketing";
import { generateSellerUpdate } from "@/lib/workflows/seller-update";
import type { ListingMarketingAsset, MarketingAssetKind, SellerUpdate } from "@/lib/types";
import { actionContext, guard, type ActionResult } from "./shared";

export async function generateMarketingAction(input: {
  listingId: string;
  kind: MarketingAssetKind;
  instructions?: string;
}): Promise<ActionResult<{ asset: ListingMarketingAsset; flagged: string[] }>> {
  return guard(async () => {
    const { ownerId } = await actionContext();
    const { asset, flagged } = await generateListingMarketing(input.listingId, input.kind, ownerId, {
      instructions: input.instructions,
    });
    revalidatePath(`/marketing/${input.listingId}`);
    return {
      ok: true,
      data: { asset, flagged },
      message: flagged.length > 0 ? `Generated, but ${flagged.length} phrase(s) need a look.` : "Generated.",
    };
  });
}

export async function saveMarketingAction(input: {
  assetId: string;
  content: string;
}): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const asset = await store.getListingMarketing(input.assetId);
    if (!asset) return { ok: false, error: "That content no longer exists." };

    const { findProhibited } = await import("@/lib/ai/prompts/writing");
    const listing = await store.getListing(asset.listingId);
    const flagged = findProhibited(input.content, listing?.prohibitedPhrases ?? []);

    await store.updateListingMarketing(input.assetId, {
      content: input.content,
      flaggedPhrases: flagged,
      status: "draft",
    });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "marketing.edited",
      entityType: "listing_marketing",
      entityId: input.assetId,
      metadata: { flagged },
    });

    revalidatePath(`/marketing/${asset.listingId}`);
    return { ok: true, message: flagged.length > 0 ? `Saved. ${flagged.length} phrase(s) still flagged.` : "Saved." };
  });
}

/**
 * Approving marketing is what makes it usable in public. It is a deliberate,
 * human step — generation alone never marks anything approved.
 */
export async function approveMarketingAction(assetId: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const asset = await store.getListingMarketing(assetId);
    if (!asset) return { ok: false, error: "That content no longer exists." };

    await store.updateListingMarketing(assetId, {
      status: "approved",
      approvedAt: new Date().toISOString(),
    });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "marketing.approved",
      entityType: "listing_marketing",
      entityId: assetId,
      metadata: { kind: asset.kind },
    });

    revalidatePath(`/marketing/${asset.listingId}`);
    return { ok: true, message: "Approved and ready to publish." };
  });
}

export async function generateSellerUpdateAction(
  listingId: string,
): Promise<ActionResult<{ update: SellerUpdate }>> {
  return guard(async () => {
    const { ownerId } = await actionContext();
    const { update } = await generateSellerUpdate(listingId, ownerId);
    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/today");
    return { ok: true, data: { update }, message: "Draft ready for review." };
  });
}

export async function approveSellerUpdateAction(input: {
  updateId: string;
  draftMessage?: string;
}): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const update = await store.getSellerUpdate(input.updateId);
    if (!update) return { ok: false, error: "That update no longer exists." };

    await store.updateSellerUpdate(input.updateId, {
      status: "approved",
      draftMessage: input.draftMessage ?? update.draftMessage,
      approvedBy: ownerId,
      approvedAt: new Date().toISOString(),
    });
    // Approving the update is what resets the listing's cadence clock.
    await store.updateListing(update.listingId, { lastSellerUpdateAt: new Date().toISOString() });

    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "seller_update.approved",
      entityType: "seller_update",
      entityId: input.updateId,
      metadata: { listingId: update.listingId },
    });

    revalidatePath(`/listings/${update.listingId}`);
    revalidatePath("/today");
    return { ok: true, message: "Approved. Send it to the sellers from your mail client." };
  });
}

export async function rejectSellerUpdateAction(updateId: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const update = await store.getSellerUpdate(updateId);
    if (!update) return { ok: false, error: "That update no longer exists." };
    await store.updateSellerUpdate(updateId, { status: "rejected" });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "seller_update.rejected",
      entityType: "seller_update",
      entityId: updateId,
      metadata: {},
    });
    revalidatePath(`/listings/${update.listingId}`);
    return { ok: true, message: "Rejected. Generate a new one when you are ready." };
  });
}
