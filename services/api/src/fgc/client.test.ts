import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { barcelonaWallClockToMs } from '../utils/barcelona-time';
import {
  applyLineServiceStatus,
  buildStaticStationsByLine,
  getActiveLineCodesForDate,
  parseLineRecords,
  parseScheduleRows,
} from './client';

describe('FGC data mappers', () => {
  it('keeps only the Barcelona-connected line allowlist', () => {
    const lines = parseLineRecords([
      {
        route_short_name: 'S1',
        route_long_name: 'Barcelona Pl. Catalunya - Terrassa Nacions Unides',
        route_color: 'EF7900',
      },
      {
        route_short_name: 'MM',
        route_long_name: 'Cremallera Montserrat',
        route_color: '000000',
      },
    ]);

    assert.equal(lines.length, 1);
    assert.equal(lines[0].code, 'S1');
    assert.equal(lines[0].operator, 'fgc');
    assert.equal(lines[0].network, 'barcelona-valles');
  });

  it('normalizes daily schedule rows and parent stations', () => {
    const rows = parseScheduleRows([
      {
        date: '2026-07-11',
        route_short_name: 'L6',
        trip_headsign: 'Sarrià',
        stop_name: 'Barcelona - Plaça Catalunya',
        stop_id: 'PC2',
        parent_station: 'PC',
        arrival_time: '12:34:00',
        stop_sequence: '1',
        shape_id: '100001',
        stop_lat: '41.38563194',
        stop_lon: '2.168720219',
        wheelchair_boarding: '1',
        platform_code: '2',
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].parentStation, 'PC');
    assert.equal(rows[0].platformCode, '2');
    assert.equal(rows[0].wheelchairBoarding, 1);
  });

  it('builds stations from static GTFS when a line has no trips today', () => {
    const lines = parseLineRecords([
      {
        route_short_name: 'R50',
        route_long_name: 'Manresa Baixador - Barcelona Pl. Espanya',
        route_color: '137F4B',
      },
    ]);
    const stationsByLine = buildStaticStationsByLine(
      [
        { stop_id: 'MB', stop_name: 'Manresa Baixador', stop_lat: '41.72', stop_lon: '1.82' },
        { stop_id: 'MB1', stop_name: 'Manresa Baixador', stop_lat: '41.72', stop_lon: '1.82', parent_station: 'MB' },
        { stop_id: 'PE', stop_name: 'Barcelona - Plaça Espanya', stop_lat: '41.37', stop_lon: '2.15' },
        { stop_id: 'PE4', stop_name: 'Barcelona - Plaça Espanya', stop_lat: '41.37', stop_lon: '2.15', parent_station: 'PE' },
      ],
      [
        { trip_id: 'r50-trip', stop_id: 'MB1', stop_sequence: '1' },
        { trip_id: 'r50-trip', stop_id: 'PE4', stop_sequence: '2' },
      ],
      [
        { route_id: 'R50', trip_id: 'r50-trip', trip_headsign: 'Barcelona', shape_id: 'r50-shape' },
      ],
      lines,
    );

    assert.deepEqual(
      stationsByLine.get('R50')?.map((station) => station.code),
      ['MB', 'PE'],
    );
  });

  it('distinguishes no service today from unavailable schedule data', () => {
    const lines = parseLineRecords([
      { route_short_name: 'S1', route_long_name: 'Barcelona - Terrassa' },
      { route_short_name: 'R50', route_long_name: 'Manresa - Barcelona' },
    ]);
    const trips = [
      {
        route_id: 'S1',
        service_id: 'sunday-service',
        trip_id: 's1-trip',
      },
      {
        route_id: 'R50',
        service_id: 'weekday-service',
        trip_id: 'r50-trip',
      },
    ];
    const calendarDates = [
      { service_id: 'sunday-service', date: '20260712', exception_type: '1' },
    ];
    const activeLineCodes = getActiveLineCodesForDate(
      trips,
      calendarDates,
      '2026-07-12',
    );

    assert.deepEqual(
      applyLineServiceStatus(lines, activeLineCodes).map((line) => line.serviceStatus),
      ['active', 'no-service'],
    );
    assert.deepEqual(
      applyLineServiceStatus(lines, null).map((line) => line.serviceStatus),
      ['unknown', 'unknown'],
    );
  });

  it('converts Barcelona summer wall-clock time to UTC', () => {
    assert.equal(
      new Date(barcelonaWallClockToMs('2026-07-11', '12:00:00')).toISOString(),
      '2026-07-11T10:00:00.000Z',
    );
  });
});
