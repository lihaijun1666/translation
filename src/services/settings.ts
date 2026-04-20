import type { ProviderConfig } from '../types';

const SETTINGS_KEY = 'translation-reader-provider-config-v1';

export const defaultProviderConfig: ProviderConfig = {
  primaryProvider: 'youdao',
  fallbackProvider: 'none',
  apiKeys: {
    youdaoAppKey: '',
    youdaoAppSecret: '',
    youdaoEndpoint: 'https://openapi.youdao.com/api',
    icibaKey: '',
    icibaDictEndpoint: 'https://dict-co.iciba.com/api/dictionary.php',
    icibaTranslateEndpoint: 'https://fy.iciba.com/ajax.php',
    llmApiKey: '',
    llmBaseUrl: 'https://api.deepseek.com/chat/completions',
    llmModel: 'deepseek-chat',
  },
};

export function loadProviderConfig(): ProviderConfig {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return defaultProviderConfig;
  }

  try {
    const parsed = JSON.parse(raw) as ProviderConfig;
    return {
      ...defaultProviderConfig,
      ...parsed,
      apiKeys: {
        ...defaultProviderConfig.apiKeys,
        ...(parsed.apiKeys ?? {}),
      },
    };
  } catch {
    return defaultProviderConfig;
  }
}

export function saveProviderConfig(config: ProviderConfig): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
}
