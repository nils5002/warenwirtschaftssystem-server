import { Building2, MapPin, Warehouse } from 'lucide-react';
import type { LocationItem } from '../types';

export function LocationsPage({
  locations,
  onOpenInventory,
  onEditLocation,
}: {
  locations: LocationItem[];
  onOpenInventory: (name: string) => void;
  onEditLocation: (name: string) => void;
}) {
  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Standorte / Lagerorte</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Lagerstruktur</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {locations.map((location) => (
          <article key={location.name} className="surface-card animate-fade-up">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{location.name}</h3>
                <p className="text-sm text-slate-500">{location.capacity}</p>
              </div>
              <MapPin className="h-5 w-5 text-brand-700" />
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Zugewiesen</dt>
                <dd className="font-medium text-slate-900">{location.assignedAssets}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Verfügbar</dt>
                <dd className="font-medium text-slate-900">{location.availableAssets}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Verantwortlich</dt>
                <dd className="font-medium text-slate-900">{location.manager}</dd>
              </div>
            </dl>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:flex">
              <button
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => onOpenInventory(location.name)}
              >
                <Warehouse className="h-3.5 w-3.5" />
                Inventar
              </button>
              <button
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => onEditLocation(location.name)}
              >
                <Building2 className="h-3.5 w-3.5" />
                Bearbeiten
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

