import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export type ContextMenuItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  // 'danger' hebt destruktive Aktionen (z. B. Löschen) optisch ab.
  tone?: 'default' | 'danger';
  // Trennlinie oberhalb des Eintrags, um Aktionsgruppen zu gliedern.
  separatorBefore?: boolean;
  onSelect: () => void;
};

type ContextMenuProps = {
  // Wunschposition (Mauszeiger/Touchpunkt) in Viewport-Koordinaten.
  position: { x: number; y: number };
  title?: string;
  subtitle?: string;
  items: ContextMenuItem[];
  onClose: () => void;
};

/**
 * Leichtgewichtiges, wiederverwendbares Kontextmenü auf Token-Basis
 * (bg-surface/border-line/text-ink) — funktioniert damit in allen UI-Modi.
 * Rendert per Portal über allem, klemmt sich in den sichtbaren Viewport und
 * schließt bei Klick außerhalb, Escape, Scroll, Resize oder Auswahl.
 */
export function ContextMenu({ position, title, subtitle, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  // Erst unsichtbar rendern, messen, dann in den Viewport klemmen — so läuft
  // das Menü nie aus dem sichtbaren Bereich heraus.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = position.x;
    let top = position.y;
    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - rect.width - margin;
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = window.innerHeight - rect.height - margin;
    }
    setCoords({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [position.x, position.y, items.length]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    // Scroll (auch in inneren Containern) und Resize schließen das Menü,
    // damit es nicht von seiner Zeile "wegdriftet".
    const handleViewportChange = () => onClose();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [onClose]);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (!buttons.length) return;
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      activeIndex === -1
        ? delta === 1
          ? 0
          : buttons.length - 1
        : (activeIndex + delta + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label={title ?? 'Kontextmenü'}
      className="fixed z-[90] min-w-[224px] max-w-[280px] rounded-xl border border-line bg-surface p-1.5 shadow-panel focus:outline-none"
      style={{
        left: coords?.left ?? position.x,
        top: coords?.top ?? position.y,
        visibility: coords ? 'visible' : 'hidden',
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
    >
      {title ? (
        <div className="border-b border-line px-3 pb-2 pt-1.5">
          <p className="truncate text-sm font-semibold text-ink" title={title}>
            {title}
          </p>
          {subtitle ? <p className="truncate text-xs text-ink-faint">{subtitle}</p> : null}
        </div>
      ) : null}
      <div className="mt-1 space-y-0.5">
        {items.map((item) => (
          <div key={item.key}>
            {item.separatorBefore ? <div className="my-1 border-t border-line" /> : null}
            <button
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition focus:outline-none ${
                item.tone === 'danger'
                  ? 'text-rose-500 hover:bg-rose-500/10 focus-visible:bg-rose-500/10'
                  : 'text-ink hover:bg-surface-2 focus-visible:bg-surface-2'
              }`}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {item.icon ? <item.icon className="h-4 w-4 shrink-0 opacity-80" /> : null}
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
