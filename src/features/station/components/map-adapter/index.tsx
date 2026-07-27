import { Fragment, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import MapView, { Marker, Polyline, type MapPressEvent } from 'react-native-maps';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppLanguage } from '@/src/i18n';
import type { TransportMode } from '@/src/domain/catalog/models';
import { getLineBrand } from '@/src/features/catalog/utils/line-brand';
import { getPlannerRouteMode } from '@/src/features/planner/utils/route-presentation';
import {
  getUniqueInterchangeLines,
  prioritizeSelectedInterchangeLine,
  type StationInterchange,
} from '@/src/features/station/utils/station-interchanges';
import {
  getVisibleStationAnnotationCodes,
  type StationAnnotationCandidate,
} from '@/src/features/station/utils/map-annotation-layout';
import { getMapMarkerDetail } from '@/src/features/station/utils/map-marker-detail';
import {
  selectStationMarkers,
  trimSegmentToStations,
} from '@/src/features/station/utils/map-route-geometry';
import { Text, usePalette, useThemedStyles } from '@/src/design-system';
import { useColorScheme } from '@/hooks/use-color-scheme';

import {
  MAP_Z,
  STATION_BADGE_ANCHOR,
  STATION_MARKER_ANCHOR,
  STATION_MARKER_CENTER_OFFSET,
  STATION_MARKER_IMAGE,
  STATION_NAME_ANCHOR,
  STATION_NAME_CENTER_OFFSET,
  VEHICLE_DETAIL_ANCHOR,
  VEHICLE_DETAIL_CENTER_OFFSET,
} from './constants';
import {
  getFallbackPolyline,
  hasFiniteCoordinate,
  toMapCoordinate,
  withAlpha,
} from './geometry';
import { useMapCamera } from './hooks/use-map-camera';
import { useMapUserLocation } from './hooks/use-map-user-location';
import { useMapVehicles } from './hooks/use-map-vehicles';
import { NearbyStopDot, NearbyStopLabel } from './markers/nearby-markers';
import {
  PlannerEndpointMarker,
  PlannerTransferBadges,
} from './markers/planner-markers';
import {
  DynamicSelectedStationMarker,
  StationNameLabel,
  StationNameMarker,
  StationTransferBadges,
} from './markers/station-markers';
import { VehicleMarker } from './markers/vehicle-marker';
import { createStyles } from './styles';
import type { MapAdapterProps, RoutePolyline } from './types';

export type {
  NearbyStopMarker,
  PlannerMapMarker,
  PlannerMapPolyline,
} from './types';

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
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapWidth, setMapWidth] = useState(0);
  const [mapHeight, setMapHeight] = useState(0);
  const selectedStation = stations.find(
    (station) => station.code === selectedStationCode,
  );
  const lineBrand = getLineBrand(mode, lineCode, lineColor);

  const {
    mapRef,
    centerMap,
    visibleRegion,
    placementEpoch,
    handleRegionChangeComplete,
  } = useMapCamera({
    isMapReady,
    mapHeight,
    explorationVisible,
    selectedStation,
    stationFocusRequestId,
    topInset,
    bottomInset,
    plannerFocusKey,
    plannerMarkers,
    plannerPolylines,
    plannerStepFocus,
  });

  const {
    hasLocationPermission,
    isWaitingForUserLocation,
    locationMessage,
    userCoordinate,
    handleUserLocationChange,
    handleCenterUserLocation,
  } = useMapUserLocation({ centerMap, onUserLocationChange });

  const latitudeDelta = visibleRegion?.latitudeDelta ?? 0.05;
  const longitudeDelta = visibleRegion?.longitudeDelta ?? 0.05;

  const bottomControlsAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: -(animatedBottomInset?.get() ?? bottomInset),
      },
    ],
  }));

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

  const {
    placedVehicles,
    selectedVehicle,
    selectedVehicleId,
    selectedVehicleMeta,
    vehicleObstacles,
    handleVehiclePress,
    dismissSelectedVehicle,
    dismissOnMapPress,
  } = useMapVehicles({
    explorationVisible,
    routeGeometryPending,
    routePolylines,
    stations,
    transitVehicles,
    transitVehiclesUpdatedAt,
  });

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

  const handleStationPress = useCallback(
    (stationCode: string) => {
      onStationPress(stationCode);
    },
    [onStationPress],
  );

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      const coordinate = event.nativeEvent.coordinate;
      dismissOnMapPress();
      onMapPress?.({ lat: coordinate.latitude, lon: coordinate.longitude });
    },
    [dismissOnMapPress, onMapPress],
  );

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
            onPress={dismissSelectedVehicle}
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
