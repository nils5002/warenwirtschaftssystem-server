import QRCode from 'qrcode';
import { CheckCircle2, RefreshCw, Smartphone, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppDialog } from '../dialogs/AppDialogProvider';
import { InstallInstructions } from './CompanionOnboarding';
import { PasskeySetupCard } from './PasskeySetupCard';
import { LoadingButton } from '../loading';
import {
  decideCompanionPairing,
  fetchCompanionPairing,
  fetchCompanionSettings,
  revokeAllCompanionDevices,
  revokeCompanionDevice,
  setCompanionEnabled,
  startCompanionPairing,
  type CompanionPairingState,
  type CompanionSettings,
} from '../../services/wmsApi';
import {
  buildPairingUrl,
  deviceLabel,
  formatCountdown,
  isFinalPairingStatus,
  relativeTime,
} from './companionPairing';

const POLL_MS = 2000;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Kopplungsdialog am PC: QR-Code, Ablauf, Bestätigung der Anfrage. */
function PairingDialog({ onClose, onPaired }: { onClose: () => void; onPaired: () => void }) {
  const [pairing, setPairing] = useState<CompanionPairingState | null>(null);
  const [qr, setQr] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const closedRef = useRef(false);

  const create = useCallback(async () => {
    setError('');
    setQr('');
    setPairing(null);
    try {
      const started = await startCompanionPairing();
      const url = buildPairingUrl(window.location.origin, started.pairingCode);
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
      if (closedRef.current) return;
      setQr(dataUrl);
      setPairing({
        pairingId: started.pairingId,
        status: 'pending',
        expiresAt: started.expiresAt,
        expiresInSeconds: started.expiresInSeconds,
      });
      setSecondsLeft(started.expiresInSeconds);
    } catch (err) {
      setError(errorText(err, 'QR-Code konnte nicht erzeugt werden.'));
    }
  }, []);

  // Genau EIN Code beim Öffnen — auch wenn React den Effekt doppelt ausführt
  // (StrictMode). Ein zweiter Code würde den ersten serverseitig verwerfen.
  const startedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      void create();
    }
    return () => {
      closedRef.current = true;
    };
  }, [create]);

  // Countdown lokal, Status per Polling vom Server.
  useEffect(() => {
    if (!pairing || isFinalPairingStatus(pairing.status)) return;
    const tick = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    const poll = window.setInterval(async () => {
      try {
        const next = await fetchCompanionPairing(pairing.pairingId);
        if (closedRef.current) return;
        setPairing(next);
        setSecondsLeft(next.expiresInSeconds);
        if (next.status === 'consumed') onPaired();
      } catch {
        // Kurzer Netzwerkfehler: beim nächsten Durchlauf erneut versuchen.
      }
    }, POLL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [pairing?.pairingId, pairing?.status, onPaired]);

  const decide = async (action: 'approve' | 'reject') => {
    if (!pairing) return;
    setBusy(true);
    setError('');
    try {
      setPairing(await decideCompanionPairing(pairing.pairingId, action));
    } catch (err) {
      setError(errorText(err, 'Die Entscheidung konnte nicht gespeichert werden.'));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    closedRef.current = true;
    if (pairing && !isFinalPairingStatus(pairing.status)) {
      try {
        await decideCompanionPairing(pairing.pairingId, 'cancel');
      } catch {
        // Abbruch ist best effort — der Code verfällt ohnehin.
      }
    }
    onClose();
  };

  const status = pairing?.status;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="pairing-title">
      <div className="surface-card max-h-[100dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-b-none sm:rounded-b-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="pairing-title" className="text-base font-semibold text-slate-900">Neues Gerät verbinden</h2>
            <p className="mt-1 text-sm text-slate-600">
              Scanne den Code mit der Kamera deines Smartphones oder in der installierten Companion App.
            </p>
          </div>
          <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => void close()} aria-label="Schließen">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{error}</p> : null}

        {status === 'pending' && qr ? (
          <div className="space-y-3 text-center">
            <img src={qr} alt="QR-Code zum Verbinden des Smartphones" className="mx-auto h-64 w-64 rounded-xl bg-white p-2" />
            <p className="text-sm text-slate-600">
              Gültig noch <span className="font-semibold tabular-nums text-slate-900">{formatCountdown(secondsLeft)}</span> · nur einmal verwendbar
            </p>
          </div>
        ) : null}

        {status === 'claimed' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Ein Gerät möchte sich mit deinem Konto verbinden</p>
              <p className="mt-1">{deviceLabel(pairing?.deviceName || 'Smartphone', pairing?.devicePlatform)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-slate-500">Abgleichcode</p>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.3em] text-slate-900">{pairing?.matchCode}</p>
              <p className="mt-1 text-xs text-slate-500">Muss mit dem Code auf dem Smartphone übereinstimmen.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LoadingButton type="button" className="btn-secondary min-h-[44px]" isLoading={busy} onClick={() => void decide('reject')}>
                Ablehnen
              </LoadingButton>
              <LoadingButton type="button" className="btn-primary min-h-[44px]" isLoading={busy} onClick={() => void decide('approve')}>
                Verbinden
              </LoadingButton>
            </div>
            <p className="text-xs text-slate-500">Nur bestätigen, wenn du das Gerät selbst in der Hand hast.</p>
          </div>
        ) : null}

        {status === 'approved' ? (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">Bestätigt — das Smartphone schließt die Verbindung ab …</p>
        ) : null}

        {status === 'consumed' ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Gerät erfolgreich verbunden</p>
          </div>
        ) : null}

        {status === 'expired' || status === 'rejected' || status === 'cancelled' ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {status === 'expired'
              ? 'Der QR-Code ist abgelaufen.'
              : status === 'rejected'
                ? 'Die Anfrage wurde abgelehnt. Das Gerät wurde nicht verbunden.'
                : 'Die Kopplung wurde abgebrochen.'}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {status !== 'claimed' && status !== 'approved' && status !== 'consumed' ? (
            <button type="button" className="btn-secondary min-h-[44px]" onClick={() => void create()}>
              <span className="inline-flex items-center gap-1"><RefreshCw className="h-4 w-4" /> Neuen Code erzeugen</span>
            </button>
          ) : null}
          <button type="button" className={status === 'consumed' ? 'btn-primary min-h-[44px]' : 'btn-secondary min-h-[44px]'} onClick={() => void close()}>
            {status === 'consumed' ? 'Fertig' : 'Abbrechen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Kontoeinstellungen → Companion App. */
export function CompanionSection() {
  const { confirm } = useAppDialog();
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await fetchCompanionSettings());
      setError('');
    } catch (err) {
      setError(errorText(err, 'Companion-Einstellungen konnten nicht geladen werden.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!settings) return;
    const next = !settings.enabled;
    if (!next) {
      const ok = await confirm({
        title: 'Companion App deaktivieren?',
        message:
          settings.devices.length > 0
            ? `Alle ${settings.devices.length} verbundenen Geräte werden sofort abgemeldet und müssen später neu verbunden werden.`
            : 'Es können dann keine Smartphones mehr verbunden werden.',
        confirmLabel: 'Deaktivieren',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setSettings(await setCompanionEnabled(next));
      setError('');
    } catch (err) {
      setError(errorText(err, 'Einstellung konnte nicht gespeichert werden.'));
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (deviceId: string, label: string, current: boolean) => {
    const ok = await confirm({
      title: 'Gerät entfernen?',
      message: current
        ? `„${label}" ist das Gerät, das du gerade benutzt. Du wirst darauf sofort abgemeldet.`
        : `„${label}" wird sofort abgemeldet. Andere Geräte und dieser PC bleiben angemeldet.`,
      confirmLabel: 'Entfernen',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await revokeCompanionDevice(deviceId);
      await load();
    } catch (err) {
      setError(errorText(err, 'Gerät konnte nicht entfernt werden.'));
    }
  };

  const removeAll = async () => {
    const ok = await confirm({
      title: 'Alle Geräte trennen?',
      message: 'Alle verbundenen Smartphones werden sofort abgemeldet. Dieser PC bleibt angemeldet.',
      confirmLabel: 'Alle trennen',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await revokeAllCompanionDevices();
      await load();
    } catch (err) {
      setError(errorText(err, 'Geräte konnten nicht getrennt werden.'));
    }
  };

  const onThisDevice = Boolean(settings?.currentDeviceId);

  return (
    <article className="surface-card space-y-4" aria-labelledby="companion-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
            <Smartphone className="h-4 w-4" />
          </span>
          <div>
            <h2 id="companion-title" className="text-base font-semibold text-slate-900">Companion App</h2>
            <p className="text-sm text-slate-600">Warehouse auf deinem Smartphone verwenden</p>
          </div>
        </div>
        {settings ? (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${settings.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
            {settings.enabled ? 'Aktiv' : 'Deaktiviert'}
          </span>
        ) : null}
      </div>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{error}</p> : null}

      {settings ? (
        <>
          <div className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-2">
            <span id="companion-toggle-label" className="text-sm font-medium text-slate-800">Companion App aktivieren</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enabled}
              aria-labelledby="companion-toggle-label"
              aria-describedby="companion-hint"
              disabled={busy}
              onClick={() => void toggle()}
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 ${
                settings.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-6 w-6 rounded-full bg-white shadow transition ${settings.enabled ? 'translate-x-7' : 'translate-x-1'}`}
              />
            </button>
          </div>
          <p id="companion-hint" className="text-xs text-slate-500">
            Verbundene Geräte nutzen dieselben Funktionen und Rechte wie dein Konto am PC. Jedes Gerät lässt sich hier jederzeit einzeln abmelden.
          </p>

          {settings.enabled ? (
            <>
              {onThisDevice ? (
                <div className="space-y-3">
                  <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    Du nutzt gerade die Companion App. Neue Geräte lassen sich nur am PC verbinden.
                  </p>
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">Schnelle Entsperrung</h3>
                    <PasskeySetupCard />
                  </div>
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">Zum Home-Bildschirm hinzufügen</h3>
                    <InstallInstructions />
                  </div>
                </div>
              ) : (
                <button type="button" className="btn-primary min-h-[44px]" onClick={() => setPairingOpen(true)}>
                  Neues Gerät verbinden
                </button>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">Verbundene Geräte</h3>
                {settings.devices.length === 0 ? (
                  <p className="text-sm text-slate-500">Noch kein Gerät verbunden.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {settings.devices.map((device) => {
                      const label = deviceLabel(device.name, device.platform);
                      return (
                        <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {label}
                              {device.current ? <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">Dieses Gerät</span> : null}
                            </p>
                            <p className="text-xs text-slate-500">
                              Verbunden {relativeTime(device.connectedAt)} · zuletzt aktiv {relativeTime(device.lastSeenAt)}
                              {device.passkeyRegistered ? ' · Entsperren per Passkey' : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
                            onClick={() => void removeDevice(device.id, label, device.current)}
                          >
                            <Trash2 className="h-4 w-4" /> Gerät entfernen
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {settings.devices.length > 1 ? (
                  <button type="button" className="min-h-[44px] text-sm font-semibold text-rose-700 hover:underline" onClick={() => void removeAll()}>
                    Alle Geräte trennen
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : !error ? (
        <p className="text-sm text-slate-500">Wird geladen …</p>
      ) : null}

      {pairingOpen ? (
        <PairingDialog
          onClose={() => {
            setPairingOpen(false);
            void load();
          }}
          onPaired={() => void load()}
        />
      ) : null}
    </article>
  );
}
