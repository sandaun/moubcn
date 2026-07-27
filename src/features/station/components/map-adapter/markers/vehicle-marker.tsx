// The vehicle marker uses the MaterialIcons glyph font directly instead of
// IconSymbol: SF Symbols render as a native view, which Android rasterises
// unreliably inside a marker bitmap. A glyph is safe on both platforms.
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, View } from 'react-native';
import { Marker, type LatLng } from 'react-native-maps';

import { useThemedStyles } from '@/src/design-system';

import {
  MAP_Z,
  STATION_MARKER_ANCHOR,
  VEHICLE_PLACEMENT_NUDGE_DEGREES,
  VEHICLE_PULSE_RING_MS,
  VEHICLE_PULSE_STAGGER_MS,
} from '../constants';
import { withAlpha } from '../geometry';
import { createStyles } from '../styles';

export function VehicleMarker({
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
      {/* Without collapsable={false} React Native flattens this box away and
          the annotation ends up measured from the rotated heading layer, which
          drags the marker off the track by the heading tip's own radius. */}
      <View
        collapsable={false}
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
