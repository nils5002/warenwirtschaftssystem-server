import type { LucideIcon } from 'lucide-react';

type KpiCardProps = {
  title: string;
  value: string;
  trend: string;
  tone: 'neutral' | 'positive' | 'warning' | 'critical';
  icon: LucideIcon;
};

// Icon-Tone: im Light Mode klar lesbar (Tone-700 auf Tone-50/100 Hintergrund),
// im Dark Mode wieder leichte Tone-Tönung mit hellem Icon. Vorher waren die
// Icons im Light Mode mit text-{tone}-100 nahezu unsichtbar auf weißem
// Surface-Card.
const toneMap: Record<KpiCardProps['tone'], string> = {
  neutral:
    'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700/40 dark:bg-sky-500/10 dark:text-sky-200',
  positive:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-500/10 dark:text-amber-200',
  critical:
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-500/10 dark:text-rose-200',
};

export function KpiCard({ title, value, trend, tone, icon: Icon }: KpiCardProps) {
  return (
    <article className="surface-card group animate-fade-up p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</p>
        <div className={`rounded-xl border p-2.5 ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">{trend}</p>
    </article>
  );
}
