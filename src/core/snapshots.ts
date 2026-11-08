/** R34 / D17: every 30 minutes at :00 and :30 UTC (NCRONTAB, six fields). */
export const SNAPSHOT_SCHEDULE = '0 */30 * * * *';

/** Table name (spec 003 R43). */
export const SNAPSHOT_TABLE = 'weathersnapshots';

/** One stored record (spec 003 §5). */
export interface Snapshot {
  locationId: string;
  lat: number;
  lon: number;
  observedAt: string;
  fetchedAt: string;
  tempC: number;
  windKph: number;
  weatherCode: number;
  condition: string;
}

/** Where snapshots go. Injected so the core never imports a storage SDK (N8). */
export interface SnapshotStore {
  /** Insert or overwrite by identity (locationId, observedAt) — R44. */
  upsert(snapshot: Snapshot): Promise<void>;
}
