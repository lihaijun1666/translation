export type ProviderName = 'youdao' | 'iciba' | 'llm';

export interface WordDetail {
  word: string;
  translation: string;
  phonetic?: string;
  audioUrl?: string;
  collocations: string[];
  examples: string[];
  provider: ProviderName;
}

export interface SentenceTranslation {
  sentence: string;
  translation: string;
  provider: ProviderName;
}

export interface ProviderConfig {
  primaryProvider: 'youdao' | 'iciba' | 'llm';
  fallbackProvider: 'llm' | 'none';
  apiKeys: Record<string, string>;
}

export interface FavoriteWord extends WordDetail {
  id: number;
  sourceSentence: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderDocument {
  id: string;
  name: string;
  type: 'pdf' | 'txt';
  importedAt: string;
}
