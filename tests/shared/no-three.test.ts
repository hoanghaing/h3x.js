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

const THREE_IMPORT = /from\s+['"]three(\/[^'"]*)?['"]|['"]three\/|\/three\//;

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
