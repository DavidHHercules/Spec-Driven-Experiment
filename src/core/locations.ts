import { LAT_LIMIT, LON_LIMIT, parseCoordinate } from './validate';

export interface Location {
  id: string;
  lat: number;
  lon: number;
}

/** R40 / D23: cap on locations per run. */
export const MAX_LOCATIONS = 10;

const ID_FORMAT = /^[a-z0-9-]{1,32}$/; // R37

/**
 * Parses SNAPSHOT_LOCATIONS (R36–R40): `id=lat,lon` entries separated by `;`.
 * Pure: returns warnings instead of logging. Unset/empty input yields no warnings —
 * the caller decides how to report "nothing configured" (R39).
 */
export function parseLocations(raw: string | undefined): {
  locations: Location[];
  warnings: string[];
  skipped: number;
} {
  const warnings: string[] = [];
  const valid: Location[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const entries = (raw ?? '').split(';').map((e) => e.trim()).filter((e) => e !== '');

  for (const entry of entries) {
    const location = parseEntry(entry);
    if (!location) {
      warnings.push(`SNAPSHOT_LOCATIONS entry ${JSON.stringify(entry)} is invalid (expected id=lat,lon); skipped`);
      skipped++;
      continue;
    }
    // R38 / F6: only valid entries claim an id.
    if (seen.has(location.id)) {
      warnings.push(`SNAPSHOT_LOCATIONS entry ${JSON.stringify(entry)} is a duplicate of id "${location.id}"; skipped`);
      skipped++;
      continue;
    }
    seen.add(location.id);
    valid.push(location);
  }

  // R40: cap after validation, so invalid entries don't count toward it.
  if (valid.length > MAX_LOCATIONS) {
    const excess = valid.length - MAX_LOCATIONS;
    warnings.push(
      `SNAPSHOT_LOCATIONS has ${valid.length} valid entries; using the first ${MAX_LOCATIONS}, skipping ${excess}`,
    );
    skipped += excess;
  }

  return { locations: valid.slice(0, MAX_LOCATIONS), warnings, skipped };
}

function parseEntry(entry: string): Location | null {
  const parts = entry.split('=');
  if (parts.length !== 2) return null;
  const id = parts[0]!.trim();
  const coords = parts[1]!.split(',');
  if (!ID_FORMAT.test(id) || coords.length !== 2) return null;

  // Spec 001 §4.1 format (parseCoordinate trims) + R6/R7 ranges.
  const lat = parseCoordinate(coords[0]!);
  const lon = parseCoordinate(coords[1]!);
  if (lat === null || lon === null || Math.abs(lat) > LAT_LIMIT || Math.abs(lon) > LON_LIMIT) return null;

  return { id, lat, lon };
}
