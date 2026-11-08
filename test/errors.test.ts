import { describe, expect, it } from 'vitest';
import { errorBody } from '../src/core/errors';

describe('errorBody (spec §3 error shape)', () => {
  it('§3: wraps code and message in an "error" object, with nothing else', () => {
    expect(errorBody('INVALID_LAT', 'lat must be a number between -90 and 90')).toStrictEqual({
      error: { code: 'INVALID_LAT', message: 'lat must be a number between -90 and 90' },
    });
  });
});
