import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { signUploadToken, verifyUploadToken, randomSubdir } from './tokens.js';
import { extOk, sniffAudio, hashPassword } from './validate.js';
import {
  readUsageState,
  writeUsageState,
  withUsageLock,
  getUsageSnapshot,
} from './state.js';
import { sanitizeBucket, safeBasename, resolveUniquePath } from './paths.js';
import { applyAudioMetadata, writeSidecarMetadata } from './tags.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function authMaintainer(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return false;
  }
  const token = h.slice(7).trim();
  return safeEqual(token, config.apiKey);
}

/**
 * @param {{ logger?: boolean }} opts
 */
export async function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger !== false,
    ...opts,
  });

  await fastify.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 512 * 1024 * 1024,
    },
  });

  const staticRoot = resolve(__dirname, '../web-dist');
  await mkdir(staticRoot, { recursive: true });
  await fastify.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/app/',
    decorateReply: false,
  });

  fastify.get('/', async (_req, reply) => reply.redirect(302, '/app/'));

  fastify.get('/health', async () => ({ ok: true }));

  fastify.post('/v1/shares', async (req, reply) => {
    if (!authMaintainer(req)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    /** @type {{ maxBytes?: number, maxFiles?: number, expiresInHours?: number, password?: string }} */
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};
    const maxBytes = Math.min(
      Number(body.maxBytes) || 500 * 1024 * 1024,
      1024 * 1024 * 1024
    );
    const maxFiles = Math.min(Number(body.maxFiles) || 200, 2000);
    const hours = Math.min(Number(body.expiresInHours) || 24, 168);
    const sub = randomSubdir();
    const exp = `${hours}h`;
    const pwdHash =
      typeof body.password === 'string' && body.password.length > 0
        ? hashPassword(body.password)
        : undefined;

    const token = await signUploadToken({
      sub,
      maxBytes,
      maxFiles,
      exp,
      pwdHash,
    });

    const spaUrl = `${config.spaPublicUrl}/#/?token=${encodeURIComponent(token)}`;

    return {
      token,
      sub,
      expiresInHours: hours,
      maxBytes,
      maxFiles,
      spaUrl,
    };
  });

  fastify.get('/v1/session', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_token' });
    }
    const token = auth.slice(7).trim();
    let claims;
    try {
      claims = await verifyUploadToken(token);
    } catch {
      return reply.code(401).send({ error: 'invalid_token' });
    }
    const usage = await getUsageSnapshot(claims.sub);
    const pwdRequired = Boolean(claims.pwdHash);
    return {
      sub: claims.sub,
      maxBytes: claims.maxBytes,
      maxFiles: claims.maxFiles,
      usedBytes: usage.bytes,
      uploadedFiles: usage.files,
      passwordRequired: pwdRequired,
    };
  });

  await fastify.register(async function uploadScoped(f) {
    await f.register(rateLimit, {
      max: 40,
      timeWindow: '1 minute',
    });

    f.post('/v1/upload', async (req, reply) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'missing_token' });
      }
      const token = auth.slice(7).trim();
      let claims;
      try {
        claims = await verifyUploadToken(token);
      } catch {
        return reply.code(401).send({ error: 'invalid_token' });
      }

      let fileBuf = /** @type {Buffer | null} */ (null);
      let filename = 'upload.bin';
      let password = '';
      const meta = {
        title: '',
        artist: '',
        album: '',
        trackNo: '',
        bucket: '',
      };

      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          filename = part.filename || filename;
          fileBuf = await part.toBuffer();
        } else if (part.type === 'field') {
          const fn = part.fieldname;
          const val =
            typeof part.value === 'string' ? part.value : String(part.value ?? '');
          if (fn === 'password') {
            password = val;
          } else if (fn === 'title') {
            meta.title = val;
          } else if (fn === 'artist') {
            meta.artist = val;
          } else if (fn === 'album') {
            meta.album = val;
          } else if (fn === 'trackNumber') {
            meta.trackNo = val;
          } else if (fn === 'bucket') {
            meta.bucket = val;
          }
        }
      }

      if (claims.pwdHash) {
        if (!password || hashPassword(password) !== claims.pwdHash) {
          return reply.code(401).send({ error: 'password_required' });
        }
      }

      if (!fileBuf || fileBuf.length === 0) {
        return reply.code(400).send({ error: 'empty_file' });
      }

      if (!extOk(filename)) {
        return reply.code(400).send({ error: 'extension_not_allowed' });
      }

      const lower = filename.toLowerCase();
      const dot = lower.lastIndexOf('.');
      const ext = dot >= 0 ? lower.slice(dot) : '';

      if (!sniffAudio(fileBuf.subarray(0, 32), ext)) {
        return reply.code(400).send({ error: 'not_audio_sniff' });
      }

      const bucketSeg = sanitizeBucket(meta.bucket);
      const metaForTags = {
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        trackNo: meta.trackNo,
      };

      let tagged = applyAudioMetadata(fileBuf, ext, metaForTags);

      /** @type {{ ok?: boolean, path?: string, bytes?: number, error?: number, code?: string }} */
      let out;

      await withUsageLock(async () => {
        const state = await readUsageState();
        const usage = state[claims.sub] ?? { bytes: 0, files: 0 };
        if (usage.files >= claims.maxFiles) {
          out = { error: 403, code: 'max_files' };
          return;
        }
        if (usage.bytes + tagged.length > claims.maxBytes) {
          out = { error: 403, code: 'max_bytes' };
          return;
        }

        const destDir = resolve(
          config.stagingRoot,
          claims.sub,
          bucketSeg
        );
        await mkdir(destDir, { recursive: true });
        const safeName = safeBasename(filename);
        const dest = await resolveUniquePath(destDir, safeName);
        const rel = relative(resolve(config.stagingRoot), dest);
        if (rel.startsWith('..') || rel.includes('..')) {
          out = { error: 400, code: 'bad_path' };
          return;
        }

        await writeFile(dest, tagged);
        await writeSidecarMetadata(dest, {
          ...metaForTags,
          bucket: bucketSeg,
          originalFilename: filename,
        });

        usage.bytes += tagged.length;
        usage.files += 1;
        state[claims.sub] = usage;
        await writeUsageState(state);

        out = {
          ok: true,
          path: rel,
          bytes: tagged.length,
        };
      });

      if (!out || out.error) {
        return reply
          .code(out?.error ?? 500)
          .send({ error: out?.code ?? 'internal' });
      }
      return out;
    });
  });

  return fastify;
}
