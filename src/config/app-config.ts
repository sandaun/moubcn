export type AppEnvironment = 'development' | 'preview' | 'production';

interface AppConfigInput {
  appEnv: string | undefined;
  apiBaseUrl: string | undefined;
  useMock: string | undefined;
  nodeEnv: string | undefined;
}

const LOCAL_API_BASE_URL = 'http://localhost:3001';
const REMOTE_ENVIRONMENTS: ReadonlySet<AppEnvironment> = new Set(['preview', 'production']);

function parseAppEnvironment(appEnv: string | undefined, nodeEnv: string | undefined): AppEnvironment {
  const value = appEnv ?? (nodeEnv === 'production' ? 'production' : 'development');

  if (value !== 'development' && value !== 'preview' && value !== 'production') {
    throw new Error(`Invalid EXPO_PUBLIC_APP_ENV: ${value}`);
  }

  return value;
}

function parseUseMock(value: string | undefined): boolean {
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error('EXPO_PUBLIC_USE_MOCK must be either true or false');
  }

  return value === 'true';
}

function validateRemoteApiUrl(apiBaseUrl: string | undefined, appEnv: AppEnvironment): string {
  if (!apiBaseUrl) {
    throw new Error(`EXPO_PUBLIC_API_BASE_URL is required for ${appEnv}`);
  }

  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    throw new Error(`EXPO_PUBLIC_API_BASE_URL must be a valid URL for ${appEnv}`);
  }

  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';

  if (url.protocol !== 'https:' || isLocalhost) {
    throw new Error(`EXPO_PUBLIC_API_BASE_URL must use non-local HTTPS for ${appEnv}`);
  }

  return apiBaseUrl;
}

export function resolveAppConfig(input: AppConfigInput) {
  const appEnv = parseAppEnvironment(input.appEnv, input.nodeEnv);
  const useMock = parseUseMock(input.useMock);
  const isRemoteEnvironment = REMOTE_ENVIRONMENTS.has(appEnv);

  if (isRemoteEnvironment && useMock) {
    throw new Error(`EXPO_PUBLIC_USE_MOCK must be false for ${appEnv}`);
  }

  const apiBaseUrl = isRemoteEnvironment
    ? validateRemoteApiUrl(input.apiBaseUrl, appEnv)
    : (input.apiBaseUrl ?? LOCAL_API_BASE_URL);

  return {
    appEnv,
    apiBaseUrl,
    useMock,
  } as const;
}

const environmentConfig = resolveAppConfig({
  appEnv: process.env.EXPO_PUBLIC_APP_ENV,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  useMock: process.env.EXPO_PUBLIC_USE_MOCK,
  nodeEnv: process.env.NODE_ENV,
});

export const APP_CONFIG = {
  ...environmentConfig,
  catalogTtlMs: 7 * 24 * 60 * 60 * 1000,
  arrivalsPollIntervalMs: 30_000,
  // The FGC producer stamps a new Geotren snapshot once a minute, but the open
  // data portal republishes it roughly every two minutes and serves it 1.5-4
  // min old, so anything faster than this only burns requests on identical
  // payloads. Measured against the GTFS-RT header timestamps of the same feed.
  vehiclesPollIntervalMs: 30_000,
  serviceAlertsPollIntervalMs: 5 * 60_000,
} as const;
