import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Card, PageTitle, Spinner, useToast } from '../components/ui';
import type { SystemStatus } from '../types';

interface Template {
  key: string;
  title: string;
  template: string;
  default_template: string;
}

interface SettingsData {
  settings: Record<string, string>;
  paths: { data: string; recordings: string; db: string };
}

export default function Settings() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [data, setData] = useState<SettingsData | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [provider, setProvider] = useState<'cli' | 'api'>('cli');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [testing, setTesting] = useState<'cli' | 'api' | null>(null);
  const [testResult, setTestResult] = useState('');
  const [editingTpl, setEditingTpl] = useState<string | null>(null);
  const [tplText, setTplText] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async (refresh = false) => {
    const [st, se, tp] = await Promise.all([
      api.get<SystemStatus>(`/api/system/status${refresh ? '?refresh=1' : ''}`),
      api.get<SettingsData>('/api/settings'),
      api.get<Template[]>('/api/ai/templates'),
    ]);
    setStatus(st);
    setData(se);
    setTemplates(tp);
    setProvider(se.settings.ai_provider === 'api' ? 'api' : 'cli');
    setModel(se.settings.anthropic_model || 'claude-sonnet-4-6');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProvider(p: 'cli' | 'api') {
    await api.put('/api/ai/provider', { provider: p, model });
    setProvider(p);
    showToast(`已切換到 ${p === 'cli' ? 'Claude Code CLI(訂閱,零額外費用)' : 'Anthropic API'}`);
  }

  async function test(p: 'cli' | 'api') {
    setTesting(p);
    setTestResult('');
    try {
      const r = await api.post<{ reply: string; ms: number }>('/api/ai/test', { provider: p });
      setTestResult(`✓ ${p === 'cli' ? 'CLI' : 'API'} 連線成功:「${r.reply.trim()}」(${(r.ms / 1000).toFixed(1)} 秒)`);
    } catch (e) {
      setTestResult(`✗ ${(e as Error).message}`);
    } finally {
      setTesting(null);
    }
  }

  async function saveTemplate(key: string) {
    await api.put(`/api/ai/templates/${key}`, { template: tplText });
    showToast('模板已儲存');
    setEditingTpl(null);
    load();
  }

  async function resetTemplate(key: string) {
    if (!confirm('還原成預設模板?')) return;
    await api.post(`/api/ai/templates/${key}/reset`);
    showToast('已還原預設');
    setEditingTpl(null);
    load();
  }

  function exportData() {
    window.open('/api/export', '_blank');
  }

  async function importData() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      showToast('請先選擇備份 JSON 檔', 'err');
      return;
    }
    if (!confirm('匯入會覆蓋現有全部資料(匯入前會自動備份現有 DB)。確定?')) return;
    setImporting(true);
    try {
      const text = await f.text();
      const payload = JSON.parse(text);
      const r = await api.post<{ counts: Record<string, number>; backupPath: string }>('/api/import', payload);
      const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
      showToast(`匯入完成(${total} 筆)。原資料備份於 ${r.backupPath}`);
      load();
    } catch (e) {
      showToast(`匯入失敗:${(e as Error).message}`, 'err');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function openFolder(which: 'recordings' | 'data') {
    const r = await api.post<{ path: string }>('/api/settings/open-folder', { which });
    showToast(`資料夾:${r.path}(若沒自動開啟請手動前往)`);
  }

  if (!status || !data) return <Spinner />;

  const ok = (b: boolean) => (b ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700');

  return (
    <div className="space-y-4">
      {toast}
      <PageTitle title="設定" sub="AI provider·系統偵測·prompt 模板·資料備份" />

      <Card
        title="系統偵測"
        right={
          <button className="btn-secondary" onClick={() => load(true)}>
            重新偵測
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span>ffmpeg(口說三指標)</span>
            <span className={`badge ${ok(status.ffmpeg)}`}>{status.ffmpeg ? status.ffmpegVersion.split(' ').slice(0, 3).join(' ') : '未安裝'}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span>faster-whisper(本地轉錄)</span>
            <span className={`badge ${ok(status.whisper !== 'none')}`}>
              {status.whisper === 'none' ? '未安裝(可用瀏覽器轉錄/手動貼)' : `可用(${status.whisper === 'venv' ? 'app/.venv' : '系統 Python'})`}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span>Claude Code CLI(Provider A)</span>
            <span className={`badge ${ok(status.claudeCli)}`}>{status.claudeCli ? status.claudeCliVersion : '找不到 claude 指令'}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span>ANTHROPIC_API_KEY(Provider B)</span>
            <span className={`badge ${ok(status.apiKey)}`}>{status.apiKey ? '已設定' : '未設定(.env)'}</span>
          </div>
        </div>
      </Card>

      <Card title="AI Provider">
        <div className="space-y-2">
          <label
            className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${provider === 'cli' ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
          >
            <input type="radio" checked={provider === 'cli'} onChange={() => saveProvider('cli')} className="mt-1" />
            <div className="flex-1">
              <div className="font-medium text-slate-800">
                A|Claude Code CLI(預設)
                {!status.claudeCli && <span className="ml-2 badge bg-rose-100 text-rose-600">未偵測到,請改用 B</span>}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">用你已登入的 Claude 訂閱,零額外費用。批改約 30–60 秒。</div>
            </div>
            <button className="btn-secondary" disabled={testing !== null} onClick={(e) => { e.preventDefault(); test('cli'); }}>
              {testing === 'cli' ? '測試中...' : '連線測試'}
            </button>
          </label>
          <label
            className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${provider === 'api' ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
          >
            <input type="radio" checked={provider === 'api'} onChange={() => saveProvider('api')} className="mt-1" />
            <div className="flex-1">
              <div className="font-medium text-slate-800">B|Anthropic API</div>
              <div className="text-xs text-slate-500 mt-0.5">
                需在 app/.env 設 ANTHROPIC_API_KEY(參考 .env.example),依用量計費,回應較快。
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="label">模型</span>
                <input
                  className="input w-64 text-xs"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={() => provider === 'api' && saveProvider('api')}
                />
              </div>
            </div>
            <button className="btn-secondary" disabled={testing !== null} onClick={(e) => { e.preventDefault(); test('api'); }}>
              {testing === 'api' ? '測試中...' : '連線測試'}
            </button>
          </label>
          {testResult && (
            <div className={`rounded-lg px-3 py-2 text-sm ${testResult.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {testResult}
            </div>
          )}
        </div>
      </Card>

      <Card title="AI 批改 prompt 模板(存 DB,可編輯)">
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-800">
                  {t.title}
                  <span className="ml-2 text-xs text-slate-400 font-mono">{t.key}</span>
                  {t.template !== t.default_template && <span className="ml-2 badge bg-amber-100 text-amber-700">已自訂</span>}
                </div>
                <div className="flex gap-1.5">
                  {editingTpl === t.key ? (
                    <>
                      <button className="btn-primary text-xs" onClick={() => saveTemplate(t.key)}>
                        儲存
                      </button>
                      <button className="btn-secondary text-xs" onClick={() => setEditingTpl(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => {
                        setEditingTpl(t.key);
                        setTplText(t.template);
                      }}
                    >
                      編輯
                    </button>
                  )}
                  <button className="btn-ghost text-xs" onClick={() => resetTemplate(t.key)}>
                    還原預設
                  </button>
                </div>
              </div>
              {editingTpl === t.key && (
                <textarea
                  className="input w-full mt-2 font-mono text-xs"
                  rows={8}
                  value={tplText}
                  onChange={(e) => setTplText(e.target.value)}
                />
              )}
            </div>
          ))}
          <div className="text-xs text-slate-400">
            佔位符:{'{prompt}'}/{'{answer}'}(寫作)、{'{question}'}/{'{transcript}'}(口說)、{'{exclude}'}(出題)。模板要求 AI 回傳 JSON,改動時請保留 JSON 格式說明。
          </div>
        </div>
      </Card>

      <Card title="資料備份">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={exportData}>
            ⬇ 匯出全部資料(JSON)
          </button>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".json,application/json" className="text-sm" />
            <button className="btn-danger" onClick={importData} disabled={importing}>
              {importing ? '匯入中...' : '⬆ 匯入還原'}
            </button>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-400">
          匯出含全部練習紀錄/勾選狀態/錯誤本/設定;錄音音檔請另外備份 data/recordings。匯入前會自動備份現有資料。
        </div>
      </Card>

      <Card title="資料位置">
        <div className="space-y-1.5 text-sm">
          {(
            [
              ['資料庫', data.paths.db, 'data'],
              ['錄音資料夾', data.paths.recordings, 'recordings'],
            ] as const
          ).map(([label, p, which]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="label w-24">{label}</span>
              <code className="flex-1 rounded bg-slate-100 px-2 py-1 text-xs">{p}</code>
              <button className="btn-secondary text-xs" onClick={() => openFolder(which)}>
                開啟資料夾
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
