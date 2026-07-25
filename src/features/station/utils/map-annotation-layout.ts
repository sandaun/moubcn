import type { Station } from '@/src/domain/catalog/models';

export interface StationAnnotationCandidate {
  station: Pick<Station, 'code' | 'lat' | 'lon'>;
  hasName: boolean;
  hasBadges: boolean;
  selected: boolean;
}

export interface MapAnnotationViewport {
  width: number;
  height: number;
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * A non-station annotation that station labels must yield to — currently the
 * live vehicle markers, which are drawn above every station annotation and so
 * would otherwise sit on top of a name instead of displacing it.
 */
export interface MapAnnotationObstacle {
  lat: number;
  lon: number;
}

interface AnnotationRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// These bounds mirror the 44 pt marker, the 156 pt name label, and up to two
// route badges plus the overflow badge rendered by MapAdapter.
const MARKER_RADIUS = 24;
const BADGE_TOP_OFFSET = 36;
const BADGE_RIGHT_OFFSET = 132;
const UNSELECTED_NAME_HALF_WIDTH = 80;
const SELECTED_NAME_HALF_WIDTH = 84;
const UNSELECTED_NAME_BOTTOM_OFFSET = 58;
const SELECTED_NAME_BOTTOM_OFFSET = 82;
const COLLISION_GAP = 6;
// The visible vehicle disc, not its 60 pt marker box: most of that box is the
// translucent pulse ring, which labels may safely overlap.
const VEHICLE_RADIUS = 16;

function isValidViewport(viewport: MapAnnotationViewport): boolean {
  return (
    Number.isFinite(viewport.width) &&
    viewport.width > 0 &&
    Number.isFinite(viewport.height) &&
    viewport.height > 0 &&
    Number.isFinite(viewport.latitude) &&
    Number.isFinite(viewport.longitude) &&
    Number.isFinite(viewport.latitudeDelta) &&
    viewport.latitudeDelta > 0 &&
    Number.isFinite(viewport.longitudeDelta) &&
    viewport.longitudeDelta > 0
  );
}

function projectX(lon: number, viewport: MapAnnotationViewport): number {
  return (
    viewport.width / 2 + ((lon - viewport.longitude) / viewport.longitudeDelta) * viewport.width
  );
}

function projectY(lat: number, viewport: MapAnnotationViewport): number {
  return (
    viewport.height / 2 - ((lat - viewport.latitude) / viewport.latitudeDelta) * viewport.height
  );
}

function getObstacleRect(
  obstacle: MapAnnotationObstacle,
  viewport: MapAnnotationViewport,
): AnnotationRect {
  const x = projectX(obstacle.lon, viewport);
  const y = projectY(obstacle.lat, viewport);

  return {
    left: x - VEHICLE_RADIUS,
    right: x + VEHICLE_RADIUS,
    top: y - VEHICLE_RADIUS,
    bottom: y + VEHICLE_RADIUS,
  };
}

function getAnnotationRect(
  candidate: StationAnnotationCandidate,
  viewport: MapAnnotationViewport,
): AnnotationRect {
  const x = projectX(candidate.station.lon, viewport);
  const y = projectY(candidate.station.lat, viewport);
  let left = x - MARKER_RADIUS;
  let right = x + MARKER_RADIUS;
  let top = y - MARKER_RADIUS;
  let bottom = y + MARKER_RADIUS;

  if (candidate.hasBadges) {
    top = Math.min(top, y - BADGE_TOP_OFFSET);
    right = Math.max(right, x + BADGE_RIGHT_OFFSET);
  }

  if (candidate.hasName) {
    const nameHalfWidth = candidate.selected
      ? SELECTED_NAME_HALF_WIDTH
      : UNSELECTED_NAME_HALF_WIDTH;
    const nameBottomOffset = candidate.selected
      ? SELECTED_NAME_BOTTOM_OFFSET
      : UNSELECTED_NAME_BOTTOM_OFFSET;
    left = Math.min(left, x - nameHalfWidth);
    right = Math.max(right, x + nameHalfWidth);
    bottom = Math.max(bottom, y + nameBottomOffset);
  }

  return { left, right, top, bottom };
}

function intersects(first: AnnotationRect, second: AnnotationRect): boolean {
  return (
    first.left < second.right + COLLISION_GAP &&
    first.right + COLLISION_GAP > second.left &&
    first.top < second.bottom + COLLISION_GAP &&
    first.bottom + COLLISION_GAP > second.top
  );
}

function intersectsViewport(rect: AnnotationRect, viewport: MapAnnotationViewport): boolean {
  return (
    rect.right >= 0 &&
    rect.left <= viewport.width &&
    rect.bottom >= 0 &&
    rect.top <= viewport.height
  );
}

export function getVisibleStationAnnotationCodes(
  candidates: StationAnnotationCandidate[],
  viewport: MapAnnotationViewport,
  obstacles: MapAnnotationObstacle[] = [],
): Set<string> {
  const seenCodes = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate) => {
    if (
      !Number.isFinite(candidate.station.lat) ||
      !Number.isFinite(candidate.station.lon) ||
      seenCodes.has(candidate.station.code)
    ) {
      return false;
    }

    seenCodes.add(candidate.station.code);
    return true;
  });

  if (!isValidViewport(viewport) || uniqueCandidates.length <= 1) {
    return new Set(uniqueCandidates.map((candidate) => candidate.station.code));
  }

  const orderedCandidates = uniqueCandidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (first, second) =>
        Number(second.candidate.selected) - Number(first.candidate.selected) ||
        first.index - second.index,
    );
  const visibleCodes = new Set<string>();
  const occupiedRects: AnnotationRect[] = [];
  const obstacleRects = obstacles
    .filter(
      (obstacle) => Number.isFinite(obstacle.lat) && Number.isFinite(obstacle.lon),
    )
    .map((obstacle) => getObstacleRect(obstacle, viewport));

  for (const { candidate } of orderedCandidates) {
    const rect = getAnnotationRect(candidate, viewport);
    if (!intersectsViewport(rect, viewport)) {
      continue;
    }

    // The selected station keeps its label whatever is on top of it; it is the
    // one annotation the user explicitly asked for.
    if (
      !candidate.selected &&
      obstacleRects.some((obstacleRect) => intersects(rect, obstacleRect))
    ) {
      continue;
    }

    if (occupiedRects.some((occupiedRect) => intersects(rect, occupiedRect))) {
      continue;
    }

    visibleCodes.add(candidate.station.code);
    occupiedRects.push(rect);
  }

  return visibleCodes;
}
