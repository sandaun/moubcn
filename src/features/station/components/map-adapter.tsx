// The vehicle marker uses the MaterialIcons glyph font directly instead of
// IconSymbol: SF Symbols render as a native view, which Android rasterises
// unreliably inside a marker bitmap. A glyph is safe on both platforms.
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Pressable,
  StyleSheet,
  View,
  type ImageRequireSource,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import MapView, {
  Marker,
  Polyline,
  type LatLng,
  type MapPressEvent,
  type Region,
  type UserLocationChangeEvent,
} from 'react-native-maps';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppLanguage } from '@/src/i18n';
import type { Line, Station, TransportMode } from '@/src/domain/catalog/models';
import type { Segment } from '@/src/domain/geo/models';
import type { TransitVehicle } from '@/src/domain/realtime/models';
import { getLineBrand } from '@/src/features/catalog/utils/line-brand';
import {
  getPlannerRouteMode,
  type RouteLandmarkKind,
} from '@/src/features/planner/utils/route-presentation';
import {
  getUniqueInterchangeLines,
  prioritizeSelectedInterchangeLine,
  type StationInterchange,
} from '@/src/features/station/utils/station-interchanges';
import {
  getVisibleStationAnnotationCodes,
  type MapAnnotationObstacle,
  type StationAnnotationCandidate,
} from '@/src/features/station/utils/map-annotation-layout';
import { getMapMarkerDetail } from '@/src/features/station/utils/map-marker-detail';
import { getViewportFocusedRegion } from '@/src/features/station/utils/map-camera';
import {
  placePointOnPolylines,
  selectStationMarkers,
  trimSegmentToStations,
} from '@/src/features/station/utils/map-route-geometry';
import { Text, type Palette, usePalette, useThemedStyles } from '@/src/design-system';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface NearbyStopMarker {
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

interface MapAdapterProps {
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

interface RoutePolyline {
  id: string;
  coordinates: LatLng[];
}

function toMapCoordinate(point: { lat: number; lon: number }): LatLng {
  return {
    latitude: point.lat,
    longitude: point.lon,
  };
}

function hasFiniteCoordinate(coordinate: LatLng): boolean {
  return Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude);
}

function withAlpha(color: string, alpha: number): string {
  const normalized = color.trim();
  const hex = normalized.match(/^#?([0-9A-Fa-f]{6})$/)?.[1];
  if (!hex) {
    return normalized;
  }

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getFallbackPolyline(stations: Station[]): RoutePolyline | null {
  const coordinates = stations
    .map((station) => ({
      latitude: station.lat,
      longitude: station.lon,
    }))
    .filter(hasFiniteCoordinate);

  if (coordinates.length < 2) {
    return null;
  }

  return {
    id: 'stations',
    coordinates,
  };
}

const USER_LOCATION_TIMEOUT_MS = 10_000;
const MAP_CENTER_ANIMATION_MS = 450;
const STATION_MARKER_ANCHOR = { x: 0.5, y: 0.5 };
const STATION_MARKER_CENTER_OFFSET = { x: 0, y: 0 };
const STATION_BADGE_ANCHOR = { x: 0, y: 1 };
const STATION_NAME_ANCHOR = { x: 0.5, y: 0 };
const UNSELECTED_STATION_NAME_CENTER_OFFSET = { x: 0, y: 22 };
const STATION_NAME_CENTER_OFFSET = { x: 0, y: 26 };
const SELECTED_STATION_NAME_CENTER_OFFSET = { x: 0, y: 30 };
const SELECTED_MULTILINE_STATION_NAME_CENTER_OFFSET = { x: 0, y: 38 };
// Places the detail above the vehicle tile: iOS positions custom annotations by
// centerOffset alone, so this clears half the 27 pt tile plus half the card.
const VEHICLE_DETAIL_ANCHOR = { x: 0.5, y: 1 };
const VEHICLE_DETAIL_CENTER_OFFSET = { x: 0, y: -48 };
const STATION_MARKER_IMAGE = require('@/assets/map/station-marker.png') as ImageRequireSource;
// Beyond this the reported position is not plausibly the drawn route, so the
// raw coordinate is kept instead of snapping onto an unrelated stretch.
const VEHICLE_SNAP_MAX_DISTANCE_METERS = 150;
// Two slow sonar rings per movement read as a heartbeat without turning the
// marker into a permanent animation.
const VEHICLE_PULSE_RING_MS = 1_600;
const VEHICLE_PULSE_STAGGER_MS = 500;
// A vehicle annotation gets placed while the map is still settling — before its
// React content has a size, and against a projection the camera has not
// finished animating — which leaves the marker drawn tens of points off the
// track it snapped to. MapKit re-places an annotation only when its coordinate
// changes, so the marker sits there until the next feed poll moves it.
// Alternating this offset on every layout pass and every camera rest makes each
// of those moments count as a coordinate change. It is about a centimetre on
// the ground: too small to see, too large to compare equal.
const VEHICLE_PLACEMENT_NUDGE_DEGREES = 1e-7;
// How long a map press is still treated as the echo of the vehicle press that
// produced it, rather than as a tap on empty map meaning "dismiss".
const VEHICLE_PRESS_ECHO_MS = 350;

// AIRMapMarker feeds zIndex straight into MKAnnotationView.zPriority, which
// runs 0…1000 with DefaultUnselected at 500. Below that default MapKit stays
// free to order annotations its own way — by latitude — which is why the
// vehicle marker kept drawing under station labels only *sometimes*. Keeping
// the whole scale above 500 leaves relative order as the only thing MapKit has
// to honour. Defined in one place so a stray literal cannot reorder the map.
const MAP_Z_BASE = 600;
const MAP_Z = {
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

export function MapAdapter({
  lineCode,
  lineColor,
  mode,
  stations,
  segments,
  transitVehicles = [],
  transitVehiclesUpdatedAt = 0,
  routeGeometryPending = false,
  selectedStationCode,
  stationFocusRequestId = 0,
  stationInterchanges = [],
  topInset = 0,
  bottomInset = 0,
  bottomOverlayOffset = 0,
  animatedBottomInset,
  nearbyStops = [],
  plannerMarkers = [],
  plannerPolylines = [],
  plannerFocusKey = null,
  plannerStepFocus = null,
  explorationVisible = true,
  bottomActions,
  onStationPress,
  onUserLocationChange,
  onNearbyStopPress,
  onMapPress,
  onPlannerMarkerPress,
}: MapAdapterProps) {
  const colorScheme = useColorScheme();
  const palette = usePalette();
  const styles = useThemedStyles(createStyles);
  const { t } = useAppLanguage();
  const mapRef = useRef<MapView | null>(null);
  const currentRegionRef = useRef<Region | null>(null);
  const lastStationFocusRequestRef = useRef(0);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapWidth, setMapWidth] = useState(0);
  const [mapHeight, setMapHeight] = useState(0);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [isWaitingForUserLocation, setIsWaitingForUserLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const locationMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomControlsAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: -(animatedBottomInset?.get() ?? bottomInset),
      },
    ],
  }));

  useEffect(() => {
    if (locationMessageTimerRef.current) {
      clearTimeout(locationMessageTimerRef.current);
      locationMessageTimerRef.current = null;
    }
    if (locationMessage) {
      locationMessageTimerRef.current = setTimeout(() => {
        setLocationMessage(null);
      }, 3_000);
    }
    return () => {
      if (locationMessageTimerRef.current) {
        clearTimeout(locationMessageTimerRef.current);
      }
    };
  }, [locationMessage]);

  const shouldCenterOnNextUserLocationRef = useRef(false);
  const lastPlannerFocusKeyRef = useRef<string | null>(null);
  const lastPlannerStepFocusKeyRef = useRef<string | null>(null);
  const userLocationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userCoordinate, setUserCoordinate] = useState<LatLng | null>(null);
  const [visibleRegion, setVisibleRegion] = useState<Region | null>(null);
  // Advances every time the camera comes to rest; vehicle markers use it to
  // re-place themselves against the projection that is actually on screen.
  const [placementEpoch, setPlacementEpoch] = useState(0);
  // The vehicle detail is a plain overlay rather than a MapKit Callout. A
  // Callout is presented *inside* the annotation view, and AIRMapMarker then
  // resizes itself from its largest subview — which tore the marker's own
  // content apart and dismissed the bubble on the spot.
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  // A marker tap does not consume the touch (AIRMapMarker sets
  // cancelsTouchesInView = NO so the map keeps receiving selection events), so
  // pressing a vehicle also fires the map's own press. Both orderings are safe:
  // if the marker lands first the map press is ignored as an echo, and if the
  // map lands first it clears nothing the marker has not yet set.
  const lastVehiclePressAtRef = useRef(0);
  const selectedStation = stations.find(
    (station) => station.code === selectedStationCode,
  );
  const lineBrand = getLineBrand(mode, lineCode, lineColor);
  const latitudeDelta = visibleRegion?.latitudeDelta ?? 0.05;
  const longitudeDelta = visibleRegion?.longitudeDelta ?? 0.05;

  const handleRegionChangeComplete = useCallback((region: Region) => {
    currentRegionRef.current = region;
    setVisibleRegion(region);
    setPlacementEpoch((current) => current + 1);
  }, []);

  const initialRegion = useMemo(() => {
    const center = selectedStation ?? stations[0];

    if (!center) {
      return {
        latitude: 41.3851,
        longitude: 2.1734,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }

    return {
      latitude: center.lat,
      longitude: center.lon,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }, [selectedStation, stations]);

  useEffect(() => {
    let isMounted = true;

    Location.getForegroundPermissionsAsync()
      .then(({ status }) => {
        if (isMounted) {
          setHasLocationPermission(status === 'granted');
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasLocationPermission(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (userLocationTimeoutRef.current) {
        clearTimeout(userLocationTimeoutRef.current);
      }
    },
    [],
  );

  const requestLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const isGranted = status === 'granted';
      setHasLocationPermission(isGranted);
      return isGranted;
    } catch {
      setHasLocationPermission(false);
      return false;
    }
  }, []);

  const visibleStations = useMemo(
    () => {
      if (!explorationVisible) {
        return [];
      }

      return stations.filter(
        (station) => Number.isFinite(station.lat) && Number.isFinite(station.lon),
      );
    },
    [explorationVisible, stations],
  );

  const markerStations = useMemo(
    () => selectStationMarkers(visibleStations, selectedStationCode, latitudeDelta),
    [latitudeDelta, selectedStationCode, visibleStations],
  );

  const namedStations = useMemo(() => {
    if (markerStations.length === 0) {
      return [];
    }

    // Bus lines have many more stops and short distances between them,
    // so we keep all-names off until the user is very zoomed in.
    const showAllThreshold = mode === 'bus' || mode === 'tram' ? 0.012 : 0.04;
    const showEveryThreshold = mode === 'tram' ? 0.025 : mode === 'bus' ? 0.025 : 0.08;
    const showAll = latitudeDelta <= showAllThreshold;
    const showEvery = latitudeDelta <= showEveryThreshold ? (mode === 'tram' ? 4 : 3) : 0;
    const result = new Map<string, (typeof markerStations)[number]>();

    // Always show terminals.
    result.set(markerStations[0].code, markerStations[0]);
    result.set(
      markerStations[markerStations.length - 1].code,
      markerStations[markerStations.length - 1],
    );

    // Always show selected station.
    if (selectedStation) {
      result.set(selectedStation.code, selectedStation);
    }

    if (showAll) {
      for (const station of markerStations) {
        result.set(station.code, station);
      }
    } else if (showEvery > 0) {
      for (let index = 0; index < markerStations.length; index += showEvery) {
        const station = markerStations[index];
        result.set(station.code, station);
      }
    }

    return Array.from(result.values());
  }, [latitudeDelta, markerStations, mode, selectedStation]);

  // Keep Apple Maps' logo, wordmark, and "Legal" link visible. Attached sheets
  // place them above the collapsed surface; detached sheets use the gap between
  // the surface and the native tab bar. Required by Apple's MapKit terms.
  const COLLAPSED_ATTACHED_SHEET_HEIGHT = 100;
  const DETACHED_ATTRIBUTION_CLEARANCE = 16;
  const attributionBottomInset = bottomOverlayOffset > 0
    ? Math.max(0, bottomOverlayOffset - DETACHED_ATTRIBUTION_CLEARANCE)
    : Math.min(bottomInset, COLLAPSED_ATTACHED_SHEET_HEIGHT);
  const mapPadding = useMemo(
    () => ({ top: 0, right: 0, bottom: attributionBottomInset, left: 0 }),
    [attributionBottomInset],
  );

  const legalLabelInsets = useMemo(
    () => ({ bottom: attributionBottomInset, left: 70, right: 0, top: 0 }),
    [attributionBottomInset],
  );
  const appleLogoInsets = useMemo(
    () => ({
      bottom: bottomOverlayOffset > 0
        ? Math.max(0, attributionBottomInset - 12)
        : attributionBottomInset,
      left: 8,
      right: 0,
      top: 0,
    }),
    [attributionBottomInset, bottomOverlayOffset],
  );
  const markerDetail = getMapMarkerDetail(latitudeDelta);
  const interchangeByStationKey = useMemo(() => {
    const nextInterchangeByStationKey = new Map<string, StationInterchange>();

    stationInterchanges.forEach((interchange) => {
      interchange.members.forEach((member) => {
        nextInterchangeByStationKey.set(
          `${member.line.code}:${member.station.code}`,
          interchange,
        );
      });
    });

    return nextInterchangeByStationKey;
  }, [stationInterchanges]);
  const badgeStations = useMemo(
    () =>
      markerStations.filter((station) => {
        const interchange = interchangeByStationKey.get(`${lineCode}:${station.code}`);
        const isSelected = station.code === selectedStationCode;
        return (
          (interchange?.members.length ?? 1) > 1 &&
          (isSelected || markerDetail === 'full')
        );
      }),
    [interchangeByStationKey, lineCode, markerDetail, markerStations, selectedStationCode],
  );
  const routePolylines = useMemo<RoutePolyline[]>(() => {
    if (!explorationVisible) {
      return [];
    }

    const segmentPolylines = segments
      .filter((segment) => segment.lineCode === lineCode)
      .map((segment) => ({
        id: `segment:${segment.id}`,
        coordinates: trimSegmentToStations(segment, stations)
          .map(toMapCoordinate)
          .filter(hasFiniteCoordinate),
      }))
      .filter((polyline) => polyline.coordinates.length > 1);

    if (segmentPolylines.length > 0) {
      return segmentPolylines;
    }

    const fallbackPolyline = getFallbackPolyline(stations);
    return fallbackPolyline ? [fallbackPolyline] : [];
  }, [explorationVisible, lineCode, segments, stations]);
  // Vehicles belong to the line being explored, so they are hidden alongside
  // its route and stations while the planner owns the map. They also feed the
  // annotation layout below, which is why they are placed this early.
  const placedVehicles = useMemo(() => {
    // Every vehicle is snapped onto the drawn route, and until the segments
    // arrive that route is the straight-line fallback through the stations.
    // Rendering then means placing each train on a stand-in track and moving it
    // the moment the real geometry lands — MapKit animates an annotation whose
    // coordinate changes, which is the slow drift across the map on load.
    if (!explorationVisible || routeGeometryPending) {
      return [];
    }

    const routeGeometry = routePolylines.map((polyline) =>
      polyline.coordinates.map((coordinate) => ({
        lat: coordinate.latitude,
        lon: coordinate.longitude,
      })),
    );
    const stationByCode = new Map(stations.map((station) => [station.code, station]));

    return transitVehicles
      .filter((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon))
      .map((vehicle) => {
        // The feed lists upcoming stops in travel order using catalog station
        // codes, so the first one orients the vehicle along the route.
        const nextStop = vehicle.nextStops.length
          ? stationByCode.get(vehicle.nextStops[0])
          : undefined;
        const placement = placePointOnPolylines(
          routeGeometry,
          { lat: vehicle.lat, lon: vehicle.lon },
          nextStop && Number.isFinite(nextStop.lat) && Number.isFinite(nextStop.lon)
            ? { lat: nextStop.lat, lon: nextStop.lon }
            : null,
          VEHICLE_SNAP_MAX_DISTANCE_METERS,
        );

        return {
          vehicle,
          // The feed reports the destination as a catalog station code, which is
          // not something to put in front of a user.
          destinationName: vehicle.destination
            ? stationByCode.get(vehicle.destination)?.name ?? vehicle.destination
            : undefined,
          coordinate: {
            latitude: placement.point.lat,
            longitude: placement.point.lon,
          },
          bearingDegrees: placement.bearingDegrees,
        };
      });
  }, [
    explorationVisible,
    routeGeometryPending,
    routePolylines,
    stations,
    transitVehicles,
  ]);
  const selectedVehicle = placedVehicles.find(
    ({ vehicle }) => vehicle.id === selectedVehicleId,
  );

  // Drop the detail when its train leaves the feed, changes line, or the
  // planner takes over, so the card can never outlive the marker it describes.
  useEffect(() => {
    if (selectedVehicleId !== null && !selectedVehicle) {
      setSelectedVehicleId(null);
    }
  }, [selectedVehicle, selectedVehicleId]);

  // Deliberately not memoised: the age has to be recomputed on every render so
  // it stays honest between polls. Nothing here is expensive.
  const selectedVehicleMeta = (() => {
    if (!selectedVehicle) {
      return '';
    }

    const { isOnTime, occupancyPercent } = selectedVehicle.vehicle;
    const parts: string[] = [];

    if (isOnTime !== undefined) {
      parts.push(t(isOnTime ? 'vehicle_on_time' : 'vehicle_delayed'));
    }
    if (occupancyPercent !== undefined) {
      parts.push(t('vehicle_occupancy', { percent: Math.round(occupancyPercent) }));
    }
    if (transitVehiclesUpdatedAt > 0) {
      const ageSeconds = Math.max(
        0,
        Math.round((Date.now() - transitVehiclesUpdatedAt) / 1_000),
      );
      parts.push(
        ageSeconds < 60
          ? t('vehicle_age_seconds', { seconds: ageSeconds })
          : t('vehicle_age_minutes', { minutes: Math.round(ageSeconds / 60) }),
      );
    }

    return parts.join(' · ');
  })();

  const vehicleObstacles = useMemo<MapAnnotationObstacle[]>(
    () =>
      placedVehicles.map(({ coordinate }) => ({
        lat: coordinate.latitude,
        lon: coordinate.longitude,
      })),
    [placedVehicles],
  );
  const annotationCandidates = useMemo<StationAnnotationCandidate[]>(() => {
    const candidatesByCode = new Map<string, StationAnnotationCandidate>();

    for (const station of namedStations) {
      candidatesByCode.set(station.code, {
        station,
        hasName: true,
        hasBadges: false,
        selected: station.code === selectedStationCode,
      });
    }

    for (const station of badgeStations) {
      const candidate = candidatesByCode.get(station.code);
      candidatesByCode.set(station.code, {
        station,
        hasName: candidate?.hasName ?? false,
        hasBadges: true,
        selected: station.code === selectedStationCode,
      });
    }

    return Array.from(candidatesByCode.values());
  }, [badgeStations, namedStations, selectedStationCode]);
  const visibleAnnotationCodes = useMemo(
    () =>
      getVisibleStationAnnotationCodes(
        annotationCandidates,
        {
          width: mapWidth,
          height: mapHeight,
          latitude: visibleRegion?.latitude ?? selectedStation?.lat ?? 41.3851,
          longitude: visibleRegion?.longitude ?? selectedStation?.lon ?? 2.1734,
          latitudeDelta,
          longitudeDelta,
        },
        vehicleObstacles,
      ),
    [
      annotationCandidates,
      latitudeDelta,
      longitudeDelta,
      mapHeight,
      mapWidth,
      selectedStation,
      vehicleObstacles,
      visibleRegion,
    ],
  );
  const visibleBadgeStations = useMemo(
    () => badgeStations.filter((station) => visibleAnnotationCodes.has(station.code)),
    [badgeStations, visibleAnnotationCodes],
  );
  const visibleNamedStations = useMemo(
    () => namedStations.filter((station) => visibleAnnotationCodes.has(station.code)),
    [namedStations, visibleAnnotationCodes],
  );

  const centerMap = useCallback((coordinate: LatLng, delta = 0.05) => {
    mapRef.current?.animateToRegion(
      {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      MAP_CENTER_ANIMATION_MS,
    );
  }, []);

  const stopWaitingForUserLocation = useCallback((message: string | null) => {
    shouldCenterOnNextUserLocationRef.current = false;
    setIsWaitingForUserLocation(false);
    setLocationMessage(message);

    if (userLocationTimeoutRef.current) {
      clearTimeout(userLocationTimeoutRef.current);
      userLocationTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (
      stationFocusRequestId === 0 ||
      stationFocusRequestId === lastStationFocusRequestRef.current ||
      !explorationVisible ||
      !selectedStation ||
      !isMapReady ||
      mapHeight <= 0
    ) {
      return;
    }

    lastStationFocusRequestRef.current = stationFocusRequestId;
    const currentRegion = currentRegionRef.current ?? {
      latitude: selectedStation.lat,
      longitude: selectedStation.lon,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
    const focusedRegion = getViewportFocusedRegion(
      {
        latitude: selectedStation.lat,
        longitude: selectedStation.lon,
      },
      currentRegion,
      {
        height: mapHeight,
        topInset,
        bottomInset,
      },
    );

    mapRef.current?.animateToRegion(focusedRegion, MAP_CENTER_ANIMATION_MS);
  }, [
    bottomInset,
    explorationVisible,
    isMapReady,
    mapHeight,
    selectedStation,
    stationFocusRequestId,
    topInset,
  ]);

  useEffect(() => {
    if (!plannerFocusKey) {
      lastPlannerFocusKeyRef.current = null;
      return;
    }

    if (!isMapReady || plannerFocusKey === lastPlannerFocusKeyRef.current) {
      return;
    }

    const points = [
      ...plannerPolylines
      .flatMap((polyline) => polyline.points)
      .filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
      ),
      ...plannerMarkers.map((marker) => marker.coordinate),
    ];
    if (points.length < 2) {
      return;
    }

    lastPlannerFocusKeyRef.current = plannerFocusKey;
    mapRef.current?.fitToCoordinates(points.map(toMapCoordinate), {
      animated: true,
      edgePadding: {
        top: 80,
        right: 56,
        bottom: Math.max(140, bottomInset + 32),
        left: 56,
      },
    });
  }, [bottomInset, isMapReady, plannerFocusKey, plannerMarkers, plannerPolylines]);

  useEffect(() => {
    if (!plannerStepFocus) {
      lastPlannerStepFocusKeyRef.current = null;
      return;
    }
    if (
      !isMapReady ||
      plannerStepFocus.key === lastPlannerStepFocusKeyRef.current
    ) {
      return;
    }
    lastPlannerStepFocusKeyRef.current = plannerStepFocus.key;
    centerMap(toMapCoordinate(plannerStepFocus.coordinate), 0.018);
  }, [centerMap, isMapReady, plannerStepFocus]);

  const handleStationPress = useCallback(
    (stationCode: string) => {
      onStationPress(stationCode);
    },
    [onStationPress],
  );

  const handleUserLocationChange = useCallback(
    (event: UserLocationChangeEvent) => {
      const coordinate = event.nativeEvent.coordinate;

      if (!coordinate) {
        return;
      }

      setUserCoordinate({
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      });
      onUserLocationChange?.({ lat: coordinate.latitude, lon: coordinate.longitude });
      setLocationMessage(null);

      if (shouldCenterOnNextUserLocationRef.current) {
        stopWaitingForUserLocation(null);
        centerMap(coordinate, 0.025);
      }
    },
    [centerMap, onUserLocationChange, stopWaitingForUserLocation],
  );

  const handleCenterUserLocation = useCallback(async () => {
    setLocationMessage(null);

    const isGranted = hasLocationPermission
      ? true
      : await requestLocationPermission();

    if (!isGranted) {
      stopWaitingForUserLocation('Location permission is needed to center the map.');
      return;
    }

    if (userCoordinate) {
      centerMap(userCoordinate, 0.025);
      return;
    }

    shouldCenterOnNextUserLocationRef.current = true;
    setIsWaitingForUserLocation(true);

    if (userLocationTimeoutRef.current) {
      clearTimeout(userLocationTimeoutRef.current);
    }

    userLocationTimeoutRef.current = setTimeout(() => {
      stopWaitingForUserLocation(
        'Current location is not available. Check location services and try again.',
      );
    }, USER_LOCATION_TIMEOUT_MS);
  }, [
    centerMap,
    hasLocationPermission,
    requestLocationPermission,
    stopWaitingForUserLocation,
    userCoordinate,
  ]);

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      const coordinate = event.nativeEvent.coordinate;
      if (Date.now() - lastVehiclePressAtRef.current > VEHICLE_PRESS_ECHO_MS) {
        setSelectedVehicleId(null);
      }
      onMapPress?.({ lat: coordinate.latitude, lon: coordinate.longitude });
    },
    [onMapPress],
  );

  // Pressing the same train again closes the card, which together with a press
  // on empty map is why it needs no close button of its own.
  const handleVehiclePress = useCallback((vehicleId: string) => {
    lastVehiclePressAtRef.current = Date.now();
    setSelectedVehicleId((current) => (current === vehicleId ? null : vehicleId));
  }, []);

  const routeLayerKey = routePolylines
    .map((polyline) => `${polyline.id}:${polyline.coordinates.length}`)
    .join('|');
  const shouldRenderRoutePolylines = isMapReady && routePolylines.length > 0;
  const hasPlannerRoute = plannerPolylines.length > 0;
  const routeStrokeColor = hasPlannerRoute
    ? withAlpha(lineBrand.backgroundColor, 0.22)
    : lineBrand.backgroundColor;
  const routeStrokeWidth = hasPlannerRoute ? 3 : 5;
  const routeZIndex = hasPlannerRoute ? MAP_Z.routeBehindPlanner : MAP_Z.route;

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setMapWidth(width);
        setMapHeight(height);
      }}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        mapPadding={mapPadding}
        legalLabelInsets={legalLabelInsets}
        appleLogoInsets={appleLogoInsets}
        onMapReady={() => setIsMapReady(true)}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPress={handleMapPress}
        onUserLocationChange={handleUserLocationChange}
        showsUserLocation={hasLocationPermission || isWaitingForUserLocation}
        userLocationPriority="balanced"
        userInterfaceStyle={colorScheme}
      >
        {shouldRenderRoutePolylines
          ? routePolylines.map((polyline) => (
              <Polyline
                key={`${lineCode}:route:${routeLayerKey}:${polyline.id}`}
                coordinates={polyline.coordinates}
                lineCap="round"
                lineJoin="round"
                strokeWidth={routeStrokeWidth}
                strokeColor={routeStrokeColor}
                zIndex={routeZIndex}
              />
            ))
          : null}

        {plannerPolylines.map((polyline, index) => {
          const coordinates = polyline.points
            .map(toMapCoordinate)
            .filter(hasFiniteCoordinate);
          if (coordinates.length < 2) {
            return null;
          }

          return (
            <Polyline
              key={`planner:${polyline.id}`}
              coordinates={coordinates}
              lineCap="round"
              lineJoin="round"
              strokeWidth={6}
              strokeColor={polyline.color}
              zIndex={MAP_Z.plannerRoute + index}
            />
          );
        })}

        {markerStations.map((station) => {
          const isSelected = station.code === selectedStationCode;

          return (
            <Marker
              key={`${lineCode}:station:${station.code}:${isSelected ? 'dynamic-selected' : 'native'}`}
              anchor={STATION_MARKER_ANCHOR}
              centerOffset={STATION_MARKER_CENTER_OFFSET}
              coordinate={{ latitude: station.lat, longitude: station.lon }}
              image={isSelected ? undefined : STATION_MARKER_IMAGE}
              tracksViewChanges={isSelected}
              zIndex={isSelected ? MAP_Z.stationSelected : MAP_Z.station}
              onPress={() => handleStationPress(station.code)}
            >
              {isSelected ? (
                <DynamicSelectedStationMarker color={lineBrand.backgroundColor} />
              ) : null}
            </Marker>
          );
        })}

        {visibleBadgeStations.map((station) => {
          const isSelected = station.code === selectedStationCode;
          const interchange = interchangeByStationKey.get(`${lineCode}:${station.code}`);
          const interchangeLines =
            (interchange ? getUniqueInterchangeLines(interchange.members) : null) ?? [{
              code: lineCode,
              name: lineCode,
              mode,
              operator: mode === 'tram' ? 'tram' : mode === 'fgc' ? 'fgc' : 'tmb',
              vehicleMode: mode === 'tram' ? 'tram' : mode === 'fgc' ? 'rail' : mode,
              color: lineColor,
            }];
          const transferLines = prioritizeSelectedInterchangeLine(
            interchangeLines,
            mode,
            lineCode,
          );
          const visibleLineCount =
            isSelected || markerDetail === 'full'
              ? 2
              : interchangeLines.length === 2
                ? 2
                : 1;

          return (
            <Marker
              key={`${lineCode}:station-badges:${station.code}:${transferLines.map((line) => `${line.mode}-${line.code}`).join('-')}`}
              anchor={STATION_BADGE_ANCHOR}
              centerOffset={STATION_MARKER_CENTER_OFFSET}
              coordinate={{ latitude: station.lat, longitude: station.lon }}
              tracksViewChanges={false}
              zIndex={MAP_Z.stationBadge}
              onPress={() => handleStationPress(station.code)}
            >
              <StationTransferBadges
                lines={transferLines}
                visibleLineCount={visibleLineCount}
              />
            </Marker>
          );
        })}

        {visibleNamedStations.map((station) => {
          const isSelected = station.code === selectedStationCode;

          return (
            <StationNameMarker
              key={`${lineCode}:station-name:${station.code}`}
              coordinate={{ latitude: station.lat, longitude: station.lon }}
              emphasized={isSelected}
              lineColor={lineBrand.backgroundColor}
              stationName={station.name}
              onPress={() => handleStationPress(station.code)}
            />
          );
        })}

        {nearbyStops.slice(0, 25).map((stop) => (
          <Marker
            key={`nearby:${stop.mode}:${stop.lineCode}:${stop.code}`}
            anchor={STATION_MARKER_ANCHOR}
            centerOffset={STATION_MARKER_CENTER_OFFSET}
            coordinate={{ latitude: stop.lat, longitude: stop.lon }}
            tracksViewChanges={false}
            zIndex={MAP_Z.nearbyStop}
            onPress={() => onNearbyStopPress?.(stop)}
          >
            <NearbyStopDot mode={stop.mode} lineCode={stop.lineCode} lineColor={stop.lineColor} />
          </Marker>
        ))}

        {placedVehicles.map(({ vehicle, coordinate, bearingDegrees }) => (
          <VehicleMarker
            key={`vehicle:${vehicle.id}`}
            accessibilityLabel={`${vehicle.lineCode}${vehicle.destination ? `, ${vehicle.destination}` : ''}`}
            coordinate={coordinate}
            bearingDegrees={bearingDegrees}
            color={lineBrand.backgroundColor}
            iconColor={lineBrand.textColor}
            updatedAt={transitVehiclesUpdatedAt}
            placementEpoch={placementEpoch}
            selected={vehicle.id === selectedVehicleId}
            onPress={() => handleVehiclePress(vehicle.id)}
          />
        ))}

        {latitudeDelta <= 0.02
          ? nearbyStops.slice(0, latitudeDelta <= 0.008 ? 25 : 8).map((stop) => (
              <Marker
                key={`nearby-label:${stop.mode}:${stop.lineCode}:${stop.code}`}
                anchor={STATION_NAME_ANCHOR}
                centerOffset={STATION_NAME_CENTER_OFFSET}
                coordinate={{ latitude: stop.lat, longitude: stop.lon }}
                tracksViewChanges={false}
                zIndex={MAP_Z.nearbyStopLabel}
                onPress={() => onNearbyStopPress?.(stop)}
              >
                <NearbyStopLabel
                  mode={stop.mode}
                  lineCode={stop.lineCode}
                  lineColor={stop.lineColor}
                  name={stop.name}
                />
              </Marker>
            ))
          : null}

        {plannerMarkers.map((marker) => {
          const coordinate = {
            latitude: marker.coordinate.lat,
            longitude: marker.coordinate.lon,
          };
          const selectionKey = marker.selected ? 'selected' : 'idle';
          const handlePress = () => onPlannerMarkerPress?.(marker.legId);

          if (marker.kind === 'origin' || marker.kind === 'destination') {
            return (
              <Marker
                key={`planner-endpoint:${marker.id}:${selectionKey}`}
                accessibilityLabel={marker.accessibilityLabel}
                anchor={STATION_MARKER_ANCHOR}
                centerOffset={STATION_MARKER_CENTER_OFFSET}
                coordinate={coordinate}
                tracksViewChanges={false}
                zIndex={MAP_Z.plannerEndpoint}
                onPress={handlePress}
              >
                <PlannerEndpointMarker marker={marker} />
              </Marker>
            );
          }

          const routeCode = marker.outgoingRoute ?? marker.incomingRoute ?? '';
          const routeMode = marker.outgoingMode ?? marker.incomingMode ?? getPlannerRouteMode(routeCode);
          const routeBrand = getLineBrand(routeMode, routeCode);
          const usesDynamicSelectedMarker = Boolean(marker.selected);
          const transferRoutes = [
            marker.incomingRoute
              ? { code: marker.incomingRoute, mode: marker.incomingMode ?? getPlannerRouteMode(marker.incomingRoute) }
              : null,
            marker.outgoingRoute
              ? { code: marker.outgoingRoute, mode: marker.outgoingMode ?? getPlannerRouteMode(marker.outgoingRoute) }
              : null,
          ].filter((value): value is { code: string; mode: TransportMode } => value !== null)
            .filter((value, index, values) =>
              index === values.findIndex((candidate) => candidate.code === value.code),
            );

          return (
            <Fragment key={`planner-station:${marker.id}:${selectionKey}`}>
              <Marker
                accessibilityLabel={marker.accessibilityLabel}
                anchor={STATION_MARKER_ANCHOR}
                centerOffset={STATION_MARKER_CENTER_OFFSET}
                coordinate={coordinate}
                image={usesDynamicSelectedMarker ? undefined : STATION_MARKER_IMAGE}
                tracksViewChanges={usesDynamicSelectedMarker}
                zIndex={MAP_Z.plannerStation}
                onPress={handlePress}
              >
                {usesDynamicSelectedMarker ? (
                  <DynamicSelectedStationMarker color={routeBrand.backgroundColor} />
                ) : null}
              </Marker>
              {marker.kind === 'transfer' && transferRoutes.length > 1 ? (
                <Marker
                  accessibilityElementsHidden
                  anchor={STATION_BADGE_ANCHOR}
                  centerOffset={STATION_MARKER_CENTER_OFFSET}
                  coordinate={coordinate}
                  tracksViewChanges={false}
                  zIndex={MAP_Z.plannerBadge}
                  onPress={handlePress}
                >
                  <PlannerTransferBadges routes={transferRoutes} />
                </Marker>
              ) : null}
              <Marker
                accessibilityElementsHidden
                anchor={STATION_NAME_ANCHOR}
                centerOffset={STATION_NAME_CENTER_OFFSET}
                coordinate={coordinate}
                tracksViewChanges={false}
                zIndex={MAP_Z.plannerName}
                onPress={handlePress}
              >
                <StationNameLabel
                  lineColor={routeBrand.backgroundColor}
                  stationName={marker.name}
                  emphasized={marker.selected}
                />
              </Marker>
            </Fragment>
          );
        })}

        {/* Anchored to the train rather than pinned to a corner of the screen,
            so MapKit keeps it glued to the coordinate while the map pans. This
            is the same plain-annotation approach the station name labels use —
            what makes it safe is that no MapKit Callout is involved. */}
        {selectedVehicle ? (
          <Marker
            key={`vehicle-detail:${selectedVehicle.vehicle.id}`}
            anchor={VEHICLE_DETAIL_ANCHOR}
            centerOffset={VEHICLE_DETAIL_CENTER_OFFSET}
            coordinate={selectedVehicle.coordinate}
            zIndex={MAP_Z.vehicleDetail}
            onPress={() => setSelectedVehicleId(null)}
          >
            <View style={styles.vehicleCard}>
              <View style={styles.vehicleCardHeader}>
                <View
                  style={[
                    styles.vehicleCardBadge,
                    { backgroundColor: lineBrand.backgroundColor },
                  ]}
                >
                  <Text
                    style={[styles.vehicleCardBadgeText, { color: lineBrand.textColor }]}
                  >
                    {lineBrand.label}
                  </Text>
                </View>
                {selectedVehicle.destinationName ? (
                  <Text numberOfLines={1} style={styles.vehicleCardDestination}>
                    {selectedVehicle.destinationName}
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={1} style={styles.vehicleCardMeta}>
                {selectedVehicleMeta}
              </Text>
            </View>
          </Marker>
        ) : null}

      </MapView>

      <Animated.View
        pointerEvents="box-none"
        style={[styles.actionsColumn, bottomControlsAnimatedStyle]}
      >
        {bottomActions}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('map_center_location')}
          style={[
            styles.actionButton,
            !userCoordinate && !isWaitingForUserLocation && styles.actionButtonIdle,
          ]}
          onPress={handleCenterUserLocation}
        >
          {isWaitingForUserLocation ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <IconSymbol
              name="location.fill"
              size={22}
              color={userCoordinate ? palette.text : palette.textMuted}
              weight="semibold"
            />
          )}
        </Pressable>
      </Animated.View>
      {locationMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.locationMessage, bottomControlsAnimatedStyle]}
        >
          <Text style={styles.locationMessageText}>{locationMessage}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

function StationTransferBadges({
  lines,
  visibleLineCount,
}: {
  lines: Line[];
  visibleLineCount: number;
}) {
  const styles = useThemedStyles(createStyles);
  const visibleLines = lines.slice(0, visibleLineCount);
  const extraCount = Math.max(0, lines.length - visibleLines.length);

  return (
    <View style={styles.transferBadgeAnchorBox}>
      <View style={styles.transferBadgeRow}>
        {visibleLines.map((line) => {
          const brand = getLineBrand(line.mode, line.code, line.color);

          return (
            <View
              key={`${line.mode}:${line.code}`}
              style={[
                styles.transferBadge,
                { backgroundColor: brand.backgroundColor },
              ]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.transferBadgeText, { color: brand.textColor }]}
              >
                {brand.label}
              </Text>
            </View>
          );
        })}
        {extraCount > 0 ? (
          <View style={styles.extraBadge}>
            <Text style={styles.extraBadgeText}>+{extraCount}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PlannerTransferBadges({
  routes,
}: {
  routes: { code: string; mode: TransportMode }[];
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.transferBadgeAnchorBox}>
      <View style={styles.transferBadgeRow}>
        {routes.slice(0, 3).map((route) => {
          const brand = getLineBrand(route.mode, route.code);
          return (
            <View
              key={`${route.mode}:${route.code}`}
              style={[styles.transferBadge, { backgroundColor: brand.backgroundColor }]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.transferBadgeText, { color: brand.textColor }]}
              >
                {brand.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function NearbyStopDot({ mode, lineCode, lineColor }: { mode: TransportMode; lineCode: string; lineColor?: string }) {
  const styles = useThemedStyles(createStyles);
  const brand = getLineBrand(mode, lineCode, lineColor);
  return (
    <View
      style={[styles.nearbyDot, { backgroundColor: brand.backgroundColor }]}
    />
  );
}

function VehicleMarker({
  accessibilityLabel,
  coordinate,
  bearingDegrees,
  color,
  iconColor,
  updatedAt,
  placementEpoch,
  selected,
  onPress,
}: {
  accessibilityLabel: string;
  coordinate: LatLng;
  bearingDegrees: number | null;
  color: string;
  iconColor: string;
  updatedAt: number;
  placementEpoch: number;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const firstRing = useRef(new RNAnimated.Value(0)).current;
  const secondRing = useRef(new RNAnimated.Value(0)).current;
  // Counts layout passes of the marker box; see VEHICLE_PLACEMENT_NUDGE_DEGREES
  // for why every one of them has to alter the coordinate.
  const [layoutPass, setLayoutPass] = useState(0);
  const nudged = (layoutPass + placementEpoch) % 2 === 0;
  const placedCoordinate = nudged
    ? {
        latitude: coordinate.latitude + VEHICLE_PLACEMENT_NUDGE_DEGREES,
        longitude: coordinate.longitude,
      }
    : coordinate;

  // Two staggered sonar rings fire whenever the feed reports movement, which is
  // what `updatedAt` tracks. They run on the native driver and never touch the
  // annotation's coordinate, so an open callout survives them: MapKit only
  // dismisses a callout when the annotation it is attached to moves.
  //
  // Not on mount, though: nothing moved, the marker merely appeared, and two
  // rings expanding around a small tile for two seconds read as the train
  // sliding into place rather than as a train that just reported a position.
  const pulsedAtRef = useRef(updatedAt);

  useEffect(() => {
    if (pulsedAtRef.current === updatedAt) {
      return;
    }
    pulsedAtRef.current = updatedAt;

    firstRing.setValue(0);
    secondRing.setValue(0);
    const animation = RNAnimated.stagger(VEHICLE_PULSE_STAGGER_MS, [
      RNAnimated.timing(firstRing, {
        toValue: 1,
        duration: VEHICLE_PULSE_RING_MS,
        useNativeDriver: true,
      }),
      RNAnimated.timing(secondRing, {
        toValue: 1,
        duration: VEHICLE_PULSE_RING_MS,
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => animation.stop();
  }, [firstRing, secondRing, updatedAt]);

  const ringStyle = (ring: RNAnimated.Value) => [
    styles.vehiclePulseRing,
    {
      backgroundColor: color,
      opacity: ring.interpolate({
        inputRange: [0, 0.12, 1],
        outputRange: [0, 0.4, 0],
      }),
      transform: [
        {
          scale: ring.interpolate({
            inputRange: [0, 1],
            outputRange: [0.45, 1],
          }),
        },
      ],
    },
  ];

  return (
    <Marker
      accessibilityLabel={accessibilityLabel}
      anchor={STATION_MARKER_ANCHOR}
      coordinate={placedCoordinate}
      zIndex={MAP_Z.vehicle}
      onPress={onPress}
    >
      <View
        style={styles.vehicleMarkerBox}
        onLayout={() => setLayoutPass((current) => current + 1)}
      >
        <RNAnimated.View pointerEvents="none" style={ringStyle(firstRing)} />
        <RNAnimated.View pointerEvents="none" style={ringStyle(secondRing)} />
        {/* The detail card sits at the bottom of the screen, so the halo is what
            ties it to this particular train rather than proximity. */}
        {selected ? (
          <View
            pointerEvents="none"
            style={[
              styles.vehicleSelectedHalo,
              {
                backgroundColor: withAlpha(color, 0.22),
                borderColor: withAlpha(color, 0.75),
              },
            ]}
          />
        ) : null}
        {bearingDegrees !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.vehicleHeadingBox,
              { transform: [{ rotate: `${bearingDegrees}deg` }] },
            ]}
          >
            <View style={styles.vehicleHeadingTip} />
          </View>
        ) : null}
        <View style={[styles.vehicleMarker, { backgroundColor: color }]}>
          <MaterialIcons name="tram" size={15} color={iconColor} />
        </View>
      </View>
    </Marker>
  );
}

function NearbyStopLabel({
  mode,
  lineCode,
  lineColor,
  name,
}: {
  mode: TransportMode;
  lineCode: string;
  lineColor?: string;
  name: string;
}) {
  const styles = useThemedStyles(createStyles);
  const brand = getLineBrand(mode, lineCode, lineColor);
  return (
    <View style={styles.nearbyLabel}>
      <View style={[styles.nearbyLabelBadge, { backgroundColor: brand.backgroundColor }]}>
        <Text style={styles.nearbyLabelBadgeText}>
          {brand.label}
        </Text>
      </View>
      <Text numberOfLines={1} style={styles.nearbyLabelText}>
        {name}
      </Text>
    </View>
  );
}

function StationNameLabel({
  lineColor,
  stationName,
  emphasized = false,
  onTextLayout,
}: {
  lineColor: string;
  stationName: string;
  emphasized?: boolean;
  onTextLayout?: (event: NativeSyntheticEvent<TextLayoutEventData>) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={[
        styles.stationNameLabel,
        emphasized
          ? [styles.stationNameLabelEmphasized, { borderColor: lineColor }]
          : null,
      ]}>
      <Text
        numberOfLines={2}
        onTextLayout={onTextLayout}
        style={[
          styles.stationNameText,
          emphasized ? styles.stationNameTextEmphasized : null,
        ]}>
        {stationName}
      </Text>
    </View>
  );
}

function StationNameMarker({
  coordinate,
  emphasized,
  lineColor,
  stationName,
  onPress,
}: {
  coordinate: LatLng;
  emphasized: boolean;
  lineColor: string;
  stationName: string;
  onPress: () => void;
}) {
  const [lineCount, setLineCount] = useState<number | null>(null);
  const handleTextLayout = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<TextLayoutEventData>) => {
      const nextLineCount = nativeEvent.lines.length;
      setLineCount((currentLineCount) =>
        currentLineCount === nextLineCount ? currentLineCount : nextLineCount,
      );
    },
    [],
  );

  return (
    <Marker
      anchor={STATION_NAME_ANCHOR}
      centerOffset={
        !emphasized
          ? UNSELECTED_STATION_NAME_CENTER_OFFSET
          : lineCount !== null && lineCount > 1
            ? SELECTED_MULTILINE_STATION_NAME_CENTER_OFFSET
            : SELECTED_STATION_NAME_CENTER_OFFSET
      }
      coordinate={coordinate}
      tracksViewChanges={emphasized && lineCount === null}
      zIndex={emphasized ? MAP_Z.stationNameSelected : MAP_Z.stationName}
      onPress={onPress}
    >
      <StationNameLabel
        lineColor={lineColor}
        stationName={stationName}
        emphasized={emphasized}
        onTextLayout={emphasized ? handleTextLayout : undefined}
      />
    </Marker>
  );
}

function PlannerEndpointMarker({ marker }: { marker: PlannerMapMarker }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.plannerEndpointWrap}>
      <View style={[styles.plannerMarker, marker.selected ? styles.plannerMarkerSelected : null]}>
        <Text style={styles.plannerMarkerText}>{marker.label}</Text>
      </View>
      {marker.kind === 'destination' ? <View style={styles.destinationTail} /> : null}
    </View>
  );
}

function DynamicSelectedStationMarker({ color }: { color: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View collapsable={false} style={styles.selectedStationHitTarget}>
      <View
        collapsable={false}
        style={[
          styles.selectedStationHalo,
          {
            backgroundColor: withAlpha(color, 0.2),
            borderColor: withAlpha(color, 0.72),
          },
        ]}
      >
        <View
          collapsable={false}
          style={[styles.selectedStationCore, { backgroundColor: color }]}
        />
      </View>
    </View>
  );
}

const createStyles = (palette: Palette) => StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  actionsColumn: {
    position: 'absolute',
    right: 16,
    bottom: 28,
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 15,
  },
  actionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.mapControlSurface,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 8,
  },
  actionButtonIdle: {
    opacity: 0.82,
  },
  locationMessage: {
    position: 'absolute',
    right: 16,
    bottom: 80,
    maxWidth: 240,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: palette.surfaceTranslucent,
    borderWidth: 1,
    borderColor: palette.border,
    zIndex: 15,
  },
  locationMessageText: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  transferBadgeRow: {
    flexDirection: 'row',
    gap: 2,
  },
  transferBadgeAnchorBox: {
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    minWidth: 34,
    minHeight: 23,
    paddingLeft: 26,
    paddingBottom: 11,
  },
  transferBadge: {
    minWidth: 24,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: palette.surface,
  },
  transferBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },
  extraBadge: {
    minWidth: 21,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.surface,
  },
  extraBadgeText: {
    color: palette.text,
    fontSize: 10,
    fontWeight: '900',
  },
  nearbyDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.32,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  selectedStationHitTarget: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedStationHalo: {
    width: 29,
    height: 29,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedStationCore: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  // Sized to fit the sonar rings so the rasterised bitmap is never clipped.
  vehicleMarkerBox: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehiclePulseRing: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  // Rotated around the box centre so the tip circles the marker edge,
  // pointing along the vehicle heading; the train glyph itself stays upright.
  vehicleHeadingBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 60,
    height: 60,
    alignItems: 'center',
  },
  vehicleHeadingTip: {
    marginTop: 8,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFFFFF',
  },
  // Centred in the 60 pt marker box, behind the tile.
  vehicleSelectedHalo: {
    position: 'absolute',
    top: 10.5,
    left: 10.5,
    width: 39,
    height: 39,
    borderRadius: 15,
    borderWidth: 1.5,
  },
  // A rounded tile, deliberately not a circle: every station annotation on the
  // map is a white-ringed disc, and a disc-shaped vehicle at a station read as
  // a second station rather than as a train. The radius stays close to circular
  // so the orbiting heading tip keeps an even gap at every angle — a squarer
  // corner reaches further from the centre than the middle of an edge does.
  vehicleMarker: {
    width: 27,
    height: 27,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: palette.shadow,
    shadowOpacity: 0.32,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  // Lives inside a Marker, so it sizes to its content and needs no positioning
  // of its own. The cap keeps a long destination from spanning the viewport.
  vehicleCard: {
    // Fits "Barcelona - Plaça Catalunya", the longest destination on the network.
    maxWidth: 248,
    gap: 3,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  vehicleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  vehicleCardBadge: {
    minWidth: 26,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  vehicleCardBadgeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  vehicleCardDestination: {
    flexShrink: 1,
    color: palette.text,
    fontSize: 13,
    fontWeight: '800',
  },
  vehicleCardMeta: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  nearbyLabel: {
    maxWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 6,
    backgroundColor: palette.surfaceTranslucent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderStrong,
    paddingLeft: 3,
    paddingRight: 6,
    paddingVertical: 2,
    gap: 4,
  },
  nearbyLabelBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyLabelBadgeText: {
    color: palette.textInverse,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  nearbyLabelText: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  plannerMarker: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: palette.surfaceStrong,
    borderWidth: 2,
    borderColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  plannerEndpointWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  plannerMarkerSelected: {
    borderColor: palette.accent,
    borderWidth: 4,
  },
  destinationTail: {
    width: 10,
    height: 10,
    marginTop: -7,
    transform: [{ rotate: '45deg' }],
    backgroundColor: palette.surfaceStrong,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: palette.surface,
  },
  plannerMarkerText: {
    color: palette.textInverse,
    fontSize: 13,
    fontWeight: '800',
  },
  // An opaque fill and a real 1 pt outline: over a map the translucent surface
  // let the streets underneath through, and a hairline in a surface tone had
  // nothing to separate the label from whatever it happened to sit on.
  stationNameLabel: {
    maxWidth: 156,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 7,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.textMuted,
    paddingHorizontal: 7,
    paddingVertical: 3,
    shadowColor: palette.shadow,
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  stationNameLabelEmphasized: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 2.5,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    transform: [{ scale: 1.04 }],
  },
  stationNameText: {
    color: palette.text,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'left',
    letterSpacing: 0.1,
  },
  stationNameTextEmphasized: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.text,
  },
});
