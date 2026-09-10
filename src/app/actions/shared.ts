import "server-only";
import { requireSession } from "@/lib/auth/session";
import { getStore, type DataStore } from "@/lib/data/store";
import type { UUID } from "@/lib/types";

export interface ActionContext {
  store: DataStore;
  ownerId: UUID;
  actorName: string;
}

/**
 * Every server action starts here. There is no path to a mutation that skips
 * the session check.
 */
export async function actionContext(): Promise<ActionContext> {
  const session = await requireSession();
  const store = await getStore();
  return { store, ownerId: session.profileId, actorName: session.fullName };
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

/**
 * Wraps an action so a thrown error becomes a message the UI can render rather
 * than an unhandled server exception.
 */
export async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    // Server-side visibility; the user gets the message, not the stack.
    console.error("[action]", message);
    return { ok: false, error: message };
  }
}
