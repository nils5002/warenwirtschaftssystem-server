// Browser-Seite der Passkey-Zeremonien (WebAuthn) über @simplewebauthn/browser.
// Die Prüfung der Antworten passiert ausschließlich im Backend.

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import {
  fetchPasskeyRegistrationOptions,
  fetchUnlockOptions,
  verifyPasskeyRegistration,
  verifyUnlock,
  type CompanionSession,
} from '../../services/wmsApi';

export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/**
 * Übersetzt Browser-Fehler in verständliche Hinweise. Abbruch durch den
 * Nutzer ist kein "Fehler", sondern eine bewusste Entscheidung.
 */
export function passkeyErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return 'Die Bestätigung wurde abgebrochen oder ist abgelaufen. Bitte erneut versuchen.';
  }
  if (name === 'InvalidStateError') {
    return 'Auf diesem Gerät ist bereits ein Passkey für die Companion App eingerichtet.';
  }
  if (name === 'SecurityError') {
    return 'Passkeys sind nur über die sichere (HTTPS-)Adresse des Warehouse-Systems möglich.';
  }
  if (name === 'NotSupportedError') {
    return 'Dieses Gerät bzw. dieser Browser unterstützt keine Passkeys.';
  }
  return error instanceof Error && error.message ? error.message : 'Der Passkey-Vorgang ist fehlgeschlagen.';
}

export async function registerPasskey(): Promise<CompanionSession> {
  const { options } = await fetchPasskeyRegistrationOptions();
  const credential = await startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  return verifyPasskeyRegistration(credential);
}

export async function unlockWithPasskey(): Promise<CompanionSession> {
  const { options } = await fetchUnlockOptions();
  const credential = await startAuthentication({
    optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
  return verifyUnlock(credential);
}
