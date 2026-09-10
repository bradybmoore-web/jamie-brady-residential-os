"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/ai/audit";
import { analyzeLead, nextFollowUpAt } from "@/lib/workflows/analyze-lead";
import { teamDayAt } from "@/lib/utils";
import { LEAD_STAGES, type LeadStage } from "@/lib/types";
import { actionContext, guard, type ActionResult } from "./shared";

export async function analyzeLeadAction(leadId: string): Promise<ActionResult<{ summary: string }>> {
  return guard(async () => {
    const { ownerId } = await actionContext();
    const { analysis, score } = await analyzeLead(leadId, ownerId);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    revalidatePath("/approvals");
    return {
      ok: true,
      data: { summary: analysis.summary },
      message: `Classified as ${analysis.type}, score ${score}. A reply is waiting in Approvals.`,
    };
  });
}

export async function recordLeadAttemptAction(
  leadId: string,
  outcome: "no_answer" | "connected",
): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const lead = await store.getLead(leadId);
    if (!lead) return { ok: false, error: "That lead no longer exists." };

    const attemptCount = lead.attemptCount + 1;
    await store.updateLead(leadId, {
      attemptCount,
      lastAttemptAt: new Date().toISOString(),
      stage: outcome === "connected" ? "connected" : lead.stage === "new" ? "attempted_contact" : lead.stage,
      followUpDueAt: outcome === "connected" ? teamDayAt(3, 9) : nextFollowUpAt(attemptCount),
    });

    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: `lead.${outcome}`,
      entityType: "lead",
      entityId: leadId,
      metadata: { attemptCount },
    });

    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    revalidatePath("/today");
    return { ok: true, message: outcome === "connected" ? "Marked as connected." : "Attempt recorded." };
  });
}

/**
 * Changing a lead stage is a consequential CRM action, so it is an explicit,
 * human-initiated call — never something a workflow does on its own.
 */
export async function updateLeadStageAction(leadId: string, stage: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    if (!LEAD_STAGES.includes(stage as LeadStage)) return { ok: false, error: "That is not a valid stage." };

    await store.updateLead(leadId, { stage: stage as LeadStage });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "lead.stage_changed",
      entityType: "lead",
      entityId: leadId,
      metadata: { stage },
    });

    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true, message: "Stage updated." };
  });
}

export async function createLeadAction(input: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  source: string;
  inquiryContent: string;
}): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    if (!input.firstName.trim() || !input.lastName.trim()) {
      return { ok: false, error: "A lead needs a first and last name." };
    }

    const lead = await store.createLead({
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      source: input.source.trim() || "Manual entry",
      inquiredAt: new Date().toISOString(),
      inquiryContent: input.inquiryContent.trim(),
      type: "unknown",
      urgency: "medium",
      score: 0,
      assignedTo: ownerId,
      stage: "new",
      attemptCount: 0,
      followUpDueAt: teamDayAt(0, 17),
      sourceSystem: "manual",
    });

    // Classify immediately — a new lead with no read on it is not much use.
    await analyzeLead(lead.id, ownerId);

    revalidatePath("/leads");
    revalidatePath("/today");
    return { ok: true, data: { id: lead.id }, message: "Lead created and analysed." };
  });
}
