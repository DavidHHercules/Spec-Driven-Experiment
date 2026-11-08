/** Spec §4.1: optional '-', digits, optional '.' followed by digits. */
const COORDINATE_FORMAT = /^-?\d+(\.\d+)?$/;

/**
 * Parses a raw query value per spec §4.1. Returns null if the format is not accepted.
 * Does NOT check ranges.
 *
 * The regex runs before Number() on purpose (D2): Number('') is 0 and Number('0x10') is 16.
 */
export function parseCoordinate(raw: string): number | null {
  const trimmed = raw.trim();
  if (!COORDINATE_FORMAT.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}
