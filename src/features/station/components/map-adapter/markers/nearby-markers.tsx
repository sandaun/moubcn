import { View } from 'react-native';

import type { TransportMode } from '@/src/domain/catalog/models';
import { getLineBrand } from '@/src/features/catalog/utils/line-brand';
import { Text, useThemedStyles } from '@/src/design-system';

import { createStyles } from '../styles';

export function NearbyStopDot({ mode, lineCode, lineColor }: { mode: TransportMode; lineCode: string; lineColor?: string }) {
  const styles = useThemedStyles(createStyles);
  const brand = getLineBrand(mode, lineCode, lineColor);
  return (
    <View
      style={[styles.nearbyDot, { backgroundColor: brand.backgroundColor }]}
    />
  );
}
export function NearbyStopLabel({
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
