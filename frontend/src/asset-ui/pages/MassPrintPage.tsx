import { CheckSquare, Printer, Search, Square, XSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { Asset } from '../types';
import { getAssetQrCode } from '../qr';
import { printMultipleLabels, type LabelInput } from '../printLabels';

type MassPrintPageProps = {
  assets: Asset[];
};

type PrintEntry = {
  asset: Asset;
  quantity: number;
};

export function MassPrintPage({ assets }: MassPrintPageProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Alle Kategorien');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

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
      await printMultipleLabels(labels);
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
          <button
            type="button"
            className="btn-primary"
            disabled={!selectedIds.length || isPrinting}
            onClick={() => {
              void printSelected();
            }}
          >
            <Printer className="h-4 w-4" />
            {isPrinting ? 'Druckansicht wird erstellt...' : 'Ausgewählte QR-Codes drucken'}
          </button>
        </div>
      </article>
    </section>
  );
}
