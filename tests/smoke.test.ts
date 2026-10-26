import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, makeHarness, request } from './contract-http-utils.ts';

afterEach(closeHarnesses);

describe('application smoke', () => {
  it('serves the current v2 health payload', async () => {
    const harness = await makeHarness(0);
    const response = await request(harness, '/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      apiVersion: 2,
      contractVersion: '2.2',
      rulesVersion: '2.0',
    });
  });
});
