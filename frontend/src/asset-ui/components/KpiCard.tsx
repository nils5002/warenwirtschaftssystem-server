import type { LucideIcon } from 'lucide-react';

type KpiCardProps = {
  title: string;
  value: string;
  trend: string;
  tone: 'neutral' | 'positive' | 'warning' | 'critical';
  icon: LucideIcon;
};

const toneMap: Record<KpiCardProps['tone'], string> = {
  neutral: 'border-sky-300/30 bg-sky-500/10 text-sky-100',
  positive: 'border-emerald-300/30 bg-emerald-500/12 text-emerald-100',
  warning: 'border-amber-300/30 bg-amber-500/12 text-amber-100',
  critical: 'border-rose-300/30 bg-rose-500/12 text-rose-100',
};

export function KpiCard({ title, value, trend, tone, icon: Icon }: KpiCardProps) {
  return (
    <article className="surface-card group animate-fade-up rounded-2xl border border-slate-200/80 p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/75">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">{title}</p>
        <div className={`rounded-xl border p-2.5 ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">{trend}</p>
    </article>
  );
}
