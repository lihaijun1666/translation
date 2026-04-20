export interface SentenceSegment {
  type: 'word' | 'text';
  value: string;
}

export function splitParagraphs(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitSentences(paragraph: string): string[] {
  const normalized = paragraph.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g);
  if (!matches) {
    return [normalized];
  }

  return matches.map((item) => item.trim()).filter(Boolean);
}

export function splitSentenceSegments(sentence: string): SentenceSegment[] {
  const pattern = /([A-Za-z][A-Za-z'-]*)/g;
  const segments: SentenceSegment[] = [];
  let cursor = 0;

  for (const match of sentence.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;

    if (index > cursor) {
      segments.push({ type: 'text', value: sentence.slice(cursor, index) });
    }

    segments.push({ type: 'word', value });
    cursor = index + value.length;
  }

  if (cursor < sentence.length) {
    segments.push({ type: 'text', value: sentence.slice(cursor) });
  }

  return segments;
}

export function normalizeWord(value: string): string {
  return value.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase();
}
