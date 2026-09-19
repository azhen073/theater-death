import { describe, expect, it } from 'vitest';
import { isAnimatedImage, squareCrop } from '../web-v2/src/features/account/image-input.ts';

function bytes(text: string): Uint8Array {
  return Uint8Array.from([...text].map(character => character.charCodeAt(0)));
}

function pngChunk(type: string, length = 0): Uint8Array {
  const chunk = new Uint8Array(8 + length + 4);
  new DataView(chunk.buffer).setUint32(0, length, false);
  chunk.set(bytes(type), 4);
  return chunk;
}

function webpChunk(type: string, length = 0, flags = 0): Uint8Array {
  const file = new Uint8Array(12 + 8 + length);
  file.set(bytes('RIFF'), 0); file.set(bytes('WEBP'), 8); file.set(bytes(type), 12);
  new DataView(file.buffer).setUint32(16, length, true);
  if (length > 0) file[20] = flags;
  return file;
}

describe('v2 avatar image input helpers', () => {
  it('crops landscape and portrait images to centered squares', () => {
    expect(squareCrop(400, 200, 1, 0, 0)).toEqual({ left: 100, top: 0, size: 200 });
    expect(squareCrop(200, 400, 1, 0, 0)).toEqual({ left: 0, top: 100, size: 200 });
  });

  it('clamps zoom and pan to a valid crop inside the source image', () => {
    expect(squareCrop(400, 200, 8, -100, 100)).toEqual({ left: 0, top: 150, size: 50 });
    expect(squareCrop(400, 200, 0, 100, -100)).toEqual({ left: 200, top: 0, size: 200 });
    expect(squareCrop(400, 200, 2, -1, 1)).toEqual({ left: 0, top: 100, size: 100 });
  });

  it('rejects non-finite and non-positive image dimensions', () => {
    const invalidInputs: [number, number, number, number, number][] = [
      [0, 100, 1, 0, 0], [-1, 100, 1, 0, 0], [100, 0, 1, 0, 0],
      [100, 100, Number.NaN, 0, 0], [100, 100, 1, Number.POSITIVE_INFINITY, 0],
      [100, 100, 1, 0, Number.NEGATIVE_INFINITY],
    ];
    for (const input of invalidInputs) {
      expect(() => squareCrop(...input)).toThrow('invalid_image');
    }
  });

  it('detects PNG animation chunks and leaves a static PNG or truncated chunk non-animated', () => {
    const header = bytes('\x89PNG\r\n\x1a\n');
    const animated = new Uint8Array(header.length + 12);
    animated.set(header); animated.set(pngChunk('acTL'), header.length);
    expect(isAnimatedImage(animated, 'image/png')).toBe(true);

    const staticPng = new Uint8Array(header.length + 12);
    staticPng.set(header); staticPng.set(pngChunk('IDAT'), header.length);
    expect(isAnimatedImage(staticPng, 'image/png')).toBe(false);

    const truncated = new Uint8Array(header.length + 8);
    truncated.set(header); truncated.set(pngChunk('acTL', 32).subarray(0, 8), header.length);
    expect(isAnimatedImage(truncated, 'image/png')).toBe(false);
  });

  it('detects WebP ANIM, ANMF, and VP8X animation flags without hanging on truncation', () => {
    expect(isAnimatedImage(webpChunk('ANIM'), 'image/webp')).toBe(true);
    expect(isAnimatedImage(webpChunk('ANMF'), 'image/webp')).toBe(true);
    expect(isAnimatedImage(webpChunk('VP8X', 10, 2), 'image/webp')).toBe(true);
    expect(isAnimatedImage(webpChunk('VP8X', 10, 0), 'image/webp')).toBe(false);

    const truncated = webpChunk('VP8X', 100, 0).subarray(0, 24);
    expect(isAnimatedImage(truncated, 'image/webp')).toBe(false);
  });
});
