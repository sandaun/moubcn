import { useCallback, useState } from 'react';
import {
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import { Marker, type LatLng } from 'react-native-maps';

import type { Line } from '@/src/domain/catalog/models';
import { getLineBrand } from '@/src/features/catalog/utils/line-brand';
import { Text, useThemedStyles } from '@/src/design-system';

import {
  MAP_Z,
  SELECTED_MULTILINE_STATION_NAME_CENTER_OFFSET,
  SELECTED_STATION_NAME_CENTER_OFFSET,
  STATION_NAME_ANCHOR,
  UNSELECTED_STATION_NAME_CENTER_OFFSET,
} from '../constants';
import { withAlpha } from '../geometry';
import { createStyles } from '../styles';

export function StationTransferBadges({
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
export function StationNameLabel({
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

export function StationNameMarker({
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
export function DynamicSelectedStationMarker({ color }: { color: string }) {
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
