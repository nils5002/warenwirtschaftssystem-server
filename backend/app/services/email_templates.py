"""HTML- und Text-Vorlagen fuer transaktionale E-Mails.

Bewusst ohne Template-Engine: eine Handvoll Vorlagen, dafuer volle Kontrolle
ueber das Markup. Die HTML-Mail ist auf maximale Client-Kompatibilitaet
ausgelegt:

* Tabellen-Layout statt Flex/Grid (Outlook rendert mit Word-Engine).
* Inline-Styles statt ``<style>``-Block (Gmail entfernt Teile davon).
* Keine externen Ressourcen (keine Bilder, keine Webfonts, kein Tracking) —
  so kann auch kein Token ueber einen Referrer an Dritte abfliessen.
* Mobiloptimiert ueber ``max-width`` + ``width:100%`` statt Media Queries.
"""
from __future__ import annotations

from html import escape

# Farben aus dem WWS-Theme (Sky/Indigo-Verlauf der Login-Seite).
_ACCENT = "#0284c7"
_INK = "#0f172a"
_MUTED = "#475569"
_BORDER = "#e2e8f0"
_CANVAS = "#f1f5f9"

VERIFICATION_SUBJECT = "Warehouse-System – E-Mail-Adresse bestätigen"
SMTP_TEST_SUBJECT = "Warehouse-System – SMTP-Test erfolgreich"


def _first_name(full_name: str | None) -> str:
    raw = (full_name or "").strip()
    if not raw:
        return "zusammen"
    return raw.split()[0]


def _shell(*, title: str, content_html: str, preheader: str) -> str:
    """Rahmen-Markup einer Mail (Header, Karte, Footer)."""
    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>{escape(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:{_CANVAS};">
<!-- Vorschautext: erscheint in der Mailliste, bleibt im Body unsichtbar. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:{_CANVAS};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid {_BORDER};
                    border-radius:14px;overflow:hidden;">
        <tr>
          <td style="background-color:{_INK};padding:20px 28px;">
            <span style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;
                         letter-spacing:2px;text-transform:uppercase;color:#7dd3fc;">
              Warenwirtschaft
            </span>
            <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:19px;
                        font-weight:600;color:#ffffff;margin-top:4px;">
              Warehouse-System
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;
                     font-size:15px;line-height:1.6;color:{_INK};">
            {content_html}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 24px;border-top:1px solid {_BORDER};
                     font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;
                     line-height:1.6;color:{_MUTED};">
            Diese Nachricht wurde automatisch erzeugt. Bitte antworte nicht darauf.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""


def verification_email(*, name: str | None, verification_url: str, expiry_hours: int) -> tuple[str, str, str]:
    """Baut (Betreff, Text-Alternative, HTML) der Bestaetigungsmail.

    ``verification_url`` stammt ausschliesslich aus der vertrauenswuerdigen
    ``FRONTEND_URL`` (siehe email_verification_service) — niemals aus einem
    Request-Header.
    """
    greeting = _first_name(name)
    safe_url = escape(verification_url, quote=True)

    content = f"""
      <p style="margin:0 0 16px;">Hallo {escape(greeting)},</p>
      <p style="margin:0 0 16px;">
        vielen Dank für deine Registrierung im Warehouse-System.
      </p>
      <p style="margin:0 0 24px;">
        Bitte bestätige deine E-Mail-Adresse über den folgenden Button:
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
        <tr>
          <td align="center" bgcolor="{_ACCENT}" style="border-radius:10px;">
            <a href="{safe_url}"
               style="display:inline-block;padding:13px 26px;font-family:Segoe UI,Helvetica,Arial,sans-serif;
                      font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
              E-Mail-Adresse bestätigen
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;color:{_MUTED};font-size:13px;">
        Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br />
        <span style="word-break:break-all;color:{_ACCENT};">{safe_url}</span>
      </p>
      <p style="margin:0 0 16px;">
        Dieser Link ist {expiry_hours} Stunden gültig.
      </p>
      <p style="margin:0 0 16px;">
        Nach der Bestätigung muss dein Benutzerkonto noch von einem Administrator
        freigegeben werden.
      </p>
      <p style="margin:0;color:{_MUTED};font-size:13px;">
        Wenn du dich nicht registriert hast, kannst du diese Nachricht ignorieren.
      </p>
    """

    text_body = (
        f"Hallo {greeting},\n\n"
        "vielen Dank für deine Registrierung im Warehouse-System.\n\n"
        "Bitte bestätige deine E-Mail-Adresse über den folgenden Link:\n"
        f"{verification_url}\n\n"
        f"Dieser Link ist {expiry_hours} Stunden gültig.\n\n"
        "Nach der Bestätigung muss dein Benutzerkonto noch von einem Administrator "
        "freigegeben werden.\n\n"
        "Wenn du dich nicht registriert hast, kannst du diese Nachricht ignorieren.\n\n"
        "Viele Grüße\n"
        "Dein Warehouse-System"
    )

    html_body = _shell(
        title=VERIFICATION_SUBJECT,
        content_html=content,
        preheader="Bitte bestätige deine E-Mail-Adresse, um die Registrierung abzuschließen.",
    )
    return VERIFICATION_SUBJECT, text_body, html_body


def smtp_test_email() -> tuple[str, str, str]:
    """Baut (Betreff, Text-Alternative, HTML) der SMTP-Testnachricht.

    Enthaelt bewusst KEINE Konfigurationsdetails (Host, Port, Benutzername) —
    die Nachricht landet in einem fremden Postfach und soll nichts ueber die
    Serverkonfiguration verraten.
    """
    content = f"""
      <p style="margin:0 0 16px;">Hallo,</p>
      <p style="margin:0 0 16px;">
        dies ist eine Testnachricht des Warehouse-Systems.
      </p>
      <p style="margin:0 0 16px;">
        Der SMTP-Server hat die E-Mail erfolgreich zur Zustellung angenommen.
      </p>
      <p style="margin:0;color:{_MUTED};font-size:13px;">
        Viele Grüße<br />Dein Warehouse-System
      </p>
    """
    text_body = (
        "Hallo,\n\n"
        "dies ist eine Testnachricht des Warehouse-Systems.\n\n"
        "Der SMTP-Server hat die E-Mail erfolgreich zur Zustellung angenommen.\n\n"
        "Viele Grüße\n"
        "Dein Warehouse-System"
    )
    html_body = _shell(
        title=SMTP_TEST_SUBJECT,
        content_html=content,
        preheader="SMTP-Test des Warehouse-Systems.",
    )
    return SMTP_TEST_SUBJECT, text_body, html_body
