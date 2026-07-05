type ProgressBarProps = {
  // 0..1
  ratio: number;
  // Ampellogik optional von außen; ohne tone wird nach Auslastung gefärbt
  // (viel verfügbar = grün, knapp = amber, kritisch = rot) wie im Mockup
  // "Ressourcenlage & Engpässe".
  tone?: 'auto' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
};

const toneClass: Record<Exclude<ProgressBarProps['tone'], undefined | 'auto'>, string> = {
  primary: 'bg-primary',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

export function ProgressBar({ ratio, tone = 'auto', className = '' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const resolved =
    tone === 'auto' ? (clamped >= 0.6 ? 'success' : clamped >= 0.35 ? 'warning' : 'danger') : tone;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`} role="progressbar" aria-valuenow={Math.round(clamped * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] ${toneClass[resolved]}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}
