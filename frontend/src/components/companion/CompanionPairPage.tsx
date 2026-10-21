import { CheckCircle2, ScanLine, Smartphone, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { QrScannerDialog } from '../../asset-ui/components/QrScannerDialog';
import {
  cancelCompanionClaim,
  claimCompanionPairing,
  completeCompanionPairing,
  fetchCompanionClaimStatus,
  type CompanionClaim,
} from '../../services/wmsApi';
import { COMPANION_PAIR_PATH, extractPairingCode, phoneStatusMessage } from './companionPairing';
import { skipNextStartLock } from './appLock';
import { CompanionOnboarding } from './CompanionOnboarding';

type Phase =
  | { kind: 'scan'; message?: string }
  | { kind: 'claiming' }
  | { kind: 'confirm'; claim: CompanionClaim }
  | { kind: 'completing' }
  | { kind: 'done'; deviceName: string }
  | { kind: 'error'; message: string };

const POLL_MS = 2000;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Öffentliche Kopplungsseite auf dem Smartphone.
 *
 * Der Kopplungscode kommt über das #-Fragment (QR mit der normalen Kamera)
 * oder über den eingebauten Scanner (wichtig für die installierte
 * Homescreen-App: iOS trennt deren Speicher vom Safari-Browser, die Kopplung
 * muss daher in genau dem Kontext stattfinden, in dem die App später läuft).
 */
export function CompanionPairPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'scan' });
  const [scannerOpen, setScannerOpen] = useState(false);
  const startedRef = useRef(false);

  const claim = useCallback(async (code: string) => {
    setPhase({ kind: 'claiming' });
    try {
      const result = await claimCompanionPairing(code);
      setPhase({ kind: 'confirm', claim: result });
    } catch (err) {
      setPhase({ kind: 'error', message: errorText(err, 'Der QR-Code konnte nicht eingelöst werden.') });
    }
  }, []);

  // Code aus dem Fragment übernehmen und sofort aus der Adresszeile entfernen
  // (kein Verbleib in Verlauf, Lesezeichen oder Screenshots der URL).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const fragment = window.location.hash;
    if (fragment) {
      window.history.replaceState(null, '', COMPANION_PAIR_PATH);
      const code = extractPairingCode(fragment);
      if (code) {
        void claim(code);
      } else {
        setPhase({ kind: 'scan', message: 'Dieser Link enthält keinen gültigen Kopplungscode.' });
      }
    }
  }, [claim]);

  // Warten auf die Entscheidung am PC.
  useEffect(() => {
    if (phase.kind !== 'confirm') return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const status = await fetchCompanionClaimStatus();
        if (stopped) return;
        if (status.status === 'approved') {
          stopped = true;
          window.clearInterval(timer);
          setPhase({ kind: 'completing' });
          try {
            const session = await completeCompanionPairing();
            setPhase({ kind: 'done', deviceName: session.deviceName });
          } catch (err) {
            setPhase({ kind: 'error', message: errorText(err, 'Die Verbindung konnte nicht abgeschlossen werden.') });
          }
        } else if (status.status !== 'claimed') {
          stopped = true;
          window.clearInterval(timer);
          setPhase({ kind: 'error', message: phoneStatusMessage(status.status) });
        }
      } catch (err) {
        // 404 = Kopplung verfallen/abgebrochen; Netzwerkfehler -> weiter versuchen.
        if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
          stopped = true;
          window.clearInterval(timer);
          setPhase({ kind: 'error', message: phoneStatusMessage('expired') });
        }
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase.kind]);

  const onScanned = (value: string) => {
    setScannerOpen(false);
    const code = extractPairingCode(value, window.location.origin);
    if (!code) {
      setPhase({
        kind: 'scan',
        message: 'Das ist kein Kopplungscode dieses Warehouse-Systems. Bitte den QR-Code unter „Mein Konto → Companion App" am PC scannen.',
      });
      return;
    }
    void claim(code);
  };

  const abort = async () => {
    await cancelCompanionClaim();
    setPhase({ kind: 'scan', message: 'Kopplung abgebrochen.' });
  };

  return (
    <main className="min-h-[100dvh] bg-canvas px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-ink">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Smartphone className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Warehouse Companion</h1>
            <p className="text-sm text-ink-muted">Smartphone mit deinem Konto verbinden</p>
          </div>
        </header>

        {phase.kind === 'scan' ? (
          <section className="surface-card space-y-4">
            {phase.message ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">{phase.message}</p>
            ) : null}
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
              <li>Am PC im Warehouse-System „Mein Konto → Companion App" öffnen.</li>
              <li>„Neues Gerät verbinden" wählen.</li>
              <li>Den angezeigten QR-Code hier scannen und am PC bestätigen.</li>
            </ol>
            <button type="button" className="btn-primary min-h-[48px] w-full" onClick={() => setScannerOpen(true)}>
              <span className="inline-flex items-center justify-center gap-2"><ScanLine className="h-5 w-5" /> QR-Code scannen</span>
            </button>
            <p className="text-xs text-ink-muted">Die Kamera wird nur zum Einlesen des QR-Codes verwendet; es werden keine Bilder gespeichert.</p>
            <a href="/login" className="block text-center text-sm font-medium text-primary hover:underline">Stattdessen normal anmelden</a>
          </section>
        ) : null}

        {phase.kind === 'claiming' || phase.kind === 'completing' ? (
          <section className="surface-card text-sm text-ink-muted" role="status">
            {phase.kind === 'claiming' ? 'QR-Code wird geprüft …' : 'Verbindung wird abgeschlossen …'}
          </section>
        ) : null}

        {phase.kind === 'confirm' ? (
          <section className="surface-card space-y-4">
            <div>
              <p className="text-sm text-ink-muted">Verbinden mit dem Konto</p>
              <p className="text-base font-semibold">{phase.claim.accountName}</p>
              <p className="text-sm text-ink-muted">{phase.claim.accountEmail}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center">
              <p className="text-xs uppercase tracking-wide text-ink-muted">Abgleichcode</p>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.3em]">{phase.claim.matchCode}</p>
            </div>
            <p className="text-sm" role="status">
              Bitte bestätige die Verbindung jetzt <strong>am PC</strong> und prüfe, dass dort derselbe Code angezeigt wird.
            </p>
            <button type="button" className="btn-secondary min-h-[44px] w-full" onClick={() => void abort()}>
              Abbrechen
            </button>
          </section>
        ) : null}

        {phase.kind === 'done' ? (
          <section className="space-y-4">
            <div className="surface-card flex items-center gap-3 border-emerald-200">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold">Gerät erfolgreich verbunden</p>
                <p className="text-sm text-ink-muted">Dieses Gerät ist jetzt als „{phase.deviceName}" mit deinem Konto verbunden.</p>
              </div>
            </div>
            <CompanionOnboarding
              onContinue={() => {
                skipNextStartLock();
                window.location.replace('/dashboard');
              }}
            />
          </section>
        ) : null}

        {phase.kind === 'error' ? (
          <section className="surface-card space-y-4">
            <p className="flex items-start gap-2 text-sm" role="alert">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              {phase.message}
            </p>
            <button type="button" className="btn-primary min-h-[44px] w-full" onClick={() => setPhase({ kind: 'scan' })}>
              Neuen QR-Code scannen
            </button>
          </section>
        ) : null}
      </div>

      {scannerOpen ? (
        <QrScannerDialog title="Kopplungscode scannen" onDetected={onScanned} onClose={() => setScannerOpen(false)} />
      ) : null}
    </main>
  );
}
