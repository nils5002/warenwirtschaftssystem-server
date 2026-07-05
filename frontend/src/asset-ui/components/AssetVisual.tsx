import {
  Boxes,
  HardDrive,
  Laptop,
  MonitorSmartphone,
  Package,
  Printer,
  Router,
  ScanLine,
  Smartphone,
  TabletSmartphone,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

type AssetVisualProps = {
  category?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const sizeMap: Record<NonNullable<AssetVisualProps['size']>, string> = {
  sm: 'h-14 w-14 rounded-2xl',
  md: 'h-16 w-16 rounded-[20px]',
  lg: 'h-48 w-48 rounded-[28px]',
  xl: 'h-56 w-56 rounded-[32px]',
};

function getCategoryIcon(category?: string): LucideIcon {
  const value = (category ?? '').trim().toLowerCase();
  if (value.includes('laptop') || value.includes('notebook')) return Laptop;
  if (value.includes('ipad') || value.includes('tablet')) return TabletSmartphone;
  if (value.includes('smartphone') || value.includes('handy')) return Smartphone;
  if (value.includes('scanner')) return ScanLine;
  if (value.includes('drucker')) return Printer;
  if (value.includes('router')) return Router;
  if (value.includes('switch')) return Waypoints;
  if (value.includes('dock') || value.includes('monitor')) return MonitorSmartphone;
  if (value.includes('server') || value.includes('storage') || value.includes('nas')) return HardDrive;
  if (value.includes('zubehör')) return Package;
  return Boxes;
}

function getAccentClass(category?: string): string {
  const value = (category ?? '').trim().toLowerCase();
  if (value.includes('laptop') || value.includes('notebook')) return 'bg-sky-500/18 ring-sky-400/25';
  if (value.includes('ipad') || value.includes('tablet')) return 'bg-cyan-500/18 ring-cyan-400/25';
  if (value.includes('smartphone') || value.includes('handheld')) return 'bg-violet-500/18 ring-violet-400/25';
  if (value.includes('scanner')) return 'bg-emerald-500/18 ring-emerald-400/25';
  if (value.includes('drucker')) return 'bg-amber-500/18 ring-amber-400/25';
  if (value.includes('router') || value.includes('switch')) return 'bg-rose-500/18 ring-rose-400/25';
  return 'bg-slate-500/18 ring-white/10';
}

function getIconToneClass(category?: string): string {
  const value = (category ?? '').trim().toLowerCase();
  if (value.includes('laptop') || value.includes('notebook')) return 'text-sky-200';
  if (value.includes('ipad') || value.includes('tablet')) return 'text-cyan-200';
  if (value.includes('smartphone') || value.includes('handheld')) return 'text-violet-200';
  if (value.includes('scanner')) return 'text-emerald-200';
  if (value.includes('drucker')) return 'text-amber-200';
  if (value.includes('router') || value.includes('switch')) return 'text-rose-200';
  return 'text-slate-100';
}

export function AssetVisual({ category, name, size = 'md' }: AssetVisualProps) {
  const Icon = getCategoryIcon(category);
  const iconClass =
    size === 'xl'
      ? 'h-16 w-16'
      : size === 'lg'
        ? 'h-12 w-12'
        : size === 'md'
          ? 'h-7 w-7'
          : 'h-6 w-6';

  return (
    <div
      aria-hidden
      title={name || category || 'Asset'}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${sizeMap[size]}`}
    >
      <div
        className={`absolute inset-[14%] rounded-[inherit] ring-1 ${getAccentClass(category)}`}
      />
      <Icon className={`relative z-[1] ${iconClass} ${getIconToneClass(category)}`} strokeWidth={1.8} />
    </div>
  );
}
