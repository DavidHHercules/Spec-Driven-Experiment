import { parseCurrent } from './openMeteo';
import type { AttemptOutcome } from './types';

/** Max characters of an upstream body copied into a log line. */
const LOG_SNIPPET_LENGTH = 500;

/**
 * Makes ONE request to Open-Meteo and classifies the result. Never throws:
 * every way an attempt can end is an AttemptOutcome.
 */
export async function fetchAttemptOnce(
  fetchFn: typeof globalThis.fetch,
  url: string,
): Promise<AttemptOutcome> {
  let res: Response;
  let text: string;
  try {
    res = await fetchFn(url);
    // Read the body as text once, so it can be both parsed and logged.
    text = await res.text();
  } catch (err) {
    return { kind: 'network', detail: describeError(err) };
  }

  if (!res.ok) {
    return { kind: 'status', status: res.status, detail: `body=${snippet(text)}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'bad-response', detail: `invalid JSON body=${snippet(text)}` };
  }

  const parsed = parseCurrent(json);
  if (!parsed.ok) {
    return { kind: 'bad-response', detail: parsed.reason };
  }

  const { ok: _ok, ...data } = parsed;
  return { kind: 'ok', data };
}

/**
 * Formats an error for logging, including its `cause` chain. Node's fetch throws a
 * generic "TypeError: fetch failed" and puts the real reason (ECONNREFUSED, DNS
 * failure, TLS error…) in `cause` — without this, R18's "details are logged" is hollow.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const own = `${err.name}: ${err.message}`;
  return err.cause === undefined ? own : `${own} (cause: ${describeError(err.cause)})`;
}

function snippet(text: string): string {
  return JSON.stringify(text.slice(0, LOG_SNIPPET_LENGTH));
}
