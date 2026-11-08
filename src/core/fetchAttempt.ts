import { parseCurrent } from './openMeteo';
import type { AttemptOutcome } from './types';

/** Max characters of an upstream body copied into a log line. */
const LOG_SNIPPET_LENGTH = 500;

/**
 * Makes ONE request to Open-Meteo and classifies the result. Never throws:
 * every way an attempt can end is an AttemptOutcome.
 *
 * R22: one AbortController covers both the request and the body read, so the timeout
 * applies to the whole attempt. N6: on timeout the request is aborted, not abandoned.
 * Uses setTimeout rather than AbortSignal.timeout() so tests can control it with fake timers.
 */
export async function fetchAttemptOnce(
  fetchFn: typeof globalThis.fetch,
  url: string,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  let text: string;
  try {
    res = await fetchFn(url, { signal: controller.signal });
    // Read the body as text once, so it can be both parsed and logged.
    text = await res.text();
  } catch (err) {
    // F4: any failure that isn't our timeout — including mid-body — is a network failure.
    return timedOut ? { kind: 'timeout', timeoutMs } : { kind: 'network', detail: describeError(err) };
  } finally {
    clearTimeout(timer);
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

/** One-line description of a failed attempt, for logs. */
export function describeOutcome(outcome: Exclude<AttemptOutcome, { kind: 'ok' }>): string {
  switch (outcome.kind) {
    case 'network':
      return `network ${outcome.detail}`;
    case 'timeout':
      return `timeout after ${outcome.timeoutMs}ms`;
    case 'status':
      return `status ${outcome.status} ${outcome.detail}`;
    case 'bad-response':
      return `bad response ${outcome.detail}`;
  }
}
