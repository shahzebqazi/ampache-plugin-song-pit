import { describe, expect, it } from 'vitest';
import { extOk, sniffAudio, hashPassword } from '../src/validate.js';

describe('validate', () => {
  it('extOk allows known audio', () => {
    expect(extOk('x.mp3')).toBe(true);
    expect(extOk('x.aac')).toBe(true);
    expect(extOk('x.exe')).toBe(false);
  });

  it('sniffAudio accepts MP3 sync', () => {
    const b = Buffer.alloc(32);
    b[0] = 0xff;
    b[1] = 0xfb;
    expect(sniffAudio(b, '.mp3')).toBe(true);
  });

  it('sniffAudio accepts ADTS AAC when ext is .aac', () => {
    const b = Buffer.alloc(32);
    b[0] = 0xff;
    b[1] = 0xf1;
    expect(sniffAudio(b, '.aac')).toBe(true);
    expect(sniffAudio(b, '.mp3')).toBe(false);
  });

  it('hashPassword is stable', () => {
    expect(hashPassword('x')).toBe(hashPassword('x'));
    expect(hashPassword('x')).not.toBe(hashPassword('y'));
  });
});
