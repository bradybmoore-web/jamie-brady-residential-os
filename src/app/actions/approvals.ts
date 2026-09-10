"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/ai/audit";
import { getEmailAdapter } from "@/lib/integrations/email";
import { actionContext, guard, type ActionResult } from "./shared";

/**
 * The approval workflow.
 *
 * Statuses move draft → needs_review → approved → executed, or → rejected.
 * "Executed" for an email means a draft was placed in the mailbox and the
 * record marked sent — the product does not send mail itself, by design.
 */

export async function approveActionItem(actionId: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const item = await store.getAIAction(actionId);
    if (!item) return { ok: false, error: "That item no longer exists." };
    if (item.status === "executed") return { ok: false, error: "That has already been sent." };

    await store.updateAIAction(actionId, {
      status: "approved",
      reviewedBy: ownerId,
      reviewedAt: new Date().toISOString(),
    });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "ai_action.approved",
      entityType: "ai_action",
      entityId: actionId,
      metadata: { type: item.type },
    });

    revalidatePath("/approvals");
    return { ok: true, message: "Approved. Send it when you are ready." };
  });
}

export async function rejectActionItem(actionId: string, reason?: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    await store.updateAIAction(actionId, {
      status: "rejected",
      reviewedBy: ownerId,
      reviewedAt: new Date().toISOString(),
      rejectionReason: reason?.trim() || null,
    });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "ai_action.rejected",
      entityType: "ai_action",
      entityId: actionId,
      metadata: { reason: reason ?? null },
    });
    revalidatePath("/approvals");
    return { ok: true, message: "Rejected." };
  });
}

export async function editActionItem(input: {
  actionId: string;
  subject?: string;
  body: string;
}): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const item = await store.getAIAction(input.actionId);
    if (!item) return { ok: false, error: "That item no longer exists." };
    if (item.status === "executed") return { ok: false, error: "That has already been sent and cannot be edited." };

    await store.updateAIAction(input.actionId, {
      body: input.body,
      subject: input.subject ?? item.subject,
      // An edited draft is Jamie's words now, so it drops back to needs_review
      // rather than staying approved on the strength of the old text.
      status: "needs_review",
    });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "ai_action.edited",
      entityType: "ai_action",
      entityId: input.actionId,
      metadata: {},
    });
    revalidatePath("/approvals");
    return { ok: true, message: "Saved." };
  });
}

/**
 * Marks an approved item as executed.
 *
 * For an email this stages a draft through the email adapter. With Gmail
 * connected that creates a real draft in Jamie's mailbox; without it, the text
 * stays here and the UI says so. Either way, no message is transmitted to a
 * client by this application.
 */
export async function executeActionItem(actionId: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const item = await store.getAIAction(actionId);
    if (!item) return { ok: false, error: "That item no longer exists." };
    if (item.status !== "approved") return { ok: false, error: "Approve it first." };

    let message = "Marked as sent.";

    if (item.type === "email_draft" && item.recipient) {
      const adapter = await getEmailAdapter();
      const result = await adapter.draftEmail({
        to: item.recipient,
        subject: item.subject ?? "(no subject)",
        body: item.body,
      });
      message = result.created
        ? "Draft created in your Gmail drafts folder. Open Gmail to send it."
        : (result.note ?? "Gmail is not connected, so nothing was placed in your mailbox.");
    }

    await store.updateAIAction(actionId, { status: "executed", executedAt: new Date().toISOString() });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "ai_action.executed",
      entityType: "ai_action",
      entityId: actionId,
      metadata: { type: item.type, recipient: item.recipient },
    });

    revalidatePath("/approvals");
    return { ok: true, message };
  });
}

/**
 * Create a draft by hand — the destination for "Draft Email" on a priority card
 * or an opportunity. It lands in the same queue as everything the AI writes, so
 * there is one place where outbound work waits.
 */
export async function createDraftAction(input: {
  title: string;
  subject: string;
  body: string;
  recipient?: string;
  contactId?: string;
  leadId?: string;
}): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    if (!input.body.trim()) return { ok: false, error: "The message is empty." };

    const run = await store.createAIRun({
      workflow: "assistant",
      promptVersion: "manual@1",
      model: "none",
      provider: "mock",
      inputRecordIds: input.contactId ? [{ recordType: "contact", recordId: input.contactId }] : [],
      status: "success",
      latencyMs: 0,
      outputSummary: `Manual draft: ${input.title}`,
      startedAt: new Date().toISOString(),
      ownerId,
      sourceSystem: "manual",
    });

    const action = await store.createAIAction({
      aiRunId: run.id,
      workflow: "assistant",
      type: "email_draft",
      status: "needs_review",
      title: input.title.trim() || "Draft email",
      body: input.body,
      subject: input.subject.trim() || null,
      recipient: input.recipient?.trim() || null,
      contactId: input.contactId ?? null,
      leadId: input.leadId ?? null,
      confidence: 1,
      evidence: [],
      ownerId,
      requiresApproval: true,
      sourceSystem: "manual",
    });

    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "ai_action.created",
      entityType: "ai_action",
      entityId: action.id,
      metadata: { manual: true },
    });

    revalidatePath("/approvals");
    return { ok: true, data: { id: action.id }, message: "Draft saved." };
  });
}
