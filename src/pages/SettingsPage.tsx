import { useState } from 'react';
import type { ProviderConfig } from '../types';

interface SettingsPageProps {
  config: ProviderConfig;
  onSave: (config: ProviderConfig) => void;
}

export function SettingsPage({ config, onSave }: SettingsPageProps) {
  const [form, setForm] = useState<ProviderConfig>(config);
  const [message, setMessage] = useState('');

  function updateApiKey(key: string, value: string) {
    setForm((prev) => ({
      ...prev,
      apiKeys: {
        ...prev.apiKeys,
        [key]: value,
      },
    }));
  }

  return (
    <main className="settings-layout">
      <section className="settings-card">
        <h2 className="title">服务设置</h2>
        <p className="muted">
          支持有道/金山在线翻译，也支持 LLM（默认 DeepSeek）。可将 LLM 设为主服务或兜底服务。
        </p>
        <p className="muted">
          速度建议：查词场景优先选择 youdao/iciba 作为主 Provider，llm 作为回退；llm 作为主 Provider
          通常会慢很多。
        </p>

        <div className="form-grid">
          <label>
            主 Provider
            <select
              value={form.primaryProvider}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  primaryProvider: event.target.value as 'youdao' | 'iciba' | 'llm',
                }))
              }
            >
              <option value="youdao">youdao</option>
              <option value="iciba">iciba</option>
              <option value="llm">llm (DeepSeek/OpenAI-compatible)</option>
            </select>
          </label>

          <label>
            回退 Provider
            <select
              value={form.fallbackProvider}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  fallbackProvider: event.target.value as 'llm' | 'none',
                }))
              }
            >
              <option value="llm">llm</option>
              <option value="none">none</option>
            </select>
          </label>

          <label>
            youdaoAppKey
            <input
              value={form.apiKeys.youdaoAppKey ?? ''}
              onChange={(event) => updateApiKey('youdaoAppKey', event.target.value)}
            />
          </label>

          <label>
            youdaoAppSecret
            <input
              type="password"
              value={form.apiKeys.youdaoAppSecret ?? ''}
              onChange={(event) =>
                updateApiKey('youdaoAppSecret', event.target.value)
              }
            />
          </label>

          <label>
            icibaKey
            <input
              value={form.apiKeys.icibaKey ?? ''}
              onChange={(event) => updateApiKey('icibaKey', event.target.value)}
            />
          </label>

          <label>
            llmApiKey (DeepSeek API Key)
            <input
              type="password"
              value={form.apiKeys.llmApiKey ?? ''}
              onChange={(event) => updateApiKey('llmApiKey', event.target.value)}
            />
          </label>

          <label>
            youdaoEndpoint
            <input
              value={form.apiKeys.youdaoEndpoint ?? ''}
              onChange={(event) => updateApiKey('youdaoEndpoint', event.target.value)}
            />
          </label>

          <label>
            icibaDictEndpoint
            <input
              value={form.apiKeys.icibaDictEndpoint ?? ''}
              onChange={(event) =>
                updateApiKey('icibaDictEndpoint', event.target.value)
              }
            />
          </label>

          <label>
            icibaTranslateEndpoint
            <input
              value={form.apiKeys.icibaTranslateEndpoint ?? ''}
              onChange={(event) =>
                updateApiKey('icibaTranslateEndpoint', event.target.value)
              }
            />
          </label>

          <label>
            llmBaseUrl (DeepSeek endpoint)
            <input
              value={form.apiKeys.llmBaseUrl ?? ''}
              onChange={(event) => updateApiKey('llmBaseUrl', event.target.value)}
            />
          </label>

          <label>
            llmModel
            <input
              value={form.apiKeys.llmModel ?? ''}
              onChange={(event) => updateApiKey('llmModel', event.target.value)}
            />
          </label>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="button"
            onClick={() => {
              onSave(form);
              setMessage('设置已保存');
            }}
          >
            保存设置
          </button>
          {message ? <span className="muted">{message}</span> : null}
        </div>
      </section>
    </main>
  );
}
