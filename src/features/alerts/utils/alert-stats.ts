import type { ServiceAlert } from '@/src/domain/alerts/models';

export interface AlertStats {
  all: number;
  current: number;
  planned: number;
}

export function countAlerts(alerts: ServiceAlert[]): AlertStats {
  return {
    all: alerts.length,
    current: alerts.filter((alert) => alert.kind === 'current').length,
    planned: alerts.filter((alert) => alert.kind === 'planned').length,
  };
}
