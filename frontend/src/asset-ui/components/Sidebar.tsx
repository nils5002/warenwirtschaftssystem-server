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
      <div className="mb-2.5 border-b border-slate-200/80 px-1 pb-2 dark:border-slate-800">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-600 dark:text-slate-300">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{caption}</p>
      </div>
      <div className="space-y-2">
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
              className={`group relative flex w-full items-center justify-between rounded-2xl px-3.5 py-3 text-left transition-all duration-200 ${
                active
                  ? 'border border-sky-200 bg-gradient-to-r from-sky-50 to-indigo-50 text-slate-900 shadow-sm ring-1 ring-sky-100 dark:border-sky-900/70 dark:from-sky-950/40 dark:to-indigo-950/40 dark:text-slate-100 dark:ring-sky-900/40'
                  : 'border border-transparent text-slate-700 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-100/90 hover:text-slate-900 hover:shadow-sm dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {active ? <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-sky-500/90" /> : null}
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`rounded-lg p-1.5 transition ${
                    active
                      ? 'bg-white/80 text-sky-700 shadow-sm dark:bg-slate-900/80 dark:text-sky-300'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-200'
                  }`}
                >
                  <item.icon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold leading-tight">{item.label}</span>
                  {item.hint ? (
                    <span className="block truncate pt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.hint}</span>
                  ) : null}
                </span>
              </span>
              {active ? <ChevronRight className="h-4.5 w-4.5 shrink-0 text-sky-600 dark:text-sky-300" /> : null}
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
        className={`fixed left-0 top-0 z-40 flex h-screen w-72 transform flex-col border-r border-slate-200/80 bg-white/90 p-4 shadow-panel backdrop-blur-xl transition-transform dark:border-slate-800 dark:bg-slate-950/90 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-indigo-600 shadow-sm">
                <Sparkles className="h-4.5 w-4.5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">Warenwirtschaftssystem</p>
                <p className="mt-0.5 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300">
                  Conventex
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900 md:hidden"
            onClick={onCloseMobile}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="soft-scrollbar flex-1 space-y-6 overflow-y-auto pr-1">
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

        <div className="mt-4 space-y-3 rounded-2xl border border-sky-200/70 bg-gradient-to-br from-slate-900 via-sky-900 to-indigo-900 p-3.5 text-slate-50 shadow-sm dark:border-slate-700">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-200">
            <Sparkles className="h-3.5 w-3.5" />
            Live Betrieb
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-white/10 bg-white/10 px-2.5 py-2.5">
              <p className="text-sky-100/90">Verfügbar</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.availableAssets}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/10 px-2.5 py-2.5">
              <p className="text-sky-100/90">Verliehen</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.loanedAssets}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/10 px-2.5 py-2.5">
              <p className="text-sky-100/90">Offene Tickets</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.openTickets}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/10 px-2.5 py-2.5">
              <p className="text-sky-100/90">Aktive Planungen</p>
              <p className="mt-0.5 text-base font-semibold text-white">{stats.activePlannings}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
