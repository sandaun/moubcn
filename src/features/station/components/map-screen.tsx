import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MapAdapter,
  type PlannerMapMarker,
  type PlannerMapPolyline,
} from '@/src/features/station/components/map-adapter';
import { ModeToggle } from '@/src/features/station/components/mode-toggle';
import { FamilyFilter } from '@/src/features/station/components/family-filter';
import { SearchShell } from '@/src/features/station/components/search-shell';
import { NearbyControl } from '@/src/features/nearby/components/nearby-control';
import { RouteControl } from '@/src/features/planner/components/route-control';
import type { RouteLandmark } from '@/src/features/planner/utils/route-presentation';
import {
  useNearbyStopsQuery,
  type NearbyStop,
} from '@/src/features/nearby/hooks/use-nearby-stops-query';
import type { Line, TransportMode } from '@/src/domain/catalog/models';
import {
  filterLinesByFamily,
  getBusLineFamily,
  listAvailableFamilies,
  type BusLineFamily,
} from '@/src/features/catalog/utils/bus-line-family';
import { useLineStationsQuery } from '@/src/features/catalog/hooks/use-line-stations-query';
import { useLineSegmentsQuery } from '@/src/features/station/hooks/use-line-segments-query';
import { useLineVehiclesQuery } from '@/src/features/station/hooks/use-line-vehicles-query';
import type { StationInterchange } from '@/src/features/station/utils/station-interchanges';
import { useAppLanguage } from '@/src/i18n';
import { Text, type Palette, useThemedStyles } from '@/src/design-system';

interface MapScreenProps {
  lineCode: string;
  lines?: Line[];
  mode: TransportMode;
  pendingMode?: TransportMode | null;
  stationCode: string;
  stationFocusRequestId?: number;
  showBackButton?: boolean;
  stationInterchanges?: StationInterchange[];
  bottomInset?: number;
  bottomOverlayOffset?: number;
  animatedBottomInset?: SharedValue<number>;
  onLineChange?: (lineCode: string) => void;
  onModeChange?: (mode: TransportMode) => void;
  onStationChange?: (stationCode: string) => void;
  onNearbyStopSelect?: (stop: NearbyStop) => void;
  nearbyEnabled: boolean;
  nearbyModes: TransportMode[];
  onNearbyToggle: () => void;
  onNearbyConfigurationPress: () => void;
  onUserLocationChange?: (coordinate: { lat: number; lon: number } | null) => void;
  plannerEnabled?: boolean;
  plannerOrigin?: { lat: number; lon: number } | null;
  plannerOriginLabel?: string | null;
  plannerDestination?: { lat: number; lon: number } | null;
  plannerDestinationLabel?: string | null;
  plannerActivePoint?: 'origin' | 'destination';
  plannerEditing?: boolean;
  plannerLandmarks?: RouteLandmark[];
  plannerRoutePolylines?: PlannerMapPolyline[];
  plannerFocusKey?: string | null;
  plannerStepFocus?: { key: string; coordinate: { lat: number; lon: number } } | null;
  selectedPlannerLegId?: string | null;
  placeToSave?: boolean;
  onPlannerToggle?: () => void;
  onPlannerMapPress?: (coordinate: { lat: number; lon: number }) => void;
  onPlannerMarkerPress?: (legId: string | undefined) => void;
  onPlaceSaveMapPress?: (coordinate: { lat: number; lon: number }) => void;
}

const NEARBY_RADIUS_METERS = 500;

export function MapScreen({
  lineCode,
  lines,
  mode,
  pendingMode = null,
  stationCode,
  stationFocusRequestId = 0,
  showBackButton = true,
  stationInterchanges,
  bottomInset = 0,
  bottomOverlayOffset = 0,
  animatedBottomInset,
  onLineChange,
  onModeChange,
  onStationChange,
  onNearbyStopSelect,
  nearbyEnabled,
  nearbyModes,
  onNearbyToggle,
  onNearbyConfigurationPress,
  onUserLocationChange,
  plannerEnabled = false,
  plannerOrigin = null,
  plannerOriginLabel = null,
  plannerDestination = null,
  plannerDestinationLabel = null,
  plannerActivePoint = 'destination',
  plannerEditing = true,
  plannerLandmarks = [],
  plannerRoutePolylines = [],
  plannerFocusKey = null,
  plannerStepFocus = null,
  selectedPlannerLegId = null,
  placeToSave = false,
  onPlannerToggle,
  onPlannerMapPress,
  onPlannerMarkerPress,
  onPlaceSaveMapPress,
}: MapScreenProps) {
  const styles = useThemedStyles(createStyles);
  const { t } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [topOverlayHeight, setTopOverlayHeight] = useState(0);
  const explorationVisible = !plannerEnabled;
  const topMapInset = showBackButton || explorationVisible
    ? insets.top + 8 + topOverlayHeight + 12
    : insets.top;

  const stationsQuery = useLineStationsQuery(mode, lineCode);
  const segmentsQuery = useLineSegmentsQuery(mode, lineCode);
  const { vehicles, positionsUpdatedAt } = useLineVehiclesQuery(mode, lineCode);
  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);

  const [busFamily, setBusFamily] = useState<BusLineFamily | null>(null);
  const lastSyncedLineCodeRef = useRef<string | null>(null);

  // Reset the family filter when leaving bus mode.
  useEffect(() => {
    if (mode !== 'bus') {
      setBusFamily(null);
      lastSyncedLineCodeRef.current = null;
    }
  }, [mode]);

  // When the active line changes externally to one that is not visible under the
  // current family filter, switch to its family so the user can still see it.
  // Importantly, this never fires when the user is the one toggling the filter.
  useEffect(() => {
    if (mode !== 'bus' || !lineCode) {
      lastSyncedLineCodeRef.current = lineCode ?? null;
      return;
    }

    if (lastSyncedLineCodeRef.current === lineCode) {
      return;
    }
    lastSyncedLineCodeRef.current = lineCode;

    if (busFamily === null) {
      return;
    }

    const family = getBusLineFamily(lineCode);
    if (family !== busFamily) {
      setBusFamily(family);
    }
  }, [busFamily, lineCode, mode]);

  const availableFamilies = useMemo(
    () => (mode === 'bus' ? listAvailableFamilies(lines ?? []) : []),
    [lines, mode],
  );

  const visibleLines = useMemo(() => {
    if (mode !== 'bus' || !lines) {
      return lines ?? [];
    }
    return filterLinesByFamily(lines, busFamily);
  }, [busFamily, lines, mode]);

  const activeLine = useMemo(
    () => lines?.find((line) => line.code === lineCode),
    [lineCode, lines],
  );

  const nearbyQuery = useNearbyStopsQuery(userLocation, {
    modes: nearbyModes,
    radiusMeters: NEARBY_RADIUS_METERS,
    enabled: nearbyEnabled && explorationVisible,
  });

  const activeStationCodes = useMemo(
    () => new Set(stations.map((s) => s.code)),
    [stations],
  );

  const nearbyMarkers = useMemo(() => {
    if (!nearbyEnabled || !explorationVisible) {
      return [];
    }
    return (nearbyQuery.data ?? [])
      .filter((stop) => !(stop.mode === mode && activeStationCodes.has(stop.code)))
      .map((stop) => ({
        code: stop.code,
        lineCode: stop.lineCode,
        lineColor: stop.lineColor,
        name: stop.name,
        lat: stop.lat,
        lon: stop.lon,
        mode: stop.mode,
      }));
  }, [activeStationCodes, explorationVisible, mode, nearbyEnabled, nearbyQuery.data]);

  const plannerMarkers = useMemo<PlannerMapMarker[]>(() => {
    if (!plannerEnabled) {
      return [];
    }
    const landmarks = plannerLandmarks.length > 0
      ? plannerLandmarks
      : [
          ...(plannerOrigin
            ? [{
                id: 'origin',
                kind: 'origin' as const,
                name: plannerOriginLabel ?? t('planner_origin'),
                coordinate: plannerOrigin,
              }]
            : []),
          ...(plannerDestination
            ? [{
                id: 'destination',
                kind: 'destination' as const,
                name: plannerDestinationLabel ?? t('planner_destination'),
                coordinate: plannerDestination,
              }]
            : []),
        ];

    return landmarks.map((landmark) => {
      const label = landmark.kind === 'origin' ? 'A' : landmark.kind === 'destination' ? 'B' : '';
      const accessibilityLabel = landmark.kind === 'origin'
        ? `${t('planner_origin')}: ${landmark.name}`
        : landmark.kind === 'destination'
          ? `${t('planner_destination')}: ${landmark.name}`
          : landmark.kind === 'boarding'
            ? t('planner_marker_boarding', { name: landmark.name })
            : landmark.kind === 'transfer'
              ? t('planner_marker_transfer', { name: landmark.name })
              : t('planner_marker_alighting', { name: landmark.name });
      return {
        ...landmark,
        label,
        accessibilityLabel,
        selected:
          landmark.kind === 'origin' || landmark.kind === 'destination'
            ? plannerEditing && plannerActivePoint === landmark.kind
            : landmark.legId === selectedPlannerLegId,
      };
    });
  }, [
    plannerActivePoint,
    plannerDestination,
    plannerDestinationLabel,
    plannerEditing,
    plannerEnabled,
    plannerLandmarks,
    plannerOrigin,
    plannerOriginLabel,
    selectedPlannerLegId,
    t,
  ]);

  const plannerPolylines = useMemo<PlannerMapPolyline[]>(() => {
    if (!plannerEnabled) {
      return [];
    }
    return plannerRoutePolylines;
  }, [plannerEnabled, plannerRoutePolylines]);

  const handleNearbyStopPress = useCallback(
    (stop: { code: string; lineCode: string; mode: TransportMode }) => {
      const match = (nearbyQuery.data ?? []).find(
        (candidate) =>
          candidate.code === stop.code &&
          candidate.lineCode === stop.lineCode &&
          candidate.mode === stop.mode,
      );
      if (!match) return;

      if (
        match.mode === mode &&
        stations.some((station) => station.code === match.code)
      ) {
        onStationChange?.(match.code);
      }

      onNearbyStopSelect?.(match);
    },
    [mode, nearbyQuery.data, onNearbyStopSelect, onStationChange, stations],
  );

  const handleStationPress = useCallback(
    (nextStationCode: string) => {
      if (!nextStationCode) return;
      onStationChange?.(nextStationCode);
    },
    [onStationChange],
  );

  const handleMapPress = useCallback(
    (coordinate: { lat: number; lon: number }) => {
      if (placeToSave) {
        onPlaceSaveMapPress?.(coordinate);
        return;
      }
      if (!plannerEnabled) {
        return;
      }
      onPlannerMapPress?.(coordinate);
    },
    [onPlaceSaveMapPress, onPlannerMapPress, placeToSave, plannerEnabled],
  );

  const handleUserLocationChange = useCallback(
    (coordinate: { lat: number; lon: number } | null) => {
      setUserLocation(coordinate);
      onUserLocationChange?.(coordinate);
    },
    [onUserLocationChange],
  );

  const showFamilyFilter = mode === 'bus' && availableFamilies.length > 0;
  return (
    <View style={styles.root}>
      <MapAdapter
        lineCode={lineCode}
        lineColor={activeLine?.color}
        mode={mode}
        stations={stations}
        segments={segmentsQuery.data ?? []}
        transitVehicles={vehicles}
        transitVehiclesUpdatedAt={positionsUpdatedAt}
        routeGeometryPending={stationsQuery.isPending || segmentsQuery.isPending}
        selectedStationCode={stationCode}
        stationFocusRequestId={stationFocusRequestId}
        stationInterchanges={stationInterchanges}
        topInset={topMapInset}
        bottomInset={bottomInset}
        bottomOverlayOffset={bottomOverlayOffset}
        animatedBottomInset={animatedBottomInset}
        nearbyStops={nearbyMarkers}
        plannerMarkers={plannerMarkers}
        plannerPolylines={plannerPolylines}
        plannerFocusKey={plannerFocusKey}
        plannerStepFocus={plannerStepFocus}
        explorationVisible={explorationVisible}
        bottomActions={
          showBackButton ? null : (
            <>
              <RouteControl enabled={plannerEnabled} onPress={onPlannerToggle ?? (() => undefined)} />
              {explorationVisible ? (
                <NearbyControl
                  enabled={nearbyEnabled}
                  selectedModeCount={nearbyModes.length}
                  onToggle={onNearbyToggle}
                  onConfigure={onNearbyConfigurationPress}
                />
              ) : null}
            </>
          )
        }
        onStationPress={handleStationPress}
        onUserLocationChange={handleUserLocationChange}
        onNearbyStopPress={handleNearbyStopPress}
        onMapPress={handleMapPress}
        onPlannerMarkerPress={onPlannerMarkerPress}
      />

      {showBackButton || explorationVisible ? (
        <View
          style={[styles.topOverlay, { top: insets.top + 8 }]}
          onLayout={(event) => {
            setTopOverlayHeight(event.nativeEvent.layout.height);
          }}
        >
          {showBackButton ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('back')}
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <Text style={styles.backButtonText}>{'<'}</Text>
            </Pressable>
          ) : (
            <View style={styles.controls}>
              {onModeChange ? (
                <ModeToggle mode={mode} pendingMode={pendingMode} onChange={onModeChange} />
              ) : null}
              <View
                pointerEvents={pendingMode ? 'none' : 'auto'}
                style={[styles.modeControls, pendingMode ? styles.modeControlsPending : null]}
              >
                {showFamilyFilter ? (
                  <FamilyFilter
                    available={availableFamilies}
                    selected={busFamily}
                    onChange={setBusFamily}
                  />
                ) : null}
                <SearchShell
                  lineCode={lineCode}
                  lines={visibleLines}
                  mode={mode}
                  onLineChange={onLineChange}
                />
              </View>
            </View>
          )}
        </View>
      ) : null}

    </View>
  );
}

const createStyles = (palette: Palette) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  topOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
  },
  controls: {
    gap: 8,
  },
  modeControls: {
    gap: 8,
  },
  modeControlsPending: {
    opacity: 0.55,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceTranslucent,
    borderWidth: 1,
    borderColor: palette.border,
  },
  backButtonText: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: -1,
  },
});
