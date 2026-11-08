import { describeOutcome } from './fetchAttempt';
import type { AttemptOutcome } from './types';

/** Wait before attempt 2, 3, 4 (R27: 250 × 2^(n−2) ms). Not configurable (spec 002 R32). */
export const BACKOFF_MS = [250, 500, 1000] as const;

/** Upstream statuses worth retrying (R25 / D10). 429 deliberately excluded. */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

/** R25 / R26: is this failure worth another attempt? */
export function isTransient(outcome: AttemptOutcome): boolean {
  switch (outcome.kind) {
    case 'network':
    case 'timeout':
      return true;
    case 'status':
      return RETRYABLE_STATUSES.has(outcome.status);
    case 'bad-response': // a malformed body won't fix itself
    case 'ok':
      return false;
  }
}

/**
 * Runs `attempt` until it succeeds, fails permanently, or `maxAttempts` is reached,
 * waiting BACKOFF_MS between attempts. Returns the LAST outcome (R29 / D13).
 * Knows nothing about weather — AttemptOutcome is its only coupling.
 */
export async function runWithRetries(
  attempt: () => Promise<AttemptOutcome>,
  maxAttempts: number,
  logFailure: (msg: string) => void,
): Promise<{ outcome: AttemptOutcome; attempts: number }> {
  for (let n = 1; ; n++) {
    const outcome = await attempt();
    if (outcome.kind === 'ok') return { outcome, attempts: n }; // R28

    const willRetry = isTransient(outcome) && n < maxAttempts;
    // maxAttempts ≤ 4 (R32), so n − 1 ≤ 2 whenever we retry; the fallback only satisfies the type.
    const backoff: number = BACKOFF_MS[n - 1] ?? BACKOFF_MS[2];

    // R30
    logFailure(
      `attempt ${n}/${maxAttempts} failed: ${describeOutcome(outcome)}; ` +
        (willRetry ? `retrying in ${backoff}ms` : 'giving up'),
    );

    if (!willRetry) return { outcome, attempts: n };
    await delay(backoff);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
