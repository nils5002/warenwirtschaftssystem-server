import { Bell, CircleHelp, LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import type { AppRole } from '../types';

type TopbarProps = {
  search: string;
  onSearch: (value: string) => void;
  onMenuOpen: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeRole: AppRole;
  userName: string;
  projectContext: string;
  onProjectContextChange: (value: string) => void;
  onOpenHelp: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  activeLabel: string;
  activeHint?: string;
};

export function Topbar({
  search,
  onSearch,
  onMenuOpen,
  theme,
  onToggleTheme,
  activeRole,
  userName,
  projectContext,
  onProjectContextChange,
  onOpenHelp,
  onOpenNotifications,
  onOpenProfile,
  onLogout,
  activeLabel,
  activeHint,
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/90 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto grid max-w-[1600px] gap-3 px-3 py-3.5 sm:px-4 md:grid-cols-[minmax(240px,auto)_minmax(300px,1fr)_auto] md:items-start md:gap-4 md:px-8 md:py-4">
        <div className="flex min-w-0 items-start gap-2.5 md:gap-3">
          <button type="button" className="btn-secondary mt-0.5 p-2.5 md:hidden" onClick={onMenuOpen}>
            <Menu className="h-4.5 w-4.5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-brand-700 dark:text-sky-400">
              Warenwirtschaftssystem Konventex
            </p>
            <p className="mt-0.5 truncate text-base font-semibold text-slate-900 dark:text-slate-100 sm:text-lg">
              {activeLabel}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{activeHint || 'Aktiver Bereich'}</p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Suchen nach Asset, Ticket, Inventarnummer oder Team..."
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 shadow-sm outline-none ring-brand-300 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-[auto_1fr]">
            <div className="inline-flex h-9 items-center rounded-full border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-700 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-300">
              Rolle: {activeRole}
            </div>
            <input
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none ring-brand-300 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
              placeholder="Projektkontext (optional)"
              value={projectContext}
              onChange={(event) => onProjectContextChange(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln'}
            aria-label={theme === 'dark' ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln'}
            className="btn-secondary h-10 w-10 p-0"
          >
            {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          </button>

          <button type="button" onClick={onOpenHelp} className="btn-secondary hidden h-10 w-10 p-0 sm:inline-flex">
            <CircleHelp className="h-4.5 w-4.5" />
          </button>
          <button type="button" onClick={onOpenNotifications} className="btn-secondary relative h-10 w-10 p-0">
            <Bell className="h-4.5 w-4.5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-sky-500" />
          </button>

          <button type="button" onClick={onOpenProfile} className="btn-secondary h-10 px-2.5 py-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-700 text-[11px] font-bold text-white shadow-sm">
              {userName
                .split(' ')
                .map((part) => part[0] || '')
                .join('')
                .slice(0, 2)
                .toUpperCase() || 'U'}
            </div>
            <div className="hidden text-left xl:block">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{userName}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{activeRole}</p>
            </div>
          </button>
          <button type="button" onClick={onLogout} className="btn-secondary h-10 px-3 py-1.5">
            <LogOut className="h-4 w-4" />
            <span className="text-xs font-medium">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
