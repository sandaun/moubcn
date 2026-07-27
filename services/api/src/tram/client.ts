import { parse } from 'csv-parse/sync';
import { FeedMessage } from 'gtfs-rt-bindings';

import { env } from '../config/env';
import { fetchWithTimeout } from '../tmb/http';
import type {
  ArrivalDto,
  LineDto,
  LineServiceStatus,
  SegmentDto,
  ServiceAlertDto,
  StationDto,
} from '../types/api';
import { tramOAuthClient } from './oauth';
import { readZipTextFiles } from './zip';
import { barcelonaWallClockToMs, currentBarcelonaDate } from '../utils/barcelona-time';
import { asNumber, asString, isRecord } from '../utils/coerce';
import { getFeedEntities } from '../utils/gtfs-realtime';

const TRAM_MODE = 'tram' as const;
const TRAM_OPERATOR = 'tram' as const;
const TRAM_BRAND_COLOR = '009189';
const CATALOG_TTL_MS = 24 * 60 * 60 * 1_000;
const CATALOG_STALE_MAX_MS = 7 * CATALOG_TTL_MS;
const REQUIRED_GTFS_FILES = [
  'routes.txt',
  'stops.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar_dates.txt',
  'shapes.txt',
] as const;

type TramLanguage = 'ca' | 'es' | 'en';

interface TramNetwork {
  code: 'TBX' | 'TBS';
  id: 1 | 2;
  name: 'trambaix' | 'trambesos';
}

const NETWORKS: readonly TramNetwork[] = [
  { code: 'TBX', id: 1, name: 'trambaix' },
  { code: 'TBS', id: 2, name: 'trambesos' },
];

interface StopRow {
  lat: number;
  locationType: number;
  lon: number;
  name: string;
  parentStation?: string;
  platformCode?: string;
  stopId: string;
  wheelchairBoarding?: number;
}

interface TripRow {
  destination: string;
  directionId: string;
  lineCode: string;
  routeId: string;
  serviceId: string;
  shapeId: string;
  tripId: string;
}

interface StopTimeRow {
  arrivalTime: string;
  departureTime: string;
  stopId: string;
  stopSequence: number;
  tripId: string;
}

interface ScheduleRow {
  arrivalTime: string;
  date: string;
  destination: string;
  directionId: string;
  lineCode: string;
  parentStation: string;
  platformCode?: string;
  stopId: string;
  tripId: string;
}

interface CatalogSnapshot {
  catalogDate: string;
  fetchedAtMs: number;
  lines: LineDto[];
  network: TramNetwork;
  platformToParent: Map<string, string>;
  routeCodeById: Map<string, string>;
  scheduleRows: ScheduleRow[];
  segmentsByLine: Map<string, SegmentDto[]>;
  stationNameByCode: Map<string, string>;
  stationsByLine: Map<string, StationDto[]>;
  tripDestinationByRouteDirection: Map<string, string>;
  tripsById: Map<string, TripRow>;
}

interface GtfsRows {
  calendarDates: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  shapes: Record<string, unknown>[];
  stops: Record<string, unknown>[];
  stopTimes: Record<string, unknown>[];
  trips: Record<string, unknown>[];
}

const snapshots = new Map<string, CatalogSnapshot>();
const snapshotFlights = new Map<string, Promise<CatalogSnapshot>>();

function parseCsv(text: string): Record<string, unknown>[] {
  const rows = parse(text, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as unknown;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function parseStops(rows: Record<string, unknown>[]): Map<string, StopRow> {
  const result = new Map<string, StopRow>();
  for (const row of rows) {
    const stopId = asString(row.stop_id);
    const name = asString(row.stop_name);
    const lat = asNumber(row.stop_lat);
    const lon = asNumber(row.stop_lon);
    if (!stopId || !name || lat === undefined || lon === undefined) continue;
    result.set(stopId, {
      stopId,
      name,
      lat,
      lon,
      locationType: asNumber(row.location_type) ?? 0,
      parentStation: asString(row.parent_station),
      platformCode: asString(row.platform_code),
      wheelchairBoarding: asNumber(row.wheelchair_boarding),
    });
  }
  return result;
}

function parseStopTimes(rows: Record<string, unknown>[]): StopTimeRow[] {
  return rows.flatMap((row) => {
    const tripId = asString(row.trip_id);
    const stopId = asString(row.stop_id);
    const arrivalTime = asString(row.arrival_time);
    const departureTime = asString(row.departure_time) ?? arrivalTime;
    const stopSequence = asNumber(row.stop_sequence);
    if (!tripId || !stopId || !arrivalTime || !departureTime || stopSequence === undefined) {
      return [];
    }
    return [{ tripId, stopId, arrivalTime, departureTime, stopSequence }];
  });
}

function getActiveServiceIds(
  rows: Record<string, unknown>[],
  date: string,
): Set<string> | null {
  const compactDate = date.replaceAll('-', '');
  const matches = rows.filter((row) => asString(row.date) === compactDate);
  if (matches.length === 0) return null;
  const result = new Set<string>();
  for (const row of matches) {
    const serviceId = asString(row.service_id);
    if (!serviceId) continue;
    if (asNumber(row.exception_type) === 1) result.add(serviceId);
    if (asNumber(row.exception_type) === 2) result.delete(serviceId);
  }
  return result;
}

function splitTerminals(name: string): [string | undefined, string | undefined] {
  const separator = name.includes(' - ') ? ' - ' : '-';
  const terminals = name.split(separator).map((value) => value.trim()).filter(Boolean);
  return [terminals[0], terminals.length > 1 ? terminals.at(-1) : undefined];
}

function normalizeRouteName(name: string): string {
  return name
    .replace(/[_|]+/g, ' | ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseShapes(rows: Record<string, unknown>[]): Map<string, Array<{ lat: number; lon: number }>> {
  const raw = new Map<string, Array<{ lat: number; lon: number; sequence: number }>>();
  for (const row of rows) {
    const shapeId = asString(row.shape_id);
    const lat = asNumber(row.shape_pt_lat);
    const lon = asNumber(row.shape_pt_lon);
    const sequence = asNumber(row.shape_pt_sequence);
    if (!shapeId || lat === undefined || lon === undefined || sequence === undefined) continue;
    const points = raw.get(shapeId) ?? [];
    points.push({ lat, lon, sequence });
    raw.set(shapeId, points);
  }
  return new Map(
    [...raw].map(([shapeId, points]) => [
      shapeId,
      points.sort((left, right) => left.sequence - right.sequence)
        .map(({ lat, lon }) => ({ lat, lon })),
    ]),
  );
}

export function buildTramSnapshot(
  network: TramNetwork,
  rows: GtfsRows,
  catalogDate: string,
  fetchedAtMs = Date.now(),
): CatalogSnapshot {
  const stopsById = parseStops(rows.stops);
  const stopTimes = parseStopTimes(rows.stopTimes);
  const routeCodeById = new Map<string, string>();
  const routes = rows.routes.flatMap((row) => {
    const routeId = asString(row.route_id);
    const code = asString(row.route_short_name)?.toUpperCase();
    if (!routeId || !code || !/^T[1-6]$/.test(code)) return [];
    routeCodeById.set(routeId, code);
    return [{
      routeId,
      code,
      name: normalizeRouteName(asString(row.route_long_name) ?? code),
      color: TRAM_BRAND_COLOR,
      textColor: 'FFFFFF',
    }];
  });
  const tripsById = new Map<string, TripRow>();
  const tripDestinationByRouteDirection = new Map<string, string>();
  for (const row of rows.trips) {
    const tripId = asString(row.trip_id);
    const routeId = asString(row.route_id);
    const lineCode = routeId ? routeCodeById.get(routeId) : undefined;
    if (!tripId || !routeId || !lineCode) continue;
    const trip = {
      tripId,
      routeId,
      lineCode,
      serviceId: asString(row.service_id) ?? '',
      destination: asString(row.trip_headsign) ?? lineCode,
      directionId: String(asNumber(row.direction_id) ?? ''),
      shapeId: asString(row.shape_id) ?? '',
    };
    tripsById.set(tripId, trip);
  }

  const activeServiceIds = getActiveServiceIds(rows.calendarDates, catalogDate);
  const allTrips = [...tripsById.values()];
  const activeTrips = activeServiceIds === null
    ? allTrips
    : allTrips.filter((trip) => activeServiceIds.has(trip.serviceId));
  const activeLineCodes = new Set(activeTrips.map((trip) => trip.lineCode));
  const stopTimesByTrip = new Map<string, StopTimeRow[]>();
  for (const stopTime of stopTimes) {
    const values = stopTimesByTrip.get(stopTime.tripId) ?? [];
    values.push(stopTime);
    stopTimesByTrip.set(stopTime.tripId, values);
  }
  for (const trip of tripsById.values()) {
    if (trip.destination === trip.lineCode) {
      const terminalStopTime = [...(stopTimesByTrip.get(trip.tripId) ?? [])]
        .sort((left, right) => right.stopSequence - left.stopSequence)[0];
      const terminalPlatform = terminalStopTime
        ? stopsById.get(terminalStopTime.stopId)
        : undefined;
      const terminalStation = terminalPlatform
        ? stopsById.get(terminalPlatform.parentStation ?? terminalPlatform.stopId)
        : undefined;
      trip.destination = terminalStation?.name ?? terminalPlatform?.name ?? trip.destination;
    }
    tripDestinationByRouteDirection.set(
      `${trip.routeId}:${trip.directionId}`,
      trip.destination,
    );
  }

  const lines: LineDto[] = routes.map((route) => {
    const [originStation, destinationStation] = splitTerminals(route.name);
    const serviceStatus: LineServiceStatus = activeServiceIds === null
      ? 'unknown'
      : activeLineCodes.has(route.code)
        ? 'active'
        : 'no-service';
    return {
      code: route.code,
      name: route.name,
      color: route.color,
      textColor: route.textColor,
      mode: TRAM_MODE,
      operator: TRAM_OPERATOR,
      vehicleMode: TRAM_MODE,
      network: network.name,
      originStation,
      destinationStation,
      serviceStatus,
    };
  }).sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
  const stationsByLine = new Map<string, StationDto[]>();

  for (const line of lines) {
    const candidateTrips = activeTrips.filter((trip) => trip.lineCode === line.code);
    const fallbackTrips = allTrips.filter((trip) => trip.lineCode === line.code);
    const representative = [...(candidateTrips.length ? candidateTrips : fallbackTrips)]
      .map((trip) => ({ trip, stops: stopTimesByTrip.get(trip.tripId) ?? [] }))
      .sort((left, right) => {
        const countParents = (values: StopTimeRow[]) => new Set(
          values.map((value) => stopsById.get(value.stopId)?.parentStation ?? value.stopId),
        ).size;
        return countParents(right.stops) - countParents(left.stops);
      })[0];
    const stationByCode = new Map<string, StationDto>();
    for (const stopTime of [...(representative?.stops ?? [])]
      .sort((left, right) => left.stopSequence - right.stopSequence)) {
      const platform = stopsById.get(stopTime.stopId);
      if (!platform) continue;
      const stationCode = platform.parentStation ?? platform.stopId;
      if (stationByCode.has(stationCode)) continue;
      const station = stopsById.get(stationCode) ?? platform;
      stationByCode.set(stationCode, {
        code: stationCode,
        lineCode: line.code,
        lineColor: line.color,
        mode: TRAM_MODE,
        operator: TRAM_OPERATOR,
        vehicleMode: TRAM_MODE,
        network: network.name,
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        order: stationByCode.size + 1,
        accessibilityTypeId: station.wheelchairBoarding,
        accessibilityLabel: station.wheelchairBoarding === 1
          ? 'Accessible'
          : station.wheelchairBoarding === 2
            ? 'Not accessible'
            : undefined,
      });
    }
    stationsByLine.set(line.code, [...stationByCode.values()]);
  }

  const shapesById = parseShapes(rows.shapes);
  const segmentsByLine = new Map<string, SegmentDto[]>();
  for (const line of lines) {
    const candidates = activeTrips.filter((trip) => trip.lineCode === line.code && trip.shapeId);
    const fallback = allTrips.filter((trip) => trip.lineCode === line.code && trip.shapeId);
    const shapeIds = [...new Set((candidates.length ? candidates : fallback).map((trip) => trip.shapeId))];
    segmentsByLine.set(line.code, shapeIds.flatMap((shapeId) => {
      const points = shapesById.get(shapeId) ?? [];
      return points.length > 1 ? [{
        id: `tram:${line.code}:${shapeId}`,
        lineCode: line.code,
        mode: TRAM_MODE,
        operator: TRAM_OPERATOR,
        points,
      }] : [];
    }));
  }

  const platformToParent = new Map(
    [...stopsById.values()].map((stop) => [stop.stopId, stop.parentStation ?? stop.stopId]),
  );
  const stationNameByCode = new Map(
    [...stopsById.values()].map((stop) => {
      const stationCode = stop.parentStation ?? stop.stopId;
      return [stationCode, stopsById.get(stationCode)?.name ?? stop.name];
    }),
  );
  const activeTripIds = new Set(activeTrips.map((trip) => trip.tripId));
  const scheduleRows: ScheduleRow[] = stopTimes.flatMap((stopTime) => {
    if (!activeTripIds.has(stopTime.tripId)) return [];
    const trip = tripsById.get(stopTime.tripId);
    const stop = stopsById.get(stopTime.stopId);
    if (!trip || !stop) return [];
    return [{
      date: catalogDate,
      lineCode: trip.lineCode,
      tripId: trip.tripId,
      destination: trip.destination,
      directionId: trip.directionId,
      stopId: stop.stopId,
      parentStation: stop.parentStation ?? stop.stopId,
      platformCode: stop.platformCode,
      arrivalTime: stopTime.arrivalTime,
    }];
  });

  return {
    network,
    catalogDate,
    fetchedAtMs,
    lines,
    stationsByLine,
    segmentsByLine,
    tripsById,
    platformToParent,
    routeCodeById,
    stationNameByCode,
    tripDestinationByRouteDirection,
    scheduleRows,
  };
}

async function downloadGtfsRows(network: TramNetwork): Promise<GtfsRows> {
  const response = await fetchWithTimeout(
    new URL(`/GTFS/zip/${network.code}.zip`, env.tramOpenDataBaseUrl),
  );
  if (!response.ok) {
    throw new Error(`TRAM GTFS ${network.code} failed with status ${response.status}`);
  }
  const files = readZipTextFiles(
    new Uint8Array(await response.arrayBuffer()),
    REQUIRED_GTFS_FILES,
  );
  return {
    routes: parseCsv(files.get('routes.txt') ?? ''),
    stops: parseCsv(files.get('stops.txt') ?? ''),
    trips: parseCsv(files.get('trips.txt') ?? ''),
    stopTimes: parseCsv(files.get('stop_times.txt') ?? ''),
    calendarDates: parseCsv(files.get('calendar_dates.txt') ?? ''),
    shapes: parseCsv(files.get('shapes.txt') ?? ''),
  };
}

export async function refreshTramSnapshot(
  network: TramNetwork,
  date: string,
  nowMs: number,
  cached: CatalogSnapshot | undefined,
  loader: (network: TramNetwork) => Promise<GtfsRows> = downloadGtfsRows,
): Promise<CatalogSnapshot> {
  if (cached && cached.catalogDate === date && nowMs - cached.fetchedAtMs < CATALOG_TTL_MS) {
    return cached;
  }
  try {
    return buildTramSnapshot(network, await loader(network), date, nowMs);
  } catch (error) {
    if (cached && nowMs - cached.fetchedAtMs <= CATALOG_STALE_MAX_MS) return cached;
    throw error;
  }
}

async function loadNetwork(network: TramNetwork): Promise<CatalogSnapshot> {
  const date = currentBarcelonaDate();
  const cached = snapshots.get(network.code);
  const nowMs = Date.now();
  if (cached && cached.catalogDate === date && nowMs - cached.fetchedAtMs < CATALOG_TTL_MS) {
    return cached;
  }
  const currentFlight = snapshotFlights.get(network.code);
  if (currentFlight) return currentFlight;

  const flight = refreshTramSnapshot(network, date, nowMs, cached)
    .then((snapshot) => {
      snapshots.set(network.code, snapshot);
      return snapshot;
    })
    .finally(() => {
      snapshotFlights.delete(network.code);
    });
  snapshotFlights.set(network.code, flight);
  return flight;
}

function networkForLine(lineCode: string): TramNetwork {
  const normalized = lineCode.toUpperCase();
  const network = normalized === 'T1' || normalized === 'T2' || normalized === 'T3'
    ? NETWORKS[0]
    : NETWORKS[1];
  if (!/^T[1-6]$/.test(normalized)) {
    throw new Error(`Unknown TRAM line code: ${lineCode}`);
  }
  return network;
}

async function getLineSnapshot(lineCode: string): Promise<CatalogSnapshot> {
  return loadNetwork(networkForLine(lineCode));
}

async function loadRealtimeFeed(network: TramNetwork): Promise<Record<string, unknown>> {
  const response = await tramOAuthClient.fetch(`/api/v1/gtfsrealtime?networkId=${network.id}`);
  if (!response.ok) {
    throw new Error(`TRAM realtime feed failed with status ${response.status}`);
  }
  const message = FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
  const value = FeedMessage.toObject(message, {
    arrays: true,
    defaults: false,
    enums: String,
    longs: String,
    objects: true,
  });
  if (!isRecord(value)) throw new Error('Invalid TRAM realtime feed');
  return value;
}

export function getScheduledArrivals(
  snapshot: CatalogSnapshot,
  lineCode: string,
  stationCode: string,
  nowMs: number,
): ArrivalDto[] {
  return snapshot.scheduleRows
    .filter((row) => row.lineCode === lineCode && row.parentStation === stationCode)
    .map((row) => ({ row, arrivalMs: barcelonaWallClockToMs(row.date, row.arrivalTime) }))
    .filter(({ arrivalMs }) => arrivalMs >= nowMs - 30_000 && arrivalMs <= nowMs + 2 * 60 * 60_000)
    .sort((left, right) => left.arrivalMs - right.arrivalMs)
    .slice(0, 8)
    .map(({ row, arrivalMs }) => ({
      lineCode,
      stationCode,
      mode: TRAM_MODE,
      operator: TRAM_OPERATOR,
      directionId: row.directionId || row.destination,
      platformCode: row.platformCode,
      destination: row.destination,
      etaSec: Math.max(0, Math.round((arrivalMs - nowMs) / 1_000)),
      sourceTimestampMs: nowMs,
      serviceId: row.tripId,
      realtimeStatus: 'scheduled' as const,
    }));
}

export function mapTramRealtimeArrivals(
  snapshot: CatalogSnapshot,
  feed: Record<string, unknown>,
  lineCode: string,
  stationCode: string,
  nowMs: number,
): ArrivalDto[] {
  const realtime: ArrivalDto[] = [];
  for (const entity of getFeedEntities(feed)) {
    if (!isRecord(entity.trip_update) || !isRecord(entity.trip_update.trip)) continue;
    const rawTrip = entity.trip_update.trip;
    const tripId = asString(rawTrip.trip_id);
    const staticTrip = tripId ? snapshot.tripsById.get(tripId) : undefined;
    const routeId = asString(rawTrip.route_id);
    const resolvedLineCode = staticTrip?.lineCode ?? (
      routeId ? snapshot.routeCodeById.get(routeId) : undefined
    );
    if (
      !tripId ||
      resolvedLineCode !== lineCode ||
      !Array.isArray(entity.trip_update.stop_time_update)
    ) {
      continue;
    }
    const updates = entity.trip_update.stop_time_update.filter(isRecord);
    const destinationStopId = updates.length
      ? asString(updates[updates.length - 1].stop_id)
      : undefined;
    const destinationStationCode = destinationStopId
      ? snapshot.platformToParent.get(destinationStopId) ?? destinationStopId
      : undefined;
    const realtimeDirectionId = String(asNumber(rawTrip.direction_id) ?? '');
    const destination = staticTrip?.destination ?? (
      routeId
        ? snapshot.tripDestinationByRouteDirection.get(`${routeId}:${realtimeDirectionId}`)
        : undefined
    ) ?? (
      destinationStationCode ? snapshot.stationNameByCode.get(destinationStationCode) : undefined
    ) ?? lineCode;
    const directionId = staticTrip?.directionId || realtimeDirectionId;
    for (const rawUpdate of updates) {
      if (!isRecord(rawUpdate)) continue;
      const stopId = asString(rawUpdate.stop_id);
      if (!stopId || (snapshot.platformToParent.get(stopId) ?? stopId) !== stationCode) continue;
      const event = isRecord(rawUpdate.arrival)
        ? rawUpdate.arrival
        : isRecord(rawUpdate.departure)
          ? rawUpdate.departure
          : null;
      const timeSec = event ? asNumber(event.time) : undefined;
      if (timeSec === undefined || timeSec * 1_000 < nowMs - 30_000) continue;
      realtime.push({
        lineCode,
        stationCode,
        mode: TRAM_MODE,
        operator: TRAM_OPERATOR,
        directionId: directionId || destination,
        destination,
        etaSec: Math.max(0, Math.round(timeSec - nowMs / 1_000)),
        sourceTimestampMs: asNumber(entity.trip_update.timestamp)
          ? Number(entity.trip_update.timestamp) * 1_000
          : nowMs,
        serviceId: tripId,
        realtimeStatus: 'realtime',
        delaySec: event ? asNumber(event.delay) : undefined,
        isCancelled: asString(rawTrip.schedule_relationship) === 'CANCELED',
      });
    }
  }
  return realtime
    .sort((left, right) => left.etaSec - right.etaSec)
    .filter((arrival, index, values) => index === values.findIndex(
      (candidate) => candidate.serviceId === arrival.serviceId &&
        candidate.stationCode === arrival.stationCode,
    ));
}

export async function getTramLines(): Promise<LineDto[]> {
  const values = await Promise.all(NETWORKS.map(loadNetwork));
  return values.flatMap((snapshot) => snapshot.lines);
}

export async function getTramLineStations(lineCode: string): Promise<StationDto[]> {
  const normalized = lineCode.toUpperCase();
  return (await getLineSnapshot(normalized)).stationsByLine.get(normalized) ?? [];
}

export async function getTramLineSegments(lineCode: string): Promise<SegmentDto[]> {
  const normalized = lineCode.toUpperCase();
  return (await getLineSnapshot(normalized)).segmentsByLine.get(normalized) ?? [];
}

export async function getAllTramStations(): Promise<StationDto[]> {
  const snapshots = await Promise.all(NETWORKS.map(loadNetwork));
  return snapshots.flatMap((snapshot) => [...snapshot.stationsByLine.values()].flat());
}

export async function getTramArrivals(lineCode: string, stationCode: string): Promise<ArrivalDto[]> {
  const normalized = lineCode.toUpperCase();
  const snapshot = await getLineSnapshot(normalized);
  const nowMs = Date.now();
  const scheduled = getScheduledArrivals(snapshot, normalized, stationCode, nowMs);
  try {
    const feed = await loadRealtimeFeed(snapshot.network);
    const uniqueRealtime = mapTramRealtimeArrivals(
      snapshot,
      feed,
      normalized,
      stationCode,
      nowMs,
    );
    const scheduledWithoutDuplicates = scheduled.filter((candidate) => !uniqueRealtime.some(
      (live) => live.destination === candidate.destination &&
        Math.abs(live.etaSec - candidate.etaSec) <= 120,
    ));
    return [...uniqueRealtime, ...scheduledWithoutDuplicates]
      .sort((left, right) => left.etaSec - right.etaSec)
      .slice(0, 8);
  } catch {
    return scheduled;
  }
}

function localizedText(value: unknown, language: TramLanguage): string | undefined {
  if (typeof value === 'string') return asString(value);
  if (!isRecord(value)) return undefined;
  return asString(value[language]) ?? asString(value.ca) ?? asString(value.es) ?? asString(value.en);
}

function findSourceUrl(value: string): string | undefined {
  return value.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, '');
}

export function mapTramAlterations(
  payload: unknown,
  language: TramLanguage,
  nowMs = Date.now(),
): ServiceAlertDto[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const title = localizedText(raw.title, language);
    const description = localizedText(raw.description, language) ?? title;
    if (!title || !description) return [];
    const lineCodes = Array.isArray(raw.lines)
      ? raw.lines.flatMap((line) => {
        const code = asString(line)?.toUpperCase();
        return code && /^T[1-6]$/.test(code) ? [code] : [];
      })
      : [];
    const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : raw.type;
    return [{
      id: `tram-alteration:${asString(raw.id) ?? title}`,
      title,
      description,
      mode: TRAM_MODE,
      operator: TRAM_OPERATOR,
      severity: type === 0 || type === 'warning' ? 'warning' : 'info',
      kind: 'current',
      affectedLines: lineCodes.map((code) => ({
        code,
        mode: TRAM_MODE,
        operator: TRAM_OPERATOR,
      })),
      source: 'tram-alterations',
      sourceUrl: findSourceUrl(description),
      updatedAtMs: nowMs,
    }];
  });
}

export async function getTramServiceAlerts(language: TramLanguage): Promise<ServiceAlertDto[]> {
  const response = await tramOAuthClient.fetch('/api/v1/Alterations');
  if (!response.ok) {
    throw new Error(`TRAM alterations failed with status ${response.status}`);
  }
  return mapTramAlterations(await response.json(), language);
}
