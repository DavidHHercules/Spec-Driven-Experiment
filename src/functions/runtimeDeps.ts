import type { InvocationContext } from '@azure/functions';
import type { Deps } from '../core/types';

/** Real dependencies for any function in this app: network, clock, app settings, host logging. */
export function runtimeDeps(context: InvocationContext): Deps {
  return {
    fetch: globalThis.fetch,
    now: () => new Date(),
    settings: process.env, // app settings; resolved and validated in the core
    log: {
      info: (msg) => context.log(msg),
      warn: (msg) => context.warn(msg),
      error: (msg) => context.error(msg),
    },
  };
}
