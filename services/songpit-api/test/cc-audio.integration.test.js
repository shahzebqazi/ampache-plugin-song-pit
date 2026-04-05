import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { readFile, access, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import FormData from 'form-data';

const require = createRequire(import.meta.url);
const NodeID3 = require('node-id3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureMp3 = path.join(
  __dirname,
  'fixtures/cc0/scaryviolins-cc0-preview.mp3'
);
const stagingDir = path.join(__dirname, '..', 'test-staging');

beforeEach(async () => {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  process.env.SONGPIT_STAGING_ROOT = stagingDir;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CC0 audio fixture', () => {
  it('fixture exists and looks like MPEG audio', async () => {
    await access(fixtureMp3);
    const head = await readFile(fixtureMp3);
    expect(head.length).toBeGreaterThan(10_000);
    const ok =
      (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ||
      head.subarray(0, 3).toString('ascii') === 'ID3';
    expect(ok).toBe(true);
  });
});

describe('CC0 upload + tagging + transfer', () => {
  it('writes file under bucket, embeds ID3, writes sidecar, sizes match', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ logger: false });

    const audioBuf = await readFile(fixtureMp3);
    const originalSize = audioBuf.length;

    const sh = await app.inject({
      method: 'POST',
      url: '/v1/shares',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      payload: {
        maxBytes: 5_000_000,
        maxFiles: 5,
        expiresInHours: 1,
      },
    });
    expect(sh.statusCode).toBe(200);
    const { token } = JSON.parse(sh.body);

    const title = 'Song Pit Test Title';
    const artist = 'Song Pit Test Artist';
    const album = 'Song Pit Test Album';
    const trackNumber = '7';
    const bucket = 'CC-Imports';

    const form = new FormData();
    form.append('title', title);
    form.append('artist', artist);
    form.append('album', album);
    form.append('trackNumber', trackNumber);
    form.append('bucket', bucket);
    form.append('file', audioBuf, {
      filename: 'scaryviolins-cc0-preview.mp3',
      contentType: 'audio/mpeg',
    });

    const up = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        ...form.getHeaders(),
        authorization: `Bearer ${token}`,
      },
      payload: form,
    });

    expect(up.statusCode).toBe(200);
    const body = JSON.parse(up.body);
    expect(body.ok).toBe(true);
    expect(body.bytes).toBeGreaterThanOrEqual(originalSize);
    expect(body.path).toContain('CC-Imports');
    expect(body.path).toContain('scaryviolins-cc0-preview.mp3');

    const absAudio = path.join(stagingDir, body.path);
    const onDisk = await readFile(absAudio);
    expect(onDisk.length).toBe(body.bytes);

    const tags = NodeID3.read(onDisk);
    expect(String(tags.title ?? '').trim()).toBe(title);
    expect(String(tags.artist ?? '').trim()).toBe(artist);
    expect(String(tags.album ?? '').trim()).toBe(album);
    expect(String(tags.trackNumber ?? tags.TRCK ?? '').trim()).toBe(trackNumber);

    const stem = path.basename(absAudio, path.extname(absAudio));
    const sidePath = path.join(path.dirname(absAudio), `${stem}.songpit-meta.json`);
    const sideRaw = await readFile(sidePath, 'utf8');
    const side = JSON.parse(sideRaw);
    expect(side.title).toBe(title);
    expect(side.artist).toBe(artist);
    expect(side.bucket).toBe('CC-Imports');
    expect(side.originalFilename).toBe('scaryviolins-cc0-preview.mp3');

    const sess = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: { authorization: `Bearer ${token}` },
    });
    const s = JSON.parse(sess.body);
    expect(s.uploadedFiles).toBe(1);
    expect(s.usedBytes).toBe(body.bytes);

    await app.close();
  });

  it('duplicate filename in same bucket gets _1 suffix', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ logger: false });

    const audioBuf = await readFile(fixtureMp3);

    const sh = await app.inject({
      method: 'POST',
      url: '/v1/shares',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      payload: { maxBytes: 5_000_000, maxFiles: 5, expiresInHours: 1 },
    });
    const { token } = JSON.parse(sh.body);

    async function uploadOnce() {
      const form = new FormData();
      form.append('title', 'A');
      form.append('bucket', 'Dup');
      form.append('file', audioBuf, {
        filename: 'same.mp3',
        contentType: 'audio/mpeg',
      });
      return app.inject({
        method: 'POST',
        url: '/v1/upload',
        headers: {
          ...form.getHeaders(),
          authorization: `Bearer ${token}`,
        },
        payload: form,
      });
    }

    const u1 = await uploadOnce();
    const u2 = await uploadOnce();
    expect(u1.statusCode).toBe(200);
    expect(u2.statusCode).toBe(200);
    expect(JSON.parse(u1.body).path).toContain('same.mp3');
    expect(JSON.parse(u2.body).path).toContain('same_1.mp3');

    await app.close();
  });
});
