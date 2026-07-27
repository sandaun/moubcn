import type { ImageRequireSource } from 'react-native';

export const USER_LOCATION_TIMEOUT_MS = 10_000;
export const MAP_CENTER_ANIMATION_MS = 450;
export const STATION_MARKER_ANCHOR = { x: 0.5, y: 0.5 };
export const STATION_MARKER_CENTER_OFFSET = { x: 0, y: 0 };
export const STATION_BADGE_ANCHOR = { x: 0, y: 1 };
export const STATION_NAME_ANCHOR = { x: 0.5, y: 0 };
export const UNSELECTED_STATION_NAME_CENTER_OFFSET = { x: 0, y: 22 };
export const STATION_NAME_CENTER_OFFSET = { x: 0, y: 26 };
export const SELECTED_STATION_NAME_CENTER_OFFSET = { x: 0, y: 30 };
export const SELECTED_MULTILINE_STATION_NAME_CENTER_OFFSET = { x: 0, y: 38 };
// Places the detail above the vehicle tile: iOS positions custom annotations by
// centerOffset alone, so this clears half the 27 pt tile plus half the card.
export const VEHICLE_DETAIL_ANCHOR = { x: 0.5, y: 1 };
export const VEHICLE_DETAIL_CENTER_OFFSET = { x: 0, y: -48 };
export const STATION_MARKER_IMAGE = require('@/assets/map/station-marker.png') as ImageRequireSource;
// Beyond this the reported position is not plausibly the drawn route, so the
// raw coordinate is kept instead of snapping onto an unrelated stretch.
export const VEHICLE_SNAP_MAX_DISTANCE_METERS = 150;
// Two slow sonar rings per movement read as a heartbeat without turning the
// marker into a permanent animation.
export const VEHICLE_PULSE_RING_MS = 1_600;
export const VEHICLE_PULSE_STAGGER_MS = 500;
// A vehicle annotation gets placed while the map is still settling — before its
// React content has a size, and against a projection the camera has not
// finished animating — which leaves the marker drawn tens of points off the
// track it snapped to. MapKit re-places an annotation only when its coordinate
// changes, so the marker sits there until the next feed poll moves it.
// Alternating this offset on every layout pass and every camera rest makes each
// of those moments count as a coordinate change. It is about a centimetre on
// the ground: too small to see, too large to compare equal.
export const VEHICLE_PLACEMENT_NUDGE_DEGREES = 1e-7;
// How long a map press is still treated as the echo of the vehicle press that
// produced it, rather than as a tap on empty map meaning "dismiss".
export const VEHICLE_PRESS_ECHO_MS = 350;

// AIRMapMarker feeds zIndex straight into MKAnnotationView.zPriority, which
// runs 0…1000 with DefaultUnselected at 500. Below that default MapKit stays
// free to order annotations its own way — by latitude — which is why the
// vehicle marker kept drawing under station labels only *sometimes*. Keeping
// the whole scale above 500 leaves relative order as the only thing MapKit has
// to honour. Defined in one place so a stray literal cannot reorder the map.
const MAP_Z_BASE = 600;
export const MAP_Z = {
  routeBehindPlanner: MAP_Z_BASE + 1,
  route: MAP_Z_BASE + 5,
  nearbyStop: MAP_Z_BASE + 8,
  nearbyStopLabel: MAP_Z_BASE + 9,
  station: MAP_Z_BASE + 10,
  stationSelected: MAP_Z_BASE + 20,
  stationBadge: MAP_Z_BASE + 30,
  stationName: MAP_Z_BASE + 35,
  stationNameSelected: MAP_Z_BASE + 40,
  plannerRoute: MAP_Z_BASE + 45,
  vehicle: MAP_Z_BASE + 55,
  vehicleDetail: MAP_Z_BASE + 58,
  plannerStation: MAP_Z_BASE + 60,
  plannerBadge: MAP_Z_BASE + 65,
  plannerName: MAP_Z_BASE + 70,
  plannerEndpoint: MAP_Z_BASE + 75,
} as const;
