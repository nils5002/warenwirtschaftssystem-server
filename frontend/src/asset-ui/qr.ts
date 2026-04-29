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
