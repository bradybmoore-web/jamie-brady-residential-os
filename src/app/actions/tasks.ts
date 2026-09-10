"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/ai/audit";
import { teamDayAt } from "@/lib/utils";
import { actionContext, guard, type ActionResult } from "./shared";
import type { TaskCategory, Urgency } from "@/lib/types";

export async function createTaskAction(input: {
  title: string;
  detail?: string;
  dueAt?: string;
  category?: TaskCategory;
  urgency?: Urgency;
  contactId?: string;
  leadId?: string;
  listingId?: string;
}): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const title = input.title.trim();
    if (!title) return { ok: false, error: "A task needs a title." };

    const task = await store.createTask({
      title,
      detail: input.detail?.trim() || null,
      category: input.category ?? "follow_up",
      status: "open",
      dueAt: input.dueAt ?? teamDayAt(0, 17),
      ownerId,
      contactId: input.contactId ?? null,
      leadId: input.leadId ?? null,
      listingId: input.listingId ?? null,
      urgency: input.urgency ?? "medium",
      createdByAi: false,
      sourceSystem: "manual",
    });

    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "task.created",
      entityType: "task",
      entityId: task.id,
      metadata: { title },
    });

    revalidatePath("/today");
    return { ok: true, data: { id: task.id }, message: "Task added." };
  });
}

export async function completeTaskAction(taskId: string): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    await store.updateTask(taskId, { status: "done", completedAt: new Date().toISOString() });
    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "task.completed",
      entityType: "task",
      entityId: taskId,
      metadata: {},
    });
    revalidatePath("/today");
    return { ok: true, message: "Marked done." };
  });
}

/**
 * "Mark Done" on a priority card. A priority is a derived object, not a row, so
 * the meaning depends on what produced it: a task closes, a lead records an
 * attempt, a relationship records a personal touch.
 */
export async function dismissPriorityAction(input: {
  priorityKey: string;
  personId?: string | null;
  taskId?: string | null;
  leadId?: string | null;
}): Promise<ActionResult> {
  return guard(async () => {
    const { store, ownerId } = await actionContext();
    const now = new Date().toISOString();

    if (input.taskId) {
      await store.updateTask(input.taskId, { status: "done", completedAt: now });
    }

    if (input.leadId) {
      const lead = await store.getLead(input.leadId);
      if (lead) {
        await store.updateLead(lead.id, {
          attemptCount: lead.attemptCount + 1,
          lastAttemptAt: now,
          stage: lead.stage === "new" ? "attempted_contact" : lead.stage,
          followUpDueAt: teamDayAt(2, 9),
        });
      }
    }

    if (input.personId) {
      // Recording the touch is what actually clears the relationship signal —
      // it is the fact the scoring reads next time.
      await store.updateContact(input.personId, {
        lastPersonalContactAt: now,
        lastTouchAt: now,
      });
      const opportunities = await store.listOpportunities();
      for (const opportunity of opportunities) {
        if (opportunity.contactId === input.personId && opportunity.status === "open") {
          await store.updateOpportunity(opportunity.id, { status: "acted" });
        }
      }
    }

    await audit(store, {
      actorId: ownerId,
      actorType: "user",
      action: "priority.completed",
      entityType: "priority",
      entityId: input.personId ?? input.taskId ?? input.leadId ?? input.priorityKey,
      metadata: { priorityKey: input.priorityKey },
    });

    revalidatePath("/today");
    revalidatePath("/opportunities");
    return { ok: true, message: "Done. It will not resurface tomorrow." };
  });
}
