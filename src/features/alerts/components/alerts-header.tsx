import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import type {
  AlertFilterCounts,
  AlertFilters,
  OperatorFilter,
} from '@/src/features/alerts/utils/alert-filters';
import type { AlertStats } from '@/src/features/alerts/utils/alert-stats';
import type { AlertsTimeFilter } from '@/src/features/preferences/models';
import { useAppLanguage } from '@/src/i18n';
import { Text, usePalette, useThemedStyles } from '@/src/design-system';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { createStyles } from './alerts-styles';

interface SegmentButtonProps {
  active: boolean;
  count: number;
  label: string;
  onPress: () => void;
}

function SegmentButton({
  active,
  count,
  label,
  onPress,
}: SegmentButtonProps) {
  const colorScheme = useColorScheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.segmentButton,
        active ? styles.segmentButtonActive : null,
        active && colorScheme === 'dark' ? styles.segmentButtonActiveDark : null,
        pressed ? styles.filterButtonPressed : null,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{ selected: active }}
      hitSlop={2}>
      <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}>
        {label}
      </Text>
      <Text style={[styles.segmentCount, active ? styles.segmentCountActive : null]}>
        {count}
      </Text>
    </Pressable>
  );
}

interface MineFilterButtonProps {
  active: boolean;
  count: number;
  label: string;
  onPress: () => void;
}

function MineFilterButton({ active, count, label, onPress }: MineFilterButtonProps) {
  const palette = usePalette();
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.mineFilterButton,
        active ? styles.mineFilterButtonActive : null,
        pressed ? styles.filterButtonPressed : null,
      ]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}>
      <View style={[styles.mineFilterIcon, active ? styles.mineFilterIconActive : null]}>
        <MaterialIcons
          name={active ? 'star' : 'star-border'}
          size={20}
          color={active ? palette.onAccent : palette.favorite}
        />
      </View>
      <Text style={[styles.mineFilterLabel, active ? styles.mineFilterLabelActive : null]}>
        {label}
      </Text>
      <Text style={[styles.mineFilterCount, active ? styles.mineFilterCountActive : null]}>
        {count}
      </Text>
      <MaterialIcons
        name={active ? 'check-circle' : 'radio-button-unchecked'}
        size={21}
        color={active ? palette.accent : palette.textSubtle}
      />
    </Pressable>
  );
}

interface AlertsHeaderProps {
  filterCounts: AlertFilterCounts;
  filters: AlertFilters;
  error: boolean;
  isFetching: boolean;
  onMineOnlyChange: (mineOnly: boolean) => void;
  onRetry: () => void;
  onOperatorFilterChange: (filter: OperatorFilter) => void;
  onTimeFilterChange: (filter: AlertsTimeFilter) => void;
  stats: AlertStats;
}

export function AlertsHeader({
  filterCounts,
  filters,
  error,
  isFetching,
  onMineOnlyChange,
  onRetry,
  onOperatorFilterChange,
  onTimeFilterChange,
  stats,
}: AlertsHeaderProps) {
  const palette = usePalette();
  const styles = useThemedStyles(createStyles);
  const { t } = useAppLanguage();
  const timeOptions: { id: AlertsTimeFilter; label: string }[] = [
    { id: 'all', label: t('alerts_all') },
    { id: 'current', label: t('alerts_now') },
    { id: 'planned', label: t('alerts_planned') },
  ];
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{t('alerts_title')}</Text>
          <Text style={styles.subtitle}>{t('alerts_network')}</Text>
        </View>
        <View style={styles.summaryCompact}>
          <View style={styles.summaryHeadline}>
            <Text style={styles.summaryValue}>{stats.all}</Text>
            <Text style={styles.summaryLabel}>
              {stats.all === 1 ? t('alerts_one') : t('alerts_other')}
            </Text>
            {isFetching ? <ActivityIndicator size="small" color={palette.accent} /> : null}
          </View>
          <Text style={styles.summaryDetail}>
            {t('alerts_summary', { current: stats.current, planned: stats.planned })}
          </Text>
        </View>
      </View>

      <View style={styles.filterStack}>
        <MineFilterButton
          active={filters.mineOnly}
          count={filterCounts.mine}
          label={t('alerts_mine')}
          onPress={() => onMineOnlyChange(!filters.mineOnly)}
        />

        <View style={styles.segmentedControl} accessibilityLabel={t('alerts_filter_time')}>
          {timeOptions.map((option) => (
            <SegmentButton
              key={option.id}
              active={filters.time === option.id}
              count={filterCounts.time[option.id]}
              label={option.label}
              onPress={() => onTimeFilterChange(option.id)}
            />
          ))}
        </View>

        <View style={styles.segmentedControl} accessibilityLabel={t('alerts_filter_operator')}>
          {([
            { id: 'all', label: t('alerts_all') },
            { id: 'tmb', label: 'TMB' },
            { id: 'fgc', label: 'FGC' },
            { id: 'tram', label: 'TRAM' },
          ] as const).map((option) => (
            <SegmentButton
              key={option.id}
              active={filters.operator === option.id}
              count={filterCounts.operator[option.id]}
              label={option.label}
              onPress={() => onOperatorFilterChange(option.id)}
            />
          ))}
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{t('alerts_load_error')}</Text>
          <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button">
            <Text style={styles.retryText}>{t('retry')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
