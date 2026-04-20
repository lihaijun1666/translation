import { useEffect, useState } from 'react';
import { listFavorites, removeFavorite } from '../db/database';
import { lookupWordFromFallback } from '../services/translationService';
import { playWordPronunciation } from '../utils/audio';
import type { FavoriteWord, ProviderConfig } from '../types';

interface FavoritesPageProps {
  config: ProviderConfig;
}

interface FavoriteSupplement {
  phonetic?: string;
  audioUrl?: string;
  collocations?: string[];
  examples?: string[];
  attempted?: boolean;
}

function splitBilingual(value: string): { en: string; zh?: string } {
  const parts = value.split(/\s*[|｜]\s*/g).map((item) => item.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { en: value };
  }
  return { en: parts[0], zh: parts.slice(1).join(' | ') };
}

function applyFavoriteSupplement(
  item: FavoriteWord,
  supplement?: FavoriteSupplement,
): FavoriteWord {
  if (!supplement) {
    return item;
  }
  return {
    ...item,
    phonetic: item.phonetic || supplement.phonetic,
    audioUrl: item.audioUrl || supplement.audioUrl,
    collocations: item.collocations.length
      ? item.collocations
      : (supplement.collocations ?? item.collocations),
    examples: item.examples.length ? item.examples : (supplement.examples ?? item.examples),
  };
}

export function FavoritesPage({ config }: FavoritesPageProps) {
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<FavoriteWord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [supplementingId, setSupplementingId] = useState<number | null>(null);
  const [supplementById, setSupplementById] = useState<Record<number, FavoriteSupplement>>({});
  const [error, setError] = useState('');

  async function loadData(search = keyword): Promise<void> {
    try {
      setError('');
      const rows = await listFavorites(search.trim());
      setItems(rows);
      setSelectedId((previous) => {
        if (!rows.length) {
          return null;
        }
        if (previous !== null && rows.some((item) => item.id === previous)) {
          return previous;
        }
        return rows[0].id;
      });
    } catch (e) {
      setError((e as Error).message || '加载收藏失败');
    }
  }

  async function handleDelete(word: string): Promise<void> {
    await removeFavorite(word);
    await loadData(keyword);
  }

  useEffect(() => {
    void loadData('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const selected = items.find((item) => item.id === selectedId);
    if (!selected) {
      return;
    }
    if (config.fallbackProvider === 'none' || selected.provider === config.fallbackProvider) {
      return;
    }

    const merged = applyFavoriteSupplement(selected, supplementById[selected.id]);
    const needsFallback =
      !merged.phonetic
      || !merged.audioUrl
      || !merged.collocations.length
      || !merged.examples.length;
    if (!needsFallback || supplementById[selected.id]?.attempted) {
      return;
    }

    setSupplementById((previous) => ({
      ...previous,
      [selected.id]: {
        ...previous[selected.id],
        attempted: true,
      },
    }));
    setSupplementingId(selected.id);

    void (async () => {
      const fallback = await lookupWordFromFallback(
        config,
        selected.word,
        selected.sourceSentence || selected.word,
      );

      setSupplementById((previous) => {
        const current = previous[selected.id] ?? {};
        if (!fallback) {
          return {
            ...previous,
            [selected.id]: {
              ...current,
              attempted: true,
            },
          };
        }

        return {
          ...previous,
          [selected.id]: {
            ...current,
            attempted: true,
            phonetic: selected.phonetic || current.phonetic || fallback.phonetic,
            audioUrl: selected.audioUrl || current.audioUrl || fallback.audioUrl,
            collocations: selected.collocations.length
              ? selected.collocations
              : (current.collocations ?? fallback.collocations),
            examples: selected.examples.length
              ? selected.examples
              : (current.examples ?? fallback.examples),
          },
        };
      });
      setSupplementingId((previous) => (previous === selected.id ? null : previous));
    })();
  }, [config, items, selectedId, supplementById]);

  return (
    <main className="favorites-layout">
      <section className="favorites-header">
        <div>
          <h2 className="title">收藏单词</h2>
          <p className="muted">列表仅展示摘要，点击卡片可查看详情。数据仅保存在本机。</p>
        </div>
        <div className="favorites-actions">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索单词或释义"
          />
          <button
            type="button"
            className="button"
            onClick={() => {
              void loadData(keyword);
            }}
          >
            搜索
          </button>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {!items.length ? (
        <div className="empty-box">
          <p>暂无收藏记录。</p>
        </div>
      ) : (
        <ul className="favorite-list">
          {items.map((item) => {
            const isExpanded = selectedId === item.id;
            const detail = applyFavoriteSupplement(item, supplementById[item.id]);
            return (
              <li
                key={item.id}
                className={`favorite-card ${isExpanded ? 'favorite-card-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedId((previous) => (previous === item.id ? null : item.id));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId((previous) => (previous === item.id ? null : item.id));
                  }
                }}
              >
                <div className="favorite-title-row">
                  <div className="word-heading-main">
                    <h3>{item.word}</h3>
                    <span className="word-phonetic">
                      {detail.phonetic ? `[${detail.phonetic}]` : '[暂无音标]'}
                    </span>
                  </div>
                  <div className="favorite-row-actions">
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        playWordPronunciation(item.word, detail.audioUrl);
                      }}
                    >
                      播放发音
                    </button>
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(item.word);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>

                <p className="favorite-summary">{item.translation}</p>

                {isExpanded ? (
                  <section
                    className="favorite-detail-panel"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <div className="favorite-detail-actions">
                      <p className="muted">来源: {item.provider}</p>
                      {supplementingId === item.id ? <p className="muted">回退补全中...</p> : null}
                    </div>
                    <p className="muted">语境: {item.sourceSentence}</p>

                    <section>
                      <h5>常见搭配</h5>
                      <ul>
                        {detail.collocations.length ? (
                          detail.collocations.map((row, index) => {
                            const line = splitBilingual(row);
                            return (
                              <li key={`${row}-${index}`}>
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
                        {detail.examples.length ? (
                          detail.examples.map((row, index) => {
                            const line = splitBilingual(row);
                            return (
                              <li key={`${row}-${index}`}>
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
                  </section>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
