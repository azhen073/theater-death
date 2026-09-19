import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Ajv2020 } from 'ajv/dist/2020.js';

describe('runtime dependency contract', () => {
  it('loads native Sharp and generates/reads a 256px square WebP', async () => {
    const webp = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 35, g: 99, b: 235, alpha: 1 },
      },
    }).webp().toBuffer();
    expect(webp.byteLength).toBeGreaterThan(0);
    const metadata = await sharp(webp).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(sharp.versions.sharp).toBe('0.35.4');
  });

  it('compiles a draft 2020-12 schema with Ajv2020 and rejects missing or extra fields', () => {
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['username', 'roles'],
      properties: {
        username: { type: 'string', minLength: 3 },
        roles: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    });
    expect(validate({ username: 'catalog_user', roles: ['death', 'spirit'] })).toBe(true);
    expect(validate({ username: 'catalog_user' })).toBe(false);
    expect(validate({ username: 'catalog_user', roles: ['death'], unexpected: true })).toBe(false);
    expect(validate.errors).not.toBeNull();
  });
});
