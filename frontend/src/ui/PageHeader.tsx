import type { ReactNode } from 'react';

type PageHeaderProps = {
  // Kleines Uppercase-Label über dem Titel (z. B. Bereich/Rolle) — optional.
  kicker?: string;
  title: string;
  subtitle?: string;
  // Aktions-Slot rechts (Buttons wie "Neues Gerät", "QR drucken", ...).
  actions?: ReactNode;
  // Kompakter Modus für "table first"-Seiten (z. B. Inventar): kleinerer
  // Titel, Untertitel nur auf großen Breiten — spart vertikalen Platz auf
  // 14-Zoll-Laptops. Andere Seiten bleiben unverändert.
  dense?: boolean;
};

// Einheitlicher Seitenkopf nach Mockup: Titel + Untertitel links, primäre
// Aktionen rechts. Ersetzt die hand-gerollten Header der Einzelseiten.
export function PageHeader({ kicker, title, subtitle, actions, dense = false }: PageHeaderProps) {
  return (
    <div className={`flex flex-col ${dense ? 'gap-2' : 'gap-3'} sm:flex-row sm:items-end sm:justify-between`}>
      <div className="min-w-0">
        {kicker ? <p className={`page-kicker ${dense ? 'text-[11px]' : ''}`.trim()}>{kicker}</p> : null}
        <h2 className={dense ? 'mt-0.5 truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl' : 'page-title'}>
          {title}
        </h2>
        {subtitle ? (
          <p className={dense ? 'mt-0.5 hidden truncate text-xs text-ink-muted lg:block' : 'page-subtitle'}>{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
