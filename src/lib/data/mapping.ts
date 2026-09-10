/**
 * Column mapping between the Postgres schema (snake_case) and the domain model
 * (camelCase).
 *
 * Deliberately shallow: only top-level column names are converted. jsonb
 * payloads (evidence, milestones, metrics, market_context) are stored verbatim
 * in camelCase, because they are opaque documents rather than queryable columns.
 */

export function toSnake(key: string) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamel(key: string) {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function rowToRecord<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}

export function recordToRow(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    out[toSnake(k)] = v;
  }
  return out;
}
