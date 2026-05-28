import type { Asset } from './types';

export function buildAssetQrCode(assetId: string, tagNumber: string): string {
  return `WMS|${assetId}|${tagNumber}`;
}

export function getAssetQrCode(asset: Pick<Asset, 'id' | 'tagNumber' | 'qrCode'>): string {
  const existing = asset.qrCode?.trim();
  if (existing) {
    return existing;
  }
  return buildAssetQrCode(asset.id, asset.tagNumber);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const GROUP_PREFIX = 'group:';

/**
 * Erkennt einen Sammel-QR (Gruppen-QR). Der Scan-Wert lautet `GROUP:<token>`
 * und ist damit eindeutig vom Einzel-Asset-Format `WMS|<id>|<tag>`
 * unterscheidbar. Liefert den Token oder null, wenn es kein Sammel-QR ist.
 *
 * Berücksichtigt URL-codierte Werte und in URLs/Parametern eingebettete Codes,
 * analog zu resolveAssetByScan.
 */
export function parseGroupScan(scanInput: string): string | null {
  const raw = (scanInput ?? '').trim();
  if (!raw) return null;

  const candidates = new Set<string>();
  for (const value of [raw, safeDecode(raw)]) {
    candidates.add(value.trim());
    const markerIndex = value.toLowerCase().indexOf(GROUP_PREFIX);
    if (markerIndex >= 0) {
      candidates.add(value.slice(markerIndex).trim());
    }
    try {
      const asUrl = new URL(value);
      asUrl.searchParams.forEach((paramValue) => candidates.add(paramValue.trim()));
      candidates.add(asUrl.pathname.replace(/^\/+/, '').trim());
    } catch {
      // ignore non-URL values
    }
  }

  for (const candidate of candidates) {
    if (candidate.toLowerCase().startsWith(GROUP_PREFIX)) {
      const token = candidate.slice(GROUP_PREFIX.length).trim();
      if (token) return token;
    }
  }
  return null;
}

function lowerSet(values: string[]): Set<string> {
  return new Set(
    values
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function resolveAssetByScan(scanInput: string, assets: Asset[]): Asset | null {
  const raw = scanInput.trim();
  if (!raw) {
    return null;
  }

  const variants = new Set<string>();
  const decoded = safeDecode(raw);
  variants.add(raw);
  variants.add(decoded);

  for (const value of [raw, decoded]) {
    const markerIndex = value.indexOf('WMS|');
    if (markerIndex >= 0) {
      variants.add(value.slice(markerIndex).trim());
    }

    if (value.includes('|')) {
      variants.add(value.split('|')[1] ?? '');
    }

    try {
      const asUrl = new URL(value);
      variants.add(asUrl.pathname.replace(/^\/+/, ''));
      asUrl.searchParams.forEach((paramValue) => variants.add(paramValue));
    } catch {
      // ignore non-URL values
    }
  }

  const lookup = lowerSet(Array.from(variants));

  for (const asset of assets) {
    const qr = getAssetQrCode(asset);
    const assetValues = lowerSet([qr, asset.id, asset.tagNumber, asset.serialNumber]);
    for (const candidate of assetValues) {
      if (lookup.has(candidate)) {
        return asset;
      }
    }

    if (qr.startsWith('WMS|')) {
      const qrAssetId = qr.split('|')[1]?.trim().toLowerCase();
      if (qrAssetId && lookup.has(qrAssetId)) {
        return asset;
      }
    }
  }

  return null;
}
