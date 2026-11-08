/** WMO weather code → readable text (spec §5). */
const CONDITIONS: ReadonlyMap<number, string> = new Map([
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
]);

/** R13; unlisted integers → "Unknown" (R14, D5). */
export function describeWeatherCode(code: number): string {
  return CONDITIONS.get(code) ?? 'Unknown';
}
