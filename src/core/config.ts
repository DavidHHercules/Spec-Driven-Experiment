/** Tunable resilience settings (spec 002 R32). */
export interface ResilienceConfig {
  timeoutMs: number;
  maxAttempts: number;
}

interface IntSetting {
  name: string;
  defaultValue: number;
  min: number;
  max: number;
}

// R32. Ranges keep worst-case latency under 30 s for every valid configuration (N5, R23).
const TIMEOUT: IntSetting = { name: 'UPSTREAM_TIMEOUT_MS', defaultValue: 2000, min: 100, max: 5000 };
const ATTEMPTS: IntSetting = { name: 'UPSTREAM_MAX_ATTEMPTS', defaultValue: 3, min: 1, max: 4 };

/**
 * Resolves resilience settings from raw app settings. Pure: returns warnings rather than
 * logging them, so the caller decides where they go (R33).
 */
export function resolveResilienceConfig(settings: Readonly<Record<string, string | undefined>>): {
  config: ResilienceConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  const config = {
    timeoutMs: readInt(settings, TIMEOUT, warnings),
    maxAttempts: readInt(settings, ATTEMPTS, warnings),
  };
  return { config, warnings };
}

function readInt(
  settings: Readonly<Record<string, string | undefined>>,
  s: IntSetting,
  warnings: string[],
): number {
  const raw = settings[s.name];
  const trimmed = raw?.trim(); // F5
  if (!trimmed) return s.defaultValue; // unset or empty → default, silently (R32)

  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (Number.isInteger(value) && value >= s.min && value <= s.max) return value;

  // R33: invalid → default + warning naming the setting and the bad value.
  warnings.push(
    `${s.name}=${JSON.stringify(raw)} is invalid (expected integer ${s.min}–${s.max}); using default ${s.defaultValue}`,
  );
  return s.defaultValue;
}
