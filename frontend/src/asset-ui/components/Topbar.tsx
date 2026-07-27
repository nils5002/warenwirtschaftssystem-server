import { useEffect, useRef, useState } from 'react';
import { Bell, Check, CircleHelp, LogOut, Menu, Moon, Palette, Search, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppPage, AppRole } from '../types';
import { type Theme } from '../../hooks/useTheme';

type TopbarProps = {
  search: string;
  onSearch: (value: string) => void;
  onMenuOpen: () => void;
  theme: Theme;
  onSelectTheme: (theme: Theme) => void;
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

// Gruppen-Label je Seite — im Compact-Modus (Mobile) als Orientierung über
// dem Seitentitel sichtbar; Desktop-Topbar kommt nach Mockup ohne Titel aus
// (der Seitentitel lebt im Content als PageHeader).
const PAGE_GROUP_MAP: Record<AppPage, string> = {
  dashboard: 'Betrieb',
  planning: 'Betrieb',
  inventory: 'Lager',
  externalPool: 'Lager',
  assetDetail: 'Lager',
  checkinCheckout: 'Lager',
  tickets: 'Tickets',
  users: 'Verwaltung',
  categories: 'Verwaltung',
  importExport: 'System',
  backup: 'System',
  qrFunctions: 'System',
  massPrint: 'System',
  labelAudit: 'System',
  updateNotes: 'System',
  loginBackground: 'System',
  rolesPermissions: 'Verwaltung',
  telecomPass: 'Verwaltung',
  securityLogs: 'Verwaltung',
  systemUpdate: 'System',
};

const ICON_BUTTON =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition ' +
  'hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

type ThemeOption = { value: Theme; label: string; hint: string; icon: LucideIcon };

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Hell', hint: 'Helle Oberfläche', icon: Sun },
  { value: 'dark', label: 'Dunkel', hint: 'Navy-Produkt-Look', icon: Moon },
  { value: 'studio', label: 'Studio', hint: 'Warmes Sand-Theme', icon: Palette },
];

const THEME_META: Record<Theme, ThemeOption> = THEME_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = option;
    return acc;
  },
  {} as Record<Theme, ThemeOption>,
);

// Dreifach-Theme-Auswahl als kleines Popover. Ein-Klick statt Zyklus, damit
// jedes Theme (inkl. Studio) direkt erreichbar und erkennbar ist.
function ThemeMenu({
  theme,
  onSelectTheme,
  buttonClassName,
  iconSize,
}: {
  theme: Theme;
  onSelectTheme: (theme: Theme) => void;
  buttonClassName: string;
  iconSize: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ActiveIcon = THEME_META[theme]?.icon ?? Sun;

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Design wählen"
        aria-label="Design wählen"
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClassName}
      >
        <ActiveIcon className={iconSize} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-panel"
        >
          <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
            Design
          </p>
          {THEME_OPTIONS.map((option) => {
            const active = option.value === theme;
            const OptionIcon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onSelectTheme(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-semibold transition ${
                  active ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <OptionIcon className="h-[18px] w-[18px] shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  <span className="block truncate text-[11px] font-medium text-ink-faint">{option.hint}</span>
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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
  onSelectTheme,
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
  compact = false,
}: TopbarProps) {
  const initials = buildInitials(userName);
  const crumbGroup = PAGE_GROUP_MAP[activePage] ?? 'Betrieb';

  if (compact) {
    return (
      <header className="sticky top-0 z-20 border-b border-line bg-surface shadow-sm">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className="btn-secondary h-11 w-11 p-0" onClick={onMenuOpen} aria-label="Menü öffnen">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">{crumbGroup}</p>
              <p className="truncate text-sm font-semibold text-ink">{activeLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <ThemeMenu
              theme={theme}
              onSelectTheme={onSelectTheme}
              buttonClassName={`${ICON_BUTTON} h-11 w-11`}
              iconSize="h-5 w-5"
            />
            <button type="button" onClick={onOpenProfile} aria-label="Profil" className={`${ICON_BUTTON} h-11 w-11`}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                {initials}
              </span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              title="Abmelden"
              aria-label="Abmelden"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted transition hover:bg-rose-500/10 hover:text-rose-400"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface shadow-sm">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-3 sm:px-4 md:gap-4 md:px-8">
        <button
          type="button"
          className="btn-secondary p-2.5 md:hidden"
          onClick={onMenuOpen}
          aria-label="Menü öffnen"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Globale Suche — nimmt die verfügbare Breite ein (Mockup). */}
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Suche nach Asset, Ticket, Inventarnummer oder Team..."
            aria-label="Suche"
            className="h-10 w-full rounded-xl border border-line bg-surface-2 pl-10 pr-12 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-primary"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint md:block">
            Strg K
          </kbd>
        </div>

        {/* Projektkontext (Freitext, dezent als eigenes Feld). */}
        <div className="hidden min-w-0 lg:block">
          <label className="block rounded-xl border border-line bg-surface-2 px-3 py-1.5 transition focus-within:border-primary">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Projektkontext
            </span>
            <input
              className="w-[170px] bg-transparent text-xs font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-faint"
              placeholder="Standardprojekt"
              value={projectContext}
              onChange={(event) => onProjectContextChange(event.target.value)}
              aria-label="Projektkontext"
            />
          </label>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ThemeMenu
            theme={theme}
            onSelectTheme={onSelectTheme}
            buttonClassName={ICON_BUTTON}
            iconSize="h-[18px] w-[18px]"
          />
          <button
            type="button"
            onClick={onOpenHelp}
            title="Hilfe"
            aria-label="Hilfe"
            className={`${ICON_BUTTON} hidden sm:inline-flex`}
          >
            <CircleHelp className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onOpenNotifications}
            title="Benachrichtigungen"
            aria-label="Benachrichtigungen"
            className={`${ICON_BUTTON} relative`}
          >
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-[color:var(--ui-surface)]" aria-hidden />
          </button>
        </div>

        {/* Profil: Avatar + Name + Rolle. */}
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label={`Profil ${userName}`}
          className="inline-flex h-10 shrink-0 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-2 py-1 transition hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
            {initials}
          </span>
          <span className="hidden text-left leading-tight lg:block">
            <span className="block max-w-[160px] truncate text-xs font-semibold text-ink">{userName}</span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-ink-faint">{activeRole}</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onLogout}
          title="Abmelden"
          aria-label="Abmelden"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-2.5 text-ink-muted transition hover:bg-rose-500/10 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 md:px-3"
        >
          <LogOut className="h-[18px] w-[18px]" />
          <span className="hidden text-xs font-medium xl:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
