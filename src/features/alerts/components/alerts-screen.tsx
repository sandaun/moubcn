import { useCallback, useMemo, useState } from 'react';
import { FlatList, Linking, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ServiceAlert } from '@/src/domain/alerts/models';
import { AlertCard } from '@/src/features/alerts/components/alert-card';
import { AlertsHeader } from '@/src/features/alerts/components/alerts-header';
import { EmptyState } from '@/src/features/alerts/components/alerts-empty-state';
import { useServiceAlertsQuery } from '@/src/features/alerts/hooks/use-service-alerts-query';
import {
  alertMatchesFilters,
  getAlertFilterCounts,
  type AlertFilters,
  type OperatorFilter,
} from '@/src/features/alerts/utils/alert-filters';
import { countAlerts } from '@/src/features/alerts/utils/alert-stats';
import { lineKey } from '@/src/features/preferences/models';
import { useUserPreferencesStore } from '@/src/features/preferences/store';
import { useThemedStyles } from '@/src/design-system';

import { createStyles } from './alerts-styles';

const TAB_BAR_CLEARANCE = 96;

export function AlertsScreen() {
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const timeFilter = useUserPreferencesStore((state) => state.alertsTimeFilter);
  const mineOnly = useUserPreferencesStore((state) => state.alertsMineOnly);
  const setTimeFilter = useUserPreferencesStore((state) => state.setAlertsTimeFilter);
  const setMineOnly = useUserPreferencesStore((state) => state.setAlertsMineOnly);
  const favoriteLines = useUserPreferencesStore((state) => state.favoriteLines);
  const favoriteStops = useUserPreferencesStore((state) => state.favoriteStops);
  const { data: alerts = [], error, isFetching, isLoading, refetch } = useServiceAlertsQuery();
  const [operatorFilter, setOperatorFilter] = useState<OperatorFilter>('all');

  const favoriteLineKeys = useMemo(
    () => new Set([
      ...favoriteLines.map((line) => lineKey(line.mode, line.lineCode)),
      ...favoriteStops.map((stop) => lineKey(stop.mode, stop.lineCode)),
    ]),
    [favoriteLines, favoriteStops],
  );
  const stats = useMemo(() => countAlerts(alerts), [alerts]);
  const filters = useMemo<AlertFilters>(() => ({
    mineOnly,
    operator: operatorFilter,
    time: timeFilter,
  }), [mineOnly, operatorFilter, timeFilter]);
  const filterCounts = useMemo(
    () => getAlertFilterCounts(alerts, filters, favoriteLineKeys),
    [alerts, favoriteLineKeys, filters],
  );
  const filteredAlerts = useMemo(
    () => alerts.filter((alert) => alertMatchesFilters(alert, filters, favoriteLineKeys)),
    [alerts, favoriteLineKeys, filters],
  );
  const hasActiveFilters = timeFilter !== 'all' || operatorFilter !== 'all' || mineOnly;

  const handleOpenSource = useCallback((sourceUrl: string) => {
    void Linking.openURL(sourceUrl).catch(() => {
      // The alert stays visible; there is nothing actionable if the link fails.
    });
  }, []);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleResetFilters = useCallback(() => {
    setTimeFilter('all');
    setOperatorFilter('all');
    setMineOnly(false);
  }, [setMineOnly, setTimeFilter]);

  const renderAlert = useCallback(
    ({ item }: { item: ServiceAlert }) => (
      <AlertCard
        title={item.title}
        description={item.description}
        mode={item.mode}
        severity={item.severity}
        kind={item.kind}
        affectedLines={item.affectedLines}
        dateLabel={item.dateLabel}
        updatedAtMs={item.updatedAtMs}
        sourceUrl={item.sourceUrl}
        onSourcePress={handleOpenSource}
      />
    ),
    [handleOpenSource],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={filteredAlerts}
        keyExtractor={(alert) => alert.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
        ]}
        ListHeaderComponent={
          <AlertsHeader
            filterCounts={filterCounts}
            filters={filters}
            error={Boolean(error)}
            isFetching={isFetching && !isLoading}
            onMineOnlyChange={setMineOnly}
            onRetry={handleRetry}
            onOperatorFilterChange={setOperatorFilter}
            onTimeFilterChange={setTimeFilter}
            stats={stats}
          />
        }
        ListEmptyComponent={
          <EmptyState
            hasActiveFilters={hasActiveFilters}
            hasFavorites={favoriteLineKeys.size > 0}
            isLoading={isLoading}
            mineOnly={mineOnly}
            onResetFilters={handleResetFilters}
            totalAlerts={alerts.length}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={renderAlert}
        refreshing={isFetching && !isLoading}
        onRefresh={handleRetry}
      />
    </SafeAreaView>
  );
}
