import { buildSeedDataset } from "@/lib/data/seed";
import { buildContext } from "@/lib/scoring/context";
import { ID } from "@/lib/data/ids";
import type { Dataset } from "@/lib/types";

export { ID };

/** A fresh seeded context per test, so mutations in one test cannot leak. */
export function seededContext(now = new Date()) {
  return buildContext(buildSeedDataset(), ID.jamie, now);
}

export function seededDataset(): Dataset {
  return buildSeedDataset();
}
