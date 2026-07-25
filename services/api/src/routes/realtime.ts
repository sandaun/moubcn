import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { TtlCache } from '../cache/ttl-cache';
import { runtimeConfig } from '../config/env';
import { getFgcArrivals, getFgcVehicles } from '../fgc/client';
import { getTramArrivals } from '../tram/client';
import { fetchBusArrivalsByStation } from '../tmb/ibus-client';
import { fetchArrivalsByStation } from '../tmb/imetro-client';
import type { ArrivalDto, TransitVehicleDto, TransportMode } from '../types/api';
import { toSafeErrorDetails } from '../utils/safe-logging';

const modeParams = z.object({ mode: z.enum(['metro', 'bus', 'fgc', 'tram']) });
const querySchema = z.object({
  lineCode: z.string().min(1),
  stationCode: z.string().min(1),
});

const cache = new TtlCache<ArrivalDto[]>();
const inFlight = new Map<string, Promise<ArrivalDto[]>>();

function cacheKey(mode: TransportMode, lineCode: string, stationCode: string): string {
  return `arrivals:${mode}:${lineCode}:${stationCode}`;
}

async function fetchArrivals(
  mode: TransportMode,
  lineCode: string,
  stationCode: string,
): Promise<ArrivalDto[]> {
  if (mode === 'fgc') {
    return getFgcArrivals(lineCode, stationCode);
  }
  if (mode === 'tram') {
    return getTramArrivals(lineCode, stationCode);
  }
  if (mode === 'bus') {
    return fetchBusArrivalsByStation(stationCode, lineCode);
  }

  return fetchArrivalsByStation(stationCode, lineCode);
}

export const realtimeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/realtime/:mode/arrivals', async (request, reply) => {
    const { mode } = modeParams.parse(request.params);
    const query = querySchema.parse(request.query);
    const key = cacheKey(mode, query.lineCode, query.stationCode);

    const fresh = cache.getFresh(key);
    if (fresh) {
      return {
        data: fresh,
        meta: {
          source: 'cache',
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      };
    }

    const currentFlight = inFlight.get(key);
    if (currentFlight) {
      const shared = await currentFlight;
      return {
        data: shared,
        meta: {
          source: 'single-flight',
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      };
    }

    const fetchPromise = fetchArrivals(mode, query.lineCode, query.stationCode)
      .then((arrivals) => {
        cache.set(key, arrivals, runtimeConfig.realtimeCacheTtlMs);
        return arrivals;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, fetchPromise);

    try {
      const arrivals = await fetchPromise;
      return {
        data: arrivals,
        meta: {
          source: mode === 'fgc'
            ? 'fgc-gtfs-rt'
            : mode === 'tram'
              ? 'tram-gtfs-rt'
              : mode === 'bus'
                ? 'tmb-ibus'
                : 'tmb-imetro',
          stale: false,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const stale = cache.getStale(key, runtimeConfig.realtimeStaleMaxMs);
      if (stale) {
        return {
          data: stale,
          meta: {
            source: 'stale-cache',
            stale: true,
            fetchedAt: new Date().toISOString(),
          },
        };
      }

      fastify.log.error({ error: toSafeErrorDetails(error) }, 'Realtime upstream failed');
      return reply.status(502).send({
        error: 'Upstream unavailable',
      });
    }
  });

  const vehicleCache = new TtlCache<TransitVehicleDto[]>();
  const vehicleFlights = new Map<string, Promise<TransitVehicleDto[]>>();

  fastify.get('/v1/realtime/fgc/vehicles', async (request, reply) => {
    const query = z.object({ lineCode: z.string().min(1).optional() }).parse(request.query);
    const key = `vehicles:fgc:${query.lineCode ?? 'all'}`;
    const fresh = vehicleCache.getFresh(key);
    if (fresh) {
      return { data: fresh, meta: { source: 'cache', stale: false } };
    }

    let flight = vehicleFlights.get(key);
    if (!flight) {
      flight = getFgcVehicles(query.lineCode)
        .then((vehicles) => {
          vehicleCache.set(key, vehicles, runtimeConfig.vehiclesCacheTtlMs);
          return vehicles;
        })
        .finally(() => {
          vehicleFlights.delete(key);
        });
      vehicleFlights.set(key, flight);
    }

    try {
      return { data: await flight, meta: { source: 'fgc-geotren', stale: false } };
    } catch (error) {
      const stale = vehicleCache.getStale(key, runtimeConfig.vehiclesStaleMaxMs);
      if (stale) {
        return { data: stale, meta: { source: 'stale-cache', stale: true } };
      }
      fastify.log.error({ error: toSafeErrorDetails(error) }, 'FGC vehicles upstream failed');
      return reply.status(502).send({ error: 'Upstream unavailable' });
    }
  });
};
