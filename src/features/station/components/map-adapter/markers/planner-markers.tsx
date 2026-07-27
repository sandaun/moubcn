import { View } from 'react-native';

import type { TransportMode } from '@/src/domain/catalog/models';
import { getLineBrand } from '@/src/features/catalog/utils/line-brand';
import { Text, useThemedStyles } from '@/src/design-system';

import { createStyles } from '../styles';
import type { PlannerMapMarker } from '../types';

export function PlannerTransferBadges({
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
export function PlannerEndpointMarker({ marker }: { marker: PlannerMapMarker }) {
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
