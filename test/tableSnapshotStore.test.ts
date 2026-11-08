import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/core/snapshots';
import { snapshotToEntity } from '../src/storage/tableSnapshotStore';

const snapshot: Snapshot = {
  locationId: 'seattle', lat: 47.6, lon: -122.3,
  observedAt: '2026-11-08T06:30', fetchedAt: '2026-11-08T06:35:01.000Z',
  tempC: 11.4, windKph: 31.1, weatherCode: 51, condition: 'Drizzle',
};

describe('snapshotToEntity', () => {
  it('R44: identity → PartitionKey = location id, RowKey = observation time', () => {
    const e = snapshotToEntity(snapshot);
    expect(e.partitionKey).toBe('seattle');
    expect(e.rowKey).toBe('2026-11-08T06:30');
  });

  it('R43: every §5 field is stored', () => {
    expect(snapshotToEntity(snapshot)).toMatchObject(snapshot);
  });
});
