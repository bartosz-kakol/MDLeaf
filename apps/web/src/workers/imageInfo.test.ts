import { describe, expect, it } from 'vitest';
import { animatedImage, sniffImageType, svgSize } from './imageInfo.ts';

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

describe('sniffImageType', () => {
  it('recognises the supported formats', () => {
    expect(sniffImageType(bytes([0x89], 'PNG', [13, 10]))).toBe('image/png');
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffImageType(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('image/webp');
    expect(sniffImageType(bytes([0, 0, 0, 0], 'ftypavif'))).toBe('image/avif');
    expect(sniffImageType(bytes('<?xml version="1.0"?><svg xmlns="x"/>'))).toBe('image/svg+xml');
    expect(sniffImageType(bytes('hello'))).toBeNull();
  });
});

describe('animatedImage', () => {
  const gce = [0x21, 0xf9, 0x04];
  it('detects animated GIFs by their frame count', () => {
    expect(animatedImage('image/gif', bytes('GIF89a', gce, [0, 0], gce))).toBe(true);
    expect(animatedImage('image/gif', bytes('GIF89a', gce))).toBe(false);
  });
  it('detects animated WebP and APNG', () => {
    expect(animatedImage('image/webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [0, 0, 0, 0], 'ANIM'))).toBe(true);
    expect(animatedImage('image/webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe(false);
    expect(animatedImage('image/png', bytes([0x89], 'PNG', [13, 10, 26, 10], 'IHDR', [0, 0], 'acTL'))).toBe(true);
    expect(animatedImage('image/png', bytes([0x89], 'PNG', [13, 10, 26, 10], 'IHDR', 'IDAT', 'acTL'))).toBe(false);
  });
});

describe('svgSize', () => {
  it('reads width/height and falls back to the viewBox', () => {
    expect(svgSize('<svg width="120" height="40px"></svg>')).toEqual({ width: 120, height: 40 });
    expect(svgSize('<svg viewBox="0 0 64 32"></svg>')).toEqual({ width: 64, height: 32 });
    expect(svgSize('<svg width="128" viewBox="0 0 64 32"></svg>')).toEqual({ width: 128, height: 64 });
    expect(svgSize('<svg></svg>')).toEqual({ width: 300, height: 150 });
  });
});
