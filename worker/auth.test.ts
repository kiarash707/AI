import { describe, expect, it } from 'vitest';
import { totpCode } from './index';

describe('owner authenticator TOTP', () => {
  it('matches the RFC 6238 SHA-1 six-digit vector at counter 1', async () => {
    // Base32 for the RFC test secret "12345678901234567890".
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await expect(totpCode(secret, 1)).resolves.toBe('287082');
  });

  it('always returns exactly six decimal digits', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const code = await totpCode(secret, 59);
    expect(code).toMatch(/^\d{6}$/);
  });
});
