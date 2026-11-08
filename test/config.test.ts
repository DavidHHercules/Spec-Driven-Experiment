import { describe, expect, it } from 'vitest';
import { resolveResilienceConfig } from '../src/core/config';

const T = 'UPSTREAM_TIMEOUT_MS';
const A = 'UPSTREAM_MAX_ATTEMPTS';

describe('resolveResilienceConfig', () => {
  it('R32: unset → defaults 2000 ms / 3 attempts, no warnings', () => {
    expect(resolveResilienceConfig({})).toStrictEqual({
      config: { timeoutMs: 2000, maxAttempts: 3 },
      warnings: [],
    });
  });

  it('R32: empty or whitespace-only → defaults, no warnings', () => {
    expect(resolveResilienceConfig({ [T]: '', [A]: '  ' })).toStrictEqual({
      config: { timeoutMs: 2000, maxAttempts: 3 },
      warnings: [],
    });
  });

  it.each(['100', '2500', '5000'])('R32/N5: timeout %s is accepted', (v) => {
    const r = resolveResilienceConfig({ [T]: v });
    expect(r.config.timeoutMs).toBe(Number(v));
    expect(r.warnings).toEqual([]);
  });

  it.each(['1', '2', '4'])('R32/N5: max attempts %s is accepted', (v) => {
    const r = resolveResilienceConfig({ [A]: v });
    expect(r.config.maxAttempts).toBe(Number(v));
    expect(r.warnings).toEqual([]);
  });

  it('F5: surrounding whitespace is trimmed', () => {
    const r = resolveResilienceConfig({ [T]: ' 3000 ', [A]: ' 3 ' });
    expect(r.config).toStrictEqual({ timeoutMs: 3000, maxAttempts: 3 });
    expect(r.warnings).toEqual([]);
  });

  it.each(['abc', '0', '99', '5001', '9999', '2.5', '-5', '1e3', '0x10'])(
    'R33: timeout %j is invalid → default 2000 + warning naming setting and value',
    (v) => {
      const r = resolveResilienceConfig({ [T]: v });
      expect(r.config.timeoutMs).toBe(2000);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain(T);
      expect(r.warnings[0]).toContain(JSON.stringify(v));
    },
  );

  it.each(['abc', '0', '5', '2.5', '-1'])(
    'R33: max attempts %j is invalid → default 3 + warning',
    (v) => {
      const r = resolveResilienceConfig({ [A]: v });
      expect(r.config.maxAttempts).toBe(3);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain(A);
    },
  );

  it('R33: one invalid setting does not affect the other', () => {
    const r = resolveResilienceConfig({ [T]: 'abc', [A]: '2' });
    expect(r.config).toStrictEqual({ timeoutMs: 2000, maxAttempts: 2 });
    expect(r.warnings).toHaveLength(1);
  });

  it('N5: worst case with the largest valid settings stays under 30 s (R23 formula)', () => {
    const { config } = resolveResilienceConfig({ [T]: '5000', [A]: '4' });
    const backoffs = [250, 500, 1000].slice(0, config.maxAttempts - 1);
    const worst = config.maxAttempts * config.timeoutMs + backoffs.reduce((a, b) => a + b, 0);
    expect(worst).toBe(21_750);
    expect(worst).toBeLessThan(30_000);
  });
});
