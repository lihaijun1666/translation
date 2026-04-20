import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../types';
import {
  lookupWordWithFallback,
  translateSentenceWithFallback,
} from './translationService';

const config: ProviderConfig = {
  primaryProvider: 'youdao',
  fallbackProvider: 'llm',
  apiKeys: {},
};

describe('translationService', () => {
  it('falls back to llm when primary lookup fails', async () => {
    const deps = {
      lookupByYoudao: vi.fn().mockRejectedValue(new Error('fail')),
      lookupByIciba: vi.fn(),
      lookupByLlm: vi.fn().mockResolvedValue({
        word: 'hello',
        translation: '你好',
        collocations: [],
        examples: [],
        provider: 'llm',
      }),
      translateByYoudao: vi.fn(),
      translateByIciba: vi.fn(),
      translateByLlm: vi.fn(),
    };

    const result = await lookupWordWithFallback(config, 'hello', 'Hello world', deps);
    expect(result.provider).toBe('llm');
    expect(deps.lookupByLlm).toHaveBeenCalled();
  });

  it('returns primary result directly without waiting llm supplement', async () => {
    const deps = {
      lookupByYoudao: vi.fn().mockResolvedValue({
        word: 'hello',
        translation: '你好',
        collocations: [],
        examples: [],
        provider: 'youdao',
      }),
      lookupByIciba: vi.fn(),
      lookupByLlm: vi.fn().mockResolvedValue({
        word: 'hello',
        translation: '你好',
        phonetic: 'həˈloʊ',
        collocations: ['say hello'],
        examples: ['Hello world'],
        provider: 'llm',
      }),
      translateByYoudao: vi.fn(),
      translateByIciba: vi.fn(),
      translateByLlm: vi.fn(),
    };

    const result = await lookupWordWithFallback(config, 'hello', 'Hello world', deps);
    expect(result.provider).toBe('youdao');
    expect(result.collocations).toEqual([]);
    expect(result.examples).toEqual([]);
    expect(deps.lookupByLlm).not.toHaveBeenCalled();
  });

  it('falls back to llm when sentence translation fails', async () => {
    const deps = {
      lookupByYoudao: vi.fn(),
      lookupByIciba: vi.fn(),
      lookupByLlm: vi.fn(),
      translateByYoudao: vi.fn().mockRejectedValue(new Error('fail')),
      translateByIciba: vi.fn(),
      translateByLlm: vi.fn().mockResolvedValue({
        sentence: 'Hello world.',
        translation: '你好，世界。',
        provider: 'llm',
      }),
    };

    const result = await translateSentenceWithFallback(config, 'Hello world.', deps);
    expect(result.translation).toContain('你好');
    expect(deps.translateByLlm).toHaveBeenCalled();
  });
});
