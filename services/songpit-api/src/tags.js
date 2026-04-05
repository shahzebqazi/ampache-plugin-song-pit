import { writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NodeID3 = require('node-id3');

/**
 * @typedef {{ title?: string, artist?: string, album?: string, trackNo?: string }} MetaFields
 */

/**
 * Embed ID3 tags into MP3 buffer; returns updated buffer or original on failure.
 * @param {Buffer} buffer
 * @param {MetaFields} meta
 */
export function embedMp3Metadata(buffer, meta) {
  const tags = {};
  if (meta.title) {
    tags.title = meta.title;
  }
  if (meta.artist) {
    tags.artist = meta.artist;
  }
  if (meta.album) {
    tags.album = meta.album;
  }
  if (meta.trackNo) {
    tags.trackNumber = meta.trackNo;
  }
  if (Object.keys(tags).length === 0) {
    return buffer;
  }
  try {
    const out = NodeID3.update(tags, buffer);
    return Buffer.isBuffer(out) ? out : buffer;
  } catch {
    return buffer;
  }
}

/**
 * Write sidecar JSON next to the audio file (stem matches audio basename).
 * Used for non-MP3 or when embedding is skipped.
 * @param {string} audioPath absolute path to written audio file
 * @param {MetaFields & { bucket?: string, originalFilename?: string }} meta
 */
export async function writeSidecarMetadata(audioPath, meta) {
  const payload = {
    title: meta.title ?? '',
    artist: meta.artist ?? '',
    album: meta.album ?? '',
    trackNo: meta.trackNo ?? '',
    bucket: meta.bucket ?? '',
    originalFilename: meta.originalFilename ?? '',
  };
  if (
    !payload.title &&
    !payload.artist &&
    !payload.album &&
    !payload.trackNo &&
    !payload.bucket
  ) {
    return;
  }
  const stem = basename(audioPath, extname(audioPath));
  const sidecar = join(dirname(audioPath), `${stem}.songpit-meta.json`);
  await writeFile(sidecar, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * @param {Buffer} buffer
 * @param {string} ext lower-case extension including dot
 * @param {MetaFields} meta
 */
export function applyAudioMetadata(buffer, ext, meta) {
  if (ext === '.mp3') {
    return embedMp3Metadata(buffer, meta);
  }
  return buffer;
}
