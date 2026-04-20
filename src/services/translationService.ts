import type { ProviderConfig, SentenceTranslation, WordDetail } from '../types';
import { providers } from './providers';

interface ProviderDeps {
  lookupByYoudao: (config: ProviderConfig, word: string) => Promise<WordDetail>;
  lookupByIciba: (config: ProviderConfig, word: string) => Promise<WordDetail>;
  lookupByLlm: (
    config: ProviderConfig,
    word: string,
    contextSentence: string,
  ) => Promise<WordDetail>;
  translateByYoudao: (
    config: ProviderConfig,
    sentence: string,
  ) => Promise<SentenceTranslation>;
  translateByIciba: (
    config: ProviderConfig,
    sentence: string,
  ) => Promise<SentenceTranslation>;
  translateByLlm: (
    config: ProviderConfig,
    sentence: string,
  ) => Promise<SentenceTranslation>;
}

function hasNeedfulField(detail: WordDetail): boolean {
  return Boolean(detail.translation && detail.translation.trim().length > 0);
}

function cloneWithProvider(
  config: ProviderConfig,
  provider: ProviderConfig['primaryProvider'],
): ProviderConfig {
  return {
    ...config,
    primaryProvider: provider,
    fallbackProvider: 'none',
  };
}

async function lookupByPrimaryProvider(
  config: ProviderConfig,
  word: string,
  contextSentence: string,
  deps: ProviderDeps,
): Promise<WordDetail> {
  if (config.primaryProvider === 'llm') {
    return deps.lookupByLlm(config, word, contextSentence);
  }
  return config.primaryProvider === 'youdao'
    ? deps.lookupByYoudao(config, word)
    : deps.lookupByIciba(config, word);
}

export async function lookupWordWithFallback(
  config: ProviderConfig,
  word: string,
  contextSentence: string,
  deps: ProviderDeps = providers,
): Promise<WordDetail> {
  try {
    const primary = await lookupByPrimaryProvider(config, word, contextSentence, deps);

    if (!hasNeedfulField(primary)) {
      throw new Error('主 provider 字段缺失');
    }

    return primary;
  } catch (primaryError) {
    if (config.fallbackProvider === 'llm') {
      return deps.lookupByLlm(config, word, contextSentence);
    }
    throw primaryError;
  }
}

export async function lookupWordFromFallback(
  config: ProviderConfig,
  word: string,
  contextSentence: string,
  deps: ProviderDeps = providers,
): Promise<WordDetail | null> {
  if (config.fallbackProvider === 'none') {
    return null;
  }

  const fallbackConfig = cloneWithProvider(config, config.fallbackProvider);
  try {
    return await lookupByPrimaryProvider(fallbackConfig, word, contextSentence, deps);
  } catch {
    return null;
  }
}

export async function translateSentenceWithFallback(
  config: ProviderConfig,
  sentence: string,
  deps: ProviderDeps = providers,
): Promise<SentenceTranslation> {
  if (config.primaryProvider === 'llm') {
    return deps.translateByLlm(config, sentence);
  }

  try {
    return config.primaryProvider === 'youdao'
      ? await deps.translateByYoudao(config, sentence)
      : await deps.translateByIciba(config, sentence);
  } catch (primaryError) {
    if (config.fallbackProvider === 'llm') {
      return deps.translateByLlm(config, sentence);
    }
    throw primaryError;
  }
}
