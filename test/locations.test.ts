import { describe, expect, it } from 'vitest';
import { MAX_LOCATIONS, parseLocations } from '../src/core/locations';

const ids = (raw: string) => parseLocations(raw).locations.map((l) => l.id);

describe('parseLocations', () => {
  it('R36: spec example parses to two locations', () => {
    expect(parseLocations('seattle=47.6,-122.3; london=51.5072,-0.1276')).toStrictEqual({
      locations: [
        { id: 'seattle', lat: 47.6, lon: -122.3 },
        { id: 'london', lat: 51.5072, lon: -0.1276 },
      ],
      warnings: [],
      skipped: 0,
    });
  });

  it('R36: whitespace around entries, ids and numbers is ignored', () => {
    expect(parseLocations('  seattle = 47.6 , -122.3 ;london=51.5,-0.1  ').locations).toStrictEqual([
      { id: 'seattle', lat: 47.6, lon: -122.3 },
      { id: 'london', lat: 51.5, lon: -0.1 },
    ]);
  });

  it('R36: empty segments (e.g. trailing ";") are ignored, not warned about', () => {
    const r = parseLocations('a=1,2;;b=3,4;');
    expect(r.locations.map((l) => l.id)).toEqual(['a', 'b']);
    expect(r.warnings).toEqual([]);
    expect(r.skipped).toBe(0);
  });

  it.each(['a', 'new-york', 'x1', 'a'.repeat(32)])('R37: id %j is valid', (id) => {
    expect(ids(`${id}=1,2`)).toEqual([id]);
  });

  it.each(['Seattle', 'new_york', 'new york', 'a'.repeat(33), 'café'])('R37: id %j is invalid', (id) => {
    expect(ids(`${id}=1,2`)).toEqual([]);
  });

  it.each(['1e1,0', '91,0', '-91,0', '0,181', '0,-181', 'abc,0', '0,', ',0', '+1,0'])(
    'R37: coordinates %j are invalid (Spec 001 §4.1 format + ranges)',
    (coords) => {
      expect(ids(`a=${coords}`)).toEqual([]);
    },
  );

  it.each(['90,180', '-90,-180', '0,0'])('R37: boundary coordinates %j are valid', (coords) => {
    expect(ids(`a=${coords}`)).toEqual(['a']);
  });

  it.each(['seattle', 'seattle=47.6', '=1,2', 'a=1,2,3', 'a==1,2', 'a=1,2=3'])(
    'R37: malformed entry %j is invalid',
    (entry) => {
      expect(ids(entry)).toEqual([]);
    },
  );

  it('R38: invalid entry is skipped with a warning quoting it; valid entries kept', () => {
    const r = parseLocations('good=1,2; Bad=3,4; also-good=5,6');
    expect(r.locations.map((l) => l.id)).toEqual(['good', 'also-good']);
    expect(r.skipped).toBe(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('"Bad=3,4"');
  });

  it('R38: duplicate valid id → later entry skipped with a warning', () => {
    const r = parseLocations('a=1,2; a=3,4');
    expect(r.locations).toStrictEqual([{ id: 'a', lat: 1, lon: 2 }]);
    expect(r.skipped).toBe(1);
    expect(r.warnings[0]).toContain('"a=3,4"');
    expect(r.warnings[0]).toMatch(/duplicate/i);
  });

  it('F6: an invalid entry does not claim its id', () => {
    const r = parseLocations('a=bad; a=1,2');
    expect(r.locations).toStrictEqual([{ id: 'a', lat: 1, lon: 2 }]);
    expect(r.skipped).toBe(1);
  });

  it.each([undefined, '', '   ', ';;'])('R39: %j → no locations and no warnings (caller warns)', (raw) => {
    expect(parseLocations(raw)).toStrictEqual({ locations: [], warnings: [], skipped: 0 });
  });

  it('R40: more than 10 valid → first 10 kept, one warning, excess counted as skipped', () => {
    const raw = Array.from({ length: 12 }, (_, i) => `loc${i}=${i},${i}`).join(';');
    const r = parseLocations(raw);
    expect(MAX_LOCATIONS).toBe(10);
    expect(r.locations.map((l) => l.id)).toEqual(Array.from({ length: 10 }, (_, i) => `loc${i}`));
    expect(r.skipped).toBe(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/12 valid.*first 10/);
  });

  it('R40: invalid entries do not count toward the cap', () => {
    const raw = ['bad'].concat(Array.from({ length: 10 }, (_, i) => `loc${i}=${i},${i}`)).join(';');
    const r = parseLocations(raw);
    expect(r.locations).toHaveLength(10);
    expect(r.skipped).toBe(1);
  });
});
