import { ReactNode, useEffect, useState } from 'react';

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export function Card({
  title,
  right,
  children,
  className = '',
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function ProgressBar({
  value,
  max,
  color = 'bg-brand-500',
  label,
}: {
  value: number;
  max: number;
  color?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>{label}</span>
          <span>
            {value}/{max}({pct}%)
          </span>
        </div>
      )}
      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** 短暫顯示的操作結果訊息 */
export function useToast(): [ReactNode, (msg: string, kind?: 'ok' | 'err') => void] {
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div
      className={`fixed bottom-5 right-5 z-50 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
        toast.kind === 'ok' ? 'bg-slate-800' : 'bg-rose-600'
      }`}
    >
      {toast.msg}
    </div>
  ) : null;
  return [node, (msg, kind = 'ok') => setToast({ msg, kind })];
}

export function Spinner({ text = '載入中...' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {text}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-slate-400">{text}</div>;
}
