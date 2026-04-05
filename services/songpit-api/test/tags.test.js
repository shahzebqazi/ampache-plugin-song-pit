import { describe, expect, it } from 'vitest';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyAudioMetadata, writeSidecarMetadata } from '../src/tags.js';

describe('tags', () => {
  it('embeds ID3 into MP3 buffer', () => {
    const buf = Buffer.alloc(300);
    buf[0] = 0xff;
    buf[1] = 0xfb;
    const out = applyAudioMetadata(buf, '.mp3', {
      title: 'T',
      artist: 'A',
      album: 'Al',
      trackNo: '3',
    });
    expect(out.length).toBeGreaterThan(buf.length);
    expect(out.subarray(0, 3).toString('ascii')).toBe('ID3');
  });

  it('writes sidecar next to stem', async () => {
    const dir = join(tmpdir(), `songpit-sc-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const audio = join(dir, 'track.flac');
    await writeSidecarMetadata(audio, {
      title: 'x',
      artist: 'y',
      album: '',
      trackNo: '1',
      bucket: 'Inbox',
      originalFilename: 'track.flac',
    });
    const side = join(dir, 'track.songpit-meta.json');
    const j = JSON.parse(await readFile(side, 'utf8'));
    expect(j.title).toBe('x');
    expect(j.bucket).toBe('Inbox');
    await rm(dir, { recursive: true, force: true });
  });
});
