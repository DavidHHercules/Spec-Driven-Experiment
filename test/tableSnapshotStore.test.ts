import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/core/snapshots';
import { createSnapshotStoreFromSettings, resolveStorageTarget, snapshotToEntity } from '../src/storage/tableSnapshotStore';

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

describe('resolveStorageTarget (spec 004 R54)', () => {
  const AZURITE = 'UseDevelopmentStorage=true';
  const REAL = 'DefaultEndpointsProtocol=https;AccountName=x;EndpointSuffix=core.windows.net';

  it.each([AZURITE, REAL])('R54.1: connection string %j → connection-string', (cs) => {
    expect(resolveStorageTarget({ AzureWebJobsStorage: cs })).toStrictEqual({
      kind: 'connection-string',
      connectionString: cs,
    });
  });

  it('R54.1: connection string wins over account name', () => {
    expect(
      resolveStorageTarget({ AzureWebJobsStorage: AZURITE, AzureWebJobsStorage__accountName: 'wxsnap' }),
    ).toMatchObject({ kind: 'connection-string' });
  });

  it('R54.2: only account name → identity with the table endpoint', () => {
    expect(resolveStorageTarget({ AzureWebJobsStorage__accountName: 'wxsnapabc123' })).toStrictEqual({
      kind: 'identity',
      tableUrl: 'https://wxsnapabc123.table.core.windows.net',
    });
  });

  it.each(['', '   '])('R54.2: empty connection string %j is treated as unset', (cs) => {
    expect(
      resolveStorageTarget({ AzureWebJobsStorage: cs, AzureWebJobsStorage__accountName: 'acct' }),
    ).toMatchObject({ kind: 'identity' });
  });

  it('R54.3: neither → none', () => {
    expect(resolveStorageTarget({})).toStrictEqual({ kind: 'none' });
  });

  it('R54.3: with no storage configured, upsert rejects naming both settings', async () => {
    const store = createSnapshotStoreFromSettings({});
    const err = await store.upsert(snapshot).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('AzureWebJobsStorage');
    expect((err as Error).message).toContain('AzureWebJobsStorage__accountName');
  });

  it('R54.2: identity store can be created without touching the network or credentials', () => {
    expect(() => createSnapshotStoreFromSettings({ AzureWebJobsStorage__accountName: 'acct' })).not.toThrow();
  });
});
