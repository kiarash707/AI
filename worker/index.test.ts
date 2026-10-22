import { describe, expect, it } from 'vitest';
import { anonymousSession, classifyTask, isZeroCostPricing, taskSuitable, withAnonymousCookie, zeroPrice } from './index';

const model = (
  id: string,
  context_length: number,
  options: { modalities?: string[]; tools?: boolean; recommended_for?: string[] } = {},
) => ({
  id,
  name: id,
  context_length,
  input_price: 0,
  output_price: 0,
  modalities: options.modalities ?? ['text'],
  tools: options.tools ?? false,
  recommended_for: options.recommended_for ?? ['conversation'],
});

describe('strict zero-cost model gating', () => {
  it('accepts only explicit numeric or string zero values', () => {
    expect(zeroPrice(0)).toBe(true);
    expect(zeroPrice('0')).toBe(true);
    expect(zeroPrice('0.0')).toBe(true);
    for (const value of [1, '0.000001', 'free', '', null, undefined, true, Number.NaN]) {
      expect(zeroPrice(value)).toBe(false);
    }
  });

  it('requires both prompt and completion pricing to be explicitly zero', () => {
    expect(isZeroCostPricing({ prompt: '0', completion: 0 })).toBe(true);
    expect(isZeroCostPricing({ prompt: '0', completion: '0.00001' })).toBe(false);
    expect(isZeroCostPricing({ prompt: 0 })).toBe(false);
    expect(isZeroCostPricing(undefined)).toBe(false);
  });
});

describe('task routing', () => {
  it('recognizes Persian coding and reasoning requests', () => {
    expect(classifyTask('کد من را بررسی کن')).toBe('coding');
    expect(classifyTask('لطفاً تحلیل معماری پروژه را انجام بده')).toBe('reasoning');
    expect(classifyTask('سلام، حالت چطور است؟')).toBe('conversation');
  });

  it('prioritizes coding models and filters out incompatible modalities', () => {
    const general = model('general', 32000);
    const coder = model('coder', 8000, { recommended_for: ['coding', 'conversation'] });
    const image = model('image', 64000, { modalities: ['image'] });
    expect(taskSuitable([general, coder, image], 'coding')[0]?.id).toBe('coder');
    expect(taskSuitable([general, coder, image], 'conversation').every((m) => m.modalities.includes('text'))).toBe(true);
    expect(taskSuitable([general, image], 'image').map((m) => m.id)).toEqual(['image']);
  });
});

describe('public no-login browser sessions', () => {
  it('creates a high-entropy anonymous session when no cookie is present', () => {
    const s = anonymousSession(new Request('https://kayro-ai.pages.dev/api/conversations'));
    expect(s.fresh).toBe(true);
    expect(s.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reuses a valid anonymous cookie without creating a new identity', () => {
    const id = 'ab'.repeat(32);
    const s = anonymousSession(new Request('https://kayro-ai.pages.dev/api/conversations', {
      headers: { Cookie: `theme=dark; kayro_sid=${id}` },
    }));
    expect(s).toEqual({ id, fresh: false });
  });

  it('replaces malformed session cookies instead of trusting them', () => {
    const s = anonymousSession(new Request('https://kayro-ai.pages.dev/api/conversations', {
      headers: { Cookie: 'kayro_sid=not-a-valid-session' },
    }));
    expect(s.fresh).toBe(true);
    expect(s.id).toMatch(/^[a-f0-9]{64}$/);
    expect(s.id).not.toBe('not-a-valid-session');
  });

  it('sets an HttpOnly secure cookie for a fresh session only', () => {
    const fresh = { id: 'cd'.repeat(32), fresh: true };
    const withCookie = withAnonymousCookie(new Response('ok'), fresh);
    expect(withCookie.headers.get('set-cookie')).toContain('HttpOnly');
    expect(withCookie.headers.get('set-cookie')).toContain('Secure');
    expect(withCookie.headers.get('set-cookie')).toContain('SameSite=Lax');
    const reused = withAnonymousCookie(new Response('ok'), { id: fresh.id, fresh: false });
    expect(reused.headers.get('set-cookie')).toBeNull();
  });
});
