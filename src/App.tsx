import { NavLink, Route, Routes } from 'react-router-dom';
import { ReaderPage } from './pages/ReaderPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  loadProviderConfig,
  saveProviderConfig,
} from './services/settings';
import type { ProviderConfig } from './types';
import { useEffect, useState } from 'react';
import { getDb } from './db/database';

function App() {
  const [config, setConfig] = useState<ProviderConfig>(() => loadProviderConfig());

  useEffect(() => {
    void getDb();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>LexiRead</h1>
        <nav>
          <NavLink to="/" end>
            阅读器
          </NavLink>
          <NavLink to="/favorites">收藏</NavLink>
          <NavLink to="/settings">设置</NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<ReaderPage config={config} />} />
        <Route path="/favorites" element={<FavoritesPage config={config} />} />
        <Route
          path="/settings"
          element={
            <SettingsPage
              config={config}
              onSave={(nextConfig) => {
                saveProviderConfig(nextConfig);
                setConfig(nextConfig);
              }}
            />
          }
        />
      </Routes>
    </div>
  );
}

export default App;
