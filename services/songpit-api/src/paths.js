import { access, constants } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

/**
 * @param {string} raw
 */
export function sanitizeBucket(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/[/\\]/g, '_')
    .replace(/\.+/g, '_')
    .replace(/[^a-zA-Z0-9 _.-]/g, '_')
    .replace(/_+/g, '_')
    .trim();
  const out = s.slice(0, 120);
  return out.length > 0 ? out : 'Inbox';
}

/**
 * @param {string} name
 */
export function safeBasename(name) {
  return basename(String(name)).replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload.bin';
}

/**
 * Resolves a unique path under dir (no silent overwrite).
 * @param {string} dir
 * @param {string} safeName
 */
export async function resolveUniquePath(dir, safeName) {
  const ext = extname(safeName);
  const base = basename(safeName, ext) || 'file';
  let candidate = safeName;
  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const full = join(dir, candidate);
    try {
      await access(full, constants.F_OK);
      n += 1;
      candidate = `${base}_${n}${ext}`;
    } catch {
      return full;
    }
  }
}
