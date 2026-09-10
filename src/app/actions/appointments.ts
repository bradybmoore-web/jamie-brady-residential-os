"use server";

import { revalidatePath } from "next/cache";
import { prepareAppointment } from "@/lib/workflows/appointment-prep";
import { actionContext, guard, type ActionResult } from "./shared";
import type { AppointmentPrep } from "@/lib/types";

export async function prepareAppointmentAction(
  calendarEventId: string,
): Promise<ActionResult<{ prep: AppointmentPrep }>> {
  return guard(async () => {
    const { ownerId } = await actionContext();
    const { prep } = await prepareAppointment(calendarEventId, ownerId);
    revalidatePath("/today");
    return { ok: true, data: { prep } };
  });
}
