import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { APP_CONFIG } from '@/src/config/app-config';
import { fetchFgcVehicles } from '@/src/data/tmb/client';
import type { TransportMode } from '@/src/domain/catalog/models';
import type { TransitVehicle } from '@/src/domain/realtime/models';

const EMPTY_VEHICLES: TransitVehicle[] = [];

function getPositionSignature(vehicles: TransitVehicle[]): string {
  return vehicles.map((vehicle) => `${vehicle.id}:${vehicle.lat}:${vehicle.lon}`).join('|');
}

export interface LineVehicles {
  vehicles: TransitVehicle[];
  /**
   * Advances only when a vehicle actually changed position, which is what the
   * map's live pulse means. React Query's `dataUpdatedAt` cannot be used for
   * that: it moves on every successful fetch, and the feed republishes far more
   * slowly than we poll, so most polls return an identical payload.
   */
  positionsUpdatedAt: number;
}

export function useLineVehiclesQuery(
  mode: TransportMode,
  lineCode: string | null,
): LineVehicles {
  const query = useQuery({
    queryKey: ['realtime', mode, 'vehicles', lineCode],
    queryFn: () => fetchFgcVehicles(lineCode!),
    enabled: mode === 'fgc' && Boolean(lineCode),
    staleTime: APP_CONFIG.vehiclesPollIntervalMs,
    refetchInterval: mode === 'fgc' ? APP_CONFIG.vehiclesPollIntervalMs : false,
  });

  const vehicles = query.data ?? EMPTY_VEHICLES;
  const signature = getPositionSignature(vehicles);
  const [tracked, setTracked] = useState({
    signature,
    updatedAt: query.dataUpdatedAt,
  });

  if (tracked.signature !== signature) {
    setTracked({ signature, updatedAt: query.dataUpdatedAt });
  }

  return { vehicles, positionsUpdatedAt: tracked.updatedAt };
}
