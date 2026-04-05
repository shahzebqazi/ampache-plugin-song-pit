import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import FormData from 'form-data';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

async function makeMp3Buffer() {
  const mp3 = Buffer.alloc(200);
  mp3[0] = 0xff;
  mp3[1] = 0xfb;
  return mp3;
}

describe('buildApp', () => {
  it('uploads with metadata and buckets; second same name gets _1', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ logger: false });

    const sh = await app.inject({
      method: 'POST',
      url: '/v1/shares',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      payload: { maxBytes: 1e6, maxFiles: 10, expiresInHours: 1 },
    });
    expect(sh.statusCode).toBe(200);
    const { token } = JSON.parse(sh.body);

    const buf = await makeMp3Buffer();

    const form1 = new FormData();
    form1.append('title', 'One');
    form1.append('bucket', 'Remix');
    form1.append('file', buf, { filename: 'dup.mp3', contentType: 'audio/mpeg' });

    const up1 = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        ...form1.getHeaders(),
        authorization: `Bearer ${token}`,
      },
      payload: form1,
    });
    expect(up1.statusCode).toBe(200);
    const j1 = JSON.parse(up1.body);
    expect(j1.path).toContain('Remix');
    expect(j1.path).toContain('dup.mp3');

    const form2 = new FormData();
    form2.append('title', 'Two');
    form2.append('bucket', 'Remix');
    form2.append('file', buf, { filename: 'dup.mp3', contentType: 'audio/mpeg' });

    const up2 = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        ...form2.getHeaders(),
        authorization: `Bearer ${token}`,
      },
      payload: form2,
    });
    expect(up2.statusCode).toBe(200);
    const j2 = JSON.parse(up2.body);
    expect(j2.path).toContain('dup_1.mp3');

    await app.close();
  });

  it('rejects wrong maintainer key', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ logger: false });
    const sh = await app.inject({
      method: 'POST',
      url: '/v1/shares',
      headers: {
        authorization: 'Bearer wrong',
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(sh.statusCode).toBe(401);
    await app.close();
  });
});
