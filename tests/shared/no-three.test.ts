import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

/** Recursively lists .ts files under dir; a missing directory has none. */
function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * An import/export-from/dynamic import/require whose specifier is `three`,
 * `three/...`, the `h3x/three` alias, or a relative path that goes through a `three` directory.
 */
const THREE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](?:three(?:\/[^'"]*)?|h3x\/three(?:\/[^'"]*)?|(?:\.{1,2}\/)+(?:[^'"]*\/)?three(?:\/[^'"]*)?)['"]/;

describe('THREE_IMPORT pattern', () => {
  it.each([
    "import * as T from 'three';",
    'import { Vector3 } from "three/examples/jsm/x";',
    "import 'three';",
    "const m = await import('three');",
    "const t = require('three');",
    "import { x } from '../three';",
    "export * from '../../three/scene';",
    "import { View } from 'h3x/three';",
    'import { x } from "h3x/three/scene";',
  ])('matches %s', (line) => {
    expect(line).toMatch(THREE_IMPORT);
  });

  it.each([
    '// see src/three/ for the renderer',
    "import { a } from '../core';",
    "import x from 'threejs-thing';",
    "import { a } from 'h3x/plan';",
  ])('does not match %s', (line) => {
    expect(line).not.toMatch(THREE_IMPORT);
  });
});

describe('shared and plan modules do not depend on three', () => {
  const files = [...tsFiles(join(root, 'src/shared')), ...tsFiles(join(root, 'src/plan'))];

  it('scans at least the shared module', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s has no three import', (_, file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(THREE_IMPORT);
  });

  it('provides the shared wall joins module', () => {
    expect(existsSync(join(root, 'src/shared/walls/joins.ts'))).toBe(true);
  });
});
