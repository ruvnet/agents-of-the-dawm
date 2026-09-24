import { describe, expect, it } from 'vitest';
import { loadSector01, dialogueEn } from '../../src/contracts/fixtures';
import {
  canonicalHash, canonicalize, graphToScene, sceneToGraph, validateManifest, ID_RANGES, validatePreviews,
} from '../../src/contracts';
import type { RoutePreview } from '../../src/contracts';

describe('contracts', () => {
  it('bundled sector-01 manifest validates', () => {
    const m = loadSector01();
    expect(m.id).toBe('sector-01');
    const relief = m.pressure.routes.find((r) => r.id === 'reservoir-to-relief');
    expect(relief).toMatchObject({ physicalPipePresent: true, approved: false });
  });

  it('manifest IDs are unique and inside disjoint ranges', () => {
    const m = loadSector01();
    const ids = [...m.entities.map((e) => e.id), ...m.semanticEdges.map((e) => e.id),
      ...m.derivedStates.flatMap((d) => [d.id, d.edgeId])];
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of m.entities) expect(e.id).toBeLessThanOrEqual(ID_RANGES.static[1]);
    for (const e of m.semanticEdges) expect(e.id).toBeGreaterThanOrEqual(ID_RANGES.edges[0]);
  });

  it('rejects hydraulic relations, unsafe ids, pre-approved relief routes and bad versions', () => {
    const m = structuredClone(loadSector01()) as any;
    m.semanticEdges[0].rel = 'pressure_route';
    m.entities[0].id = 2 ** 60;
    m.pressure.routes.find((r: any) => r.id === 'reservoir-to-relief').approved = true;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatch(/pressure_route/);
      expect(r.errors.join('\n')).toMatch(/safe positive integer/);
      expect(r.errors.join('\n')).toMatch(/approved=false/);
    }
    expect(validateManifest({ ...loadSector01(), version: 2 }).ok).toBe(false);
    expect(validateManifest(null).ok).toBe(false);
  });

  it('rejects non-finite geometry', () => {
    const m = structuredClone(loadSector01()) as any;
    m.geometry.colliders[0].box.min[0] = Number.NaN;
    expect(validateManifest(m).ok).toBe(false);
  });

  it('ENU mapping round-trips and preserves handedness fixtures', () => {
    expect(graphToScene({ east_m: 1, north_m: 2, up_m: 3 })).toEqual([1, 3, -2]);
    expect(sceneToGraph([1, 3, -2])).toEqual({ east_m: 1, north_m: 2, up_m: 3 });
    for (const p of [[0, 0, 0], [5.5, -2, 7], [-3, 10, -1]] as const) {
      expect(graphToScene(sceneToGraph(p))).toEqual(p.map((n) => n + 0));
    }
  });

  it('canonical hash ignores key order and normalises -0', () => {
    expect(canonicalize({ b: 1, a: -0 })).toBe('{"a":0,"b":1}');
    expect(canonicalHash({ a: 1, b: [1, 2] })).toBe(canonicalHash({ b: [1, 2], a: 1 }));
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it('preview validator enforces exactly three unique finite previews', () => {
    const p: RoutePreview = {
      destination: 'relief-channel', occupied: false, projectedLoad: 150, safeThreshold: 220, unit: 'kPa',
      safe: true, reason: 'x', evidenceSource: { origin: 'authored-simulation', fixtureId: 'f' },
    };
    expect(validatePreviews([p])).not.toHaveLength(0);
    expect(validatePreviews([p, { ...p, destination: 'protected-pump' }, { ...p, destination: 'occupied-street' }])).toHaveLength(0);
    expect(validatePreviews([p, p, { ...p, projectedLoad: Number.NaN }]).length).toBeGreaterThan(0);
  });

  it('dialogue fixture has every scripted line with unique ids', () => {
    const ids = dialogueEn.lines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i <= 31; i++) {
      const id = `S${String(i).padStart(2, '0')}`;
      if (i === 16 || i === 17) {
        expect(ids).toContain(`${id}U`);
        expect(ids).toContain(`${id}L`);
      } else expect(ids).toContain(id);
    }
    expect(ids).toContain('D01');
  });
});
