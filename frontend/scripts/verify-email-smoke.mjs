// Ad-hoc-UI-Smoke fuer die E-Mail-Bestaetigung gegen den Verify-Stack.
// Kein Teil der Test-Suite — wird manuell im Rahmen der Container-Validierung
// ausgefuehrt (siehe .claude/skills/container-verify).
//
//   node scripts/verify-email-smoke.mjs <registrierungs-email> <token>
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:18080';
const EXECUTABLE =
  process.env.SMOKE_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [, , email, token] = process.argv;

const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

// 1) Registrierungsansicht
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Registrieren', exact: true }).first().click();
await page.locator('input[autocomplete="name"]').fill('Smoke Tester');
await page.locator('input[autocomplete="email"]').fill(email);
await page.locator('input[autocomplete="new-password"]').first().fill('Willkommen123!');
await page.locator('input[autocomplete="new-password"]').nth(1).fill('Willkommen123!');
await page.getByRole('button', { name: /Konto erstellen/ }).click();
await page.getByText('Registrierung eingegangen').waitFor({ timeout: 10000 });
const panel = await page.locator('body').innerText();
console.log('registrierung-panel:', panel.includes('Bestätigungslink') ? 'OK' : 'FEHLT');
console.log(
  'resend-button:',
  (await page.getByRole('button', { name: /E-Mail erneut senden/ }).count()) > 0 ? 'OK' : 'FEHLT',
);

// 2) Bestaetigungsseite mit gueltigem Token
await page.goto(`${BASE}/registrierung-bestaetigen?token=${encodeURIComponent(token)}`, {
  waitUntil: 'networkidle',
});
await page
  .getByRole('heading', { name: 'E-Mail-Adresse bestätigt' })
  .waitFor({ timeout: 10000 });
console.log('bestaetigung:', 'OK');
console.log(
  'token-aus-url-entfernt:',
  page.url().includes('token=') ? 'FEHLER - Token steht noch in der URL' : 'OK',
);

// 3) Abgelaufener/ungueltiger Token -> Resend-Formular
await page.goto(`${BASE}/registrierung-bestaetigen?token=nicht-gueltig-aber-lang-genug-xxxxx`, {
  waitUntil: 'networkidle',
});
await page
  .getByRole('heading', { name: 'Bestätigung nicht möglich' })
  .waitFor({ timeout: 10000 });
console.log(
  'fehlerfall-mit-resend:',
  (await page.getByRole('button', { name: /erneut senden/ }).count()) > 0 ? 'OK' : 'FEHLT',
);

console.log('konsolenfehler:', errors.length === 0 ? 'keine' : errors.join(' | '));
await browser.close();
