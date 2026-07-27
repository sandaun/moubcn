import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng, UserLocationChangeEvent } from 'react-native-maps';

import { USER_LOCATION_TIMEOUT_MS } from '../constants';

interface UseMapUserLocationOptions {
  centerMap: (coordinate: LatLng, delta?: number) => void;
  onUserLocationChange?: (coordinate: { lat: number; lon: number } | null) => void;
}

/**
 * Owns the blue-dot permission, the "center on me" button, and the transient
 * message shown when that button cannot deliver a position.
 */
export function useMapUserLocation({
  centerMap,
  onUserLocationChange,
}: UseMapUserLocationOptions) {
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [isWaitingForUserLocation, setIsWaitingForUserLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [userCoordinate, setUserCoordinate] = useState<LatLng | null>(null);
  const locationMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldCenterOnNextUserLocationRef = useRef(false);
  const userLocationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const stopWaitingForUserLocation = useCallback((message: string | null) => {
    shouldCenterOnNextUserLocationRef.current = false;
    setIsWaitingForUserLocation(false);
    setLocationMessage(message);

    if (userLocationTimeoutRef.current) {
      clearTimeout(userLocationTimeoutRef.current);
      userLocationTimeoutRef.current = null;
    }
  }, []);

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

  return {
    hasLocationPermission,
    isWaitingForUserLocation,
    locationMessage,
    userCoordinate,
    handleUserLocationChange,
    handleCenterUserLocation,
  };
}
