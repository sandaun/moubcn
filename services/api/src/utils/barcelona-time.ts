const BARCELONA_TIME_ZONE = 'Europe/Madrid';

/** Today's service date in Barcelona, as `YYYY-MM-DD`. */
export function currentBarcelonaDate(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BARCELONA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Resolves a GTFS wall-clock time in Barcelona to an absolute timestamp.
 *
 * Two correction passes are enough: the first lands within an hour of the
 * target, the second absorbs whatever DST offset applied at that instant.
 * GTFS also allows an hour of 24 or more for trips that run past midnight,
 * which is why hour 24 is folded back to 0.
 */
export function barcelonaWallClockToMs(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = targetWallMs;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BARCELONA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const renderedWallMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      parts.hour === '24' ? 0 : Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += targetWallMs - renderedWallMs;
  }
  return guess;
}
