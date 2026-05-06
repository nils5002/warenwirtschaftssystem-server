import { CheckSquare, Printer, Search, Square, XSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { Asset } from '../types';
import { getAssetQrCode } from '../qr';
import { printMultipleLabels, type LabelInput, type MassLabelSettings } from '../printLabels';
import { InlineLoadingState, LoadingButton } from '../../components/loading';

type MassPrintPageProps = {
  assets: Asset[];
};

type PrintEntry = {
  asset: Asset;
  quantity: number;
};

const MASS_LABEL_SETTINGS_STORAGE_KEY = 'wms.massPrint.labelSettings.v1';

const DEFAULT_LABEL_SETTINGS: MassLabelSettings = {
  labelWidthMm: 89,
  labelHeightMm: 41,
  qrSizeMm: 26,
  fontSizePt: 11,
  gapMm: 2,
  paddingTopMm: 3,
  paddingRightMm: 4,
  paddingBottomMm: 3,
  paddingLeftMm: 4,
  offsetXMm: 0,
  offsetYMm: 0,
  fontWeight: 700,
  textMaxLines: 1,
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeSettings(value: unknown): MassLabelSettings {
  const raw = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  return {
    labelWidthMm: clampNumber(raw.labelWidthMm, DEFAULT_LABEL_SETTINGS.labelWidthMm, 20, 200),
    labelHeightMm: clampNumber(raw.labelHeightMm, DEFAULT_LABEL_SETTINGS.labelHeightMm, 20, 200),
    qrSizeMm: clampNumber(raw.qrSizeMm, DEFAULT_LABEL_SETTINGS.qrSizeMm, 8, 60),
    fontSizePt: clampNumber(raw.fontSizePt, DEFAULT_LABEL_SETTINGS.fontSizePt, 6, 24),
    gapMm: clampNumber(raw.gapMm, DEFAULT_LABEL_SETTINGS.gapMm, 0, 20),
    paddingTopMm: clampNumber(raw.paddingTopMm, DEFAULT_LABEL_SETTINGS.paddingTopMm, 0, 30),
    paddingRightMm: clampNumber(raw.paddingRightMm, DEFAULT_LABEL_SETTINGS.paddingRightMm, 0, 30),
    paddingBottomMm: clampNumber(raw.paddingBottomMm, DEFAULT_LABEL_SETTINGS.paddingBottomMm, 0, 30),
    paddingLeftMm: clampNumber(raw.paddingLeftMm, DEFAULT_LABEL_SETTINGS.paddingLeftMm, 0, 30),
    offsetXMm: clampNumber(raw.offsetXMm, DEFAULT_LABEL_SETTINGS.offsetXMm, -20, 20),
    offsetYMm: clampNumber(raw.offsetYMm, DEFAULT_LABEL_SETTINGS.offsetYMm, -20, 20),
    fontWeight: clampNumber(raw.fontWeight, DEFAULT_LABEL_SETTINGS.fontWeight, 400, 900),
    textMaxLines: Math.round(clampNumber(raw.textMaxLines, DEFAULT_LABEL_SETTINGS.textMaxLines, 1, 3)),
  };
}

function loadStoredSettings(): MassLabelSettings {
  if (typeof window === 'undefined') return DEFAULT_LABEL_SETTINGS;
  try {
    const raw = window.localStorage.getItem(MASS_LABEL_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_LABEL_SETTINGS;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_LABEL_SETTINGS;
  }
}

export function MassPrintPage({ assets }: MassPrintPageProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Alle Kategorien');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [labelSettings, setLabelSettings] = useState<MassLabelSettings>(() => loadStoredSettings());
  const [previewQrDataUrl, setPreviewQrDataUrl] = useState<string>('');
  const [previewQrLoading, setPreviewQrLoading] = useState(false);

  const categories = useMemo(() => {
    return ['Alle Kategorien', ...Array.from(new Set(assets.map((asset) => asset.category).filter(Boolean)))];
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesCategory = category === 'Alle Kategorien' || asset.category === category;
      if (!matchesCategory) return false;
      if (!needle) return true;
      const haystack = [asset.name, asset.serialNumber, asset.category, asset.id, asset.tagNumber]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [assets, category, search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedEntries = useMemo<PrintEntry[]>(() => {
    return assets
      .filter((asset) => selectedSet.has(asset.id))
      .map((asset) => ({
        asset,
        quantity: Math.min(99, Math.max(1, quantities[asset.id] ?? 1)),
      }));
  }, [assets, quantities, selectedSet]);

  const totalPages = useMemo(() => {
    return selectedEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  }, [selectedEntries]);

  const previewAsset = useMemo(() => {
    return selectedEntries[0]?.asset ?? filteredAssets[0] ?? assets[0] ?? null;
  }, [assets, filteredAssets, selectedEntries]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MASS_LABEL_SETTINGS_STORAGE_KEY, JSON.stringify(labelSettings));
    } catch {
      // Ignorieren: Druck bleibt funktionsfaehig, auch wenn localStorage blockiert ist.
    }
  }, [labelSettings]);

  useEffect(() => {
    if (!previewAsset) {
      setPreviewQrDataUrl('');
      setPreviewQrLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewQrLoading(true);
    void QRCode.toDataURL(getAssetQrCode(previewAsset), {
      width: 360,
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      (url) => {
        if (!cancelled) {
          setPreviewQrDataUrl(url);
          setPreviewQrLoading(false);
        }
      },
      () => {
        if (!cancelled) {
          setPreviewQrDataUrl('');
          setPreviewQrLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [previewAsset]);

  const updateLabelSetting = (key: keyof MassLabelSettings, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setLabelSettings((current) => sanitizeSettings({ ...current, [key]: parsed }));
  };

  const toggleAsset = (assetId: string) => {
    setSelectedIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
    setQuantities((current) => (current[assetId] ? current : { ...current, [assetId]: 1 }));
  };

  const selectAll = () => {
    setSelectedIds(assets.map((asset) => asset.id));
    setQuantities((current) => {
      const next = { ...current };
      for (const asset of assets) {
        if (!next[asset.id]) next[asset.id] = 1;
      }
      return next;
    });
  };

  const clearAll = () => {
    setSelectedIds([]);
  };

  const selectVisible = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredAssets.map((asset) => asset.id)])]);
    setQuantities((current) => {
      const next = { ...current };
      for (const asset of filteredAssets) {
        if (!next[asset.id]) next[asset.id] = 1;
      }
      return next;
    });
  };

  const clearVisible = () => {
    const visibleIds = new Set(filteredAssets.map((asset) => asset.id));
    setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
  };

  const setQuantity = (assetId: string, raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed) ? Math.min(99, Math.max(1, parsed)) : 1;
    setQuantities((current) => ({ ...current, [assetId]: next }));
  };

  const printSelected = async () => {
    if (!selectedEntries.length) return;
    setIsPrinting(true);
    setPrintError(null);
    try {
      const labels: LabelInput[] = [];
      for (const entry of selectedEntries) {
        const qrValue = getAssetQrCode(entry.asset);
        // Feste Groesse fuer konsistente Dymo-Etiketten.
        const qrDataUrl = await QRCode.toDataURL(qrValue, {
          width: 360,
          margin: 0,
          color: { dark: '#000000', light: '#ffffff' },
        });
        for (let index = 0; index < entry.quantity; index += 1) {
          labels.push({ qrDataUrl, assetName: entry.asset.name });
        }
      }
      await printMultipleLabels(labels, labelSettings);
    } catch {
      setPrintError('Druckansicht konnte nicht erstellt werden. Bitte versuche es erneut.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <p className="page-kicker">Admin</p>
        <h2 className="page-title">QR-Code Massendruck</h2>
        <p className="page-subtitle">Bestehende Assets auswählen und als einzelne QR-Labels drucken.</p>
      </div>

      <article className="surface-card animate-fade-up space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Label-Layout anpassen</h3>
          <p className="mt-1 text-xs text-slate-600">
            Passe hier die Position und Größe des QR-Labels an. Die Einstellungen werden lokal im Browser gespeichert
            und beim Drucken verwendet.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="field text-xs">
              Labelbreite (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.labelWidthMm} onChange={(event) => updateLabelSetting('labelWidthMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Labelhöhe (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.labelHeightMm} onChange={(event) => updateLabelSetting('labelHeightMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              QR-Größe (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.qrSizeMm} onChange={(event) => updateLabelSetting('qrSizeMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Schriftgröße (pt)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.fontSizePt} onChange={(event) => updateLabelSetting('fontSizePt', event.target.value)} />
            </label>
            <label className="field text-xs">
              Abstand QR/Text (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.gapMm} onChange={(event) => updateLabelSetting('gapMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Padding oben (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.paddingTopMm} onChange={(event) => updateLabelSetting('paddingTopMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Padding rechts (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.paddingRightMm} onChange={(event) => updateLabelSetting('paddingRightMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Padding unten (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.paddingBottomMm} onChange={(event) => updateLabelSetting('paddingBottomMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Padding links (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.paddingLeftMm} onChange={(event) => updateLabelSetting('paddingLeftMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              X-Offset (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.offsetXMm} onChange={(event) => updateLabelSetting('offsetXMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Y-Offset (mm)
              <input className="field-input h-9" type="number" step="0.5" value={labelSettings.offsetYMm} onChange={(event) => updateLabelSetting('offsetYMm', event.target.value)} />
            </label>
            <label className="field text-xs">
              Schriftstärke
              <input className="field-input h-9" type="number" step="100" value={labelSettings.fontWeight} onChange={(event) => updateLabelSetting('fontWeight', event.target.value)} />
            </label>
            <label className="field text-xs sm:col-span-2 lg:col-span-1">
              Max. Textzeilen
              <input className="field-input h-9" type="number" step="1" value={labelSettings.textMaxLines} onChange={(event) => updateLabelSetting('textMaxLines', event.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary text-xs" onClick={() => setLabelSettings(DEFAULT_LABEL_SETTINGS)}>
              Standardwerte zurücksetzen
            </button>
            <span className="text-xs text-slate-500">
              Vorschau-Asset: {previewAsset?.name ?? 'Kein Asset verfügbar'}
            </span>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div
              className="relative overflow-hidden rounded border border-dashed border-slate-300 bg-slate-50"
              style={{
                width: `${labelSettings.labelWidthMm * 4}px`,
                height: `${labelSettings.labelHeightMm * 4}px`,
                maxWidth: '100%',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  boxSizing: 'border-box',
                  paddingTop: `${labelSettings.paddingTopMm * 4}px`,
                  paddingRight: `${labelSettings.paddingRightMm * 4}px`,
                  paddingBottom: `${labelSettings.paddingBottomMm * 4}px`,
                  paddingLeft: `${labelSettings.paddingLeftMm * 4}px`,
                  transform: `translate(${labelSettings.offsetXMm * 4}px, ${labelSettings.offsetYMm * 4}px)`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {previewQrDataUrl ? (
                  <img
                    src={previewQrDataUrl}
                    alt="Vorschau QR"
                    style={{
                      width: `${labelSettings.qrSizeMm * 4}px`,
                      height: `${labelSettings.qrSizeMm * 4}px`,
                      objectFit: 'contain',
                      background: '#fff',
                    }}
                  />
                ) : null}
                <div
                  style={{
                    marginTop: `${labelSettings.gapMm * 4}px`,
                    fontSize: `${labelSettings.fontSizePt * (4 / 3)}px`,
                    fontWeight: labelSettings.fontWeight,
                    lineHeight: 1.1,
                    textAlign: 'center',
                    maxWidth: '92%',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: labelSettings.textMaxLines,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {previewAsset?.name ?? 'Asset-Name'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="field">
            Suche
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="field-input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, Seriennummer, Kategorie, Asset-ID oder Inventarnummer"
              />
            </div>
          </label>

          <label className="field md:min-w-[220px]">
            Kategorie
            <select className="field-input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={selectAll}>
            <CheckSquare className="h-3.5 w-3.5" />
            Alle auswählen
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={clearAll}>
            <Square className="h-3.5 w-3.5" />
            Auswahl aufheben
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={selectVisible}>
            <CheckSquare className="h-3.5 w-3.5" />
            Sichtbare auswählen
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={clearVisible}>
            <XSquare className="h-3.5 w-3.5" />
            Sichtbare abwählen
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          Ausgewählt: {selectedIds.length} von {assets.length} Assets
          {selectedIds.length ? ` · Druckseiten: ${totalPages}` : ''}
        </div>
        {printError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {printError}
          </div>
        ) : null}
        {previewQrLoading ? <InlineLoadingState message="QR-Vorschau wird vorbereitet ..." /> : null}
        {isPrinting ? <InlineLoadingState message="Druckdaten werden erzeugt ..." /> : null}

        <div className="soft-scrollbar max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {filteredAssets.map((asset) => {
            const checked = selectedSet.has(asset.id);
            return (
              <label
                key={asset.id}
                className={`grid gap-3 rounded-xl border px-3 py-2.5 md:grid-cols-[auto_1fr_auto] ${
                  checked ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={checked}
                  onChange={() => toggleAsset(asset.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">{asset.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {asset.category} · SN: {asset.serialNumber}
                  </span>
                </span>
                {checked ? (
                  <span className="field w-24 text-xs">
                    Menge
                    <input
                      type="number"
                      min={1}
                      max={99}
                      className="field-input h-9"
                      value={quantities[asset.id] ?? 1}
                      onChange={(event) => setQuantity(asset.id, event.target.value)}
                    />
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                )}
              </label>
            );
          })}
          {!filteredAssets.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
              Keine Assets für den aktuellen Filter gefunden.
            </div>
          ) : null}
        </div>

        <div className="flex justify-end">
          <LoadingButton
            type="button"
            className="btn-primary"
            disabled={!selectedIds.length || isPrinting}
            onClick={() => {
              void printSelected();
            }}
            isLoading={isPrinting}
            loadingText="Druckdaten werden erzeugt ..."
          >
            <Printer className="h-4 w-4" />
            Ausgewählte QR-Codes drucken
          </LoadingButton>
        </div>
      </article>
    </section>
  );
}
