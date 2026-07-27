import { isRecord } from './coerce';

/** Reads the entity list out of a decoded GTFS-Realtime feed. */
export function getFeedEntities(feed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(feed.entity) ? feed.entity.filter(isRecord) : [];
}
