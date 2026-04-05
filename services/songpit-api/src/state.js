import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const statePath = () => join(config.stagingRoot, '.songpit-usage.json');

/** @typedef {{ bytes: number, files: number }} Usage */

/** @type {Map<string, Usage>} */
let cache = new Map();

export async function loadState() {
  try {
    const raw = await readFile(statePath(), 'utf8');
    const obj = JSON.parse(raw);
    cache = new Map(Object.entries(obj));
  } catch {
    cache = new Map();
  }
}

async function persist() {
  await mkdir(dirname(statePath()), { recursive: true });
  const obj = Object.fromEntries(cache);
  await writeFile(statePath(), JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * @param {string} sub
 */
export function getUsage(sub) {
  return cache.get(sub) ?? { bytes: 0, files: 0 };
}

/**
 * @param {string} sub
 * @param {number} addBytes
 */
export async function addUsage(sub, addBytes) {
  const u = getUsage(sub);
  u.bytes += addBytes;
  u.files += 1;
  cache.set(sub, u);
  await persist();
}
