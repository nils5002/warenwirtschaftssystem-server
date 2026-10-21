import { Boxes, CheckCircle2, Loader2, LogIn, MailCheck, Send, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchLoginBranding, resendVerification } from '../../services/wmsApi';
import { EMAIL_PATTERN } from './emailVerification';

// Ergebnis einer Registrierung, so wie die Login-Seite es braucht: Meldung,
// welches Verfahren galt, und die ehrliche Auskunft, ob eine Bestätigungsmail
// wirklich rausging.
export type RegisterOutcome = {
  message: string;
  // false = klassischer Ablauf: Es ist gar keine E-Mail vorgesehen, das Konto
  // wartet ausschließlich auf die Admin-Freigabe.
  verificationRequired: boolean;
  emailSent: boolean;
  emailHint?: string | null;
};

type LoginPageProps = {
  onLogin: (payload: { email: string; password: string }) => Promise<void>;
  onRegister: (payload: {
    name: string;
    email: string;
    password: string;
    website?: string;
  }) => Promise<RegisterOutcome>;
};

type AuthMode = 'login' | 'register';

export function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Nach erfolgreicher Registrierung ersetzt eine Bestätigungs-Ansicht das
  // Formular (statt eines zusätzlichen Dialogs).
  const [registered, setRegistered] = useState<RegisterOutcome | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  // Honeypot: für Menschen unsichtbares Feld — nur Bots füllen es aus.
  const [website, setWebsite] = useState('');
  // Vom Admin verwaltetes Hintergrundbild (öffentlicher Endpunkt, kein Login
  // nötig). Bis es geladen ist bzw. wenn keines aktiv ist, greift der statische
  // Standard-Hintergrund /login-background.jpg.
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);

  const isRegister = mode === 'register';

  useEffect(() => {
    let cancelled = false;
    void fetchLoginBranding().then((branding) => {
      if (!cancelled) setBackgroundUrl(branding.backgroundUrl);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim() || !password.trim()) {
      setError('Bitte E-Mail und Passwort eingeben.');
      return;
    }
    if (isRegister) {
      if (!name.trim()) {
        setError('Bitte Namen eingeben.');
        return;
      }
      if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) {
        setError('Bitte eine gültige E-Mail-Adresse eingeben.');
        return;
      }
      if (password.length < 8) {
        setError('Passwort muss mindestens 8 Zeichen haben.');
        return;
      }
      if (password !== passwordConfirm) {
        setError('Passwörter stimmen nicht überein.');
        return;
      }
    }

    setBusy(true);
    try {
      if (isRegister) {
        const outcome = await onRegister({
          name: name.trim(),
          email: email.trim(),
          password,
          website,
        });
        // Passwörter sofort aus dem State werfen — die Bestätigungsansicht
        // braucht sie nicht mehr.
        setPassword('');
        setPasswordConfirm('');
        setRegisteredEmail(email.trim());
        setRegistered(outcome);
      } else {
        await onLogin({ email: email.trim(), password });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentifizierung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => {
    setRegistered(null);
    setResendNotice(null);
    setResendError(null);
    setMode('login');
    setNotice(null);
  };

  const requestResend = async () => {
    setResendError(null);
    setResendNotice(null);
    const target = registeredEmail.trim();
    if (!EMAIL_PATTERN.test(target.toLowerCase())) {
      setResendError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    setResendBusy(true);
    try {
      const response = await resendVerification(target);
      if (response.emailSent === false) {
        setResendError(response.emailHint ?? 'Die E-Mail konnte nicht versendet werden.');
      } else {
        setResendNotice(response.message);
      }
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Der Versand hat nicht geklappt.');
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Aktiver, admin-verwalteter Hintergrund (falls vorhanden), sonst der
          statische Standard. Inline-Style, weil die URL dynamisch ist. */}
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${backgroundUrl ?? '/login-background.jpg'}')` }}
      />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.02)_0%,rgba(2,6,23,0.2)_72%,rgba(2,6,23,0.32)_100%)]" />
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950/16 via-slate-900/10 to-indigo-950/18" />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-sky-500/16 blur-3xl" />
        <div className="absolute right-0 top-20 h-96 w-96 rounded-full bg-indigo-500/16 blur-3xl" />
      </div>
      <main className="relative mx-auto flex min-h-screen w-full items-center justify-center overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="relative w-full max-w-[400px] overflow-hidden rounded-[1.5rem] border border-white/15 bg-slate-950/45 px-5 py-5 shadow-[0_30px_80px_rgba(2,6,23,0.7),0_0_60px_rgba(14,165,233,0.12)] backdrop-blur-[24px] sm:px-6 sm:py-6">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.14),rgba(255,255,255,0.02)_42%,rgba(2,132,199,0.08)_100%)]" />
          <div className="relative flex flex-col">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-sky-300/10 shadow-[0_0_28px_rgba(56,189,248,0.25)]">
                <Boxes className="h-5 w-5 text-sky-200" />
              </div>
              <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-200/90">WARENWIRTSCHAFT</p>
              <h1 className="mt-1.5 text-xl font-semibold text-white sm:text-2xl">Willkommen.</h1>
              <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-200/90">
                Hardware, Planung und Rückgabe zentral verwalten
              </p>
              <p className="mt-2.5 inline-flex rounded-full border border-sky-200/20 bg-sky-300/10 px-2.5 py-0.5 text-[10px] font-medium text-sky-100/90">
                Inventar · Einsatzplanung · QR-Scan
              </p>
            </div>

            {registered ? (
              // Registrierung eingegangen: ersetzt das Formular, kein
              // zusätzlicher Dialog.
              <div className="mt-4 flex flex-col gap-3">
                <div className="flex items-center justify-center gap-2 text-emerald-200">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-sm font-semibold">Registrierung eingegangen</span>
                </div>
                <div className="rounded-xl border border-white/15 bg-slate-900/50 px-3 py-2.5 text-[13px] leading-relaxed text-slate-200">
                  {!registered.verificationRequired ? (
                    // Klassischer Ablauf: keine E-Mail im Spiel, also auch
                    // kein Hinweis auf Posteingang oder Spam-Ordner.
                    <>
                      Deine Registrierung wurde gespeichert und wartet auf die Freigabe durch
                      einen Administrator. Du kannst dich anmelden, sobald dein Konto
                      freigegeben wurde.
                    </>
                  ) : registered.emailSent ? (
                    <>
                      Wir haben dir eine E-Mail mit einem Bestätigungslink an{' '}
                      <span className="font-semibold text-white">{registeredEmail}</span> gesendet.
                      Bitte überprüfe auch deinen Spam-Ordner.
                    </>
                  ) : (
                    registered.emailHint ??
                    'Die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte versuche es erneut.'
                  )}
                </div>
                {!registered.verificationRequired ? null : registered.emailSent ? (
                  <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[13px] text-sky-100">
                    Nach der Bestätigung muss dein Konto noch von einem Administrator freigegeben
                    werden.
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-100">
                    Dein Konto wurde angelegt — nur der Versand hat nicht geklappt. Versuche es
                    gleich erneut oder wende dich an einen Administrator.
                  </div>
                )}

                {resendError ? (
                  <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    {resendError}
                  </div>
                ) : null}
                {resendNotice ? (
                  <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    {resendNotice}
                  </div>
                ) : null}

                {/* Nur im Verfahren mit E-Mail-Bestätigung sinnvoll — im
                    klassischen Ablauf gibt es nichts erneut zu senden. */}
                {registered.verificationRequired ? (
                  <button
                    type="button"
                    onClick={() => void requestResend()}
                    disabled={resendBusy}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-slate-900/60 px-4 text-sm font-semibold text-slate-100 transition hover:border-sky-300/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {resendBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Wird gesendet...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        E-Mail erneut senden
                      </>
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={backToLogin}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition hover:from-sky-400 hover:to-indigo-500"
                >
                  <MailCheck className="h-4 w-4" />
                  Zur Anmeldung
                </button>
              </div>
            ) : (
              <>
            <div className="mt-4 inline-flex self-center rounded-2xl border border-white/15 bg-slate-900/50 p-1">
              <button
                type="button"
                className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
                  !isRegister ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/40' : 'text-slate-300 hover:text-white'
                }`}
                onClick={() => setMode('login')}
              >
                Login
              </button>
              <button
                type="button"
                className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
                  isRegister ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/40' : 'text-slate-300 hover:text-white'
                }`}
                onClick={() => setMode('register')}
              >
                Registrieren
              </button>
            </div>
            <p className="mt-2.5 text-center text-xs text-slate-300/90">
              Noch kein Konto?{' '}
              <button
                type="button"
                className="font-semibold text-sky-300 hover:text-sky-200"
                onClick={() => setMode('register')}
              >
                Registrieren
              </button>
            </p>

            <form className="mt-4 space-y-2.5" onSubmit={submit}>
              {isRegister ? (
                <label className="field text-slate-200">
                  Name
                  <input
                    className="field-input h-10 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    autoFocus
                  />
                </label>
              ) : null}
              <label className="field text-slate-200">
                E-Mail
                <input
                  className="field-input h-10 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  autoFocus={!isRegister}
                />
              </label>
              <label className="field text-slate-200">
                Passwort
                <input
                  type="password"
                  className="field-input h-10 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                />
              </label>
              {isRegister ? (
                <label className="field text-slate-200">
                  Passwort bestätigen
                  <input
                    type="password"
                    className="field-input h-10 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              ) : null}
              {isRegister ? (
                // Honeypot gegen Bots: unsichtbar und nicht fokussierbar —
                // echte Nutzer lassen das Feld leer.
                <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
                  <label>
                    Website
                    <input
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  {notice}
                </div>
              ) : null}

              <button
                type="submit"
                className="mt-1 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition hover:from-sky-400 hover:to-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isRegister ? 'Registrierung läuft...' : 'Anmeldung läuft...'}
                  </>
                ) : isRegister ? (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Konto erstellen
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Login
                  </>
                )}
              </button>
            </form>
            {/* Companion App: Smartphone ohne Passworteingabe über den PC verbinden. */}
            <a
              href="/verbinden"
              className="mt-4 flex min-h-[44px] items-center justify-center rounded-xl text-sm font-medium text-primary hover:underline"
            >
              Smartphone per QR-Code mit dem Konto verbinden
            </a>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
