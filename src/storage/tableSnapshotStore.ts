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

/**
 * Azure Table Storage implementation of SnapshotStore. The only module that knows about
 * Tables, so src/core stays SDK-free (Spec 001 N2, Spec 003 N8).
 */
export function createTableSnapshotStore(connectionString: string, tableName = SNAPSHOT_TABLE): SnapshotStore {
  const client = TableClient.fromConnectionString(connectionString, tableName, {
    // Azurite serves plain HTTP; the SDK refuses that unless explicitly allowed.
    allowInsecureConnection: connectionString.includes('UseDevelopmentStorage=true') || connectionString.includes('127.0.0.1'),
  });

  // Create the table once per process; createTable is a no-op if it already exists.
  let ready: Promise<void> | undefined;
  const ensureTable = () => (ready ??= client.createTable().catch((err) => {
    ready = undefined; // allow a retry on the next upsert if creation failed
    throw err;
  }));

  return {
    async upsert(snapshot) {
      await ensureTable();
      await client.upsertEntity(snapshotToEntity(snapshot), 'Replace'); // R44: overwrite
    },
  };
}
