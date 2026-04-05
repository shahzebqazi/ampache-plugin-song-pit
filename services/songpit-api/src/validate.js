import { createHash } from 'node:crypto';

const ALLOWED_EXT = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.wav',
]);

const MAGIC = [
  { bytes: [0xff, 0xfb] },
  { bytes: [0xff, 0xfa] },
  { bytes: [0x49, 0x44, 0x33] }, // ID3
  { bytes: [0x66, 0x4c, 0x61, 0x43] }, // fLaC
  { bytes: [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70] }, // loose ftyp
  { bytes: [0x4f, 0x67, 0x67, 0x53] }, // OggS
];

/**
 * @param {string} name
 */
export function extOk(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return ALLOWED_EXT.has(lower.slice(dot));
}

/**
 * Best-effort magic sniff; extension still required.
 * @param {Buffer} buf
 * @param {string} [extHint] lower-case extension e.g. '.aac'
 */
export function sniffAudio(buf, extHint = '') {
  if (buf.length < 12) {
    return false;
  }
  for (const m of MAGIC) {
    if (m.bytes.length > buf.length) {
      continue;
    }
    let ok = true;
    for (let i = 0; i < m.bytes.length; i++) {
      if (m.bytes[i] !== buf[i]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return true;
    }
  }
  // MP4/M4A: 'ftyp' at offset 4
  if (
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    return true;
  }
  // RIFF WAVE
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return true;
  }
  // ADTS AAC (.aac): 12-bit sync 0xFFF, layer ID 0 (MPEG-4)
  if (
    extHint === '.aac' &&
    buf[0] === 0xff &&
    (buf[1] & 0xf0) === 0xf0 &&
    (buf[1] & 0x06) === 0
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} password
 * @param {string} [salt]
 */
export function hashPassword(password, salt = 'songpit-v1') {
  return createHash('sha256')
    .update(salt + '|' + password)
    .digest('hex');
}
