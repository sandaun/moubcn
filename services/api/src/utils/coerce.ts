// Coercions for the loosely typed rows that come out of the open-data CSV and
// JSON feeds. Deliberately strict: a blank cell is missing data, not an empty
// string or a zero.
//
// Note that `tmb/helpers.ts` exports its own `asString`/`asNumber` with
// different rules (no trimming, and `asNumber('')` yields 0 there). They are
// not interchangeable, so the TMB clients keep using theirs.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
