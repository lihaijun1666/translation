import { fetch } from '@tauri-apps/plugin-http';
import type { ProviderConfig, SentenceTranslation, WordDetail } from '../types';

type JsonValue = Record<string, unknown>;

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
    // ignore JSON stringify failure
  }
  return fallback;
}

function truncateYoudaoQuery(value: string): string {
  if (value.length <= 20) {
    return value;
  }
  return `${value.slice(0, 10)}${value.length}${value.slice(-10)}`;
}

async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function requestJson(
  url: string,
  init?: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<JsonValue> {
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.headers,
      body: init?.body,
    });
  } catch (error) {
    throw new Error(`请求失败：${getErrorMessage(error, '网络异常')}`);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const detail = bodyText ? ` | ${bodyText.slice(0, 180)}` : '';
    throw new Error(`HTTP ${response.status}: ${response.statusText || '请求失败'}${detail}`);
  }

  try {
    return (await response.json()) as JsonValue;
  } catch (error) {
    throw new Error(`响应解析失败：${getErrorMessage(error, '非 JSON 响应')}`);
  }
}

function mapYoudaoWordResponse(data: JsonValue, word: string): WordDetail {
  const translationList = data.translation as string[] | undefined;
  const basic = (data.basic as JsonValue | undefined) ?? {};
  const web = (data.web as Array<{ key?: string; value?: string[] }> | undefined) ?? [];

  const translation = translationList?.join('；').trim() ?? '';
  if (!translation) {
    throw new Error('有道未返回翻译结果');
  }

  const collocations = web
    .map((item) => `${item.key ?? ''}: ${(item.value ?? []).join('、')}`.trim())
    .filter(Boolean)
    .slice(0, 6);

  const examples = web
    .map((item) => (item.value ?? []).join('；'))
    .filter(Boolean)
    .slice(0, 6);

  return {
    word,
    translation,
    phonetic: (basic.phonetic as string | undefined)
      ?? (basic['us-phonetic'] as string | undefined)
      ?? (basic['uk-phonetic'] as string | undefined),
    audioUrl: (basic['us-speech'] as string | undefined)
      ?? (basic['uk-speech'] as string | undefined)
      ?? (data.speakUrl as string | undefined),
    collocations,
    examples,
    provider: 'youdao',
  };
}

function mapIcibaWordResponse(data: JsonValue, word: string): WordDetail {
  const symbols = (data.symbols as JsonValue[] | undefined) ?? [];
  const firstSymbol = symbols[0] ?? {};
  const parts = (firstSymbol.parts as JsonValue[] | undefined) ?? [];

  const pieces = parts
    .map((part) => {
      const partLabel = (part.part as string | undefined) ?? '';
      const means = ((part.means as string[] | undefined) ?? []).join('；');
      return `${partLabel} ${means}`.trim();
    })
    .filter(Boolean);

  const translation = pieces.join('；');
  if (!translation) {
    throw new Error('金山未返回翻译结果');
  }

  return {
    word,
    translation,
    phonetic:
      (firstSymbol.ph_am as string | undefined)
      ?? (firstSymbol.ph_en as string | undefined),
    audioUrl:
      (firstSymbol.ph_am_mp3 as string | undefined)
      ?? (firstSymbol.ph_en_mp3 as string | undefined),
    collocations: pieces.slice(0, 5),
    examples: [],
    provider: 'iciba',
  };
}

function parseJsonFromLlm(content: string): JsonValue {
  const cleaned = content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned) as JsonValue;
}

function truncateContextForLookup(sentence: string): string {
  const normalized = sentence.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 120)}...`;
}

export async function enrichBilingualByLlm(
  config: ProviderConfig,
  collocations: string[],
  examples: string[],
): Promise<{ collocations: string[]; examples: string[] }> {
  const apiKey = config.apiKeys.llmApiKey;
  const endpoint = config.apiKeys.llmBaseUrl;
  const model = config.apiKeys.llmModel || 'deepseek-chat';
  if (!apiKey || !endpoint) {
    return { collocations, examples };
  }

  const payload = {
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          '你是双语词典助手。将输入中的 collocations 和 examples 保持原顺序输出，并将每一项格式化为 "英文｜中文解释"。必须输出 JSON，字段名为 collocations 和 examples。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          collocations,
          examples,
        }),
      },
    ],
  };

  const data = await requestJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const choices = (data.choices as JsonValue[] | undefined) ?? [];
  const message = (choices[0]?.message as JsonValue | undefined) ?? {};
  const content = (message.content as string | undefined)?.trim() ?? '';
  if (!content) {
    return { collocations, examples };
  }

  try {
    const parsed = parseJsonFromLlm(content);
    return {
      collocations: ((parsed.collocations as string[] | undefined) ?? collocations).slice(
        0,
        Math.max(collocations.length, 8),
      ),
      examples: ((parsed.examples as string[] | undefined) ?? examples).slice(
        0,
        Math.max(examples.length, 8),
      ),
    };
  } catch {
    return { collocations, examples };
  }
}

export async function lookupByYoudao(
  config: ProviderConfig,
  word: string,
): Promise<WordDetail> {
  const appKey = config.apiKeys.youdaoAppKey;
  const appSecret = config.apiKeys.youdaoAppSecret;
  const endpoint = config.apiKeys.youdaoEndpoint;

  if (!appKey || !appSecret || !endpoint) {
    throw new Error('请在设置中填写有道 appKey / appSecret');
  }

  const salt = Math.random().toString(36).slice(2);
  const curtime = Math.floor(Date.now() / 1000).toString();
  const signRaw = `${appKey}${truncateYoudaoQuery(word)}${salt}${curtime}${appSecret}`;
  const sign = await sha256(signRaw);

  const params = new URLSearchParams({
    q: word,
    from: 'en',
    to: 'zh-CHS',
    appKey,
    salt,
    sign,
    signType: 'v3',
    curtime,
  });

  const data = await requestJson(`${endpoint}?${params.toString()}`);
  return mapYoudaoWordResponse(data, word);
}

export async function translateByYoudao(
  config: ProviderConfig,
  sentence: string,
): Promise<SentenceTranslation> {
  const appKey = config.apiKeys.youdaoAppKey;
  const appSecret = config.apiKeys.youdaoAppSecret;
  const endpoint = config.apiKeys.youdaoEndpoint;

  if (!appKey || !appSecret || !endpoint) {
    throw new Error('请在设置中填写有道 appKey / appSecret');
  }

  const salt = Math.random().toString(36).slice(2);
  const curtime = Math.floor(Date.now() / 1000).toString();
  const signRaw = `${appKey}${truncateYoudaoQuery(sentence)}${salt}${curtime}${appSecret}`;
  const sign = await sha256(signRaw);

  const params = new URLSearchParams({
    q: sentence,
    from: 'en',
    to: 'zh-CHS',
    appKey,
    salt,
    sign,
    signType: 'v3',
    curtime,
  });

  const data = await requestJson(`${endpoint}?${params.toString()}`);
  const translation = ((data.translation as string[] | undefined) ?? []).join('；').trim();
  if (!translation) {
    throw new Error('有道未返回句子翻译');
  }

  return {
    sentence,
    translation,
    provider: 'youdao',
  };
}

export async function lookupByIciba(
  config: ProviderConfig,
  word: string,
): Promise<WordDetail> {
  const key = config.apiKeys.icibaKey;
  const endpoint = config.apiKeys.icibaDictEndpoint;
  if (!key || !endpoint) {
    throw new Error('请在设置中填写金山词霸 key');
  }

  const params = new URLSearchParams({
    w: word,
    key,
    type: 'json',
  });
  const data = await requestJson(`${endpoint}?${params.toString()}`);
  return mapIcibaWordResponse(data, word);
}

export async function translateByIciba(
  config: ProviderConfig,
  sentence: string,
): Promise<SentenceTranslation> {
  const endpoint = config.apiKeys.icibaTranslateEndpoint;
  if (!endpoint) {
    throw new Error('请在设置中填写金山翻译 endpoint');
  }

  const body = new URLSearchParams({
    a: 'fy',
    f: 'en',
    t: 'zh',
    w: sentence,
  });

  const data = await requestJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: body.toString(),
  });

  const content = data.content as JsonValue | undefined;
  const translation = (content?.out as string | undefined)?.trim() ?? '';
  if (!translation) {
    throw new Error('金山未返回句子翻译');
  }

  return {
    sentence,
    translation,
    provider: 'iciba',
  };
}

export async function lookupByLlm(
  config: ProviderConfig,
  word: string,
  contextSentence: string,
): Promise<WordDetail> {
  const apiKey = config.apiKeys.llmApiKey;
  const endpoint = config.apiKeys.llmBaseUrl;
  const model = config.apiKeys.llmModel || 'deepseek-chat';
  if (!apiKey || !endpoint) {
    throw new Error('请在设置中填写 LLM key/baseUrl');
  }

  const payload = {
    model,
    temperature: 0,
    max_tokens: 220,
    messages: [
      {
        role: 'system',
        content:
          '你是英语词典助手。输出精简 JSON，字段必须是 translation, phonetic, collocations, examples。collocations 最多 3 条，examples 最多 2 条，且每条格式为 "英文｜中文解释"。',
      },
      {
        role: 'user',
        content: `word=${word}\ncontext=${truncateContextForLookup(contextSentence)}`,
      },
    ],
  };

  const data = await requestJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const choices = (data.choices as JsonValue[] | undefined) ?? [];
  const message = (choices[0]?.message as JsonValue | undefined) ?? {};
  const content = (message.content as string | undefined)?.trim() ?? '';
  if (!content) {
    throw new Error('LLM 未返回词条内容');
  }

  const parsed = parseJsonFromLlm(content);
  return {
    word,
    translation: (parsed.translation as string | undefined) ?? '',
    phonetic: (parsed.phonetic as string | undefined) ?? '',
    audioUrl: '',
    collocations: ((parsed.collocations as string[] | undefined) ?? []).slice(0, 3),
    examples: ((parsed.examples as string[] | undefined) ?? []).slice(0, 2),
    provider: 'llm',
  };
}

export async function translateByLlm(
  config: ProviderConfig,
  sentence: string,
): Promise<SentenceTranslation> {
  const apiKey = config.apiKeys.llmApiKey;
  const endpoint = config.apiKeys.llmBaseUrl;
  const model = config.apiKeys.llmModel || 'deepseek-chat';
  if (!apiKey || !endpoint) {
    throw new Error('请在设置中填写 LLM key/baseUrl');
  }

  const payload = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: '将英文句子翻译为简体中文，只返回翻译文本。',
      },
      {
        role: 'user',
        content: sentence,
      },
    ],
  };

  const data = await requestJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const choices = (data.choices as JsonValue[] | undefined) ?? [];
  const message = (choices[0]?.message as JsonValue | undefined) ?? {};
  const translation = (message.content as string | undefined)?.trim() ?? '';
  if (!translation) {
    throw new Error('LLM 未返回句子翻译');
  }

  return {
    sentence,
    translation,
    provider: 'llm',
  };
}

export const providers = {
  lookupByYoudao,
  lookupByIciba,
  lookupByLlm,
  translateByYoudao,
  translateByIciba,
  translateByLlm,
};

export { mapYoudaoWordResponse, mapIcibaWordResponse };
