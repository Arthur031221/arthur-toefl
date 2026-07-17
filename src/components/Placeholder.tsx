import { PageTitle } from './ui';

export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <PageTitle title={title} />
      <div className="card py-16 text-center text-slate-400 text-sm">
        此模組於 {phase} 建置中,稍後就緒。
      </div>
    </div>
  );
}
