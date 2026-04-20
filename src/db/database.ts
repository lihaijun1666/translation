import Database from '@tauri-apps/plugin-sql';
import type { FavoriteWord, ReaderDocument, WordDetail } from '../types';

let dbPromise: Promise<Database> | null = null;

async function setupSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE,
      phonetic TEXT,
      translation TEXT NOT NULL,
      audio_url TEXT,
      collocations TEXT NOT NULL,
      examples TEXT NOT NULL,
      source_sentence TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      document_id TEXT PRIMARY KEY,
      position REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:reader.db').then(async (db) => {
      await setupSchema(db);
      return db;
    });
  }

  return dbPromise;
}

function nowIso() {
  return new Date().toISOString();
}

function decodeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addOrUpdateFavorite(
  detail: WordDetail,
  sourceSentence: string,
): Promise<void> {
  const db = await getDb();
  const now = nowIso();

  await db.execute(
    `
      INSERT INTO favorites
      (word, phonetic, translation, audio_url, collocations, examples, source_sentence, provider, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      ON CONFLICT(word) DO UPDATE SET
        phonetic = excluded.phonetic,
        translation = excluded.translation,
        audio_url = excluded.audio_url,
        collocations = excluded.collocations,
        examples = excluded.examples,
        source_sentence = excluded.source_sentence,
        provider = excluded.provider,
        updated_at = excluded.updated_at;
    `,
    [
      detail.word,
      detail.phonetic ?? '',
      detail.translation,
      detail.audioUrl ?? '',
      JSON.stringify(detail.collocations),
      JSON.stringify(detail.examples),
      sourceSentence,
      detail.provider,
      now,
    ],
  );
}

export async function removeFavorite(word: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM favorites WHERE word = $1', [word]);
}

export async function isFavoriteWord(word: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    'SELECT COUNT(1) as count FROM favorites WHERE word = $1',
    [word],
  );
  const first = rows[0] as unknown as { count?: number };
  return Number(first?.count ?? 0) > 0;
}

export async function listFavorites(keyword = ''): Promise<FavoriteWord[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: number;
      word: string;
      phonetic: string;
      translation: string;
      audio_url: string;
      collocations: string;
      examples: string;
      source_sentence: string;
      provider: 'youdao' | 'iciba' | 'llm';
      created_at: string;
      updated_at: string;
    }>
  >(
    `
      SELECT *
      FROM favorites
      WHERE word LIKE $1 OR translation LIKE $1
      ORDER BY updated_at DESC;
    `,
    [`%${keyword}%`],
  );

  return rows.map((row) => ({
    id: row.id,
    word: row.word,
    phonetic: row.phonetic || undefined,
    translation: row.translation,
    audioUrl: row.audio_url || undefined,
    collocations: decodeJsonArray(row.collocations),
    examples: decodeJsonArray(row.examples),
    provider: row.provider,
    sourceSentence: row.source_sentence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function upsertDocument(document: ReaderDocument): Promise<void> {
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO documents (id, name, type, imported_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        imported_at = excluded.imported_at;
    `,
    [document.id, document.name, document.type, document.importedAt],
  );
}

export async function upsertReadingProgress(
  documentId: string,
  position: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO reading_progress (document_id, position, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT(document_id) DO UPDATE SET
        position = excluded.position,
        updated_at = excluded.updated_at;
    `,
    [documentId, position, nowIso()],
  );
}

export async function getReadingProgress(
  documentId: string,
): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<Array<{ position: number }>>(
    'SELECT position FROM reading_progress WHERE document_id = $1 LIMIT 1',
    [documentId],
  );

  if (!rows.length) {
    return null;
  }

  return Number(rows[0].position);
}
