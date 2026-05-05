/**
 * Gemeinsame Drucklogik fuer Einzel- und Massendruck von QR-Labels.
 *
 * - Kein window.open, kein document.write, kein innerHTML fuer Nutzdaten.
 * - Texte werden ausschliesslich ueber textContent in DOM-Elementen gesetzt.
 * - Nutzt globale @media print-Regeln aus index.css (body.wms-printing[-single|-mass]).
 * - Ein temporaerer Container <div class="wms-print-root"> wird an document.body angehaengt
 *   und nach afterprint (bzw. einem Sicherheits-Timeout) wieder entfernt.
 * - @page-Regel wird je Modus kurz injiziert, weil @page nicht via Body-Klasse gescoped
 *   werden kann.
 */

const PRINT_ROOT_CLASS = 'wms-print-root';
const BODY_PRINTING_CLASS = 'wms-printing';
const BODY_SINGLE_CLASS = 'wms-printing-single';
const BODY_MASS_CLASS = 'wms-printing-mass';
const PAGE_STYLE_ATTR = 'data-wms-page-style';
const SAFETY_TIMEOUT_MS = 30_000;

export type LabelInput = {
  qrDataUrl: string;
  assetName: string;
  tagNumber?: string;
};

export type MassLabelSettings = {
  labelWidthMm: number;
  labelHeightMm: number;
  qrSizeMm: number;
  fontSizePt: number;
  gapMm: number;
  paddingTopMm: number;
  paddingRightMm: number;
  paddingBottomMm: number;
  paddingLeftMm: number;
  offsetXMm: number;
  offsetYMm: number;
  fontWeight: number;
  textMaxLines: number;
};

type PrintMode = 'single' | 'mass';

function clearLingering(): void {
  document.body.classList.remove(BODY_PRINTING_CLASS, BODY_SINGLE_CLASS, BODY_MASS_CLASS);
  document.querySelectorAll(`style[${PAGE_STYLE_ATTR}]`).forEach((el) => el.remove());
  document.querySelectorAll(`.${PRINT_ROOT_CLASS}`).forEach((el) => el.remove());
}

function buildLabel(input: LabelInput, includeTag: boolean): HTMLDivElement {
  const page = document.createElement('div');
  page.className = 'wms-label-page';

  const inner = document.createElement('div');
  inner.className = 'wms-label-inner';

  const img = document.createElement('img');
  img.className = 'wms-label-img';
  img.alt = '';
  img.src = input.qrDataUrl;

  const name = document.createElement('div');
  name.className = 'wms-label-name';
  name.textContent = input.assetName;

  inner.appendChild(img);
  inner.appendChild(name);

  if (includeTag && input.tagNumber) {
    const tag = document.createElement('div');
    tag.className = 'wms-label-tag';
    tag.textContent = input.tagNumber;
    inner.appendChild(tag);
  }

  page.appendChild(inner);
  return page;
}

function injectPageStyle(mode: PrintMode): HTMLStyleElement {
  const rule =
    mode === 'single'
      ? '@page { size: auto; margin: 12mm; }'
      : '@page { size: 89mm 41mm; margin: 0; }';
  const style = document.createElement('style');
  style.setAttribute(PAGE_STYLE_ATTR, mode);
  style.textContent = rule;
  document.head.appendChild(style);
  return style;
}

function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  if (!images.length) return Promise.resolve();

  const waitOne = (img: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      if (img.complete && img.naturalWidth > 0) {
        resolve();
        return;
      }
      const done = () => {
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
        resolve();
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });

  return Promise.all(images.map(waitOne)).then(() => undefined);
}

function runPrint(labels: LabelInput[], mode: PrintMode, massSettings?: MassLabelSettings): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return Promise.resolve();
  if (!labels.length) return Promise.resolve();

  clearLingering();

  const modeClass = mode === 'single' ? BODY_SINGLE_CLASS : BODY_MASS_CLASS;
  const includeTag = mode === 'single';

  const root = document.createElement('div');
  root.className = PRINT_ROOT_CLASS;
  root.setAttribute('aria-hidden', 'true');
  if (mode === 'mass' && massSettings) {
    root.style.setProperty('--wms-label-width-mm', `${massSettings.labelWidthMm}mm`);
    root.style.setProperty('--wms-label-height-mm', `${massSettings.labelHeightMm}mm`);
    root.style.setProperty('--wms-qr-size-mm', `${massSettings.qrSizeMm}mm`);
    root.style.setProperty('--wms-font-size-pt', `${massSettings.fontSizePt}pt`);
    root.style.setProperty('--wms-gap-mm', `${massSettings.gapMm}mm`);
    root.style.setProperty('--wms-padding-top-mm', `${massSettings.paddingTopMm}mm`);
    root.style.setProperty('--wms-padding-right-mm', `${massSettings.paddingRightMm}mm`);
    root.style.setProperty('--wms-padding-bottom-mm', `${massSettings.paddingBottomMm}mm`);
    root.style.setProperty('--wms-padding-left-mm', `${massSettings.paddingLeftMm}mm`);
    root.style.setProperty('--wms-offset-x-mm', `${massSettings.offsetXMm}mm`);
    root.style.setProperty('--wms-offset-y-mm', `${massSettings.offsetYMm}mm`);
    root.style.setProperty('--wms-font-weight', `${massSettings.fontWeight}`);
    root.style.setProperty('--wms-text-max-lines', `${massSettings.textMaxLines}`);
  }

  for (const label of labels) {
    root.appendChild(buildLabel(label, includeTag));
  }

  const pageStyle = injectPageStyle(mode);
  document.body.appendChild(root);
  document.body.classList.add(BODY_PRINTING_CLASS, modeClass);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.removeEventListener('afterprint', cleanup);
    document.body.classList.remove(BODY_PRINTING_CLASS, modeClass);
    pageStyle.remove();
    root.remove();
  };

  window.addEventListener('afterprint', cleanup);
  // Sicherheits-Cleanup, falls afterprint nicht ausgeloest wird
  // (manche Browser feuern es bei Druckabbruch unzuverlaessig).
  window.setTimeout(cleanup, SAFETY_TIMEOUT_MS);

  return waitForImages(root).then(
    () =>
      new Promise<void>((resolve) => {
        // Ein Frame Wartezeit, damit Layout/Rendering definitiv abgeschlossen sind,
        // bevor der Druckdialog den Snapshot zieht.
        requestAnimationFrame(() => {
          try {
            window.print();
          } finally {
            resolve();
          }
        });
      }),
  );
}

export function printSingleLabel(input: LabelInput): Promise<void> {
  return runPrint([input], 'single');
}

export function printMultipleLabels(inputs: LabelInput[], massSettings?: MassLabelSettings): Promise<void> {
  return runPrint(inputs, 'mass', massSettings);
}
