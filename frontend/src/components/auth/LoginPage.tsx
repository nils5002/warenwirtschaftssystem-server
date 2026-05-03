import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { useState } from 'react';

type LoginPageProps = {
  onLogin: (payload: { email: string; password: string }) => Promise<void>;
  onRegister: (payload: { name: string; email: string; password: string }) => Promise<string | void>;
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

  const isRegister = mode === 'register';

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
        const message = await onRegister({ name: name.trim(), email: email.trim(), password });
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
      <div className="fixed inset-0 bg-[url('/login-background.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950/85 via-slate-900/65 to-indigo-950/70" />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="absolute right-0 top-20 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
      </div>
      <main className="relative mx-auto flex min-h-screen w-full max-w-[1280px] items-center px-4 py-8 sm:px-6 lg:justify-end lg:px-10">
        <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur-2xl sm:p-7">
          <p className="inline-flex rounded-full border border-sky-200/30 bg-sky-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-200">
            Inventar · Einsatzplanung · QR-Scan
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Warenwirtschaftssystem</h1>
          <p className="mt-1 text-sm text-slate-200">Hardware, Planung und Rückgabe zentral verwalten</p>

          <div className="mt-5 inline-flex rounded-xl border border-white/20 bg-slate-900/45 p-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                !isRegister ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-300'
              }`}
              onClick={() => setMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                isRegister ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-300'
              }`}
              onClick={() => setMode('register')}
            >
              Registrieren
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-300">
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
                  className="field-input border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
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
                className="field-input border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
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
                className="field-input border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
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
                  className="field-input border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
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
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition hover:from-sky-400 hover:to-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 disabled:cursor-not-allowed disabled:opacity-70"
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
      </main>
    </div>
  );
}
