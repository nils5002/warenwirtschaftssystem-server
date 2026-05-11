export const CANONICAL_CATEGORIES = [
  'Laptop',
  'iPad',
  'Handheld',
  'Smartphone',
  'QR-Code-Scanner',
  'Drucker',
  'Kartendrucker',
  'Switch',
  'Router',
  'LTE-Router',
  'Zubehör',
  'Sonstiges',
] as const;

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

const DEFAULT_CATEGORY: CanonicalCategory = 'Sonstiges';

function categoryKey(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const CATEGORY_ALIASES = new Map<string, CanonicalCategory>([
  ['laptop', 'Laptop'],
  ['laptops', 'Laptop'],
  ['notebook', 'Laptop'],
  ['notebooks', 'Laptop'],
  ['macbook', 'Laptop'],
  ['thinkpad', 'Laptop'],
  ['ipad', 'iPad'],
  ['ipads', 'iPad'],
  ['tablet', 'iPad'],
  ['tablets', 'iPad'],
  ['handheld', 'Handheld'],
  ['handhelds', 'Handheld'],
  ['handhelden', 'Handheld'],
  ['smartphone', 'Smartphone'],
  ['smartphones', 'Smartphone'],
  ['phone', 'Smartphone'],
  ['phones', 'Smartphone'],
  ['iphone', 'Smartphone'],
  ['qrcodescanner', 'QR-Code-Scanner'],
  ['qrcodescanners', 'QR-Code-Scanner'],
  ['qrcode', 'QR-Code-Scanner'],
  ['qrscanner', 'QR-Code-Scanner'],
  ['qrscanners', 'QR-Code-Scanner'],
  ['scanner', 'QR-Code-Scanner'],
  ['scanners', 'QR-Code-Scanner'],
  ['handscanner', 'QR-Code-Scanner'],
  ['handscanners', 'QR-Code-Scanner'],
  ['barcodescanner', 'QR-Code-Scanner'],
  ['barcodescanners', 'QR-Code-Scanner'],
  ['drucker', 'Drucker'],
  ['printer', 'Drucker'],
  ['printers', 'Drucker'],
  ['laserdrucker', 'Drucker'],
  ['kartendrucker', 'Kartendrucker'],
  ['cardprinter', 'Kartendrucker'],
  ['cardprinters', 'Kartendrucker'],
  ['switch', 'Switch'],
  ['switches', 'Switch'],
  ['router', 'Router'],
  ['routers', 'Router'],
  ['wlanrouter', 'Router'],
  ['wifirouter', 'Router'],
  ['gateway', 'Router'],
  ['lterouter', 'LTE-Router'],
  ['lterouters', 'LTE-Router'],
  ['4grouter', 'LTE-Router'],
  ['5grouter', 'LTE-Router'],
  ['zubehoer', 'Zubehör'],
  ['zubehör', 'Zubehör'],
  ['accessory', 'Zubehör'],
  ['accessories', 'Zubehör'],
  ['sonstiges', 'Sonstiges'],
  ['misc', 'Sonstiges'],
  ['miscellaneous', 'Sonstiges'],
  ['other', 'Sonstiges'],
]);

for (const category of CANONICAL_CATEGORIES) {
  CATEGORY_ALIASES.set(categoryKey(category), category);
}

export function normalizeCategory(value: string | null | undefined): CanonicalCategory {
  return CATEGORY_ALIASES.get(categoryKey(value)) ?? DEFAULT_CATEGORY;
}

export function isCanonicalCategory(value: string | null | undefined): value is CanonicalCategory {
  return CANONICAL_CATEGORIES.includes((value ?? '').trim() as CanonicalCategory);
}

export function categoryHint(value: string | null | undefined): CanonicalCategory | null {
  const normalized = normalizeCategory(value);
  if (normalized === DEFAULT_CATEGORY && categoryKey(value) !== categoryKey(DEFAULT_CATEGORY)) {
    return null;
  }
  return (value ?? '').trim() === normalized ? null : normalized;
}

export function categoryOptionsFromRecords(
  records: Array<{ name: string; isActive?: boolean }> | null | undefined,
): string[] {
  const activeNames = (records ?? [])
    .filter((item) => item.isActive !== false)
    .map((item) => item.name.trim())
    .filter(Boolean);
  const merged = activeNames.length ? activeNames : [...CANONICAL_CATEGORIES];
  const order = new Map<string, number>(
    CANONICAL_CATEGORIES.map((category, index) => [category, index]),
  );
  return [...new Set(merged)].sort((a, b) => {
    const left = order.get(a) ?? 10_000;
    const right = order.get(b) ?? 10_000;
    return left === right ? a.localeCompare(b, 'de') : left - right;
  });
}
