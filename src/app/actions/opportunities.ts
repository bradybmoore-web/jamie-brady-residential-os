"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/ai/audit";
import { identifyFollowUpOpportunities } from "@/lib/workflows/follow-up";
import { teamDayAt } from "@/lib/utils";
import { actionContext, guard, type ActionResult } from "./shared";

export async function refreshOpportunitiesAction(): Promise<ActionResult<{ count: number }>> {
  return guard(async () => {
    const { ownerId } = await actionContext();
    const { opportunities } = await identifyFollowUpOpportunities(ownerId);
    revalidatePath("/opportunities");
    revalidatePath("/today");
    return {
      ok: true,
      data: { count: opportunities.length },
      message: `${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"} found.`,
    };
  });
}

export async function markOpportunityActedAction(opportunityId: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const opportunity = await store.getOpportunity(opportunityId);
    if (!opportunity) return { ok: false, error: "That opportunity no longer exists." };

    await store.updateOpportunity(opportunityId, { status: "acted" });
    if (opportunity.contactId) {
      // Recording the touch is what stops it resurfacing tomorrow.
      const now = new Date().toISOString();
      await store.updateContact(opportunity.contactId, {
        lastPersonalContactAt: now,
        lastTouchAt: now,
        lastPersonalContactChannel: opportunity.recommendedChannel === "handwritten_note" ? "email" : opportunity.recommendedChannel,
      });
    }

    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "opportunity.acted",
      entityType: "opportunity",
      entityId: opportunityId,
      metadata: { contactId: opportunity.contactId },
    });

    revalidatePath("/opportunities");
    revalidatePath("/today");
    return { ok: true, message: "Recorded." };
  });
}

export async function dismissOpportunityAction(opportunityId: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    await store.updateOpportunity(opportunityId, { status: "dismissed" });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "opportunity.dismissed",
      entityType: "opportunity",
      entityId: opportunityId,
      metadata: {},
    });
    revalidatePath("/opportunities");
    return { ok: true, message: "Dismissed. It will not come back." };
  });
}

export async function snoozeOpportunityAction(opportunityId: string, days = 14): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    await store.updateOpportunity(opportunityId, {
      status: "snoozed",
      snoozedUntil: teamDayAt(days, 9),
    });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "opportunity.snoozed",
      entityType: "opportunity",
      entityId: opportunityId,
      metadata: { days },
    });
    revalidatePath("/opportunities");
    return { ok: true, message: `Snoozed for ${days} days.` };
  });
}
