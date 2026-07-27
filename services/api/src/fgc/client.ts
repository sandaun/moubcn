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
  TransitVehicleDto,
  VehicleMode,
} from '../types/api';
import { barcelonaWallClockToMs, currentBarcelonaDate } from '../utils/barcelona-time';
import { asNumber, asString, isRecord } from '../utils/coerce';
import { getFeedEntities } from '../utils/gtfs-realtime';

const FGC_MODE = 'fgc' as const;
const FGC_OPERATOR = 'fgc' as const;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_LINES = new Set([
  'L6',
  'L7',
  'L8',
  'L12',
  'S1',
  'S2',
  'S3',
  'S4',
  'S8',
  'S9',
  'R5',
  'R6',
  'R50',
  'R53',
  'R60',
  'R63',
  'FV',
]);

interface CatalogSnapshot {
  fetchedAtMs: number;
  catalogDate: string;
  serviceDate: string;
  lines: LineDto[];
  stationsByLine: Map<string, StationDto[]>;
  segmentsByLine: Map<string, SegmentDto[]>;
  scheduleRows: ScheduleRow[];
  tripsById: Map<string, TripRow>;
  platformToParent: Map<string, string>;
}

interface ScheduleRow {
  date: string;
  lineCode: string;
  destination: string;
  stationName: string;
  stopId: string;
  parentStation: string;
  arrivalTime: string;
  stopSequence: number;
  shapeId: string;
  color?: string;
  textColor?: string;
  lat: number;
  lon: number;
  wheelchairBoarding?: number;
  platformCode?: string;
}

interface TripRow {
  tripId: string;
  lineCode: string;
  destination: string;
  shapeId: string;
  serviceId: string;
}

interface StaticStop {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  parentStation?: string;
  wheelchairBoarding?: number;
}

interface StaticStopTime {
  tripId: string;
  stopId: string;
  stopSequence: number;
}

interface StaticGtfsRows {
  calendarDates: Record<string, unknown>[];
  stops: Record<string, unknown>[];
  stopTimes: Record<string, unknown>[];
  trips: Record<string, unknown>[];
}

let catalogSnapshot: CatalogSnapshot | null = null;
let catalogInFlight: Promise<CatalogSnapshot> | null = null;

function asBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'True' || value === 'true') return true;
  if (value === false || value === 'False' || value === 'false') return false;
  return undefined;
}

function networkForLine(lineCode: string): string {
  return ['L6', 'L7', 'L12', 'S1', 'S2', 'FV'].includes(lineCode)
    ? 'barcelona-valles'
    : 'llobregat-anoia';
}

function vehicleModeForLine(lineCode: string): VehicleMode {
  if (lineCode === 'FV') return 'funicular';
  if (['L6', 'L7', 'L8', 'L12'].includes(lineCode)) return 'metro';
  return 'rail';
}

async function requestJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`FGC API failed with status ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

async function getDatasetRecords(datasetId: string, limit = 100): Promise<unknown[]> {
  const url = new URL(`${env.fgcOpenDataBaseUrl}/catalog/datasets/${datasetId}/records`);
  url.searchParams.set('limit', String(limit));
  const payload = await requestJson(url.toString());
  if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
  return payload.results;
}

async function getDatasetCsv(datasetId: string): Promise<Record<string, unknown>[]> {
  const url = new URL(`${env.fgcOpenDataBaseUrl}/catalog/datasets/${datasetId}/exports/csv`);
  url.searchParams.set('delimiter', ',');
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`FGC CSV export failed with status ${response.status}`);
  }
  const rows = parse(await response.text(), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as unknown;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function findDatasetFileUrl(records: unknown[], filename?: string): string | undefined {
  for (const record of records) {
    if (!isRecord(record) || !isRecord(record.file)) continue;
    const currentFilename = asString(record.file.filename);
    const url = asString(record.file.url);
    if (url && (!filename || currentFilename === filename)) return url;
  }
  return undefined;
}

async function getDatasetFileUrl(datasetId: string, filename?: string): Promise<string> {
  const records = await getDatasetRecords(datasetId, 20);
  const url = findDatasetFileUrl(records, filename);
  if (url) return url;
  throw new Error(`FGC dataset file not found: ${datasetId}${filename ? `/${filename}` : ''}`);
}

async function getCsvFileRows(url: string, filename: string): Promise<Record<string, unknown>[]> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`FGC ${filename} failed with status ${response.status}`);
  }
  const rows = parse(await response.text(), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as unknown;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

async function loadStaticGtfsRows(): Promise<StaticGtfsRows> {
  const records = await getDatasetRecords('gtfs_zip', 20);
  const filenames = ['stops.txt', 'stop_times.txt', 'trips.txt', 'calendar_dates.txt'] as const;
  const urls = filenames.map((filename) => {
    const url = findDatasetFileUrl(records, filename);
    if (!url) throw new Error(`FGC dataset file not found: gtfs_zip/${filename}`);
    return url;
  });
  const [stops, stopTimes, trips, calendarDates] = await Promise.all([
    getCsvFileRows(urls[0], filenames[0]),
    getCsvFileRows(urls[1], filenames[1]),
    getCsvFileRows(urls[2], filenames[2]),
    getCsvFileRows(urls[3], filenames[3]).catch(() => []),
  ]);
  return { calendarDates, stops, stopTimes, trips };
}

async function loadDailySchedule(): Promise<ScheduleRow[]> {
  try {
    return parseScheduleRows(await getDatasetCsv('viajes-de-hoy'));
  } catch {
    return [];
  }
}

export function parseScheduleRows(rows: Record<string, unknown>[]): ScheduleRow[] {
  return rows.flatMap((row) => {
    const lineCode = asString(row.route_short_name)?.toUpperCase();
    const stopId = asString(row.stop_id);
    const stationName = asString(row.stop_name);
    const arrivalTime = asString(row.arrival_time);
    const date = asString(row.date);
    const lat = asNumber(row.stop_lat);
    const lon = asNumber(row.stop_lon);
    const stopSequence = asNumber(row.stop_sequence);
    if (
      !lineCode ||
      !ALLOWED_LINES.has(lineCode) ||
      !stopId ||
      !stationName ||
      !arrivalTime ||
      !date ||
      lat === undefined ||
      lon === undefined ||
      stopSequence === undefined
    ) {
      return [];
    }
    return [{
      date,
      lineCode,
      destination: asString(row.trip_headsign) ?? lineCode,
      stationName,
      stopId,
      parentStation: asString(row.parent_station) ?? stopId,
      arrivalTime,
      stopSequence,
      shapeId: asString(row.shape_id) ?? '',
      color: asString(row.route_color),
      textColor: asString(row.route_text_color),
      lat,
      lon,
      wheelchairBoarding: asNumber(row.wheelchair_boarding),
      platformCode: asString(row.platform_code),
    }];
  });
}

function parseTripRows(rows: Record<string, unknown>[]): Map<string, TripRow> {
  const result = new Map<string, TripRow>();
  for (const row of rows) {
    const tripId = asString(row.trip_id);
    const lineCode = asString(row.route_id)?.toUpperCase();
    if (!tripId || !lineCode || !ALLOWED_LINES.has(lineCode)) continue;
    result.set(tripId, {
      tripId,
      lineCode,
      destination: asString(row.trip_headsign) ?? lineCode,
      shapeId: asString(row.shape_id) ?? tripId,
      serviceId: asString(row.service_id) ?? '',
    });
  }
  return result;
}

function parseStaticStops(rows: Record<string, unknown>[]): Map<string, StaticStop> {
  const result = new Map<string, StaticStop>();
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
      parentStation: asString(row.parent_station),
      wheelchairBoarding: asNumber(row.wheelchair_boarding),
    });
  }
  return result;
}

function parseStaticStopTimes(rows: Record<string, unknown>[]): StaticStopTime[] {
  return rows.flatMap((row) => {
    const tripId = asString(row.trip_id);
    const stopId = asString(row.stop_id);
    const stopSequence = asNumber(row.stop_sequence);
    if (!tripId || !stopId || stopSequence === undefined) return [];
    return [{ tripId, stopId, stopSequence }];
  });
}

export function buildStaticStationsByLine(
  stopRows: Record<string, unknown>[],
  stopTimeRows: Record<string, unknown>[],
  tripRows: Record<string, unknown>[],
  lines: LineDto[],
): Map<string, StationDto[]> {
  const stopsById = parseStaticStops(stopRows);
  const tripsById = parseTripRows(tripRows);
  const stopTimesByTrip = new Map<string, StaticStopTime[]>();
  for (const stopTime of parseStaticStopTimes(stopTimeRows)) {
    if (!tripsById.has(stopTime.tripId)) continue;
    const tripStopTimes = stopTimesByTrip.get(stopTime.tripId) ?? [];
    tripStopTimes.push(stopTime);
    stopTimesByTrip.set(stopTime.tripId, tripStopTimes);
  }
  const lineByCode = new Map(lines.map((line) => [line.code, line]));
  const result = new Map<string, StationDto[]>();

  for (const lineCode of ALLOWED_LINES) {
    const candidates: StaticStopTime[][] = [];
    for (const [tripId, stopTimes] of stopTimesByTrip) {
      if (tripsById.get(tripId)?.lineCode === lineCode) {
        candidates.push(stopTimes);
      }
    }
    const representative = candidates.sort((left, right) => {
      const leftStops = new Set(left.map((row) => stopsById.get(row.stopId)?.parentStation ?? row.stopId)).size;
      const rightStops = new Set(right.map((row) => stopsById.get(row.stopId)?.parentStation ?? row.stopId)).size;
      return rightStops - leftStops;
    })[0] ?? [];
    const stationByCode = new Map<string, StationDto>();
    const line = lineByCode.get(lineCode);

    for (const stopTime of [...representative].sort((a, b) => a.stopSequence - b.stopSequence)) {
      const platform = stopsById.get(stopTime.stopId);
      if (!platform) continue;
      const stationCode = platform.parentStation ?? platform.stopId;
      if (stationByCode.has(stationCode)) continue;
      const station = stopsById.get(stationCode) ?? platform;
      stationByCode.set(stationCode, {
        code: stationCode,
        lineCode,
        lineColor: line?.color,
        mode: FGC_MODE,
        operator: FGC_OPERATOR,
        vehicleMode: vehicleModeForLine(lineCode),
        network: networkForLine(lineCode),
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        order: stationByCode.size + 1,
        accessibilityTypeId: station.wheelchairBoarding,
        accessibilityLabel:
          station.wheelchairBoarding === 1
            ? 'Accessible'
            : station.wheelchairBoarding === 2
              ? 'Not accessible'
              : undefined,
      });
    }
    result.set(lineCode, [...stationByCode.values()]);
  }
  return result;
}

function buildPlatformToParent(stopRows: Record<string, unknown>[]): Map<string, string> {
  const stopsById = parseStaticStops(stopRows);
  return new Map(
    [...stopsById.values()].map((stop) => [stop.stopId, stop.parentStation ?? stop.stopId]),
  );
}

export function parseLineRecords(records: unknown[]): LineDto[] {
  return records.flatMap((record) => {
    if (!isRecord(record)) return [];
    const code = asString(record.route_short_name)?.toUpperCase();
    if (!code || !ALLOWED_LINES.has(code)) return [];
    const longName = asString(record.route_long_name) ?? code;
    const terminals = longName.split(' - ');
    return [{
      code,
      name: longName,
      mode: FGC_MODE,
      operator: FGC_OPERATOR,
      vehicleMode: vehicleModeForLine(code),
      network: networkForLine(code),
      color: asString(record.route_color),
      textColor: asString(record.route_text_color),
      originStation: terminals[0],
      destinationStation: terminals.length > 1 ? terminals.at(-1) : undefined,
    }];
  }).sort((left, right) => {
    const networkComparison = (left.network ?? '').localeCompare(right.network ?? '');
    return networkComparison || left.code.localeCompare(right.code, undefined, { numeric: true });
  });
}

export function applyLineServiceStatus(
  lines: LineDto[],
  activeLineCodes: ReadonlySet<string> | null,
): LineDto[] {
  return lines.map((line) => {
    const serviceStatus: LineServiceStatus = activeLineCodes === null
      ? 'unknown'
      : activeLineCodes.has(line.code)
        ? 'active'
        : 'no-service';
    return { ...line, serviceStatus };
  });
}

export function getActiveLineCodesForDate(
  tripRows: Record<string, unknown>[],
  calendarDateRows: Record<string, unknown>[],
  date: string,
): Set<string> | null {
  const compactDate = date.replaceAll('-', '');
  const matchingRows = calendarDateRows.filter(
    (row) => asString(row.date) === compactDate,
  );
  if (matchingRows.length === 0) return null;

  const activeServiceIds = new Set<string>();
  for (const row of matchingRows) {
    const serviceId = asString(row.service_id);
    if (!serviceId) continue;
    if (asNumber(row.exception_type) === 1) {
      activeServiceIds.add(serviceId);
    } else if (asNumber(row.exception_type) === 2) {
      activeServiceIds.delete(serviceId);
    }
  }

  const activeLineCodes = new Set<string>();
  for (const trip of parseTripRows(tripRows).values()) {
    if (activeServiceIds.has(trip.serviceId)) {
      activeLineCodes.add(trip.lineCode);
    }
  }
  return activeLineCodes;
}

function parseSegments(records: unknown[]): Map<string, SegmentDto[]> {
  const result = new Map<string, SegmentDto[]>();
  for (const record of records) {
    if (!isRecord(record)) continue;
    const lineCode = asString(record.route_short_name)?.toUpperCase();
    if (!lineCode || !ALLOWED_LINES.has(lineCode) || !isRecord(record.shape)) continue;
    const geometry = isRecord(record.shape.geometry) ? record.shape.geometry : null;
    if (!geometry || !Array.isArray(geometry.coordinates)) continue;
    const lineStrings = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
    const segments: SegmentDto[] = [];
    lineStrings.forEach((rawLine, index) => {
      if (!Array.isArray(rawLine)) return;
      const points = rawLine.flatMap((rawPoint) => {
        if (!Array.isArray(rawPoint) || rawPoint.length < 2) return [];
        const lon = asNumber(rawPoint[0]);
        const lat = asNumber(rawPoint[1]);
        return lat === undefined || lon === undefined ? [] : [{ lat, lon }];
      });
      if (points.length > 1) {
        segments.push({
          id: `fgc:${lineCode}:${index}`,
          lineCode,
          mode: FGC_MODE,
          operator: FGC_OPERATOR,
          points,
        });
      }
    });
    result.set(lineCode, segments);
  }
  return result;
}

async function loadCatalog(): Promise<CatalogSnapshot> {
  const [lineRecords, routeRecords, staticGtfs, dailySchedule] = await Promise.all([
    getDatasetRecords('lineas-red-fgc', 100),
    getDatasetRecords('gtfs_routes', 100),
    loadStaticGtfsRows(),
    loadDailySchedule(),
  ]);
  const catalogDate = currentBarcelonaDate();
  const staticLines = parseLineRecords(lineRecords);
  const tripsById = parseTripRows(staticGtfs.trips);
  const activeLineCodes = getActiveLineCodesForDate(
    staticGtfs.trips,
    staticGtfs.calendarDates,
    catalogDate,
  );
  return {
    fetchedAtMs: Date.now(),
    catalogDate,
    serviceDate: dailySchedule[0]?.date ?? catalogDate,
    lines: applyLineServiceStatus(staticLines, activeLineCodes),
    stationsByLine: buildStaticStationsByLine(
      staticGtfs.stops,
      staticGtfs.stopTimes,
      staticGtfs.trips,
      staticLines,
    ),
    segmentsByLine: parseSegments(routeRecords),
    scheduleRows: dailySchedule,
    tripsById,
    platformToParent: buildPlatformToParent(staticGtfs.stops),
  };
}

async function getCatalog(): Promise<CatalogSnapshot> {
  if (
    catalogSnapshot &&
    catalogSnapshot.catalogDate === currentBarcelonaDate() &&
    Date.now() - catalogSnapshot.fetchedAtMs < CATALOG_TTL_MS
  ) {
    return catalogSnapshot;
  }
  if (catalogInFlight) return catalogInFlight;
  catalogInFlight = loadCatalog()
    .then((snapshot) => {
      catalogSnapshot = snapshot;
      return snapshot;
    })
    .catch((error) => {
      if (catalogSnapshot) return catalogSnapshot;
      throw error;
    })
    .finally(() => {
      catalogInFlight = null;
    });
  return catalogInFlight;
}

async function loadFeed(datasetId: string): Promise<Record<string, unknown>> {
  const fileUrl = await getDatasetFileUrl(datasetId);
  const response = await fetchWithTimeout(fileUrl);
  if (!response.ok) throw new Error(`FGC realtime feed failed with status ${response.status}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  const message = FeedMessage.decode(buffer);
  const value = FeedMessage.toObject(message, {
    arrays: true,
    defaults: false,
    enums: String,
    longs: String,
    objects: true,
  });
  if (!isRecord(value)) throw new Error('Invalid FGC realtime feed');
  return value;
}

function getScheduledArrivals(
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
      mode: FGC_MODE,
      operator: FGC_OPERATOR,
      directionId: row.destination,
      platformCode: row.platformCode,
      destination: row.destination,
      etaSec: Math.max(0, Math.round((arrivalMs - nowMs) / 1_000)),
      sourceTimestampMs: nowMs,
      realtimeStatus: 'scheduled',
    }));
}

export async function getFgcLines(): Promise<LineDto[]> {
  return (await getCatalog()).lines;
}

export async function getFgcLineStations(lineCode: string): Promise<StationDto[]> {
  return (await getCatalog()).stationsByLine.get(lineCode.toUpperCase()) ?? [];
}

export async function getFgcLineSegments(lineCode: string): Promise<SegmentDto[]> {
  return (await getCatalog()).segmentsByLine.get(lineCode.toUpperCase()) ?? [];
}

export async function getFgcArrivals(lineCode: string, stationCode: string): Promise<ArrivalDto[]> {
  const snapshot = await getCatalog();
  const nowMs = Date.now();
  const scheduled = getScheduledArrivals(snapshot, lineCode.toUpperCase(), stationCode, nowMs);
  try {
    const feed = await loadFeed('trip-updates-gtfs_realtime');
    const realtime: ArrivalDto[] = [];
    for (const entity of getFeedEntities(feed)) {
      if (!isRecord(entity.trip_update) || !isRecord(entity.trip_update.trip)) continue;
      const tripId = asString(entity.trip_update.trip.trip_id);
      const trip = tripId ? snapshot.tripsById.get(tripId) : undefined;
      if (!trip || trip.lineCode !== lineCode.toUpperCase() || !Array.isArray(entity.trip_update.stop_time_update)) continue;
      for (const update of entity.trip_update.stop_time_update) {
        if (!isRecord(update)) continue;
        const stopId = asString(update.stop_id);
        if (!stopId || (snapshot.platformToParent.get(stopId) ?? stopId) !== stationCode) continue;
        const event = isRecord(update.arrival) ? update.arrival : isRecord(update.departure) ? update.departure : null;
        const timeSec = event ? asNumber(event.time) : undefined;
        if (timeSec === undefined || timeSec * 1_000 < nowMs - 30_000) continue;
        const delaySec = event ? asNumber(event.delay) : undefined;
        realtime.push({
          lineCode: trip.lineCode,
          stationCode,
          mode: FGC_MODE,
          operator: FGC_OPERATOR,
          directionId: trip.destination,
          destination: trip.destination,
          etaSec: Math.max(0, Math.round(timeSec - nowMs / 1_000)),
          sourceTimestampMs: asNumber(entity.trip_update.timestamp)
            ? Number(entity.trip_update.timestamp) * 1_000
            : nowMs,
          serviceId: trip.tripId,
          realtimeStatus: 'realtime',
          delaySec,
          isCancelled: asString(entity.trip_update.trip.schedule_relationship) === 'CANCELED',
        });
      }
    }
    const uniqueRealtime = realtime
      .sort((a, b) => a.etaSec - b.etaSec)
      .filter((arrival, index, values) =>
        index === values.findIndex((candidate) =>
          candidate.serviceId === arrival.serviceId && candidate.stationCode === arrival.stationCode,
        ),
      );
    const scheduledWithoutRealtimeDuplicates = scheduled.filter((candidate) =>
      !uniqueRealtime.some((live) =>
        live.destination === candidate.destination && Math.abs(live.etaSec - candidate.etaSec) <= 120,
      ),
    );
    return [...uniqueRealtime, ...scheduledWithoutRealtimeDuplicates]
      .sort((a, b) => a.etaSec - b.etaSec)
      .slice(0, 8);
  } catch {
    return scheduled;
  }
}

function getTranslation(value: unknown, language: 'ca' | 'es' | 'en'): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.translation)) return undefined;
  const translations = value.translation.filter(isRecord);
  return asString(translations.find((item) => asString(item.language) === language)?.text)
    ?? asString(translations.find((item) => !item.language)?.text)
    ?? asString(translations[0]?.text);
}

export async function getFgcServiceAlerts(language: 'ca' | 'es' | 'en'): Promise<ServiceAlertDto[]> {
  const [snapshot, feed] = await Promise.all([getCatalog(), loadFeed('alerts-gtfs_realtime')]);
  const nowMs = Date.now();
  return getFeedEntities(feed).flatMap((entity) => {
    if (!isRecord(entity.alert)) return [];
    const informed = Array.isArray(entity.alert.informed_entity)
      ? entity.alert.informed_entity.filter(isRecord)
      : [];
    const lineCodes = new Set<string>();
    for (const target of informed) {
      const routeId = asString(target.route_id)?.toUpperCase();
      if (routeId && ALLOWED_LINES.has(routeId)) lineCodes.add(routeId);
      if (isRecord(target.trip)) {
        const trip = snapshot.tripsById.get(asString(target.trip.trip_id) ?? '');
        if (trip) lineCodes.add(trip.lineCode);
      }
      const stopId = asString(target.stop_id);
      const parentStation = stopId ? snapshot.platformToParent.get(stopId) ?? stopId : undefined;
      if (parentStation) {
        for (const [candidateLine, stations] of snapshot.stationsByLine) {
          if (stations.some((station) => station.code === parentStation)) lineCodes.add(candidateLine);
        }
      }
    }
    const periods = Array.isArray(entity.alert.active_period)
      ? entity.alert.active_period.filter(isRecord)
      : [];
    const startsAtMs = asNumber(periods[0]?.start) ? Number(periods[0].start) * 1_000 : undefined;
    const endsAtMs = asNumber(periods[0]?.end) ? Number(periods[0].end) * 1_000 : undefined;
    const title = getTranslation(entity.alert.header_text, language);
    if (!title || lineCodes.size === 0) return [];
    const effect = asString(entity.alert.effect);
    return [{
      id: asString(entity.id) ?? `fgc-alert-${title}`,
      title,
      description: getTranslation(entity.alert.description_text, language) ?? title,
      mode: FGC_MODE,
      operator: FGC_OPERATOR,
      severity: ['NO_SERVICE', 'SIGNIFICANT_DELAYS', 'STOP_MOVED'].includes(effect ?? '')
        ? 'disruption'
        : 'warning',
      kind: startsAtMs !== undefined && startsAtMs > nowMs ? 'planned' : 'current',
      affectedLines: [...lineCodes].map((code) => ({ code, mode: FGC_MODE, operator: FGC_OPERATOR })),
      source: 'fgc-gtfs-rt',
      startsAtMs,
      endsAtMs,
      updatedAtMs: nowMs,
    }];
  });
}

function parseNextStops(value: unknown): string[] {
  const text = asString(value);
  return text ? [...text.matchAll(/"parada"\s*:\s*"([^"]+)"/g)].map((match) => match[1]) : [];
}

export async function getFgcVehicles(lineCode?: string): Promise<TransitVehicleDto[]> {
  const records = await getDatasetRecords('posicionament-dels-trens', 100);
  return records.flatMap((record) => {
    if (!isRecord(record) || !isRecord(record.geo_point_2d)) return [];
    const currentLine = asString(record.lin)?.toUpperCase();
    const lat = asNumber(record.geo_point_2d.lat);
    const lon = asNumber(record.geo_point_2d.lon);
    if (
      !currentLine ||
      !ALLOWED_LINES.has(currentLine) ||
      (lineCode && currentLine !== lineCode.toUpperCase()) ||
      lat === undefined ||
      lon === undefined
    ) return [];
    const occupancyValues = [
      asNumber(record.ocupacio_mi_percent),
      asNumber(record.ocupacio_ri_percent),
      asNumber(record.ocupacio_m1_percent),
      asNumber(record.ocupacio_m2_percent),
    ].filter((value): value is number => value !== undefined);
    return [{
      id: asString(record.id) ?? `${currentLine}:${lat}:${lon}`,
      lineCode: currentLine,
      mode: FGC_MODE,
      operator: FGC_OPERATOR,
      lat,
      lon,
      destination: asString(record.desti),
      nextStops: parseNextStops(record.properes_parades),
      isOnTime: asBoolean(record.en_hora),
      occupancyPercent: occupancyValues.length
        ? occupancyValues.reduce((sum, value) => sum + value, 0) / occupancyValues.length
        : undefined,
    }];
  });
}

export async function getAllFgcStations(): Promise<StationDto[]> {
  const snapshot = await getCatalog();
  const unique = new Map<string, StationDto>();
  for (const stations of snapshot.stationsByLine.values()) {
    for (const station of stations) {
      unique.set(`${station.lineCode}:${station.code}`, station);
    }
  }
  return [...unique.values()];
}
