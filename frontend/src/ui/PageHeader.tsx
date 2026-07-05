import type { ReactNode } from 'react';

type PageHeaderProps = {
  // Kleines Uppercase-Label über dem Titel (z. B. Bereich/Rolle) — optional.
  kicker?: string;
  title: string;
  subtitle?: string;
  // Aktions-Slot rechts (Buttons wie "Neues Gerät", "QR drucken", ...).
  actions?: ReactNode;
};

// Einheitlicher Seitenkopf nach Mockup: Titel + Untertitel links, primäre
// Aktionen rechts. Ersetzt die hand-gerollten Header der Einzelseiten.
export function PageHeader({ kicker, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {kicker ? <p className="page-kicker">{kicker}</p> : null}
        <h2 className="page-title">{title}</h2>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
