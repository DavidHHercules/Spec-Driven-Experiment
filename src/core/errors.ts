import type { ErrorBody, ErrorCode } from './types';

/** Builds the spec §3 error response body. */
export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}
