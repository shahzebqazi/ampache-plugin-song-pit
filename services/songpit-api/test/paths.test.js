import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { sanitizeBucket, safeBasename, resolveUniquePath } from '../src/paths.js';

describe('paths', () => {
  it('sanitizeBucket defaults and strips unsafe chars', () => {
    expect(sanitizeBucket('')).toBe('Inbox');
    expect(sanitizeBucket('  Live / Set  ')).toBe('Live _ Set');
  });

  it('safeBasename removes path segments', () => {
    expect(safeBasename('../../evil.mp3')).toBe('evil.mp3');
  });

  it('resolveUniquePath avoids overwrite', async () => {
    const dir = path.join(tmpdir(), `songpit-path-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const first = await resolveUniquePath(dir, 'a.mp3');
    expect(first.endsWith(`${path.sep}a.mp3`)).toBe(true);
    await writeFile(first, '1');
    const second = await resolveUniquePath(dir, 'a.mp3');
    expect(second).toContain('a_1.mp3');
    await rm(dir, { recursive: true, force: true });
  });
});
