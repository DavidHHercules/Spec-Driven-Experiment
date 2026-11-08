import { app, InvocationContext, Timer } from '@azure/functions';
import { runSnapshots, SNAPSHOT_SCHEDULE, type SnapshotStore } from '../core/snapshots';
import { createTableSnapshotStore } from '../storage/tableSnapshotStore';
import { runtimeDeps } from './runtimeDeps';

// One store per process, reused across runs (the table is created once).
let store: SnapshotStore | undefined;

/**
 * Azure adapter for scheduled snapshots (spec 003). Wires the real store and passes the
 * platform's past-due flag into the core. A thrown error (R46) marks the run as failed.
 */
export async function snapshots(timer: Timer, context: InvocationContext): Promise<void> {
  // Same storage account the host itself uses (plan 003 §2.2).
  store ??= createTableSnapshotStore(process.env['AzureWebJobsStorage'] ?? '');
  await runSnapshots({ ...runtimeDeps(context), store }, { isPastDue: timer.isPastDue });
}

app.timer('snapshots', {
  schedule: SNAPSHOT_SCHEDULE, // R34
  handler: snapshots,
});
