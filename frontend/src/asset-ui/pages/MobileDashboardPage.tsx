import { Boxes, Handshake, Plus, TriangleAlert, Undo2 } from 'lucide-react';
import { ActionCard, PageHeader } from '../../ui';
import type { AppPage } from '../types';

type MobileDashboardPageProps = {
  onNavigate: (page: AppPage) => void;
  // Öffnet die Ein-/Auslagerung direkt im passenden Modus — die Kachel
  // „Gerät zurücknehmen“ soll in der Rücknahme landen, nicht in der Ausgabe.
  onOpenCheckinCheckout?: (mode: 'checkout' | 'checkin') => void;
};

const actions: Array<{
  label: string;
  hint: string;
  page: AppPage;
  icon: typeof Handshake;
  tone: 'primary' | 'neutral' | 'warning' | 'success';
  checkinCheckoutMode?: 'checkout' | 'checkin';
}> = [
  { label: 'Gerät ausgeben', hint: 'Check-out starten', page: 'checkinCheckout', icon: Handshake, tone: 'success', checkinCheckoutMode: 'checkout' },
  { label: 'Gerät zurücknehmen', hint: 'Check-in starten', page: 'checkinCheckout', icon: Undo2, tone: 'neutral', checkinCheckoutMode: 'checkin' },
  { label: 'Gerät suchen', hint: 'Inventar öffnen', page: 'inventory', icon: Boxes, tone: 'neutral' },
  { label: 'Defekt melden', hint: 'Ticket anlegen', page: 'tickets', icon: TriangleAlert, tone: 'warning' },
  { label: 'Neues Gerät anlegen', hint: 'Inventar-Erfassung', page: 'inventory', icon: Plus, tone: 'primary' },
];

export function MobileDashboardPage({ onNavigate, onOpenCheckinCheckout }: MobileDashboardPageProps) {
  return (
    <section className="space-y-4">
      <PageHeader kicker="Mobile Start" title="Schnellaktionen" subtitle="Tippe auf eine Aktion für den Lagerprozess." />

      <div className="space-y-2.5">
        {actions.map((action) => (
          <ActionCard
            key={action.label}
            icon={action.icon}
            title={action.label}
            subtitle={action.hint}
            tone={action.tone}
            onClick={() => {
              if (action.checkinCheckoutMode && onOpenCheckinCheckout) {
                onOpenCheckinCheckout(action.checkinCheckoutMode);
                return;
              }
              onNavigate(action.page);
            }}
          />
        ))}
      </div>
    </section>
  );
}
