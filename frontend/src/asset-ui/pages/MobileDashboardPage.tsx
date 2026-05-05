import { Boxes, Handshake, Plus, TriangleAlert, Undo2 } from 'lucide-react';
import type { AppPage } from '../types';

type MobileDashboardPageProps = {
  onNavigate: (page: AppPage) => void;
};

const actions: Array<{ label: string; hint: string; page: AppPage; icon: typeof Handshake }> = [
  { label: 'Gerät ausgeben', hint: 'Check-out starten', page: 'checkinCheckout', icon: Handshake },
  { label: 'Gerät zurücknehmen', hint: 'Check-in starten', page: 'checkinCheckout', icon: Undo2 },
  { label: 'Gerät suchen', hint: 'Inventar öffnen', page: 'inventory', icon: Boxes },
  { label: 'Defekt melden', hint: 'Ticket anlegen', page: 'tickets', icon: TriangleAlert },
  { label: 'Neues Gerät anlegen', hint: 'Inventar-Erfassung', page: 'inventory', icon: Plus },
];

export function MobileDashboardPage({ onNavigate }: MobileDashboardPageProps) {
  return (
    <section className="space-y-4">
      <div className="surface-card p-4">
        <p className="page-kicker">Mobile Start</p>
        <h2 className="page-title text-2xl">Schnellaktionen</h2>
        <p className="page-subtitle">Tippe auf eine Aktion für den Lagerprozess.</p>
      </div>

      <div className="grid gap-3">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`surface-card flex min-h-[68px] items-center gap-3 text-left ${
              action.page === 'checkinCheckout' || action.page === 'inventory' ? 'border-brand-200/80' : ''
            }`}
            onClick={() => onNavigate(action.page)}
          >
            <span className="rounded-xl bg-brand-50 p-2 text-brand-700 dark:bg-sky-900/40 dark:text-sky-200">
              <action.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{action.label}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{action.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
