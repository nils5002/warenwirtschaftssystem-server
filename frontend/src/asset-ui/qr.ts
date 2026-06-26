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

/**
 * Lose Normalisierung für tolerante Suche: lower-case, getrimmt und ohne
 * Leerzeichen/Bindestriche. Damit matchen "CX-EVENT-27", "cx event 27" und
 * "cxevent27" auf denselben Wert.
 */
function normalizeLoose(value: string): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '');
}

/**
 * Tolerante Geräte-Suche über die im Frontend-State vorhandene Asset-Liste.
 * Sucht über Inventarnummer, QR-Payload, Name/Bezeichnung und Seriennummer.
 *
 * Normalisiert case-insensitive und behandelt Leerzeichen/Bindestriche tolerant.
 * Ranking (höher = besser):
 *   1. exakte Inventarnummer
 *   2. exakter QR-Code
 *   3. exakte Seriennummer / lose-exakte Inventarnummer
 *   4. beginnt mit Suchtext
 *   5. enthält Suchtext
 *   6. ähnliche normalisierte Treffer (ohne Leerzeichen/Bindestriche)
 *
 * Liefert maximal `limit` Treffer, am besten passende zuerst.
 */
export function searchAssets(query: string, assets: Asset[], limit = 10): Asset[] {
  const raw = (query ?? '').trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  const qLoose = normalizeLoose(raw);
  if (!qLoose) return [];

  const scored: { asset: Asset; score: number }[] = [];
  for (const asset of assets) {
    const tag = (asset.tagNumber ?? '').toLowerCase();
    const name = (asset.name ?? '').toLowerCase();
    const serial = (asset.serialNumber ?? '').toLowerCase();
    const qr = getAssetQrCode(asset).toLowerCase();
    const tagLoose = normalizeLoose(asset.tagNumber ?? '');
    const nameLoose = normalizeLoose(asset.name ?? '');
    const serialLoose = normalizeLoose(asset.serialNumber ?? '');

    let score = 0;
    if (tag && tag === q) score = Math.max(score, 100);
    if (qr && qr === q) score = Math.max(score, 95);
    if (serial && serial === q) score = Math.max(score, 90);
    if (tagLoose && tagLoose === qLoose) score = Math.max(score, 88);
    if (tag && tag.startsWith(q)) score = Math.max(score, 70);
    if (tagLoose && tagLoose.startsWith(qLoose)) score = Math.max(score, 66);
    if (name && name.startsWith(q)) score = Math.max(score, 60);
    if (tag && tag.includes(q)) score = Math.max(score, 50);
    if (tagLoose && tagLoose.includes(qLoose)) score = Math.max(score, 46);
    if (name && name.includes(q)) score = Math.max(score, 40);
    if (nameLoose && nameLoose.includes(qLoose)) score = Math.max(score, 36);
    if (qr && qr.includes(q)) score = Math.max(score, 30);
    if ((serial && serial.includes(q)) || (serialLoose && serialLoose.includes(qLoose))) {
      score = Math.max(score, 25);
    }

    if (score > 0) scored.push({ asset, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.asset.tagNumber ?? '').localeCompare(b.asset.tagNumber ?? ''),
  );
  return scored.slice(0, limit).map((entry) => entry.asset);
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
