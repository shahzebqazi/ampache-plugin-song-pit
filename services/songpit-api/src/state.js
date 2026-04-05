import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Mutex } from 'async-mutex';
import { config } from './config.js';

const stateFile = () => join(config.stagingRoot, '.songpit-usage.json');

/** Serializes read–modify–write for usage.json within one Node process. */
const usageMutex = new Mutex();

/**
 * Read usage map from disk (may be slightly stale for GET /session).
 */
export async function readUsageState() {
  try {
    const raw = await readFile(stateFile(), 'utf8');
    const obj = JSON.parse(raw);
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
      ? obj
      : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, { bytes: number, files: number }>} state
 */
export async function writeUsageState(state) {
  await mkdir(config.stagingRoot, { recursive: true });
  await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Serialize usage mutations (parallel uploads in one worker).
 * @template T
 * @param {() => Promise<T>} fn
 */
export async function withUsageLock(fn) {
  return usageMutex.runExclusive(async () => {
    await mkdir(config.stagingRoot, { recursive: true });
    return fn();
  });
}

/**
 * @param {string} sub
 */
export async function getUsageSnapshot(sub) {
  const state = await readUsageState();
  const u = state[sub];
  return u ?? { bytes: 0, files: 0 };
}
