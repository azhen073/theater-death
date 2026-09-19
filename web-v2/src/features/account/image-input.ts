export interface Crop { left: number; top: number; size: number }
export function squareCrop(width: number, height: number, zoom: number, x: number, y: number): Crop {
  if (![width, height, zoom, x, y].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('invalid_image');
  const size = Math.min(width, height) / Math.max(1, Math.min(4, zoom));
  const pan = (value: number) => Math.max(-1, Math.min(1, value));
  return { left: (width - size) * (pan(x) + 1) / 2, top: (height - size) * (pan(y) + 1) / 2, size };
}

/** Reject animated sources before flattening; uploaded avatars must be static. */
export function isAnimatedImage(bytes: Uint8Array, mime: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (mime === 'image/png') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset, false);
      if (ascii(offset + 4, offset + 8) === 'acTL') return true;
      const next = offset + 12 + length;
      if (next > bytes.length) break;
      offset = next;
    }
  }
  if (mime === 'image/webp') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset + 4, true);
      const chunk = ascii(offset, offset + 4);
      if (chunk === 'ANIM' || chunk === 'ANMF' || chunk === 'VP8X' && length > 0 && offset + 8 < bytes.length && (bytes[offset + 8]! & 2) !== 0) return true;
      const next = offset + 8 + length + length % 2;
      if (next > bytes.length) break;
      offset = next;
    }
  }
  return false;
}
