import { Boxes, CheckCircle2, Loader2, LogIn, MailWarning, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { navigate } from '../../routing/router';
import { isWmsApiError, resendVerification, verifyEmail } from '../../services/wmsApi';
import {
  allowsResend,
  extractVerificationToken,
  isLikelyEmail,
  phaseForStatus,
  verificationMessage,
  VERIFY_EMAIL_PATH,
  type VerificationPhase,
} from './emailVerification';

/**
 * Öffentliche Seite, auf die der Bestätigungslink aus der E-Mail führt.
 *
 * Der Token wird per POST eingelöst (nicht per Link-Aufruf) und sofort aus
 * der Adresszeile entfernt — danach steht er weder in der Browser-History
 * noch könnte er über einen Referrer abfließen.
 */
export function EmailVerificationPage() {
  const [phase, setPhase] = useState<VerificationPhase>('pending');
  const [detail, setDetail] = useState<string | null>(null);
  const [accountActive, setAccountActive] = useState(false);

  const [email, setEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  // Guard gegen den Doppelaufruf des Effekts im React-StrictMode: der Token
  // ist einmalig — ein zweiter Aufruf würde ihn als "bereits verwendet"
  // melden und den Nutzer grundlos auf einen Fehler schicken.
  const redeemed = useRef(false);

  useEffect(() => {
    if (redeemed.current) return;
    redeemed.current = true;

    const token = extractVerificationToken(window.location.search, window.location.hash);
    // Token umgehend aus der URL entfernen — unabhängig davon, ob die
    // Einlösung gleich klappt.
    window.history.replaceState(null, '', VERIFY_EMAIL_PATH);

    if (!token) {
      setPhase('missing');
      return;
    }

    void verifyEmail(token)
      .then((response) => {
        setPhase('success');
        setDetail(response.message);
        setAccountActive(Boolean(response.accountActive));
      })
      .catch((error: unknown) => {
        const status = isWmsApiError(error) ? error.status : undefined;
        const nextPhase = phaseForStatus(status);
        setPhase(nextPhase);
        setDetail(isWmsApiError(error) ? error.detail : null);
      });
  }, []);

  const submitResend = async (event: React.FormEvent) => {
    event.preventDefault();
    setResendError(null);
    setResendNotice(null);
    if (!isLikelyEmail(email)) {
      setResendError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    setResendBusy(true);
    try {
      const response = await resendVerification(email.trim());
      if (response.emailSent === false) {
        setResendError(response.emailHint ?? 'Die E-Mail konnte nicht versendet werden.');
      } else {
        setResendNotice(response.message);
      }
    } catch (error) {
      setResendError(
        error instanceof Error ? error.message : 'Der Versand hat nicht geklappt.',
      );
    } finally {
      setResendBusy(false);
    }
  };

  const message = verificationMessage(phase, detail);
  const isSuccess = phase === 'success';
  const isPending = phase === 'pending';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950" />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-sky-500/16 blur-3xl" />
        <div className="absolute right-0 top-20 h-96 w-96 rounded-full bg-indigo-500/16 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full items-center justify-center overflow-y-auto px-4 py-6 sm:px-6">
        <div className="relative w-full max-w-[440px] overflow-hidden rounded-[1.5rem] border border-white/15 bg-slate-950/55 px-5 py-6 shadow-[0_30px_80px_rgba(2,6,23,0.7)] backdrop-blur-[24px] sm:px-6">
          <div className="relative flex flex-col items-center text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-sky-300/10">
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
              ) : isSuccess ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              ) : (
                <MailWarning className="h-5 w-5 text-amber-300" />
              )}
            </div>
            <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-200/90">
              WARENWIRTSCHAFT
            </p>
            <h1 className="mt-1.5 text-xl font-semibold text-white sm:text-2xl">
              {isPending
                ? 'E-Mail wird bestätigt...'
                : isSuccess
                  ? 'E-Mail-Adresse bestätigt'
                  : 'Bestätigung nicht möglich'}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-200/90">{message}</p>
          </div>

          {isSuccess ? (
            <div className="mt-5 space-y-3">
              {!accountActive ? (
                <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
                  Dein Konto wird jetzt von einem Administrator geprüft. Du kannst dich anmelden,
                  sobald die Freigabe erteilt ist.
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition hover:from-sky-400 hover:to-indigo-500"
              >
                <LogIn className="h-4 w-4" />
                Zur Anmeldung
              </button>
            </div>
          ) : null}

          {allowsResend(phase) ? (
            <form className="mt-5 space-y-2.5" onSubmit={submitResend}>
              <label className="field text-slate-200">
                E-Mail-Adresse
                <input
                  className="field-input h-10 rounded-xl border-white/20 bg-slate-900/55 text-white placeholder:text-slate-400 focus:border-sky-300/60"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="name@firma.de"
                />
              </label>
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
              <button
                type="submit"
                disabled={resendBusy}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition hover:from-sky-400 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {resendBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Wird gesendet...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Bestätigungslink erneut senden
                  </>
                )}
              </button>
            </form>
          ) : null}

          {!isSuccess && !isPending ? (
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 text-xs font-semibold text-sky-300 hover:text-sky-200"
            >
              <Boxes className="h-3.5 w-3.5" />
              Zurück zur Anmeldung
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
