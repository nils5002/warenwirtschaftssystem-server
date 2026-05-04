/**
 * Druckt ein einzelnes QR-Label ohne window.open/document.write.
 *
 * Vorgehen:
 * - Eine temporaere Druckflaeche wird per DOM-API an document.body angehaengt.
 * - @media print blendet alles ausser dieser Flaeche aus.
 * - Nach afterprint (oder einem Sicherheits-Timeout) wird alles wieder entfernt.
 *
 * Texte werden ausschliesslich ueber textContent gesetzt — keine HTML-Injection.
 */

const PORTAL_ID = 'single-qr-print-portal';
const STYLE_FLAG = 'single-qr-print-style';
const CLEANUP_TIMEOUT_MS = 30_000;

export type PrintQrLabelInput = {
  qrDataUrl: string;
  assetName: string;
  tagNumber: string;
};

function removeExisting(): void {
  document.getElementById(PORTAL_ID)?.remove();
  document.querySelector(`style[data-${STYLE_FLAG}]`)?.remove();
}

function buildStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.setAttribute(`data-${STYLE_FLAG}`, 'true');
  style.textContent = `
    #${PORTAL_ID} {
      display: none;
    }

    @page {
      size: auto;
      margin: 12mm;
    }

    @media print {
      body > *:not(#${PORTAL_ID}) {
        display: none !important;
      }

      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        color: #000 !important;
        font-family: Arial, sans-serif;
      }

      #${PORTAL_ID} {
        display: block !important;
        position: static !important;
        background: #fff !important;
      }

      #${PORTAL_ID} .qr-single-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 8mm;
      }

      #${PORTAL_ID} .qr-single-img {
        width: 60mm;
        height: 60mm;
        object-fit: contain;
        margin-bottom: 6mm;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 2mm;
        background: #fff;
      }

      #${PORTAL_ID} .qr-single-name {
        font-size: 14pt;
        font-weight: 700;
        text-align: center;
        margin-bottom: 2mm;
        color: #000;
        max-width: 90mm;
        word-break: break-word;
      }

      #${PORTAL_ID} .qr-single-tag {
        font-size: 12pt;
        text-align: center;
        color: #000;
        max-width: 90mm;
        word-break: break-word;
      }
    }
  `;
  return style;
}

function buildPortal({ qrDataUrl, assetName, tagNumber }: PrintQrLabelInput): {
  portal: HTMLDivElement;
  image: HTMLImageElement;
} {
  const portal = document.createElement('div');
  portal.id = PORTAL_ID;
  portal.setAttribute('aria-hidden', 'true');

  const wrap = document.createElement('div');
  wrap.className = 'qr-single-wrap';

  const image = document.createElement('img');
  image.className = 'qr-single-img';
  image.src = qrDataUrl;
  image.alt = '';

  const nameNode = document.createElement('div');
  nameNode.className = 'qr-single-name';
  nameNode.textContent = assetName;

  const tagNode = document.createElement('div');
  tagNode.className = 'qr-single-tag';
  tagNode.textContent = tagNumber;

  wrap.appendChild(image);
  wrap.appendChild(nameNode);
  wrap.appendChild(tagNode);
  portal.appendChild(wrap);

  return { portal, image };
}

export function printQrLabel(input: PrintQrLabelInput): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!input.qrDataUrl) return;

  removeExisting();

  const style = buildStyle();
  const { portal, image } = buildPortal(input);

  document.head.appendChild(style);
  document.body.appendChild(portal);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.removeEventListener('afterprint', cleanup);
    style.remove();
    portal.remove();
  };

  window.addEventListener('afterprint', cleanup);
  // Sicherheits-Cleanup, falls afterprint nicht ausgeloest wird
  // (manche Browser feuern es bei Abbruch unzuverlaessig).
  window.setTimeout(cleanup, CLEANUP_TIMEOUT_MS);

  const triggerPrint = () => {
    try {
      window.print();
    } finally {
      // Falls afterprint synchron nach print() ausbleibt, geben wir der Page Zeit,
      // den Druckdialog noch zu rendern. Cleanup kommt dann ueber afterprint
      // oder den Sicherheits-Timeout oben.
    }
  };

  if (image.complete && image.naturalWidth > 0) {
    triggerPrint();
    return;
  }

  const onResolved = () => {
    image.removeEventListener('load', onResolved);
    image.removeEventListener('error', onResolved);
    triggerPrint();
  };
  image.addEventListener('load', onResolved, { once: true });
  image.addEventListener('error', onResolved, { once: true });
}
