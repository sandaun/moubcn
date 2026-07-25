import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/src/core/query-client';
import { ErrorBoundary } from '@/src/core/error-boundary';
import { LanguageProvider, useAppLanguage } from '@/src/i18n';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePalette } from '@/src/design-system';

function RootNavigator() {
  const { t } = useAppLanguage();

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="lines/[mode]/[lineCode]"
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="settings"
        options={{
          animation: 'slide_from_right',
          headerBackTitle: t('back'),
          headerLargeTitle: true,
          title: t('settings_title'),
        }}
      />
      <Stack.Screen
        name="data-sources"
        options={{
          animation: 'slide_from_right',
          headerBackTitle: t('back'),
          headerLargeTitle: true,
          title: t('sources_title'),
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const palette = usePalette();
  const navigationTheme = {
    ...(colorScheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(colorScheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: palette.accent,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      notification: palette.danger,
    },
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <LanguageProvider>
        <ErrorBoundary>
          <SafeAreaProvider>
            <QueryClientProvider client={queryClient}>
              <ThemeProvider value={navigationTheme}>
                <RootNavigator />
                <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
              </ThemeProvider>
            </QueryClientProvider>
          </SafeAreaProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
