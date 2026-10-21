import { LogOut, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { AppPage, NavItem } from '../asset-ui/types';

type MobileMoreSheetProps = {
  items: NavItem[];
  activePage: AppPage;
  onSelect: (page: AppPage) => void;
  onClose: () => void;
  onLogout: () => void;
};

/**
 * "Mehr"-Bereich der mobilen Navigation: alle für die Rolle sichtbaren Seiten,
 * die nicht in der unteren Leiste stehen (z. B. Tickets, Mein Konto und die
 * rollenabhängige Administration). Als Bottom-Sheet mit eigenem Scrollbereich.
 */
export function MobileMoreSheet({ items, activePage, onSelect, onClose, onLogout }: MobileMoreSheetProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const operations = items.filter((item) => (item.group ?? 'operations') === 'operations');
  const administration = items.filter((item) => item.group === 'administration');

  const renderGroup = (title: string, group: NavItem[]) =>
    group.length ? (
      <div className="space-y-1">
        <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
        <ul className="grid grid-cols-1 gap-1">
          {group.map((item) => {
            const active = item.key === activePage;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition ${
                    active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-2'
                  }`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    onSelect(item.key);
                    onClose();
                  }}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.hint ? <span className="block truncate text-xs font-normal text-ink-muted">{item.hint}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Weitere Bereiche" onClick={onClose}>
      <div
        className="max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-surface px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-base font-semibold text-ink">Mehr</p>
          <button ref={closeRef} type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-2" onClick={onClose} aria-label="Schließen">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          {renderGroup('Bereiche', operations)}
          {renderGroup('Verwaltung', administration)}
          <button
            type="button"
            className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-rose-600 hover:bg-surface-2"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            <LogOut className="h-5 w-5" /> Abmelden
          </button>
        </div>
      </div>
    </div>
  );
}
