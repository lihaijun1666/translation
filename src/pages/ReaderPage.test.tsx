import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReaderPage } from './ReaderPage';
import type { ProviderConfig } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../utils/pdf', () => ({
  extractTextFromPdf: vi.fn(),
}));

vi.mock('../db/database', () => ({
  addOrUpdateFavorite: vi.fn().mockResolvedValue(undefined),
  getReadingProgress: vi.fn().mockResolvedValue(null),
  isFavoriteWord: vi.fn().mockResolvedValue(false),
  upsertDocument: vi.fn().mockResolvedValue(undefined),
  upsertReadingProgress: vi.fn().mockResolvedValue(undefined),
  removeFavorite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/translationService', () => ({
  lookupWordWithFallback: vi.fn().mockResolvedValue({
    word: 'hello',
    translation: '你好',
    phonetic: 'həˈloʊ',
    collocations: ['say hello'],
    examples: ['Hello world.'],
    provider: 'youdao',
  }),
  translateSentenceWithFallback: vi.fn().mockResolvedValue({
    sentence: 'Hello world.',
    translation: '你好，世界。',
    provider: 'youdao',
  }),
}));

vi.mock('../services/providers', () => ({
  enrichBilingualByLlm: vi.fn().mockResolvedValue({
    collocations: ['say hello｜打招呼'],
    examples: ['Hello world.｜你好，世界。'],
  }),
}));

const config: ProviderConfig = {
  primaryProvider: 'youdao',
  fallbackProvider: 'llm',
  apiKeys: {},
};

describe('ReaderPage integration', () => {
  it('imports txt, translates sentence and looks up word', async () => {
    render(<ReaderPage config={config} />);

    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['Hello world. This is a test.'], 'demo.txt', {
      type: 'text/plain',
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('world')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Helloworld\./i }));

    await waitFor(() => {
      expect(screen.getByText(/译: 你好，世界。/)).toBeInTheDocument();
    });

    const helloWord = screen.getAllByText('Hello')[0];
    fireEvent.doubleClick(helloWord);

    await waitFor(() => {
      expect(screen.getByText('你好')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '收藏单词' })).toBeInTheDocument();
    });
  });
});
