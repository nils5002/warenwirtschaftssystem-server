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
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-16 top-0 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute right-0 top-16 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
      </div>
      <main className="relative mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-8 sm:px-6">
        <div className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 p-5 shadow-panel sm:p-6">
          <p className="page-kicker text-brand-300">Warehouse WMS</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Sichere Anmeldung</h1>
          <p className="mt-1 text-sm text-slate-300">E-Mail und Passwort für den Zugriff auf das System.</p>

          <div className="mt-4 inline-flex rounded-lg border border-slate-700 bg-slate-800 p-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                !isRegister ? 'bg-brand-600 text-white' : 'text-slate-300'
              }`}
              onClick={() => setMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                isRegister ? 'bg-brand-600 text-white' : 'text-slate-300'
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
              className="font-semibold text-brand-300 hover:text-brand-200"
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
                  className="field-input bg-slate-800 text-white"
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
                className="field-input bg-slate-800 text-white"
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
                className="field-input bg-slate-800 text-white"
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
                  className="field-input bg-slate-800 text-white"
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

            <button type="submit" className="btn-primary w-full" disabled={busy}>
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
