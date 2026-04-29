import type { LucideIcon } from 'lucide-react';

type KpiCardProps = {
  title: string;
  value: string;
  trend: string;
  tone: 'neutral' | 'positive' | 'warning' | 'critical';
  icon: LucideIcon;
};

const toneMap: Record<KpiCardProps['tone'], string> = {
  neutral: 'bg-slate-900 text-slate-100',
  positive: 'bg-emerald-600 text-emerald-50',
  warning: 'bg-amber-500 text-amber-50',
  critical: 'bg-rose-600 text-rose-50',
};

export function KpiCard({ title, value, trend, tone, icon: Icon }: KpiCardProps) {
  return (
    <article className="surface-card group animate-fade-up p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-500">{title}</p>
        <div className={`rounded-xl p-2 ${toneMap[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1.5 text-xs font-medium text-slate-500">{trend}</p>
    </article>
  );
}
