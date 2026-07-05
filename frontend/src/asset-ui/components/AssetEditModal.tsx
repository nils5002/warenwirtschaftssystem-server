import { QrCode, ShieldCheck, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LoadingButton } from '../../components/loading';
import { AssetQrCodePreview } from './AssetQrCodePreview';
import { getAssetQrCode } from '../qr';
import type { Asset, CategoryItem } from '../types';

type AssetEditModalProps = {
  asset: Asset;
  categories: CategoryItem[];
  onClose: () => void;
  onSave: (assetId: string, patch: Partial<Asset>) => Promise<void>;
};

type AssetEditFormState = {
  name: string;
  category: string;
  location: string;
  serialNumber: string;
  model: string;
  ipAddress: string;
  macLan: string;
  macWlan: string;
  notes: string;
  cardPrinterCompatible: boolean;
  availableForPlanning: boolean;
};

type FieldErrors = Partial<Record<keyof AssetEditFormState, string>>;

function createInitialState(asset: Asset): AssetEditFormState {
  return {
    name: asset.name,
    category: asset.category,
    location: asset.location,
    serialNumber: asset.serialNumber,
    model: asset.model ?? '',
    ipAddress: asset.ipAddress ?? '',
    macLan: asset.macLan ?? '',
    macWlan: asset.macWlan ?? '',
    notes: asset.notes,
    cardPrinterCompatible: asset.cardPrinterCompatible ?? true,
    availableForPlanning: asset.availableForPlanning ?? true,
  };
}

function normalizeOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseAssignment(value: string): { assignee: string; project: string } {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') {
    return { assignee: '—', project: '—' };
  }
  const parts = trimmed.split('·').map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return { assignee: trimmed, project: '—' };
  }
  return {
    assignee: parts[0] || '—',
    project: parts.slice(1).join(' · ') || '—',
  };
}

export function AssetEditModal({ asset, categories, onClose, onSave }: AssetEditModalProps) {
  const [form, setForm] = useState<AssetEditFormState>(() => createInitialState(asset));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(createInitialState(asset));
    setErrors({});
    setSaveError(null);
    setIsSaving(false);
  }, [asset]);

  const categoryOptions = useMemo(() => {
    const activeNames = categories
      .filter((item) => item.isActive !== false)
      .map((item) => item.name.trim())
      .filter(Boolean);
    return [...new Set([asset.category, ...activeNames])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
  }, [asset.category, categories]);

  const qrValue = useMemo(() => getAssetQrCode(asset), [asset]);
  const assignment = useMemo(() => parseAssignment(asset.assignedTo), [asset.assignedTo]);

  const validate = (): boolean => {
    const nextErrors: FieldErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Bitte einen Gerätenamen eingeben.';
    if (!form.category.trim()) {
      nextErrors.category = 'Bitte eine Kategorie auswählen.';
    } else if (!categoryOptions.includes(form.category.trim())) {
      nextErrors.category = 'Kategorie muss aus der bestehenden Kategorienliste stammen.';
    }
    if (!form.location.trim()) nextErrors.location = 'Bitte einen Standort eingeben.';
    if (!form.serialNumber.trim()) nextErrors.serialNumber = 'Bitte eine Seriennummer eingeben.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const patch: Partial<Asset> = {};
    const normalizedName = form.name.trim();
    const normalizedCategory = form.category.trim();
    const normalizedLocation = form.location.trim();
    const normalizedSerial = form.serialNumber.trim();
    const normalizedModel = normalizeOptional(form.model);
    const normalizedIp = normalizeOptional(form.ipAddress);
    const normalizedMacLan = normalizeOptional(form.macLan);
    const normalizedMacWlan = normalizeOptional(form.macWlan);
    const normalizedNotes = form.notes.trim();

    if (normalizedName !== asset.name) patch.name = normalizedName;
    if (normalizedCategory !== asset.category) patch.category = normalizedCategory;
    if (normalizedLocation !== asset.location) patch.location = normalizedLocation;
    if (normalizedSerial !== asset.serialNumber) patch.serialNumber = normalizedSerial;
    if ((asset.model ?? undefined) !== normalizedModel) patch.model = normalizedModel;
    if ((asset.ipAddress ?? undefined) !== normalizedIp) patch.ipAddress = normalizedIp;
    if ((asset.macLan ?? undefined) !== normalizedMacLan) patch.macLan = normalizedMacLan;
    if ((asset.macWlan ?? undefined) !== normalizedMacWlan) patch.macWlan = normalizedMacWlan;
    if (normalizedNotes !== asset.notes.trim()) patch.notes = normalizedNotes;
    if ((asset.cardPrinterCompatible ?? true) !== form.cardPrinterCompatible) {
      patch.cardPrinterCompatible = form.cardPrinterCompatible;
    }
    if ((asset.availableForPlanning ?? true) !== form.availableForPlanning) {
      patch.availableForPlanning = form.availableForPlanning;
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(asset.id, patch);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Änderungen konnten nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/70 p-3 sm:items-center sm:p-5">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Schließen" onClick={onClose} />
      <div className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-canvas shadow-panel">
        <div className="border-b border-line bg-surface/80 px-5 py-4 backdrop-blur sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">Inventar</p>
              <h3 className="mt-1 text-2xl font-semibold text-ink">Gerät bearbeiten</h3>
              <p className="mt-1 text-sm text-ink-muted">
                Alle editierbaren Stammdaten in einem Dialog. Status, Ausgabe/Rücknahme und Wartung bleiben in ihren Fach-Workflows.
              </p>
            </div>
            <button type="button" className="btn-ghost px-2 py-2" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="soft-scrollbar overflow-y-auto px-5 py-5 sm:px-6">
          {saveError ? (
            <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {saveError}
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-faint">Stammdaten</h4>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="field">
                    Gerätename
                    <input
                      className="field-input"
                      value={form.name}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, name: event.target.value }));
                        setErrors((current) => ({ ...current, name: undefined }));
                      }}
                    />
                    {errors.name ? <span className="text-xs text-rose-300">{errors.name}</span> : null}
                  </label>

                  <label className="field">
                    Kategorie
                    <select
                      className="field-input"
                      value={form.category}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, category: event.target.value }));
                        setErrors((current) => ({ ...current, category: undefined }));
                      }}
                    >
                      {categoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    {errors.category ? <span className="text-xs text-rose-300">{errors.category}</span> : null}
                  </label>

                  <label className="field">
                    Inventarnummer
                    <input className="field-input opacity-80" value={asset.tagNumber} readOnly />
                    <span className="text-xs text-ink-faint">
                      Read-only, damit bestehende QR-Codes und Label-Zuordnungen nicht unbeabsichtigt geändert werden.
                    </span>
                  </label>

                  <label className="field">
                    Seriennummer
                    <input
                      className="field-input"
                      value={form.serialNumber}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, serialNumber: event.target.value }));
                        setErrors((current) => ({ ...current, serialNumber: undefined }));
                      }}
                    />
                    {errors.serialNumber ? <span className="text-xs text-rose-300">{errors.serialNumber}</span> : null}
                  </label>

                  <label className="field">
                    Modell
                    <input
                      className="field-input"
                      placeholder="Optional"
                      value={form.model}
                      onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-faint">Status & Standort</h4>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="field">
                    Aktueller Status
                    <input className="field-input opacity-80" value={asset.status} readOnly />
                    <span className="text-xs text-ink-faint">
                      Statuswechsel laufen weiter über Ausgabe, Rücknahme, Defekt- und Wartungs-Workflows.
                    </span>
                  </label>

                  <label className="field">
                    Standort
                    <input
                      className="field-input"
                      value={form.location}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, location: event.target.value }));
                        setErrors((current) => ({ ...current, location: undefined }));
                      }}
                    />
                    {errors.location ? <span className="text-xs text-rose-300">{errors.location}</span> : null}
                  </label>

                  <label className="field">
                    Zugewiesen an
                    <input className="field-input opacity-80" value={assignment.assignee} readOnly />
                  </label>

                  <label className="field">
                    Projektzuordnung
                    <input className="field-input opacity-80" value={assignment.project} readOnly />
                  </label>

                  <label className="field">
                    Nächste Rückgabe
                    <input className="field-input opacity-80" value={asset.nextReturn || '—'} readOnly />
                  </label>

                  <label className="field">
                    Expected Return Date
                    <input className="field-input opacity-80" value={asset.expectedReturnDate || '—'} readOnly />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-faint">Technische Daten</h4>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="field">
                    IP-Adresse
                    <input
                      className="field-input"
                      placeholder="Optional"
                      value={form.ipAddress}
                      onChange={(event) => setForm((current) => ({ ...current, ipAddress: event.target.value }))}
                    />
                  </label>

                  <label className="field">
                    MAC LAN
                    <input
                      className="field-input"
                      placeholder="Optional"
                      value={form.macLan}
                      onChange={(event) => setForm((current) => ({ ...current, macLan: event.target.value }))}
                    />
                  </label>

                  <label className="field md:col-span-2">
                    MAC WLAN
                    <input
                      className="field-input"
                      placeholder="Optional"
                      value={form.macWlan}
                      onChange={(event) => setForm((current) => ({ ...current, macWlan: event.target.value }))}
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-faint">Wartung & Hinweise</h4>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="field">
                    Wartungsstatus
                    <input className="field-input opacity-80" value={asset.maintenanceState || '—'} readOnly />
                    <span className="text-xs text-ink-faint">
                      Read-only, damit offene Defekt- und Wartungsfälle nicht durch das Speichern überschrieben werden.
                    </span>
                  </label>

                  <div className="rounded-2xl border border-line bg-canvas/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Asset-Flags</p>
                    <div className="mt-3 space-y-3">
                      <label className="flex items-start gap-3 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-line bg-surface"
                          checked={form.availableForPlanning}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, availableForPlanning: event.target.checked }))
                          }
                        />
                        <span>
                          In Einsatzplanung berücksichtigen
                          <span className="mt-1 block text-xs text-ink-faint">
                            Deaktiviert blendet das Asset fachlich aus der Verfügbarkeitsplanung aus.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-line bg-surface"
                          checked={form.cardPrinterCompatible}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, cardPrinterCompatible: event.target.checked }))
                          }
                        />
                        <span>
                          Kartendrucker-kompatibel
                          <span className="mt-1 block text-xs text-ink-faint">
                            Relevant für Laptop-Bestand in Projekten mit Kartendruckern.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <label className="field md:col-span-2">
                    Notizen / interne Hinweise
                    <textarea
                      className="field-input min-h-[144px]"
                      value={form.notes}
                      onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                </div>
              </section>
            </div>

            <aside className="space-y-5">
              <section className="rounded-2xl border border-line bg-surface p-4">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <QrCode className="h-3.5 w-3.5" />
                  QR-Vorschau
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <AssetQrCodePreview qrValue={qrValue} assetName={asset.name} size={132} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{asset.tagNumber}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      QR bleibt hier unverändert. Druck/Download bleiben außerhalb des Bearbeiten-Dialogs.
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Workflow-Info
                </p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-ink-faint">Letzte Ausgabe</dt>
                    <dd className="mt-1 font-medium text-ink">{asset.lastCheckout || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Nächste Reservierung</dt>
                    <dd className="mt-1 font-medium text-ink">{asset.nextReservation || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Planungszuordnung</dt>
                    <dd className="mt-1 break-all font-medium text-ink">{asset.assignedPlanningId || '—'}</dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
                  <Wrench className="h-3.5 w-3.5" />
                  Fachlogik geschützt
                </p>
                <p className="mt-3 text-sm text-amber-100/90">
                  Status, Wartung, Ausgabe, Rücknahme und Projektbindung bleiben absichtlich außerhalb dieses Dialogs, damit keine aktiven Fachprozesse überschrieben werden.
                </p>
              </section>
            </aside>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-line bg-surface/90 px-5 py-4 backdrop-blur sm:px-6">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
              Abbrechen
            </button>
            <LoadingButton
              type="button"
              className="btn-primary"
              isLoading={isSaving}
              loadingText="Speichert ..."
              onClick={() => void handleSave()}
            >
              Änderungen speichern
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}
