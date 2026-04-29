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
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/85 backdrop-blur-xl">
      <div className="mx-auto grid max-w-[1600px] gap-2 px-3 py-3 sm:px-4 md:grid-cols-[auto_1fr_auto] md:items-center md:px-8 md:py-3.5">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary p-2 md:hidden" onClick={onMenuOpen}>
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
              Aktiver Bereich
            </p>
            <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">{activeLabel}</p>
            {activeHint ? <p className="truncate text-xs text-slate-500">{activeHint}</p> : null}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Suchen nach Asset, Ticket, Inventarnummer oder Team..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none ring-brand-300 placeholder:text-slate-400 focus:ring-2"
          />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 flex items-center">
              Rolle: {activeRole}
            </div>
            <input
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
              placeholder="Projektkontext (optional)"
              value={projectContext}
              onChange={(event) => onProjectContextChange(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln'}
            aria-label={theme === 'dark' ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln'}
            className="btn-secondary p-2"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button type="button" onClick={onOpenHelp} className="btn-secondary hidden p-2 sm:inline-flex">
            <CircleHelp className="h-4 w-4" />
          </button>
          <button type="button" onClick={onOpenNotifications} className="btn-secondary relative p-2">
            <Bell className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500" />
          </button>

          <button type="button" onClick={onOpenProfile} className="btn-secondary px-2 py-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-700 text-[11px] font-bold text-white">
              {userName
                .split(' ')
                .map((part) => part[0] || '')
                .join('')
                .slice(0, 2)
                .toUpperCase() || 'U'}
            </div>
            <div className="hidden text-left lg:block">
              <p className="text-xs font-semibold text-slate-900">{userName}</p>
              <p className="text-[11px] text-slate-500">{activeRole}</p>
            </div>
          </button>
          <button type="button" onClick={onLogout} className="btn-secondary px-2 py-1.5">
            <LogOut className="h-4 w-4" />
            <span className="hidden text-xs lg:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
