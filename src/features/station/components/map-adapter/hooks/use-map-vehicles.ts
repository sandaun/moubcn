import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Station } from '@/src/domain/catalog/models';
import type { TransitVehicle } from '@/src/domain/realtime/models';
import type { MapAnnotationObstacle } from '@/src/features/station/utils/map-annotation-layout';
import { placePointOnPolylines } from '@/src/features/station/utils/map-route-geometry';
import { useAppLanguage } from '@/src/i18n';

import { VEHICLE_PRESS_ECHO_MS, VEHICLE_SNAP_MAX_DISTANCE_METERS } from '../constants';
import type { RoutePolyline } from '../types';

interface UseMapVehiclesOptions {
  explorationVisible: boolean;
  routeGeometryPending: boolean;
  routePolylines: RoutePolyline[];
  stations: Station[];
  transitVehicles: TransitVehicle[];
  transitVehiclesUpdatedAt: number;
}

/**
 * Snaps the live vehicle feed onto the drawn route and owns which vehicle has
 * its detail card open.
 */
export function useMapVehicles({
  explorationVisible,
  routeGeometryPending,
  routePolylines,
  stations,
  transitVehicles,
  transitVehiclesUpdatedAt,
}: UseMapVehiclesOptions) {
  const { t } = useAppLanguage();
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

  // Pressing the same train again closes the card, which together with a press
  // on empty map is why it needs no close button of its own.
  const handleVehiclePress = useCallback((vehicleId: string) => {
    lastVehiclePressAtRef.current = Date.now();
    setSelectedVehicleId((current) => (current === vehicleId ? null : vehicleId));
  }, []);

  const dismissSelectedVehicle = useCallback(() => {
    setSelectedVehicleId(null);
  }, []);

  const dismissOnMapPress = useCallback(() => {
    if (Date.now() - lastVehiclePressAtRef.current > VEHICLE_PRESS_ECHO_MS) {
      setSelectedVehicleId(null);
    }
  }, []);

  return {
    placedVehicles,
    selectedVehicle,
    selectedVehicleId,
    selectedVehicleMeta,
    vehicleObstacles,
    handleVehiclePress,
    dismissSelectedVehicle,
    dismissOnMapPress,
  };
}
