# Translation Reader (Tauri + React)

MVP desktop reader for English materials:
- Import `PDF` / `TXT`
- Double-click word to lookup translation, phonetic, collocations, examples
- Click sentence to translate (`en -> zh-CN`)
- Save/remove favorite words and browse them in Favorites page
- Local-only persistence (SQLite)

## Stack
- Frontend: React + TypeScript + Vite
- Desktop shell: Tauri v2
- Local DB: `@tauri-apps/plugin-sql` (SQLite)
- Networking: `@tauri-apps/plugin-http`

## Run
```bash
npm install
npm run tauri:dev
```

## Build
```bash
npm run build
npm run tauri:build
```

After `tauri:build`, install the generated Windows installer.
It registers `.pdf` / `.txt` file associations so the app can appear in "Open with"
and launch directly by double-clicking associated files.

## Quality checks
```bash
npm run lint
npm test
```

## Provider setup
Open `Settings` page and fill keys/endpoints:
- `youdaoAppKey`, `youdaoAppSecret`
- `icibaKey` (optional if not primary)
- `llmApiKey`, `llmBaseUrl`, `llmModel` (DeepSeek / OpenAI-compatible)

You can choose `youdao`, `iciba`, or `llm` as primary provider.
Default LLM preset is DeepSeek:
- `llmBaseUrl`: `https://api.deepseek.com/chat/completions`
- `llmModel`: `deepseek-chat`
