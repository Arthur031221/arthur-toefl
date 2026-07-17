import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';

// 兩種形態同一套程式碼:
//  - 預設(localhost 完整版):Express 後端、whisper、Claude CLI
//  - --mode static(GitHub Pages 網頁版):localStorage、Web Speech、直連 API
const isStatic = import.meta.env.MODE === 'static';
const App = lazy(() => import('./App'));
const StaticApp = lazy(() => import('./static/StaticApp'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="p-10 text-center text-sm text-slate-400">載入中...</div>}>
      {isStatic ? (
        <StaticApp />
      ) : (
        <HashRouter>
          <App />
        </HashRouter>
      )}
    </Suspense>
  </React.StrictMode>
);
