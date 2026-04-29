import { ChevronRight, Sparkles, X } from 'lucide-react';
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

const groupMeta: Record<'operations' | 'administration', { title: string; caption: string }> = {
  operations: {
    title: 'Betrieb',
    caption: 'Lager, Einsatz und Tickets',
  },
  administration: {
    title: 'Verwaltung',
    caption: 'Stammdaten und Integrationen',
  },
};

function NavGroup({
  title,
  caption,
  items,
  activePage,
  onSelect,
  onCloseMobile,
}: {
  title: string;
  caption: string;
  items: NavItem[];
  activePage: AppPage;
  onSelect: (page: AppPage) => void;
  onCloseMobile: () => void;
}) {
  return (
    <div>
      <div className="mb-2 px-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{title}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{caption}</p>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => {
          const active = item.key === activePage;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.label}
              onClick={() => {
                onSelect(item.key);
                onCloseMobile();
              }}
              className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition ${
                active
                  ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-100'
                  : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`rounded-lg p-1.5 transition ${
                    active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.label}</span>
                  {item.hint ? <span className="block truncate text-[11px] text-slate-500">{item.hint}</span> : null}
                </span>
              </span>
              {active ? <ChevronRight className="h-4 w-4 shrink-0" /> : null}
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
        className={`fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm transition md:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onCloseMobile}
      />

      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-72 transform flex-col border-r border-slate-200/80 bg-white/90 p-4 shadow-panel backdrop-blur-xl transition-transform md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">AtlasOps</p>
            <h1 className="text-xl font-semibold text-slate-900">Hardware WMS</h1>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={onCloseMobile}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="soft-scrollbar flex-1 space-y-5 overflow-y-auto pr-1">
          <NavGroup
            title={groupMeta.operations.title}
            caption={groupMeta.operations.caption}
            items={operations}
            activePage={activePage}
            onSelect={onSelect}
            onCloseMobile={onCloseMobile}
          />
          <NavGroup
            title={groupMeta.administration.title}
            caption={groupMeta.administration.caption}
            items={administration}
            activePage={activePage}
            onSelect={onSelect}
            onCloseMobile={onCloseMobile}
          />
        </div>

        <div className="mt-4 space-y-2.5 rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-700 to-brand-500 p-3.5 text-brand-50">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-100">
            <Sparkles className="h-3.5 w-3.5" />
            Live Betrieb
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-white/15 px-2 py-2">
              <p className="text-brand-100">Verfügbar</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.availableAssets}</p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-2">
              <p className="text-brand-100">Verliehen</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.loanedAssets}</p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-2">
              <p className="text-brand-100">Offene Tickets</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.openTickets}</p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-2">
              <p className="text-brand-100">Aktive Planungen</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.activePlannings}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
