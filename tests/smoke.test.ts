import { describe, expect, it } from 'vitest';
import { healthPayload } from '../server/health.ts';

describe('scaffold smoke', () => {
  it('reports ok from the health payload', () => {
    const payload = healthPayload();
    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('theater-death');
  });
});
