import { describe, expect, it } from 'vitest';
import {
  normalizeWord,
  splitParagraphs,
  splitSentences,
  splitSentenceSegments,
} from './text';

describe('text utils', () => {
  it('splits paragraphs by empty line', () => {
    const result = splitParagraphs('A line.\n\nB line.\n\n\nC line.');
    expect(result).toEqual(['A line.', 'B line.', 'C line.']);
  });

  it('splits sentence by punctuation and keeps abbreviations usable', () => {
    const result = splitSentences('Dr. Smith arrived. He said: hello! Really?');
    expect(result).toEqual([
      'Dr.',
      'Smith arrived.',
      'He said: hello!',
      'Really?',
    ]);
  });

  it('splits sentence into word and text segments', () => {
    const result = splitSentenceSegments("It's a test.");
    expect(result).toEqual([
      { type: 'word', value: "It's" },
      { type: 'text', value: ' ' },
      { type: 'word', value: 'a' },
      { type: 'text', value: ' ' },
      { type: 'word', value: 'test' },
      { type: 'text', value: '.' },
    ]);
  });

  it('normalizes punctuation around words', () => {
    expect(normalizeWord('"Hello!"')).toBe('hello');
    expect(normalizeWord('...world')).toBe('world');
  });
});
