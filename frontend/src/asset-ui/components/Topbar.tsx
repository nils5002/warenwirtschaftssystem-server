import { Bell, ChevronRight, CircleHelp, LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import type { AppPage, AppRole } from '../types';

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
  activePage: AppPage;
  activeLabel: string;
  activeHint?: string;
  compact?: boolean;
};

const BREADCRUMB_MAP: Record<AppPage, [string, string]> = {
  dashboard: ['Betrieb', 'Dashboard'],
  planning: ['Betrieb', 'Einsatzplanung'],
  inventory: ['Lager', 'Inventar'],
  externalPool: ['Lager', 'Fremdbestand'],
  assetDetail: ['Lager', 'Inventar / Detail'],
  checkinCheckout: ['Lager', 'Ein-/Auslagerung'],
  tickets: ['Tickets', 'Defekte / Tickets'],
  users: ['Verwaltung', 'Benutzerverwaltung'],
  categories: ['Verwaltung', 'Kategorien'],
  importExport: ['System', 'Import / Export'],
  backup: ['System', 'Backup'],
  qrFunctions: ['System', 'QR-Code'],
  massPrint: ['System', 'Massendruck'],
};

// Tailwind-Klassen für Icon-Buttons innerhalb der gruppierten Capsule rechts.
// Eigene Klasse statt btn-secondary, damit die Buttons OHNE eigene Border /
// Hintergrund auskommen — die Capsule liefert beides einmalig drumherum.
const ICON_CAPSULE_BUTTON =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition ' +
  'hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ' +
  'dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-slate-100';

const ICON_CAPSULE_DIVIDER = 'h-5 w-px bg-slate-200/80 dark:bg-slate-700/70';

function buildInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase() || 'U';
}

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
  activePage,
  activeLabel,
  activeHint,
  compact = false,
}: TopbarProps) {
  const [crumbGroup, crumbPage] = BREADCRUMB_MAP[activePage] ?? ['Betrieb', 'Dashboard'];
  const initials = buildInitials(userName);
  const themeToggleLabel = theme === 'dark' ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln';

  if (compact) {
    return (
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/95 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className="btn-secondary h-11 w-11 p-0" onClick={onMenuOpen} aria-label="Menü öffnen">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700 dark:text-sky-400">
                {crumbGroup}
              </p>
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{activeLabel}</p>
            </div>
          </div>

          {/* Mobile-Right: Theme + Profil-Avatar + Logout — gleicher Capsule-Stil wie Desktop. */}
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-xl border border-slate-200/80 bg-white/80 p-1 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
              <button
                type="button"
                onClick={onToggleTheme}
                title={themeToggleLabel}
                aria-label={themeToggleLabel}
                className={ICON_CAPSULE_BUTTON}
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <span className={ICON_CAPSULE_DIVIDER} aria-hidden />
              <button
                type="button"
                onClick={onOpenProfile}
                aria-label="Profil"
                className={`${ICON_CAPSULE_BUTTON} font-semibold`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-[11px] font-bold text-white shadow-sm">
                  {initials}
                </span>
              </button>
            </div>
            <button
              type="button"
              onClick={onLogout}
              title="Abmelden"
              aria-label="Abmelden"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/85 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto grid max-w-[1600px] gap-3 px-3 py-3 sm:px-4 md:grid-cols-[minmax(240px,auto)_minmax(320px,1fr)_auto] md:items-center md:gap-5 md:px-8 md:py-3.5">
        {/* LINKS: Branding + Breadcrumb + aktive Seite */}
        <div className="flex min-w-0 items-start gap-2.5 md:gap-3">
          <button
            type="button"
            className="btn-secondary mt-0.5 p-2.5 md:hidden"
            onClick={onMenuOpen}
            aria-label="Menü öffnen"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-sky-400">
              Warenwirtschaftssystem Conventex
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium">{crumbGroup}</span>
              <ChevronRight className="h-3 w-3 text-slate-400 dark:text-slate-500" />
              <span className="font-semibold text-slate-700 dark:text-slate-200">{crumbPage}</span>
            </div>
            <p className="mt-0.5 truncate text-base font-semibold text-slate-900 dark:text-slate-100 sm:text-lg">
              {activeLabel}
            </p>
            {activeHint ? (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{activeHint}</p>
            ) : null}
          </div>
        </div>

        {/* MITTE: Suche + Rollen-Pille + Projektkontext in EINER Reihe.
            Auf schmaleren Screens umbruchfähig — Touch-Größen bleiben groß. */}
        <div className="min-w-0">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative flex-1 min-w-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                aria-hidden
              />
              <input
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                placeholder="Suchen nach Asset, Ticket, Inventarnummer oder Team..."
                aria-label="Suche"
                className="h-10 w-full rounded-xl border border-slate-200/80 bg-white/90 pl-10 pr-3 text-sm text-slate-800 shadow-sm outline-none ring-brand-300 transition placeholder:text-slate-400 focus:ring-2 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <div className="flex items-center gap-2">
              {/* Rollen-Pille: dezenter Indikator, gut lesbar im Dark Mode. */}
              <span
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 text-xs font-semibold text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-200"
                title={`Aktive Rolle: ${activeRole}`}
              >
                <span className="hidden h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-300 sm:block" aria-hidden />
                <span className="text-[11px] font-medium uppercase tracking-wider opacity-70">Rolle</span>
                <span>{activeRole}</span>
              </span>

              {/* Projektkontext: optional, immer im Layoutfluss — auf sehr
                  schmalen Screens unter die Pille umbrechen. */}
              <input
                className="h-10 w-full max-w-[220px] rounded-xl border border-slate-200/80 bg-white/90 px-3 text-xs text-slate-700 outline-none ring-brand-300 transition placeholder:text-slate-400 focus:ring-2 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200 dark:placeholder:text-slate-500"
                placeholder="Projektkontext (optional)"
                value={projectContext}
                onChange={(event) => onProjectContextChange(event.target.value)}
                aria-label="Projektkontext"
              />
            </div>
          </div>
        </div>

        {/* RECHTS: Icon-Capsule (Theme | Hilfe | Benachrichtigungen) +
            Profil-Capsule + dezenter Logout. */}
        <div className="flex items-center justify-end gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-xl border border-slate-200/80 bg-white/80 p-1 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
            <button
              type="button"
              onClick={onToggleTheme}
              title={themeToggleLabel}
              aria-label={themeToggleLabel}
              className={ICON_CAPSULE_BUTTON}
            >
              {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
            </button>
            <span className={ICON_CAPSULE_DIVIDER} aria-hidden />
            <button
              type="button"
              onClick={onOpenHelp}
              title="Hilfe"
              aria-label="Hilfe"
              className={`${ICON_CAPSULE_BUTTON} hidden sm:inline-flex`}
            >
              <CircleHelp className="h-4.5 w-4.5" />
            </button>
            <span className={`${ICON_CAPSULE_DIVIDER} hidden sm:block`} aria-hidden />
            <button
              type="button"
              onClick={onOpenNotifications}
              title="Benachrichtigungen"
              aria-label="Benachrichtigungen"
              className={`${ICON_CAPSULE_BUTTON} relative`}
            >
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sky-500 ring-2 ring-white dark:ring-slate-900" aria-hidden />
            </button>
          </div>

          {/* Profil-Capsule: Avatar + Name + Rolle (Name/Rolle ab lg sichtbar
              statt erst ab xl — bessere Nutzung der Desktop-Breite). */}
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={`Profil ${userName}`}
            className="inline-flex h-10 items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/80 px-2 py-1 shadow-sm backdrop-blur transition hover:border-brand-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 dark:border-slate-700/70 dark:bg-slate-900/70 dark:hover:border-brand-500/60 dark:hover:bg-slate-900"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-[11px] font-bold text-white shadow-sm ring-1 ring-white/60 dark:ring-slate-900/60">
              {initials}
            </span>
            <span className="hidden text-left leading-tight lg:block">
              <span className="block max-w-[160px] truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                {userName}
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {activeRole}
              </span>
            </span>
          </button>

          {/* Logout: dezent, aber jederzeit erreichbar. Icon-only auf kleinen
              Screens, mit Text ab md. Hover signalisiert Destruktion via Rosa. */}
          <button
            type="button"
            onClick={onLogout}
            title="Abmelden"
            aria-label="Abmelden"
            className="inline-flex h-10 items-center gap-2 rounded-xl px-2.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 md:px-3"
          >
            <LogOut className="h-4.5 w-4.5" />
            <span className="hidden text-xs font-medium md:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
