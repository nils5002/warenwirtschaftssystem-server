import { CheckCircle2, Download, Share } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  canPromptInstall,
  detectInstallPlatform,
  isRunningStandalone,
  onInstallPromptChange,
  promptInstall,
} from '../../pwa/installHints';
import { PasskeySetupCard } from './PasskeySetupCard';

function Step({ title, done, children }: { title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="surface-card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : null}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Installationsanleitung passend zur Plattform (iOS / Android / sonstige). */
export function InstallInstructions() {
  const platform = detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const [promptAvailable, setPromptAvailable] = useState(canPromptInstall());
  const [installed, setInstalled] = useState(isRunningStandalone());

  useEffect(() => onInstallPromptChange(() => {
    setPromptAvailable(canPromptInstall());
    setInstalled(isRunningStandalone());
  }), []);

  if (installed) {
    return <p className="text-sm text-ink-muted">Die App läuft bereits installiert vom Home-Bildschirm.</p>;
  }
  if (platform === 'ios') {
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
        <li>
          In Safari unten auf <Share className="inline h-4 w-4" aria-label="Teilen" /> <strong>Teilen</strong> tippen.
        </li>
        <li><strong>„Zum Home-Bildschirm"</strong> wählen und bestätigen.</li>
        <li>
          Die App vom Home-Bildschirm öffnen. iOS trennt die installierte App vom Browser: Verbinde das Gerät
          dort bei Bedarf einmal erneut über „QR-Code scannen".
        </li>
      </ol>
    );
  }
  if (platform === 'android' && promptAvailable) {
    return (
      <button type="button" className="btn-primary min-h-[44px] w-full" onClick={() => void promptInstall()}>
        <span className="inline-flex items-center justify-center gap-2"><Download className="h-4 w-4" /> App installieren</span>
      </button>
    );
  }
  return (
    <p className="text-sm text-ink-muted">
      Im Browsermenü (⋮) <strong>„App installieren"</strong> bzw. <strong>„Zum Startbildschirm hinzufügen"</strong> wählen.
    </p>
  );
}

/** Nächste Schritte direkt nach der erfolgreichen Kopplung. */
export function CompanionOnboarding({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <Step title="Zum Home-Bildschirm hinzufügen" done={isRunningStandalone()}>
        <InstallInstructions />
      </Step>
      <Step title="Schnelle Entsperrung einrichten">
        <PasskeySetupCard />
      </Step>
      <button type="button" className="btn-primary min-h-[48px] w-full" onClick={onContinue}>
        Zur App
      </button>
    </div>
  );
}
