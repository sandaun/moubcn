import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useAppLanguage } from '@/src/i18n';
import { Text, usePalette, useThemedStyles } from '@/src/design-system';

import { createStyles } from './alerts-styles';

interface EmptyStateProps {
  hasActiveFilters: boolean;
  hasFavorites: boolean;
  isLoading: boolean;
  mineOnly: boolean;
  onResetFilters: () => void;
  totalAlerts: number;
}

export function EmptyState({
  hasActiveFilters,
  hasFavorites,
  isLoading,
  mineOnly,
  onResetFilters,
  totalAlerts,
}: EmptyStateProps) {
  const palette = usePalette();
  const styles = useThemedStyles(createStyles);
  const { t } = useAppLanguage();
  if (isLoading) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator color={palette.accent} />
        <Text style={styles.emptyTitle}>{t('alerts_loading')}</Text>
      </View>
    );
  }

  const hasNoFavorites = mineOnly && !hasFavorites;
  const title = totalAlerts === 0
    ? t('alerts_empty_service_title')
    : hasNoFavorites
      ? t('alerts_empty_mine_title')
      : t('alerts_empty_filtered_title');
  const body = totalAlerts === 0
    ? t('alerts_empty_service_body')
    : hasNoFavorites
      ? t('alerts_empty_mine_body')
      : t('alerts_empty_filtered_body');

  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <MaterialIcons
          name={totalAlerts === 0 ? 'notifications-none' : hasNoFavorites ? 'star-border' : 'filter-alt-off'}
          size={26}
          color={palette.textMuted}
        />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {hasActiveFilters ? (
        <Pressable
          style={({ pressed }) => [
            styles.resetFiltersButton,
            pressed ? styles.resetFiltersButtonPressed : null,
          ]}
          onPress={onResetFilters}
          accessibilityRole="button">
          <Text style={styles.resetFiltersText}>{t('alerts_reset_filters')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
