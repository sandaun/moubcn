import type { SharedValue } from 'react-native-reanimated';
import type { LatLng } from 'react-native-maps';

import type { Station, TransportMode } from '@/src/domain/catalog/models';
import type { Segment } from '@/src/domain/geo/models';
import type { TransitVehicle } from '@/src/domain/realtime/models';
import type { RouteLandmarkKind } from '@/src/features/planner/utils/route-presentation';
import type { StationInterchange } from '@/src/features/station/utils/station-interchanges';

export interface NearbyStopMarker {
  code: string;
  lineCode: string;
  lineColor?: string;
  name: string;
  lat: number;
  lon: number;
  mode: TransportMode;
}

export interface PlannerMapMarker {
  id: string;
  label: string;
  name: string;
  coordinate: { lat: number; lon: number };
  kind: RouteLandmarkKind;
  legId?: string;
  incomingRoute?: string;
  outgoingRoute?: string;
  incomingMode?: TransportMode;
  outgoingMode?: TransportMode;
  selected?: boolean;
  accessibilityLabel: string;
}

export interface PlannerMapPolyline {
  id: string;
  points: { lat: number; lon: number }[];
  color: string;
}

export interface MapAdapterProps {
  lineCode: string;
  lineColor?: string;
  mode: TransportMode;
  stations: Station[];
  segments: Segment[];
  transitVehicles?: TransitVehicle[];
  transitVehiclesUpdatedAt?: number;
  routeGeometryPending?: boolean;
  selectedStationCode: string;
  stationFocusRequestId?: number;
  stationInterchanges?: StationInterchange[];
  topInset?: number;
  bottomInset?: number;
  bottomOverlayOffset?: number;
  animatedBottomInset?: SharedValue<number>;
  nearbyStops?: NearbyStopMarker[];
  plannerMarkers?: PlannerMapMarker[];
  plannerPolylines?: PlannerMapPolyline[];
  plannerFocusKey?: string | null;
  plannerStepFocus?: { key: string; coordinate: { lat: number; lon: number } } | null;
  explorationVisible?: boolean;
  bottomActions?: React.ReactNode;
  onStationPress: (stationCode: string) => void;
  onUserLocationChange?: (coordinate: { lat: number; lon: number } | null) => void;
  onNearbyStopPress?: (stop: NearbyStopMarker) => void;
  onMapPress?: (coordinate: { lat: number; lon: number }) => void;
  onPlannerMarkerPress?: (legId: string | undefined) => void;
}

export interface RoutePolyline {
  id: string;
  coordinates: LatLng[];
}
