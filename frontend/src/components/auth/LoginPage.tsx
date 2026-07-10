import { Boxes, Loader2, LogIn, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchLoginBranding } from '../../services/wmsApi';

type LoginPageProps = {
  onLogin: (payload: { email: string; password: string }) => Promise<void>;
  onRegister: (payload: { name: string; email: string; password: string; website?: string }) => Promise<string | void>;
};

// Einfache Formatprüfung (Backend validiert erneut): verhindert Registrierungen
// ohne echte E-Mail-Adresse wie den Vorfall-Benutzernamen "supman".
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

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
        const message = await onRegister({ name: name.trim(), email: email.trim(), password, website });
        setNotice(message ?? 'Registrierung erfolgreich.');
        setMode('login');
        setPassword('');
        setPasswordConfirm('');
      } else {
        await onLogin({ email: email.trim(), password });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentifizierung fehlgeschlagen.');
    } finally {
      setBusy(false);
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
        <div className="relative w-full max-w-[460px] overflow-hidden rounded-[1.75rem] border border-white/15 bg-slate-950/45 px-6 py-6 shadow-[0_30px_80px_rgba(2,6,23,0.7),0_0_60px_rgba(14,165,233,0.12)] backdrop-blur-[24px] sm:px-8 sm:py-7">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.14),rgba(255,255,255,0.02)_42%,rgba(2,132,199,0.08)_100%)]" />
          <div className="relative flex flex-col">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-sky-300/10 shadow-[0_0_28px_rgba(56,189,248,0.25)]">
                <Boxes className="h-6 w-6 text-sky-200" />
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200/90">WARENWIRTSCHAFT</p>
              <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Willkommen.</h1>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-200/90">
                Hardware, Planung und Rückgabe zentral verwalten
              </p>
              <p className="mt-3 inline-flex rounded-full border border-sky-200/20 bg-sky-300/10 px-3 py-1 text-[11px] font-medium text-sky-100/90">
                Inventar · Einsatzplanung · QR-Scan
              </p>
            </div>

            <div className="mt-5 inline-flex self-center rounded-2xl border border-white/15 bg-slate-900/50 p-1.5">
              <button
                type="button"
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  !isRegister ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/40' : 'text-slate-300 hover:text-white'
                }`}
                onClick={() => setMode('login')}
              >
                Login
              </button>
              <button
                type="button"
                className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
                  isRegister ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/40' : 'text-slate-300 hover:text-white'
                }`}
                onClick={() => setMode('register')}
              >
                Registrieren
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-slate-300/90">
              Noch kein Konto?{' '}
              <button
                type="button"
                className="font-semibold text-sky-300 hover:text-sky-200"
                onClick={() => setMode('register')}
              >
                Registrieren
              </button>
            </p>

            <form className="mt-5 space-y-3" onSubmit={submit}>
              {isRegister ? (
                <label className="field text-slate-200">
                  Name
                  <input
                    className="field-input h-11 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
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
                  className="field-input h-11 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
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
                  className="field-input h-11 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
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
                    className="field-input h-11 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
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
                className="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition hover:from-sky-400 hover:to-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 disabled:cursor-not-allowed disabled:opacity-70"
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
          </div>
        </div>
      </main>
    </div>
  );
}
