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
  size?: 'sm' | 'md' | 'lg';
};

const sizeMap: Record<NonNullable<AssetVisualProps['size']>, string> = {
  sm: 'h-10 w-10 rounded-xl',
  md: 'h-12 w-12 rounded-2xl',
  lg: 'h-16 w-16 rounded-2xl',
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
  if (value.includes('laptop') || value.includes('notebook')) return 'bg-sky-500/12 text-sky-300 ring-sky-500/20';
  if (value.includes('ipad') || value.includes('tablet')) return 'bg-cyan-500/12 text-cyan-300 ring-cyan-500/20';
  if (value.includes('smartphone') || value.includes('handheld')) return 'bg-violet-500/12 text-violet-300 ring-violet-500/20';
  if (value.includes('scanner')) return 'bg-emerald-500/12 text-emerald-300 ring-emerald-500/20';
  if (value.includes('drucker')) return 'bg-amber-500/12 text-amber-300 ring-amber-500/20';
  if (value.includes('router') || value.includes('switch')) return 'bg-rose-500/12 text-rose-300 ring-rose-500/20';
  return 'bg-slate-500/12 text-slate-200 ring-white/10';
}

export function AssetVisual({ category, name, size = 'md' }: AssetVisualProps) {
  const Icon = getCategoryIcon(category);

  return (
    <div
      aria-hidden
      title={name || category || 'Asset'}
      className={`flex shrink-0 items-center justify-center border ${sizeMap[size]} ${getAccentClass(category)}`}
    >
      <Icon className={size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-[18px] w-[18px]' : 'h-5 w-5'} strokeWidth={1.8} />
    </div>
  );
}
