import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ProviderConfig, ReaderDocument, WordDetail } from '../types';
import { playWordPronunciation } from '../utils/audio';
import { extractTextFromPdf } from '../utils/pdf';
import { splitParagraphs, splitSentences } from '../utils/text';
import {
  addOrUpdateFavorite,
  getReadingProgress,
  isFavoriteWord,
  removeFavorite,
  upsertDocument,
  upsertReadingProgress,
} from '../db/database';
import {
  lookupWordFromFallback,
  lookupWordWithFallback,
  translateSentenceWithFallback,
} from '../services/translationService';
import { enrichBilingualByLlm } from '../services/providers';
import { SentenceBlock } from '../components/SentenceBlock';

interface ReaderPageProps {
  config: ProviderConfig;
}

interface ParagraphData {
  id: string;
  sentences: string[];
}
type ParagraphKind = 'title' | 'subtitle' | 'body';

interface ReaderCachePayload {
  documentName: string;
  documentId: string | null;
  paragraphs: ParagraphData[];
  sentenceTranslations: Record<string, string>;
}

interface PathLoadedDocument {
  path: string;
  name: string;
  fileType: 'pdf' | 'txt';
  textContent?: string;
  bytesBase64?: string;
  modifiedAtMs: number;
}

interface LookupPopoverAnchor {
  x: number;
  y: number;
}

interface LookupPopoverPosition {
  left: number;
  top: number;
}

const READER_CACHE_KEY = 'translation-reader-last-document-v1';
const LOOKUP_POPUP_WIDTH = 360;
const LOOKUP_POPUP_ESTIMATED_HEIGHT = 420;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  try {
    const raw = JSON.stringify(error);
    if (raw && raw !== '{}') {
      return raw;
    }
  } catch {
    // no-op
  }
  return fallback;
}

function detectDocumentType(file: File): 'pdf' | 'txt' | null {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.pdf') || file.type.includes('pdf')) {
    return 'pdf';
  }
  if (lowerName.endsWith('.txt') || file.type.startsWith('text/')) {
    return 'txt';
  }
  return null;
}

function buildDocumentId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function buildPathDocumentId(path: string, modifiedAtMs: number): string {
  return `${path}-${modifiedAtMs}`;
}

function decodeBase64ToBytes(base64Value: string): Uint8Array {
  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function sanitizeExtractedText(input: string): string {
  return input
    .replace(/\uFFFD/g, '�')
    .replace(/([A-Za-z])�(s|t|m|d|re|ve|ll)\b/gi, "$1'$2")
    .replace(/([A-Za-z])�([A-Za-z])/g, '$1-$2')
    .replace(/�/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/ \./g, '.')
    .replace(/ ,/g, ',')
    .replace(/ ;/g, ';')
    .replace(/ :/g, ':')
    .trim();
}

function injectHeadingBreaks(paragraph: string): string {
  return paragraph
    .replace(/(Part\s+[IVXLC]+\b[^\n]{0,80})/gi, '\n$1')
    .replace(/(Section\s+[A-Z]\b[^\n]{0,60})/g, '\n$1')
    .replace(/(Directions?\s*:)/gi, '\n$1')
    .replace(/(You may not use\b)/gi, '\n$1')
    .replace(/(Read the passage\b)/gi, '\n$1')
    .replace(/(Each choice\b)/gi, '\n$1')
    .replace(/(Please mark\b)/gi, '\n$1')
    .trim();
}

function buildParagraphs(content: string): ParagraphData[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const paragraphGroups = splitParagraphs(normalized);
  const expanded: string[] = [];

  paragraphGroups.forEach((paragraph, index) => {
    const candidate = index < 4 ? injectHeadingBreaks(paragraph) : paragraph;
    const lines = candidate.split('\n').map((line) => line.trim()).filter(Boolean);
    const shouldSplitLines =
      index < 4
      && lines.length > 1
      && lines.length <= 8
      && lines.every((line) => line.length < 280);

    if (shouldSplitLines) {
      expanded.push(...lines.map((line) => sanitizeExtractedText(line)));
    } else {
      expanded.push(sanitizeExtractedText(paragraph.replace(/\n+/g, ' ')));
    }
  });

  return expanded.map((paragraph, index) => ({
    id: `p-${index}`,
    sentences: splitSentences(paragraph),
  }));
}

function looksLikeTitle(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (
    (/^(part|chapter|unit|section)\b/i.test(normalized) && wordCount <= 14)
    || (/reading comprehension/i.test(normalized) && wordCount <= 14)
  ) {
    return true;
  }

  const endsWithPunctuation = /[.!?。！？]$/.test(normalized);
  return wordCount <= 14 && !endsWithPunctuation;
}

function looksLikeSubtitle(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  if (/^directions?\s*:/i.test(normalized)) {
    return true;
  }

  if (/^\(?\d+\s*minutes?\)?$/i.test(normalized)) {
    return true;
  }

  if (
    /^(you may not use|read the passage|each choice|please mark|for this part|in this section)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount <= 36 && normalized.includes(':');
}

function resolveParagraphKind(text: string, index: number): ParagraphKind {
  if (index === 0 && looksLikeTitle(text)) {
    return 'title';
  }
  if (index <= 10 && looksLikeSubtitle(text)) {
    return 'subtitle';
  }
  return 'body';
}

function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function splitBilingual(value: string): { en: string; zh?: string } {
  const parts = value.split(/\s*[|｜]\s*/g).map((item) => item.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { en: value };
  }
  return { en: parts[0], zh: parts.slice(1).join(' | ') };
}

function mergeMissingFields(base: WordDetail, supplement: WordDetail): WordDetail {
  return {
    ...base,
    phonetic: base.phonetic || supplement.phonetic,
    audioUrl: base.audioUrl || supplement.audioUrl,
    collocations: base.collocations.length ? base.collocations : supplement.collocations,
    examples: base.examples.length ? base.examples : supplement.examples,
  };
}

function buildLookupCacheKey(
  provider: ProviderConfig['primaryProvider'],
  fallback: ProviderConfig['fallbackProvider'],
  word: string,
): string {
  return `${provider}:${fallback}:${word.toLowerCase()}`;
}

function resolveLookupPopoverPosition(anchor: LookupPopoverAnchor): LookupPopoverPosition {
  const viewportWidth = window.innerWidth || 1200;
  const viewportHeight = window.innerHeight || 800;
  const width = Math.min(LOOKUP_POPUP_WIDTH, Math.max(280, viewportWidth - 24));
  const preferBelowTop = anchor.y + 14;
  const preferAboveTop = anchor.y - LOOKUP_POPUP_ESTIMATED_HEIGHT - 14;
  const left = Math.min(
    Math.max(12, anchor.x - width / 2),
    Math.max(12, viewportWidth - width - 12),
  );
  const top = preferBelowTop + LOOKUP_POPUP_ESTIMATED_HEIGHT <= viewportHeight - 12
    ? Math.max(84, preferBelowTop)
    : Math.max(84, preferAboveTop);
  return { left, top };
}

export function ReaderPage({ config }: ReaderPageProps) {
  const [documentName, setDocumentName] = useState<string>('未导入文档');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphData[]>([]);
  const [selectedWord, setSelectedWord] = useState<WordDetail | null>(null);
  const [selectedSentence, setSelectedSentence] = useState<string>('');
  const [isWordFavorite, setIsWordFavorite] = useState(false);
  const [sentenceTranslations, setSentenceTranslations] = useState<
    Record<string, string>
  >({});
  const [readingError, setReadingError] = useState<string>('');
  const [readingNotice, setReadingNotice] = useState<string>('');
  const [lookupError, setLookupError] = useState<string>('');
  const [translationError, setTranslationError] = useState<string>('');
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [isWordDetailEnhancing, setIsWordDetailEnhancing] = useState(false);
  const [lookupPopoverPosition, setLookupPopoverPosition] = useState<LookupPopoverPosition | null>(
    null,
  );
  const [isSentenceLoading, setIsSentenceLoading] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const progressSaveTimerRef = useRef<number | null>(null);
  const lookupCacheRef = useRef<Map<string, WordDetail>>(new Map());
  const lookupInFlightRef = useRef<Map<string, Promise<WordDetail>>>(new Map());
  const lookupRequestIdRef = useRef(0);

  useEffect(() => {
    const raw = localStorage.getItem(READER_CACHE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ReaderCachePayload;
      if (Array.isArray(parsed.paragraphs) && parsed.paragraphs.length) {
        setParagraphs(parsed.paragraphs);
        setDocumentName(parsed.documentName || '未导入文档');
        setDocumentId(parsed.documentId ?? null);
        setSentenceTranslations(parsed.sentenceTranslations ?? {});
      }
    } catch {
      // ignore broken cache
    }
  }, []);

  useEffect(() => {
    if (!paragraphs.length) {
      return;
    }

    const payload: ReaderCachePayload = {
      documentName,
      documentId,
      paragraphs,
      sentenceTranslations,
    };
    localStorage.setItem(READER_CACHE_KEY, JSON.stringify(payload));
  }, [documentId, documentName, paragraphs, sentenceTranslations]);

  useEffect(() => {
    if (!documentId || !scrollerRef.current) {
      return;
    }

    void (async () => {
      const progress = await getReadingProgress(documentId);
      if (progress !== null && scrollerRef.current) {
        scrollerRef.current.scrollTop = progress;
      }
    })();
  }, [documentId]);

  useEffect(
    () => () => {
      if (progressSaveTimerRef.current !== null) {
        window.clearTimeout(progressSaveTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!lookupPopoverPosition) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLookupPopoverPosition(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [lookupPopoverPosition]);

  useEffect(() => {
    if (!lookupPopoverPosition || !popoverRef.current) {
      return;
    }

    const rect = popoverRef.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return;
    }
    const minLeft = 12;
    const minTop = 72;
    const maxRight = window.innerWidth - 12;
    const maxBottom = window.innerHeight - 12;

    let nextLeft = lookupPopoverPosition.left;
    let nextTop = lookupPopoverPosition.top;

    if (rect.right > maxRight) {
      nextLeft -= rect.right - maxRight;
    }
    if (rect.left < minLeft) {
      nextLeft += minLeft - rect.left;
    }
    if (rect.bottom > maxBottom) {
      nextTop -= rect.bottom - maxBottom;
    }
    if (rect.top < minTop) {
      nextTop += minTop - rect.top;
    }

    if (
      Math.abs(nextLeft - lookupPopoverPosition.left) > 0.5
      || Math.abs(nextTop - lookupPopoverPosition.top) > 0.5
    ) {
      setLookupPopoverPosition({
        left: nextLeft,
        top: nextTop,
      });
    }
  }, [
    lookupError,
    lookupPopoverPosition,
    isLookupLoading,
    isWordDetailEnhancing,
    selectedWord,
  ]);

  const canImport = useMemo(() => !isImporting, [isImporting]);

  const applyImportedText = useCallback(
    async (params: {
      id: string;
      name: string;
      type: 'pdf' | 'txt';
      content: string;
    }) => {
      const parsedParagraphs = buildParagraphs(params.content);
      if (!parsedParagraphs.length) {
        throw new Error('未提取到可读文本，请确认文件内容可复制。');
      }

      const doc: ReaderDocument = {
        id: params.id,
        name: params.name,
        type: params.type,
        importedAt: new Date().toISOString(),
      };

      setParagraphs(parsedParagraphs);
      setDocumentId(params.id);
      setDocumentName(params.name);

      try {
        await upsertDocument(doc);
      } catch (error) {
        console.error('Document metadata save failed:', error);
        setReadingNotice(
          `文档已打开，但本地保存失败：${getErrorMessage(
            error,
            '阅读进度可能无法保存。',
          )}`,
        );
      }
    },
    [],
  );

  const handleImport = useCallback(async (file: File) => {
    setIsImporting(true);
    setReadingError('');
    setReadingNotice('');
    setLookupError('');
    setIsWordDetailEnhancing(false);
    setLookupPopoverPosition(null);
    setTranslationError('');
    setSentenceTranslations({});
    setSelectedWord(null);
    setSelectedSentence('');

    try {
      const extension = detectDocumentType(file);
      if (!extension) {
        throw new Error('文件格式不支持。当前仅支持 PDF/TXT。');
      }

      const content =
        extension === 'pdf'
          ? await extractTextFromPdf(file).catch((error) => {
              throw new Error(
                `PDF 解析失败：${getErrorMessage(
                  error,
                  '请确认是可复制文本的 PDF（扫描件暂不支持）。',
                )}`,
              );
            })
          : await file.text();
      await applyImportedText({
        id: buildDocumentId(file),
        name: file.name,
        type: extension,
        content,
      });
    } catch (error) {
      console.error('Import failed:', error);
      setReadingError(`导入失败：${getErrorMessage(error, '未知错误')}`);
    } finally {
      setIsImporting(false);
    }
  }, [applyImportedText]);

  const handleImportFromPath = useCallback(
    async (path: string) => {
      setIsImporting(true);
      setReadingError('');
      setReadingNotice('');
      setLookupError('');
      setIsWordDetailEnhancing(false);
      setLookupPopoverPosition(null);
      setTranslationError('');
      setSentenceTranslations({});
      setSelectedWord(null);
      setSelectedSentence('');

      try {
        const loaded = await invoke<PathLoadedDocument>('load_document_from_path', {
          path,
        });

        let content = loaded.textContent ?? '';
        if (loaded.fileType === 'pdf') {
          if (!loaded.bytesBase64) {
            throw new Error('PDF 文件读取失败：未获得二进制内容。');
          }
          const bytes = decodeBase64ToBytes(loaded.bytesBase64);
          const stableBytes = new Uint8Array(bytes.byteLength);
          stableBytes.set(bytes);
          const pdfBlob = new Blob([stableBytes], {
            type: 'application/pdf',
          });
          const pdfFile = new File([pdfBlob], loaded.name, {
            type: 'application/pdf',
          });
          content = await extractTextFromPdf(pdfFile).catch((error) => {
            throw new Error(
              `PDF 解析失败：${getErrorMessage(
                error,
                '请确认是可复制文本的 PDF（扫描件暂不支持）。',
              )}`,
            );
          });
        }

        await applyImportedText({
          id: buildPathDocumentId(loaded.path, loaded.modifiedAtMs),
          name: loaded.name,
          type: loaded.fileType,
          content,
        });
      } catch (error) {
        console.error('Path import failed:', error);
        setReadingError(`导入失败：${getErrorMessage(error, '未知错误')}`);
      } finally {
        setIsImporting(false);
      }
    },
    [applyImportedText],
  );

  useEffect(() => {
    let isDisposed = false;

    const openFromLaunch = async () => {
      try {
        const launchPath = await invoke<string | null>('get_launch_document_path');
        if (!isDisposed && launchPath) {
          await handleImportFromPath(launchPath);
        }
      } catch (error) {
        if (!isDisposed) {
          console.error('Launch path loading failed:', error);
        }
      }
    };

    void openFromLaunch();

    const unlisten = listen<string>('open-associated-file', (event) => {
      if (event.payload) {
        void handleImportFromPath(event.payload);
      }
    });

    return () => {
      isDisposed = true;
      void unlisten.then((dispose) => dispose());
    };
  }, [handleImportFromPath]);

  async function onFileInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await handleImport(file);
    event.target.value = '';
  }

  async function lookupWordFast(word: string, sentence: string): Promise<WordDetail> {
    const cacheKey = buildLookupCacheKey(
      config.primaryProvider,
      config.fallbackProvider,
      word,
    );

    const cached = lookupCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = lookupInFlightRef.current.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = lookupWordWithFallback(config, word, sentence)
      .then((detail) => {
        lookupCacheRef.current.set(cacheKey, detail);
        return detail;
      })
      .finally(() => {
        lookupInFlightRef.current.delete(cacheKey);
      });

    lookupInFlightRef.current.set(cacheKey, request);
    return request;
  }

  async function handleWordLookup(
    word: string,
    sentence: string,
    anchor: LookupPopoverAnchor,
  ): Promise<void> {
    lookupRequestIdRef.current += 1;
    const currentRequestId = lookupRequestIdRef.current;

    setLookupPopoverPosition(resolveLookupPopoverPosition(anchor));
    setIsLookupLoading(true);
    setIsWordDetailEnhancing(false);
    setIsWordFavorite(false);
    setLookupError('');
    setSelectedSentence(sentence);

    try {
      const detail = await lookupWordFast(word, sentence);
      if (currentRequestId !== lookupRequestIdRef.current) {
        return;
      }

      setSelectedWord(detail);
      setIsLookupLoading(false);

      void (async () => {
        try {
          const favorite = await isFavoriteWord(detail.word);
          if (currentRequestId === lookupRequestIdRef.current) {
            setIsWordFavorite(favorite);
          }
        } catch (error) {
          console.warn('Favorite status check failed:', error);
        }
      })();

      const mayNeedFallbackSupplement =
        config.fallbackProvider !== 'none'
        && detail.provider !== config.fallbackProvider
        && (
          !detail.phonetic
          || !detail.audioUrl
          || !detail.collocations.length
          || !detail.examples.length
        );
      const mayNeedBilingual =
        detail.collocations.some((item) => !hasChinese(item))
        || detail.examples.some((item) => !hasChinese(item));

      if (!mayNeedFallbackSupplement && (!mayNeedBilingual || !config.apiKeys.llmApiKey)) {
        return;
      }

      setIsWordDetailEnhancing(true);
      void (async () => {
        let enrichedDetail = detail;
        try {
          if (mayNeedFallbackSupplement) {
            const fallbackDetail = await lookupWordFromFallback(config, word, sentence);
            if (currentRequestId !== lookupRequestIdRef.current) {
              return;
            }
            if (fallbackDetail) {
              enrichedDetail = mergeMissingFields(enrichedDetail, fallbackDetail);
            }
          }

          const needsBilingual =
            enrichedDetail.collocations.some((item) => !hasChinese(item))
            || enrichedDetail.examples.some((item) => !hasChinese(item));
          if (needsBilingual && config.apiKeys.llmApiKey) {
            const enriched = await enrichBilingualByLlm(
              config,
              enrichedDetail.collocations,
              enrichedDetail.examples,
            );
            if (currentRequestId !== lookupRequestIdRef.current) {
              return;
            }
            enrichedDetail = {
              ...enrichedDetail,
              collocations: enriched.collocations,
              examples: enriched.examples,
            };
          }

          const cacheKey = buildLookupCacheKey(
            config.primaryProvider,
            config.fallbackProvider,
            detail.word,
          );
          lookupCacheRef.current.set(cacheKey, enrichedDetail);
          setSelectedWord((previous) => (
            previous && previous.word === detail.word ? enrichedDetail : previous
          ));
        } catch (error) {
          console.warn('Bilingual enrichment failed:', error);
        } finally {
          if (currentRequestId === lookupRequestIdRef.current) {
            setIsWordDetailEnhancing(false);
          }
        }
      })();
    } catch (error) {
      if (currentRequestId !== lookupRequestIdRef.current) {
        return;
      }
      setLookupError(getErrorMessage(error, '查词失败'));
      setIsLookupLoading(false);
    }
  }

  async function handleSentenceTranslate(key: string, sentence: string): Promise<void> {
    if (sentenceTranslations[key]) {
      setSentenceTranslations((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      return;
    }

    setIsSentenceLoading(key);
    setTranslationError('');
    try {
      const result = await translateSentenceWithFallback(config, sentence);
      setSentenceTranslations((previous) => ({
        ...previous,
        [key]: result.translation,
      }));
    } catch (error) {
      setTranslationError(getErrorMessage(error, '句子翻译失败'));
    } finally {
      setIsSentenceLoading('');
    }
  }

  async function toggleFavorite(): Promise<void> {
    if (!selectedWord) {
      return;
    }

    if (isWordFavorite) {
      await removeFavorite(selectedWord.word);
      setIsWordFavorite(false);
      return;
    }

    await addOrUpdateFavorite(selectedWord, selectedSentence);
    setIsWordFavorite(true);
  }

  function handleScroll() {
    if (!documentId || !scrollerRef.current) {
      return;
    }

    if (progressSaveTimerRef.current !== null) {
      window.clearTimeout(progressSaveTimerRef.current);
    }

    progressSaveTimerRef.current = window.setTimeout(() => {
      if (!scrollerRef.current || !documentId) {
        return;
      }
      void upsertReadingProgress(documentId, scrollerRef.current.scrollTop);
    }, 380);
  }

  return (
    <main className="reader-layout">
      <section className="reader-panel" ref={scrollerRef} onScroll={handleScroll}>
        <div className="toolbar">
          <div>
            <h2 className="title">{documentName}</h2>
            <p className="muted">支持 PDF/TXT。双击单词会在悬浮词条框中展示详情。</p>
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              className="button"
              disabled={!canImport}
              onClick={() => fileInputRef.current?.click()}
            >
              {isImporting ? '导入中...' : '导入文件'}
            </button>
            <input
              ref={fileInputRef}
              data-testid="file-input"
              type="file"
              accept=".pdf,.txt,text/plain,application/pdf"
              style={{ display: 'none' }}
              onChange={(event) => {
                void onFileInputChange(event);
              }}
            />
          </div>
        </div>

        {readingError ? <p className="error">{readingError}</p> : null}
        {readingNotice ? <p className="notice">{readingNotice}</p> : null}
        {translationError ? <p className="error">{translationError}</p> : null}

        {!paragraphs.length ? (
          <div className="empty-box">
            <p>请先导入英文 PDF 或 TXT。</p>
            <p>阅读时双击单词查词，点击句子可显示/收起翻译。</p>
          </div>
        ) : (
          <div className="paragraph-list">
            {paragraphs.map((paragraph, paragraphIndex) => {
              const paragraphText = paragraph.sentences.join(' ').trim();
              const paragraphKind = resolveParagraphKind(paragraphText, paragraphIndex);
              const canTranslateSentence = paragraphKind === 'body';

              return (
                <article
                  key={paragraph.id}
                  className={`paragraph-item paragraph-${paragraphKind}`}
                >
                  {paragraph.sentences.map((sentence, sentenceIndex) => {
                    const key = `${paragraphIndex}-${sentenceIndex}`;
                    return (
                      <SentenceBlock
                        key={key}
                        sentence={sentence}
                        translation={canTranslateSentence ? sentenceTranslations[key] : undefined}
                        variant={paragraphKind}
                        disableSentenceClick={!canTranslateSentence}
                        onSentenceClick={() => {
                          if (canTranslateSentence) {
                            void handleSentenceTranslate(key, sentence);
                          }
                        }}
                        onWordDoubleClick={(word, position) => {
                          void handleWordLookup(word, sentence, position);
                        }}
                      />
                    );
                  })}

                  {canTranslateSentence && isSentenceLoading.startsWith(`${paragraphIndex}-`) ? (
                    <p className="muted">翻译中...</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {lookupPopoverPosition ? (
        <aside
          ref={popoverRef}
          className="lookup-popover"
          style={{
            left: `${lookupPopoverPosition.left}px`,
            top: `${lookupPopoverPosition.top}px`,
          }}
        >
          <div className="lookup-popover-head">
            <h3>词条详情</h3>
            <button
              type="button"
              className="lookup-popover-close"
              onClick={() => {
                setLookupPopoverPosition(null);
              }}
            >
              关闭
            </button>
          </div>

          {isLookupLoading ? <p className="muted">查词中...</p> : null}
          {isWordDetailEnhancing ? <p className="muted">正在补充双语搭配...</p> : null}
          {lookupError ? <p className="error">{lookupError}</p> : null}

          {!selectedWord ? (
            <p className="muted">双击任意英文单词后将在这里显示结果。</p>
          ) : (
            <div className="word-detail">
              <div className="word-heading">
                <div className="word-heading-main">
                  <h4>{selectedWord.word}</h4>
                  <span className="word-phonetic">
                    {selectedWord.phonetic ? `[${selectedWord.phonetic}]` : '[暂无音标]'}
                  </span>
                </div>
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => {
                    playWordPronunciation(selectedWord.word, selectedWord.audioUrl);
                  }}
                >
                  播放发音
                </button>
              </div>
              <p className="translation-main">{selectedWord.translation}</p>
              <p className="muted">来源: {selectedWord.provider}</p>

              <div className="action-row">
                <button type="button" className="button small" onClick={toggleFavorite}>
                  {isWordFavorite ? '取消收藏' : '收藏单词'}
                </button>
              </div>

              <section>
                <h5>常见搭配</h5>
                <ul>
                  {selectedWord.collocations.length ? (
                    selectedWord.collocations.map((item) => {
                      const line = splitBilingual(item);
                      return (
                        <li key={item}>
                          <span>{line.en}</span>
                          {line.zh ? <span className="item-zh">（{line.zh}）</span> : null}
                        </li>
                      );
                    })
                  ) : (
                    <li className="muted">暂无</li>
                  )}
                </ul>
              </section>

              <section>
                <h5>例句</h5>
                <ul>
                  {selectedWord.examples.length ? (
                    selectedWord.examples.map((item) => {
                      const line = splitBilingual(item);
                      return (
                        <li key={item}>
                          <span>{line.en}</span>
                          {line.zh ? <span className="item-zh">（{line.zh}）</span> : null}
                        </li>
                      );
                    })
                  ) : (
                    <li className="muted">暂无</li>
                  )}
                </ul>
              </section>
            </div>
          )}
        </aside>
      ) : null}
    </main>
  );
}
