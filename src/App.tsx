import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { armAudioKeepAlive } from './audio-utils';
import Dashboard from './pages/Dashboard';
import Calendar from './pages/Calendar';
import Reading from './pages/Reading';
import Listening from './pages/Listening';
import Resources from './pages/Resources';
import Speaking from './pages/Speaking';
import Writing from './pages/Writing';
import Dictation from './pages/Dictation';
import Spelling from './pages/Spelling';
import ErrorBook from './pages/ErrorBook';
import Mock from './pages/Mock';
import Settings from './pages/Settings';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '🎯' },
  { to: '/calendar', label: '65 天日曆', icon: '📅' },
  { to: '/reading', label: '閱讀訓練室', icon: '📖' },
  { to: '/listening', label: '聽力訓練室', icon: '👂' },
  { to: '/speaking', label: '口說訓練室', icon: '🎙️' },
  { to: '/writing', label: '寫作訓練室', icon: '✍️' },
  { to: '/dictation', label: '聽寫工房', icon: '🎧' },
  { to: '/spelling', label: '拼寫特訓', icon: '🔤' },
  { to: '/resources', label: '資源與配額', icon: '📦' },
  { to: '/errors', label: '錯誤本', icon: '📕' },
  { to: '/mock', label: '模考與週回顧', icon: '📈' },
  { to: '/settings', label: '設定', icon: '⚙️' },
];

export default function App() {
  // 第一次互動後啟動音訊保持喚醒,避免播放/TTS 開頭被裝置休眠吞掉
  useEffect(() => {
    const arm = () => armAudioKeepAlive();
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 w-52 bg-slate-900 text-slate-200 flex flex-col">
        <div className="px-4 py-5">
          <div className="text-lg font-bold text-white">TOEFL 備戰平台</div>
          <div className="text-xs text-slate-400 mt-1">9/19 首考·目標 4.5–5.0</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span className="text-base leading-none">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 text-[10px] text-slate-500">本地資料·記得定期匯出備份</div>
      </aside>
      <main className="ml-52 flex-1 p-6 max-w-6xl w-full">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/reading" element={<Reading />} />
          <Route path="/listening" element={<Listening />} />
          <Route path="/speaking" element={<Speaking />} />
          <Route path="/writing" element={<Writing />} />
          <Route path="/dictation" element={<Dictation />} />
          <Route path="/spelling" element={<Spelling />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/errors" element={<ErrorBook />} />
          <Route path="/mock" element={<Mock />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
