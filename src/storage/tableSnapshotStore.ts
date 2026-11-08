import { DefaultAzureCredential } from '@azure/identity';
import { TableClient, type TableEntity } from '@azure/data-tables';
import { SNAPSHOT_TABLE, type Snapshot, type SnapshotStore } from '../core/snapshots';

/**
 * Maps a snapshot to a Table Storage entity (plan 003 §2.3):
 * PartitionKey = location id (one location's history together),
 * RowKey = upstream observation time (identity per R44; ISO strings sort chronologically).
 */
export function snapshotToEntity(s: Snapshot): TableEntity<Snapshot> {
  return { partitionKey: s.locationId, rowKey: s.observedAt, ...s };
}

/** How to reach Table Storage (spec 004 R54). */
export type StorageTarget =
  | { kind: 'connection-string'; connectionString: string }
  | { kind: 'identity'; tableUrl: string }
  | { kind: 'none' };

/**
 * R54: pick the storage connection, in priority order:
 *  1. `AzureWebJobsStorage` connection string (local / Azurite — R55)
 *  2. `AzureWebJobsStorage__accountName` → managed identity (Azure — R51)
 *  3. nothing configured
 */
export function resolveStorageTarget(settings: Readonly<Record<string, string | undefined>>): StorageTarget {
  const connectionString = settings['AzureWebJobsStorage']?.trim();
  if (connectionString) return { kind: 'connection-string', connectionString };

  const account = settings['AzureWebJobsStorage__accountName']?.trim();
  if (account) return { kind: 'identity', tableUrl: `https://${account}.table.core.windows.net` };

  return { kind: 'none' };
}

/** Creates the snapshot store for whatever storage the settings point at (R54). */
export function createSnapshotStoreFromSettings(
  settings: Readonly<Record<string, string | undefined>>,
  tableName = SNAPSHOT_TABLE,
): SnapshotStore {
  const target = resolveStorageTarget(settings);
  switch (target.kind) {
    case 'connection-string':
      return tableStore(() =>
        TableClient.fromConnectionString(target.connectionString, tableName, {
          // Azurite serves plain HTTP; the SDK refuses that unless explicitly allowed.
          allowInsecureConnection:
            target.connectionString.includes('UseDevelopmentStorage=true') ||
            target.connectionString.includes('http://'),
        }),
      );
    case 'identity':
      // DefaultAzureCredential resolves to the Function App's managed identity in Azure.
      return tableStore(() => new TableClient(target.tableUrl, tableName, new DefaultAzureCredential()));
    case 'none':
      // R54.3: every upsert fails → every location fails → the run fails (spec 003 R46).
      return {
        async upsert() {
          throw new Error(
            'No storage configured: set AzureWebJobsStorage (connection string, e.g. Azurite) ' +
              'or AzureWebJobsStorage__accountName (managed identity)',
          );
        },
      };
  }
}

/**
 * Table Storage implementation of SnapshotStore. The client is created lazily on first use,
 * so constructing a store never touches the network or credentials.
 */
function tableStore(makeClient: () => TableClient): SnapshotStore {
  let client: TableClient | undefined;
  let ready: Promise<void> | undefined;

  const ensureTable = (c: TableClient) =>
    (ready ??= c.createTable().catch((err) => {
      ready = undefined; // allow a retry on the next upsert if creation failed
      throw err;
    }));

  return {
    async upsert(snapshot) {
      client ??= makeClient();
      await ensureTable(client);
      await client.upsertEntity(snapshotToEntity(snapshot), 'Replace'); // R44: overwrite
    },
  };
}
