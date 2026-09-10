import type {
  BuyerProfile,
  Contact,
  Dataset,
  EmailEvent,
  Listing,
  Property,
  Task,
  UUID,
} from "@/lib/types";

/**
 * A pre-indexed view of the dataset.
 *
 * Scoring reads the same records repeatedly from several angles (a contact's
 * email events, their tasks, the listing they are selling). Building the
 * indexes once keeps the scoring functions readable and linear.
 */
export interface WorkContext {
  dataset: Dataset;
  ownerId: UUID;
  now: Date;
  contactById: Map<UUID, Contact>;
  propertyById: Map<UUID, Property>;
  listingById: Map<UUID, Listing>;
  buyerByContactId: Map<UUID, BuyerProfile>;
  emailEventsByContactId: Map<UUID, EmailEvent[]>;
  tasksByContactId: Map<UUID, Task[]>;
  listingsBySellerContactId: Map<UUID, Listing[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export function buildContext(dataset: Dataset, ownerId: UUID, now = new Date()): WorkContext {
  const emailEventsByContactId = new Map<UUID, EmailEvent[]>();
  for (const event of dataset.emailEvents) {
    if (event.contactId) push(emailEventsByContactId, event.contactId, event);
  }
  for (const events of emailEventsByContactId.values()) {
    events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  const tasksByContactId = new Map<UUID, Task[]>();
  for (const task of dataset.tasks) {
    if (task.contactId) push(tasksByContactId, task.contactId, task);
  }

  const listingsBySellerContactId = new Map<UUID, Listing[]>();
  for (const listing of dataset.listings) {
    for (const sellerId of listing.sellerContactIds) push(listingsBySellerContactId, sellerId, listing);
  }

  return {
    dataset,
    ownerId,
    now,
    contactById: new Map(dataset.contacts.map((c) => [c.id, c])),
    propertyById: new Map(dataset.properties.map((p) => [p.id, p])),
    listingById: new Map(dataset.listings.map((l) => [l.id, l])),
    buyerByContactId: new Map(dataset.buyers.map((b) => [b.contactId, b])),
    emailEventsByContactId,
    tasksByContactId,
    listingsBySellerContactId,
  };
}

export function listingAddress(ctx: WorkContext, listing: Listing) {
  return ctx.propertyById.get(listing.propertyId)?.address ?? "Unknown address";
}
