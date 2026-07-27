import { useCallback, useEffect, useRef, useState } from 'react';
import type MapView from 'react-native-maps';
import type { LatLng, Region } from 'react-native-maps';

import type { Station } from '@/src/domain/catalog/models';
import { getViewportFocusedRegion } from '@/src/features/station/utils/map-camera';

import { MAP_CENTER_ANIMATION_MS } from '../constants';
import { toMapCoordinate } from '../geometry';
import type { PlannerMapMarker, PlannerMapPolyline } from '../types';

interface UseMapCameraOptions {
  isMapReady: boolean;
  mapHeight: number;
  explorationVisible: boolean;
  selectedStation: Station | undefined;
  stationFocusRequestId: number;
  topInset: number;
  bottomInset: number;
  plannerFocusKey: string | null;
  plannerMarkers: PlannerMapMarker[];
  plannerPolylines: PlannerMapPolyline[];
  plannerStepFocus: { key: string; coordinate: { lat: number; lon: number } } | null;
}

/**
 * Owns the map handle and everything that moves the camera: the station focus
 * request, fitting a planned route, and stepping through that route's legs.
 */
export function useMapCamera({
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
}: UseMapCameraOptions) {
  const mapRef = useRef<MapView | null>(null);
  const currentRegionRef = useRef<Region | null>(null);
  const lastStationFocusRequestRef = useRef(0);
  const lastPlannerFocusKeyRef = useRef<string | null>(null);
  const lastPlannerStepFocusKeyRef = useRef<string | null>(null);
  const [visibleRegion, setVisibleRegion] = useState<Region | null>(null);
  // Advances every time the camera comes to rest; vehicle markers use it to
  // re-place themselves against the projection that is actually on screen.
  const [placementEpoch, setPlacementEpoch] = useState(0);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    currentRegionRef.current = region;
    setVisibleRegion(region);
    setPlacementEpoch((current) => current + 1);
  }, []);

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

  return {
    mapRef,
    centerMap,
    visibleRegion,
    placementEpoch,
    handleRegionChangeComplete,
  };
}
