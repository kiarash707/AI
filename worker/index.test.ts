import { describe, expect, it } from 'vitest';
import { classifyTask, isZeroCostPricing, taskSuitable, zeroPrice } from './index';

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
