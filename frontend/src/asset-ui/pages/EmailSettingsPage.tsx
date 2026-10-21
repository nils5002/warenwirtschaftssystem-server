import {
  Activity,
  CheckCircle2,
  Info,
  Link2,
  Mail,
  MailCheck,
  Plug,
  Send,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { LoadingButton } from '../../components/loading';
import { PageHeader } from '../../ui';
import {
  fetchMailSettings,
  fetchMailStatus,
  saveMailSettings,
  sendMailTest,
  testMailConnection,
  updateRegistrationMode,
  type MailSecurity,
  type MailStatus,
  type RegistrationMode,
} from '../../services/wmsApi';
import {
  formFromSettings,
  keySourceLabel,
  payloadFromForm,
  publicUrlSourceLabel,
  registrationModeLabel,
  securityOptions,
  sourceLabel,
  statusView,
  validateForm,
  verificationBlockers,
  type MailFormState,
  type StatusTone,
} from './mailSettings';

type Feedback = { kind: 'success' | 'error' | 'info'; text: string } | null;

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
};

const FEEDBACK_CLASSES: Record<'success' | 'error' | 'info', string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'warning'; children: React.ReactNode }) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  const classes =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-sky-200 bg-sky-50 text-sky-800';
  return (
    <p className={`rounded-xl border px-3 py-2 text-xs ${classes}`}>
      <Icon className="mr-1 inline h-3.5 w-3.5" />
      {children}
    </p>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Mail; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
      <Icon className="h-4 w-4 text-brand-700" />
      {children}
    </div>
  );
}

export function EmailSettingsPage() {
  const [form, setForm] = useState<MailFormState | null>(null);
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [testRecipient, setTestRecipient] = useState('');

  const load = async () => {
    const [settings, nextStatus] = await Promise.all([fetchMailSettings(), fetchMailStatus()]);
    setForm(formFromSettings(settings));
    setStatus(nextStatus);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await load();
      } catch (error) {
        setFeedback({
          kind: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'E-Mail-Einstellungen konnten nicht geladen werden.',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (patch: Partial<MailFormState>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  const save = async (options?: { clearPassword?: boolean }) => {
    if (!form) return;
    const validation = validateForm(form);
    if (!validation.ok) {
      setFeedback({ kind: 'error', text: validation.error ?? 'Eingaben prüfen.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await saveMailSettings(payloadFromForm(form, options));
      setForm(formFromSettings(saved));
      setStatus(await fetchMailStatus());
      setFeedback({
        kind: 'success',
        text: 'Einstellungen gespeichert und sofort wirksam. Bitte Verbindung testen und eine Test-E-Mail senden.',
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Speichern fehlgeschlagen.',
      });
    } finally {
      setSaving(false);
    }
  };

  const runConnectionTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const result = await testMailConnection();
      setStatus(await fetchMailStatus());
      setFeedback({ kind: result.success ? 'success' : 'error', text: result.message });
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Verbindungstest fehlgeschlagen.',
      });
    } finally {
      setTesting(false);
    }
  };

  const runSendTest = async () => {
    const recipient = testRecipient.trim();
    if (!recipient) {
      setFeedback({ kind: 'error', text: 'Bitte eine Empfänger-E-Mail-Adresse eingeben.' });
      return;
    }
    setSending(true);
    setFeedback(null);
    try {
      const result = await sendMailTest(recipient);
      setStatus(await fetchMailStatus());
      setFeedback({ kind: result.success ? 'success' : 'error', text: result.message });
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Test-E-Mail konnte nicht gesendet werden.',
      });
    } finally {
      setSending(false);
    }
  };

  const switchMode = async (mode: RegistrationMode) => {
    if (!status || status.registrationMode === mode) return;
    setSwitching(true);
    setFeedback(null);
    try {
      const result = await updateRegistrationMode(mode);
      setStatus(await fetchMailStatus());
      setFeedback({ kind: 'success', text: result.message });
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Verfahren konnte nicht geändert werden.',
      });
    } finally {
      setSwitching(false);
    }
  };

  if (loading || !form) {
    return (
      <section className="space-y-5">
        <PageHeader
          kicker="System"
          title="E-Mail-Einstellungen"
          subtitle="SMTP-Versand und Registrierungsverfahren verwalten."
        />
        {feedback ? (
          <div className={`rounded-xl border px-4 py-3 text-sm ${FEEDBACK_CLASSES[feedback.kind]}`}>
            {feedback.text}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Wird geladen ...</p>
        )}
      </section>
    );
  }

  const view = status ? statusView(status) : null;
  const blockers = verificationBlockers(status);
  const verificationSelectable = Boolean(status?.canEnableVerification);
  const currentMode: RegistrationMode = status?.registrationMode ?? 'classic_admin_approval';
  const plainAllowed = Boolean(status?.plainSmtpAllowed);
  const securityChoices = securityOptions(form.security, plainAllowed);

  return (
    <section className="space-y-5">
      <PageHeader
        kicker="System"
        title="E-Mail-Einstellungen"
        subtitle="SMTP-Versand einrichten, testen und das Registrierungsverfahren festlegen."
      />

      {feedback ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${FEEDBACK_CLASSES[feedback.kind]}`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* --- Bereich 1: E-Mail-Status --- */}
      {view && status ? (
        <article className="surface-card space-y-3 animate-fade-up">
          <SectionTitle icon={Mail}>E-Mail-Status</SectionTitle>
          <div className={`rounded-xl border px-4 py-3 ${TONE_CLASSES[view.tone]}`}>
            <p className="text-sm font-semibold">{view.title}</p>
            <p className="mt-1 text-sm">{view.description}</p>
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <InfoRow label="Registrierungsverfahren">
              {registrationModeLabel(status.registrationMode)}
            </InfoRow>
            <InfoRow label="Selbstregistrierung">
              {status.registrationEnabled ? 'offen' : 'gesperrt'}
            </InfoRow>
          </dl>
          {!status.secretStorageAvailable ? (
            <Notice tone="warning">
              {status.secretStorageHint ?? 'Es kann derzeit kein SMTP-Passwort gespeichert werden.'}{' '}
              Alle übrigen Funktionen — insbesondere die klassische Registrierung — laufen
              unverändert weiter.
            </Notice>
          ) : null}
          {status.passwordReadable === false ? (
            <Notice tone="warning">
              Das gespeicherte SMTP-Passwort kann mit dem aktuellen Schlüssel nicht gelesen
              werden (z. B. nach einer Änderung des Server-Secrets oder einem Restore). Bitte
              das Passwort unten neu eingeben und speichern.
            </Notice>
          ) : null}
        </article>
      ) : null}

      {/* --- Bereich 2: SMTP-Einstellungen --- */}
      <article className="surface-card space-y-4 animate-fade-up">
        <SectionTitle icon={Plug}>SMTP-Einstellungen</SectionTitle>

        {status?.source === 'env' ? (
          <Notice tone="info">
            Aktuell gelten die Server-Umgebungsvariablen. Sobald hier eine Konfiguration
            gespeichert und aktiviert wird, hat sie Vorrang — ein Neustart ist nicht nötig.
          </Notice>
        ) : null}

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={form.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          SMTP-Versand aktivieren
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SMTP-Server">
            <input
              className="field-input"
              value={form.host}
              placeholder="smtp.example.de"
              onChange={(event) => update({ host: event.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="Port" hint="587 für STARTTLS, 465 für SSL/TLS">
            <input
              className="field-input"
              inputMode="numeric"
              value={form.port}
              onChange={(event) => update({ port: event.target.value })}
            />
          </Field>
          <Field
            label="Verschlüsselung"
            hint={
              form.security === 'none' && !plainAllowed
                ? 'Unverschlüsselter Versand ist im Produktivbetrieb gesperrt — bitte STARTTLS oder SSL/TLS wählen.'
                : undefined
            }
          >
            <select
              className="field-input"
              value={form.security}
              onChange={(event) => update({ security: event.target.value as MailSecurity })}
            >
              {securityChoices.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Verbindungs-Timeout (Sekunden)">
            <input
              className="field-input"
              inputMode="numeric"
              value={form.timeoutSeconds}
              onChange={(event) => update({ timeoutSeconds: event.target.value })}
            />
          </Field>
          <Field label="Benutzername">
            <input
              className="field-input"
              value={form.username}
              placeholder="noreply@example.de"
              onChange={(event) => update({ username: event.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field
            label="Passwort"
            hint={
              form.passwordTouched
                ? 'Wird beim Speichern verschlüsselt abgelegt.'
                : 'Leer lassen, um das gespeicherte Passwort beizubehalten.'
            }
          >
            <input
              className="field-input"
              type="password"
              value={form.password}
              onChange={(event) => update({ password: event.target.value, passwordTouched: true })}
              onFocus={() => {
                // Platzhalter beim ersten Antippen leeren, damit niemand
                // versehentlich Sternchen als Passwort speichert.
                if (!form.passwordTouched) update({ password: '', passwordTouched: true });
              }}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Absender-E-Mail">
            <input
              className="field-input"
              value={form.fromEmail}
              placeholder="noreply@example.de"
              onChange={(event) => update({ fromEmail: event.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="Absendername">
            <input
              className="field-input"
              value={form.fromName}
              placeholder="Warehouse-System"
              onChange={(event) => update({ fromName: event.target.value })}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <LoadingButton
            type="button"
            className="btn-primary"
            onClick={() => void save()}
            isLoading={saving}
            loadingText="Speichert ..."
          >
            Speichern
          </LoadingButton>
          <LoadingButton
            type="button"
            className="btn-secondary"
            onClick={() => void runConnectionTest()}
            isLoading={testing}
            loadingText="Testet ..."
          >
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-4 w-4" />
              Verbindung testen
            </span>
          </LoadingButton>
          {form.password && !form.passwordTouched ? (
            <LoadingButton
              type="button"
              className="btn-secondary border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              onClick={() => void save({ clearPassword: true })}
              isLoading={saving}
              loadingText="Speichert ..."
            >
              Passwort entfernen
            </LoadingButton>
          ) : null}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Test-E-Mail an">
                <input
                  className="field-input"
                  type="email"
                  value={testRecipient}
                  placeholder="admin@example.de"
                  onChange={(event) => setTestRecipient(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <LoadingButton
              type="button"
              className="btn-secondary sm:w-auto"
              onClick={() => void runSendTest()}
              isLoading={sending}
              loadingText="Sendet ..."
            >
              <span className="inline-flex items-center gap-1">
                <Send className="h-4 w-4" />
                Test-E-Mail senden
              </span>
            </LoadingButton>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Getestet wird die zuletzt gespeicherte Konfiguration. Eine angenommene Nachricht
            ist noch kein Zustellnachweis — bitte zusätzlich das Postfach prüfen (auch den
            Spam-Ordner).
          </p>
        </div>
      </article>

      {/* --- Bereich 3: Registrierungsverfahren --- */}
      <article className="surface-card space-y-3 animate-fade-up">
        <SectionTitle icon={MailCheck}>Registrierungsverfahren</SectionTitle>

        <div className="space-y-2">
          <button
            type="button"
            disabled={switching}
            onClick={() => void switchMode('classic_admin_approval')}
            className={`w-full rounded-xl border px-4 py-3 text-left transition ${
              currentMode === 'classic_admin_approval'
                ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/40'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {currentMode === 'classic_admin_approval' ? (
                <CheckCircle2 className="h-4 w-4 text-brand-700" />
              ) : null}
              Klassisch – Admin-Freigabe
            </span>
            <span className="mt-1 block text-sm text-slate-600">
              Benutzer können sich registrieren und werden durch einen Administrator
              freigeschaltet. Keine E-Mail-Bestätigung erforderlich — funktioniert auch ohne
              SMTP.
            </span>
          </button>

          <button
            type="button"
            disabled={switching || !verificationSelectable}
            onClick={() => void switchMode('email_verification')}
            className={`w-full rounded-xl border px-4 py-3 text-left transition ${
              currentMode === 'email_verification'
                ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/40'
                : 'border-slate-200 bg-white hover:border-slate-300'
            } ${!verificationSelectable && currentMode !== 'email_verification' ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {currentMode === 'email_verification' ? (
                <CheckCircle2 className="h-4 w-4 text-brand-700" />
              ) : null}
              E-Mail-Bestätigung + Admin-Freigabe
            </span>
            <span className="mt-1 block text-sm text-slate-600">
              Benutzer müssen zuerst ihre E-Mail-Adresse bestätigen. Danach erfolgt weiterhin
              die Freigabe durch einen Administrator.
            </span>
          </button>
        </div>

        {blockers.length && currentMode !== 'email_verification' ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold">Die E-Mail-Bestätigung ist noch nicht aktivierbar:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-slate-500">
          Bereits bestehende Konten behalten ihren Status: Wer sich mit erforderlicher
          E-Mail-Bestätigung registriert hat, muss sie auch nach einem Wechsel zurück zum
          klassischen Verfahren bestätigen. Der Ein-/Aus-Schalter für die Selbstregistrierung
          bleibt davon unberührt.
        </p>
      </article>

      {/* --- Bereich 4: Bestätigungslinks --- */}
      <article className="surface-card space-y-4 animate-fade-up">
        <SectionTitle icon={Link2}>Bestätigungslinks</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Öffentliche WWS-Adresse"
            hint={
              status?.publicBaseUrlSource === 'env' && !form.publicBaseUrl
                ? `Leer = Wert aus der Server-Umgebung (${status.publicBaseUrl ?? 'FRONTEND_URL'}).`
                : 'Adresse, unter der Benutzer das WWS erreichen. In Produktion nur https://.'
            }
          >
            <input
              className="field-input"
              type="url"
              value={form.publicBaseUrl}
              placeholder="https://warehouse.example.de"
              onChange={(event) => update({ publicBaseUrl: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Gültigkeit der Bestätigungslinks (Stunden)">
            <input
              className="field-input"
              inputMode="numeric"
              value={form.verificationExpiryHours}
              onChange={(event) => update({ verificationExpiryHours: event.target.value })}
            />
          </Field>
        </div>
        {status ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <InfoRow label="Links zeigen auf">{status.publicBaseUrl ?? '–'}</InfoRow>
            <InfoRow label="Herkunft">{publicUrlSourceLabel(status.publicBaseUrlSource)}</InfoRow>
          </dl>
        ) : null}
        {status && !status.frontendUrlReady && status.frontendUrlHint ? (
          <Notice tone="warning">{status.frontendUrlHint}</Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <LoadingButton
            type="button"
            className="btn-primary"
            onClick={() => void save()}
            isLoading={saving}
            loadingText="Speichert ..."
          >
            Speichern
          </LoadingButton>
          <p className="text-xs text-slate-500">
            Bestätigungs-E-Mails einzelner Benutzer lassen sich in der Benutzerverwaltung
            erneut senden.
          </p>
        </div>
      </article>

      {/* --- Bereich 5: Diagnose --- */}
      {status ? (
        <article className="surface-card space-y-3 animate-fade-up">
          <SectionTitle icon={Activity}>Diagnose</SectionTitle>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <InfoRow label="Konfigurationsursprung">{sourceLabel(status.source)}</InfoRow>
            <InfoRow label="Passwort-Verschlüsselung">
              {keySourceLabel(status.secretKeySource)}
            </InfoRow>
            <InfoRow label="Letzter erfolgreicher Test">
              {status.lastTestSuccess && status.lastTestAt ? status.lastTestAt : '–'}
            </InfoRow>
            <InfoRow label="Test-E-Mail angenommen">{status.testMailAcceptedAt ?? '–'}</InfoRow>
            <InfoRow label="Letzter fehlgeschlagener Test">
              {status.lastTestSuccess === false && status.lastTestAt ? status.lastTestAt : '–'}
            </InfoRow>
            <InfoRow label="Letzter Versand">
              {status.lastSendAt
                ? `${status.lastSendAt} · ${status.lastSendSuccess ? 'erfolgreich' : 'fehlgeschlagen'}`
                : '–'}
            </InfoRow>
          </dl>
          {status.lastTestSuccess === false && status.lastTestError ? (
            <Notice tone="warning">Letzter Testfehler: {status.lastTestError}</Notice>
          ) : null}
          {status.lastSendSuccess === false && status.lastSendError ? (
            <Notice tone="warning">Letzter Versandfehler: {status.lastSendError}</Notice>
          ) : null}
          {!status.canSend && status.problem ? <Notice tone="info">{status.problem}</Notice> : null}
        </article>
      ) : null}
    </section>
  );
}
