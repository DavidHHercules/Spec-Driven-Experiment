import { describe, expect, it } from 'vitest';
import { describeWeatherCode } from '../src/core/weatherCodes';

// Copied from spec §5, one row per code.
const SPEC_TABLE: Array<[number, string]> = [
  [0, 'Clear sky'],
  [1, 'Mainly clear'],
  [2, 'Partly cloudy'],
  [3, 'Overcast'],
  [45, 'Fog'], [48, 'Fog'],
  [51, 'Drizzle'], [53, 'Drizzle'], [55, 'Drizzle'],
  [56, 'Freezing drizzle'], [57, 'Freezing drizzle'],
  [61, 'Light rain'],
  [63, 'Rain'],
  [65, 'Heavy rain'],
  [66, 'Freezing rain'], [67, 'Freezing rain'],
  [71, 'Snow'], [73, 'Snow'], [75, 'Snow'],
  [77, 'Snow grains'],
  [80, 'Rain showers'], [81, 'Rain showers'], [82, 'Rain showers'],
  [85, 'Snow showers'], [86, 'Snow showers'],
  [95, 'Thunderstorm'],
  [96, 'Thunderstorm with hail'], [99, 'Thunderstorm with hail'],
];

describe('describeWeatherCode', () => {
  it.each(SPEC_TABLE)('R13: code %i → %j', (code, text) => {
    expect(describeWeatherCode(code)).toBe(text);
  });

  it.each([4, 44, 100, -1])('R14: unlisted integer %i → "Unknown"', (code) => {
    expect(describeWeatherCode(code)).toBe('Unknown');
  });
});
