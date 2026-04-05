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
import { loadState, getUsage, addUsage } from './state.js';

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

const fastify = Fastify({
  logger: true,
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
await fastify.register(fastifyStatic, {
  root: staticRoot,
  prefix: '/app/',
  decorateReply: false,
});

await loadState();

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
  const usage = getUsage(claims.sub);
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

fastify.post('/v1/upload', async (req, reply) => {
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

    const usage = getUsage(claims.sub);
    if (usage.files >= claims.maxFiles) {
      return reply.code(403).send({ error: 'max_files' });
    }

    let fileBuf = /** @type {Buffer | null} */ (null);
    let filename = 'upload.bin';
    let password = '';

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename || filename;
        fileBuf = await part.toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'password') {
        password =
          typeof part.value === 'string' ? part.value : String(part.value ?? '');
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

    if (!sniffAudio(fileBuf.subarray(0, 32))) {
      return reply.code(400).send({ error: 'not_audio_sniff' });
    }

    if (usage.bytes + fileBuf.length > claims.maxBytes) {
      return reply.code(403).send({ error: 'max_bytes' });
    }

    const destDir = resolve(config.stagingRoot, claims.sub);
    await mkdir(destDir, { recursive: true });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = join(destDir, safeName);
    const rel = relative(resolve(config.stagingRoot), dest);
    if (rel.startsWith('..') || rel.includes('..')) {
      return reply.code(400).send({ error: 'bad_path' });
    }

    await writeFile(dest, fileBuf);
    await addUsage(claims.sub, fileBuf.length);

    return {
      ok: true,
      path: rel,
      bytes: fileBuf.length,
    };
});

try {
  await fastify.listen({ port: config.port, host: config.host });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
