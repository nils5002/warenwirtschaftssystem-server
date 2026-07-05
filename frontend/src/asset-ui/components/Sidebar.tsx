import { Boxes, X } from 'lucide-react';
import type { AppPage, NavItem } from '../types';

type SidebarStats = {
  availableAssets: number;
  loanedAssets: number;
  openTickets: number;
  activePlannings: number;
};

type SidebarProps = {
  items: NavItem[];
  activePage: AppPage;
  onSelect: (page: AppPage) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  stats: SidebarStats;
};

const groupMeta: Record<'operations' | 'administration', { title: string }> = {
  operations: { title: 'Hauptmenü' },
  administration: { title: 'Verwaltung' },
};

function NavGroup({
  title,
  items,
  activePage,
  onSelect,
  onCloseMobile,
}: {
  title: string;
  items: NavItem[];
  activePage: AppPage;
  onSelect: (page: AppPage) => void;
  onCloseMobile: () => void;
}) {
  return (
    <div>
      <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.15em] text-ink-faint">{title}</p>
      <div className="space-y-1">
        {items.map((item) => {
          const active = item.key === activePage;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.label}
              title={item.hint}
              onClick={() => {
                onSelect(item.key);
                onCloseMobile();
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                active
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : ''}`} />
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar({ items, activePage, onSelect, mobileOpen, onCloseMobile, stats }: SidebarProps) {
  const operations = items.filter((item) => (item.group ?? 'operations') === 'operations');
  const administration = items.filter((item) => item.group === 'administration');

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/50 transition md:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onCloseMobile}
      />

      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-72 transform flex-col border-r border-line bg-surface p-4 transition-transform md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-5 flex items-center justify-between border-b border-line pb-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm">
              <Boxes className="h-[18px] w-[18px] text-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">Warenwirtschaftssystem</p>
              <p className="truncate text-[11px] text-ink-faint">Hardware Management · Conventex</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 md:hidden"
            onClick={onCloseMobile}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="soft-scrollbar flex-1 space-y-6 overflow-y-auto pr-1">
          <NavGroup
            title={groupMeta.operations.title}
            items={operations}
            activePage={activePage}
            onSelect={onSelect}
            onCloseMobile={onCloseMobile}
          />
          <NavGroup
            title={groupMeta.administration.title}
            items={administration}
            activePage={activePage}
            onSelect={onSelect}
            onCloseMobile={onCloseMobile}
          />
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-3.5">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            Live Betrieb
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-line bg-surface px-2.5 py-2">
              <p className="text-ink-faint">Verfügbar</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stats.availableAssets}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface px-2.5 py-2">
              <p className="text-ink-faint">Verliehen</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stats.loanedAssets}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface px-2.5 py-2">
              <p className="text-ink-faint">Offene Tickets</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stats.openTickets}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface px-2.5 py-2">
              <p className="text-ink-faint">Aktive Planungen</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stats.activePlannings}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
