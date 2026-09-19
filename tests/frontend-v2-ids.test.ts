import { describe, expect, it, vi } from 'vitest';
import { newRequestId } from '../web-v2/src/transport/ids.ts';

describe('v2 request id generation', () => {
  it('uses native randomUUID when available without consulting the fallback source', () => {
    const randomUUID = vi.fn(() => 'native-id');
    const getRandomValues = vi.fn((bytes: Uint8Array<ArrayBuffer>) => bytes.fill(0));
    expect(newRequestId({ randomUUID, getRandomValues })).toBe('native-id');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('uses cryptographic getRandomValues fallback with RFC4122 v4/version and variant bits', () => {
    const randomUUID = undefined;
    const sourceBytes = new Uint8Array(new ArrayBuffer(16)).fill(0xab);
    const getRandomValues = vi.fn((bytes: Uint8Array<ArrayBuffer>) => { bytes.set(sourceBytes); return bytes; });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random must not be used'); });
    try {
      const id = newRequestId({ randomUUID, getRandomValues });
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(getRandomValues).toHaveBeenCalledOnce();
      expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
    } finally { random.mockRestore(); }
  });
});
