/**
 * Unit tests — .pfs project loader validation (src/documents/project).
 *
 * The rejection paths and the minimal no-layers document never touch real
 * canvas pixels, so they run in the plain node environment. The only DOM-ish
 * requirement is `document.createElement('canvas')` inside makeCanvas() when
 * the placeholder layer is built (OffscreenCanvas does not exist in node) —
 * a minimal stub is provided below; getContext is never called on this path.
 */

import { describe, expect, it, vi } from 'vitest';
import { PROJECT_FORMAT, PROJECT_VERSION, loadProject } from '../../src/documents/project';

vi.stubGlobal('document', {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

type AnyProject = Record<string, unknown> & { document: Record<string, unknown> };

function baseProject(): AnyProject {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: '2024-01-01T00:00:00.000Z',
    document: {
      name: 'Doc',
      width: 32,
      height: 16,
      dpi: 72,
      background: 'white',
      description: '',
      guides: [],
    },
    layers: [],
    appVersion: '1.0.0',
  };
}

function projectJson(mutate?: (p: AnyProject) => void): string {
  const p = baseProject();
  mutate?.(p);
  return JSON.stringify(p);
}

describe('loadProject — rejection paths', () => {
  it('rejects invalid JSON', async () => {
    await expect(loadProject('{not valid json')).rejects.toThrow('not valid JSON');
    await expect(loadProject('')).rejects.toThrow();
  });

  it('rejects a wrong format field', async () => {
    const p = baseProject();
    p.format = 'some-other-app';
    await expect(loadProject(JSON.stringify(p))).rejects.toThrow('Not a PixelForge Studio project');
  });

  it('rejects versions newer than the app supports', async () => {
    const p = baseProject();
    p.version = PROJECT_VERSION + 1;
    await expect(loadProject(JSON.stringify(p))).rejects.toThrow(/newer than this app supports/);
  });

  it.each([0, -5, 20000])('rejects width %i out of range', async (w) => {
    const p = baseProject();
    p.document.width = w;
    await expect(loadProject(JSON.stringify(p))).rejects.toThrow('Invalid document dimensions');
  });

  it.each([0, -1, 20000])('rejects height %i out of range', async (h) => {
    const p = baseProject();
    p.document.height = h;
    await expect(loadProject(JSON.stringify(p))).rejects.toThrow('Invalid document dimensions');
  });

  it('rejects a missing document header', async () => {
    const p = baseProject();
    (p as Record<string, unknown>).document = undefined;
    await expect(loadProject(JSON.stringify(p))).rejects.toThrow('Invalid document dimensions');
  });
});

describe('loadProject — minimal valid document', () => {
  it('loads a project without layers with a placeholder layer', async () => {
    const doc = await loadProject(projectJson());
    expect(doc.name).toBe('Doc');
    expect(doc.width).toBe(32);
    expect(doc.height).toBe(16);
    expect(doc.dpi).toBe(72);
    expect(doc.colorMode).toBe('rgb-8bit');
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].kind).toBe('raster'); // placeholder so the doc is editable
    expect(doc.selectedLayerIds).toEqual([doc.layers[doc.layers.length - 1].id]);
    expect(doc.guides).toEqual([]);
  });

  it('defaults the name to "Untitled" and normalizes the background', async () => {
    const doc = await loadProject(
      projectJson((p) => {
        delete p.document.name;
        p.document.background = 'plaid';
      }),
    );
    expect(doc.name).toBe('Untitled');
    expect(doc.background).toBe('white');
  });

  it('keeps valid guides and drops malformed ones', async () => {
    const doc = await loadProject(
      projectJson((p) => {
        p.document.guides = [
          { id: 'g1', axis: 'x', position: 100 },
          { axis: 'y', position: 'NaN' },
          { id: 'g3', axis: 'z', position: 5 },
          null,
        ];
      }),
    );
    expect(doc.guides).toEqual([{ id: 'g1', axis: 'x', position: 100 }]);
  });
});
