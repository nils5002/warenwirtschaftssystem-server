import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5174/';
const runSuffix = Date.now().toString(36);
let AUTH_IDENTIFIER = process.env.SMOKE_USER ?? '';
const AUTH_PASSWORD = process.env.SMOKE_PASSWORD ?? 'Willkommen123!';
let API_AUTH_HEADERS = {};

const consoleErrors = [];
const pageErrors = [];
const stepFailures = [];
const roundtripChecks = [];

const entities = {
  user: {
    name: `Playwright Tester ${runSuffix}`,
    email: `playwright.${runSuffix}@example.local`,
    department: 'QA',
    location: 'Berlin',
    updatedName: `Playwright Tester Updated ${runSuffix}`,
    updatedDepartment: `QA-${runSuffix}`,
    updatedLocation: `Hamburg-${runSuffix}`,
  },
  asset: {
    createdName: `Playwright Device ${runSuffix}`,
    updatedName: `Playwright Device ${runSuffix} Updated`,
    createdLocation: `Testlager-${runSuffix}`,
    updatedLocation: `Berlin Lager-${runSuffix}`,
    maintenanceNote: `Wartung ${runSuffix}`,
  },
  ticket: {
    issue: `Display flackert sporadisch ${runSuffix}`,
    comment: `Tritt nach ca. 10 Minuten Betrieb auf (${runSuffix}).`,
  },
  planning: {
    customer: `Kunde Planung ${runSuffix}`,
    project: `Projekt Planung ${runSuffix}`,
    event: `Event Planung ${runSuffix}`,
    updatedProject: `Projekt Planung Updated ${runSuffix}`,
  },
};

function short(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toStatusKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll('ue', 'ü')
    .replaceAll('ae', 'ä')
    .replaceAll('oe', 'ö')
    .trim();
}

function statusMatches(actual, expected) {
  return toStatusKey(actual) === toStatusKey(expected);
}

function getPathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

async function runStep(name, fn) {
  try {
    await fn();
    console.log(`STEP_OK ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stepFailures.push({ name, message });
    console.log(`STEP_FAIL ${name}: ${message}`);
  }
}

async function clickNav(page, label) {
  await page.getByRole('button', { name: label, exact: true }).click();
}

async function fillPrompt(page, value, submitLabel = 'Weiter') {
  const input = page.locator('div.fixed input.field-input, div.fixed textarea.field-input').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(value);
  await page.getByRole('button', { name: submitLabel, exact: true }).click();
}

async function capturePost(page, path, action) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && getPathname(response.url()) === path,
    { timeout: 20000 },
  );
  await action();
  const response = await responsePromise;
  const status = response.status();
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  assertTrue(status >= 200 && status < 300, `POST ${path} fehlgeschlagen mit Status ${status}`);
  roundtripChecks.push({ type: 'api-post', path, status });
  return { status, json };
}

async function fetchOverview(context) {
  const response = await context.request.get(new URL('/api/wms/overview', BASE_URL).toString(), {
    headers: API_AUTH_HEADERS,
  });
  assertTrue(response.ok(), `GET /api/wms/overview fehlgeschlagen (${response.status()})`);
  const json = await response.json();
  roundtripChecks.push({ type: 'api-get', path: '/api/wms/overview', status: response.status() });
  return json;
}

async function fetchPlanningList(context) {
  const response = await context.request.get(new URL('/api/wms/planning', BASE_URL).toString(), {
    headers: API_AUTH_HEADERS,
  });
  assertTrue(response.ok(), `GET /api/wms/planning fehlgeschlagen (${response.status()})`);
  const json = await response.json();
  roundtripChecks.push({ type: 'api-get', path: '/api/wms/planning', status: response.status() });
  return json;
}

async function reloadAndOpen(page, navLabel, headingText) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await clickNav(page, navLabel);
  await page.getByText(headingText).first().waitFor({ timeout: 10000 });
}

function findUser(overview, email) {
  return (overview.users || []).find((item) => String(item.email).toLowerCase() === String(email).toLowerCase());
}

function findAsset(overview, id) {
  return (overview.assets || []).find((item) => item.id === id);
}

function findTicket(overview, issue) {
  return (overview.maintenanceItems || []).find((item) => item.issue === issue);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'de-DE', acceptDownloads: true });
const page = await context.newPage();

if (!AUTH_IDENTIFIER) {
  const seededUsers = await context.request.get(new URL('/api/wms/overview', BASE_URL).toString(), {
    headers: { 'X-User-Role': 'Admin' },
  });
  if (seededUsers.ok()) {
    const payload = await seededUsers.json();
    const firstUser =
      (payload.users || []).find(
        (item) =>
          String(item.role || '').toLowerCase() === 'admin' &&
          String(item.status || '').toLowerCase() === 'aktiv',
      ) || (payload.users || [])[0];
    AUTH_IDENTIFIER = firstUser?.email || firstUser?.id || '';
  }
}

const authResponse = await context.request.post(new URL('/api/auth/login', BASE_URL).toString(), {
  data: { identifier: AUTH_IDENTIFIER, password: AUTH_PASSWORD },
});
if (authResponse.ok()) {
  const authPayload = await authResponse.json();
  API_AUTH_HEADERS = { Authorization: `Bearer ${authPayload.accessToken}` };
}

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(short(msg.text()));
  }
});
page.on('pageerror', (err) => {
  pageErrors.push(short(err.message));
});

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const loginVisible = await page.getByRole('heading', { name: 'Anmelden' }).isVisible().catch(() => false);
if (loginVisible) {
  assertTrue(!!AUTH_IDENTIFIER, 'Kein Benutzer für Login verfügbar. SMOKE_USER setzen.');
  await page.getByLabel('E-Mail oder Benutzername').fill(AUTH_IDENTIFIER);
  await page.getByLabel('Passwort').fill(AUTH_PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
}
await page.getByText('Kernübersicht').waitFor({ timeout: 15000 });

await runStep('Navigation: alle Hauptseiten', async () => {
  await clickNav(page, 'Dashboard');
  await page.getByText('Kernübersicht').waitFor();

  await clickNav(page, 'Inventar');
  await page.getByText('Gerätebestand').waitFor();

  await clickNav(page, 'Kategorien');
  await page.getByText('Gerätearten').waitFor();

  await clickNav(page, 'Einsatzplanung');
  await page.getByText('Projektbezogene Hardwareplanung').waitFor();

  await clickNav(page, 'Ein-/Auslagerung');
  await page.getByText('Ausgabe und Rückgabe').waitFor();

  await clickNav(page, 'QR-Code');
  await page.getByText('Scan & Schnellaktionen').waitFor();

  await clickNav(page, 'Defekte / Tickets');
  await page.getByText('Ticketübersicht').waitFor();

  await clickNav(page, 'Import / Export');
  await page.getByText('Datenmanagement').waitFor();

  await clickNav(page, 'Benutzerverwaltung');
  await page.getByText('Teamzugriff').waitFor();
});

await runStep('Einsatzplanung: Create/Edit/Availability/Duplicate/Delete', async () => {
  await clickNav(page, 'Einsatzplanung');
  await page.getByText('Projektbezogene Hardwareplanung').waitFor();

  await page.getByTestId('planning-create').click();
  const modal = page.locator('div.fixed').filter({ hasText: 'Neue Einsatzplanung' });
  await modal.locator('label:has-text("Kunde") input').first().fill(entities.planning.customer);
  await modal.locator('label:has-text("Projekt") input').first().fill(entities.planning.project);
  await modal.locator('label:has-text("Veranstaltung") input').first().fill(entities.planning.event);
  await modal.locator('label:has-text("Status") select').first().selectOption('Entwurf');
  await modal.getByRole('button', { name: 'Planung anlegen', exact: true }).click();

  await page.getByText(`Planung ${entities.planning.customer} · ${entities.planning.project}`).waitFor({
    timeout: 15000,
  });

  await page.getByTestId('planning-add-item-0').click();
  await page.getByTestId('planning-item-category-0-0').selectOption('Laptop');
  await page.getByTestId('planning-item-qty-0-0').fill('3');

  const planningSave = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && /\/api\/wms\/planning\/[^/]+$/.test(getPathname(response.url())),
    { timeout: 20000 },
  );
  await page.getByTestId('planning-save').click();
  const saveResp = await planningSave;
  assertTrue(saveResp.ok(), 'Speichern der Einsatzplanung fehlgeschlagen');

  await page.getByText('Availability Übersicht').waitFor({ timeout: 10000 });

  const planningList = await fetchPlanningList(context);
  const created = planningList.find((item) => item.customerName === entities.planning.customer);
  assertTrue(!!created, 'Angelegte Einsatzplanung fehlt in /api/wms/planning');

  const row = page.getByTestId(`planning-row-${created.id}`);
  await row.getByRole('button', { name: /Öffnen/, exact: false }).click();

  await page.locator('label:has-text("Projekt") input').first().fill(entities.planning.updatedProject);
  const planningSave2 = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && getPathname(response.url()) === `/api/wms/planning/${created.id}`,
    { timeout: 20000 },
  );
  await page.getByTestId('planning-save').click();
  const saveResp2 = await planningSave2;
  assertTrue(saveResp2.ok(), 'Update der Einsatzplanung fehlgeschlagen');

  const duplicateResp = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      getPathname(response.url()) === `/api/wms/planning/${created.id}/duplicate`,
    { timeout: 20000 },
  );
  await row.getByRole('button').nth(1).click();
  const dupResp = await duplicateResp;
  assertTrue(dupResp.ok(), 'Duplizieren der Einsatzplanung fehlgeschlagen');
  const duplicatedBody = await dupResp.json();

  const afterDup = await fetchPlanningList(context);
  const duplicated = afterDup.find((item) => item.id === duplicatedBody.id);
  assertTrue(!!duplicated, 'Duplizierte Einsatzplanung fehlt in /api/wms/planning');

  const deleteResp = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && getPathname(response.url()) === `/api/wms/planning/${created.id}`,
    { timeout: 20000 },
  );
  await row.getByRole('button').nth(2).click();
  await page.getByRole('button', { name: 'Löschen', exact: true }).click();
  const del = await deleteResp;
  assertTrue(del.ok(), 'Löschen der Einsatzplanung fehlgeschlagen');

  if (duplicated?.id) {
    const cleanupDup = await context.request.delete(new URL(`/api/wms/planning/${duplicated.id}`, BASE_URL).toString(), {
      headers: API_AUTH_HEADERS,
    });
    assertTrue(cleanupDup.ok(), 'Cleanup der duplizierten Einsatzplanung fehlgeschlagen');
  }
});

await runStep('Benutzer: Create + Persistenz + API-Roundtrip', async () => {
  await clickNav(page, 'Benutzerverwaltung');

  const userCreate = await capturePost(page, '/api/wms/users', async () => {
    await page.getByRole('button', { name: 'Benutzer anlegen' }).click();
    const modal = page.locator('div.fixed').filter({ hasText: 'Benutzer anlegen' });
    await modal.locator('label:has-text("Name *") input').first().fill(entities.user.name);
    await modal.locator('label:has-text("E-Mail / Benutzername *") input').first().fill(entities.user.email);
    await modal.locator('label:has-text("Rolle") select').first().selectOption('Mitarbeiter');
    await modal.locator('label:has-text("Status") select').first().selectOption('Aktiv');
    await modal.locator('label:has-text("Abteilung") input').first().fill(entities.user.department);
    await modal.locator('label:has-text("Standort") input').first().fill(entities.user.location);
    await modal.getByRole('button', { name: 'Speichern', exact: true }).click();
  });

  assertTrue(userCreate.json?.email === entities.user.email, 'User-Response enthält nicht die erwartete E-Mail');
  await page.getByRole('cell', { name: entities.user.email, exact: true }).first().waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Benutzerverwaltung', 'Teamzugriff');
  await page.getByRole('cell', { name: entities.user.email, exact: true }).first().waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const user = findUser(overview, entities.user.email);
  assertTrue(!!user, 'Neu angelegter Benutzer fehlt in /api/wms/overview');
  assertTrue(user.name === entities.user.name, 'Neu angelegter Benutzername stimmt nicht');
  assertTrue(user.role === 'Mitarbeiter', 'Neu angelegte Benutzerrolle stimmt nicht');
});

await runStep('Benutzer: Update + Persistenz + API-Roundtrip', async () => {
  await clickNav(page, 'Benutzerverwaltung');
  const row = page.locator('table tbody tr', {
    has: page.getByRole('cell', { name: entities.user.email, exact: true }),
  });
  await row.first().waitFor({ timeout: 10000 });

  const userUpdate = await capturePost(page, '/api/wms/users', async () => {
    await row.first().getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const modal = page.locator('div.fixed').filter({ hasText: 'Benutzer bearbeiten' });
    await modal.locator('label:has-text("Name *") input').first().fill(entities.user.updatedName);
    await modal.locator('label:has-text("E-Mail / Benutzername *") input').first().fill(entities.user.email);
    await modal.locator('label:has-text("Rolle") select').first().selectOption('Admin');
    await modal.locator('label:has-text("Status") select').first().selectOption('Inaktiv');
    await modal.locator('label:has-text("Abteilung") input').first().fill(entities.user.updatedDepartment);
    await modal.locator('label:has-text("Standort") input').first().fill(entities.user.updatedLocation);
    await modal.getByRole('button', { name: 'Speichern', exact: true }).click();
  });

  assertTrue(userUpdate.json?.name === entities.user.updatedName, 'User-Update-Response enthält nicht den neuen Namen');

  const updatedRow = page.locator('table tbody tr', {
    has: page.getByRole('cell', { name: entities.user.email, exact: true }),
  });
  await updatedRow.first().waitFor({ timeout: 10000 });
  await updatedRow.first().getByText('Admin', { exact: true }).waitFor({ timeout: 10000 });
  await updatedRow.first().getByText('Inaktiv', { exact: true }).waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Benutzerverwaltung', 'Teamzugriff');
  const persistedRow = page.locator('table tbody tr', {
    has: page.getByRole('cell', { name: entities.user.email, exact: true }),
  });
  await persistedRow.first().getByText('Admin', { exact: true }).waitFor({ timeout: 10000 });
  await persistedRow.first().getByText('Inaktiv', { exact: true }).waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const user = findUser(overview, entities.user.email);
  assertTrue(!!user, 'Bearbeiteter Benutzer fehlt in /api/wms/overview');
  assertTrue(user.name === entities.user.updatedName, 'Bearbeiteter Benutzername nicht persisted');
  assertTrue(user.role === 'Admin', 'Bearbeitete Benutzerrolle nicht persisted');
  assertTrue(user.status === 'Inaktiv', 'Bearbeiteter Benutzerstatus nicht persisted');
  assertTrue((user.department || '') === entities.user.updatedDepartment, 'Bearbeitete Abteilung nicht persisted');
  assertTrue((user.location || '') === entities.user.updatedLocation, 'Bearbeiteter Standort nicht persisted');
});

await runStep('Asset: Create + Persistenz + API-Roundtrip', async () => {
  await clickNav(page, 'Inventar');

  const assetCreate = await capturePost(page, '/api/wms/assets', async () => {
    await page.getByRole('button', { name: 'Neues Gerät erfassen' }).click();
    const modal = page.locator('div.fixed').filter({ hasText: 'Neue Hardware erfassen' });
    await modal.locator('label:has-text("Gerätename *") input').first().fill(entities.asset.createdName);
    await modal.locator('label:has-text("Seriennummer *") input').first().fill(`SN-${runSuffix}`);
    await modal.locator('label:has-text("Standort") input').first().fill(entities.asset.createdLocation);
    await modal.getByRole('button', { name: 'Speichern', exact: true }).click();
    await modal.getByText('Gerät erfolgreich angelegt').waitFor({ timeout: 10000 });
    await modal.getByRole('button', { name: 'Fertig', exact: true }).click();
  });

  entities.asset.id = assetCreate.json?.id;
  assertTrue(!!entities.asset.id, 'Asset-Create-Response enthält keine ID');
  await page.getByText(entities.asset.createdName, { exact: true }).first().waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Inventar', 'Gerätebestand');
  const searchInput = page.getByPlaceholder('Suche nach Asset, Inventarnummer oder Seriennummer');
  await searchInput.fill(entities.asset.createdName);
  await page.getByText(entities.asset.createdName, { exact: true }).first().waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const asset = findAsset(overview, entities.asset.id);
  assertTrue(!!asset, 'Neu angelegtes Asset fehlt in /api/wms/overview');
  assertTrue(asset.name === entities.asset.createdName, 'Neu angelegter Asset-Name stimmt nicht');
});

await runStep('Asset: Update + Persistenz + API-Roundtrip', async () => {
  await clickNav(page, 'Inventar');
  const searchInput = page.getByPlaceholder('Suche nach Asset, Inventarnummer oder Seriennummer');
  await searchInput.fill(entities.asset.createdName);

  const assetRow = page.locator('table tbody tr', {
    has: page.locator('td', { hasText: entities.asset.createdName }),
  });
  await assetRow.first().waitFor({ timeout: 10000 });
  await assetRow.first().getByRole('button', { name: 'Detail', exact: true }).click();
  await page.getByText('Asset-Detailseite').waitFor({ timeout: 10000 });

  const assetUpdate = await capturePost(page, '/api/wms/assets', async () => {
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    await fillPrompt(page, entities.asset.updatedName, 'Weiter');
    await fillPrompt(page, entities.asset.updatedLocation, 'Weiter');
    await fillPrompt(page, `UI roundtrip update ${runSuffix}`, 'Speichern');
  });

  assertTrue(assetUpdate.json?.name === entities.asset.updatedName, 'Asset-Update-Response enthält nicht den neuen Namen');
  await page.getByRole('heading', { name: entities.asset.updatedName, exact: true }).first().waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Inventar', 'Gerätebestand');
  await searchInput.fill(entities.asset.updatedName);
  await page.getByText(entities.asset.updatedName, { exact: true }).first().waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const asset = findAsset(overview, entities.asset.id);
  assertTrue(!!asset, 'Bearbeitetes Asset fehlt in /api/wms/overview');
  assertTrue(asset.name === entities.asset.updatedName, 'Bearbeiteter Asset-Name nicht persisted');
  assertTrue(asset.location === entities.asset.updatedLocation, 'Bearbeiteter Asset-Standort nicht persisted');
});

await runStep('Asset-Status: In Wartung + Reload', async () => {
  await clickNav(page, 'Inventar');
  const searchInput = page.getByPlaceholder('Suche nach Asset, Inventarnummer oder Seriennummer');
  await searchInput.fill(entities.asset.updatedName);
  const row = page.locator('table tbody tr', {
    has: page.locator('td', { hasText: entities.asset.updatedName }),
  });
  await row.first().getByRole('button', { name: 'Detail', exact: true }).click();

  await capturePost(page, '/api/wms/assets', async () => {
    await page.getByRole('button', { name: 'In Wartung setzen', exact: true }).click();
    await fillPrompt(page, entities.asset.maintenanceNote, 'Setzen');
  });

  await page.getByText('In Wartung', { exact: true }).first().waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Inventar', 'Gerätebestand');
  await searchInput.fill(entities.asset.updatedName);
  const persistedRow = page.locator('table tbody tr', {
    has: page.locator('td', { hasText: entities.asset.updatedName }),
  });
  await persistedRow.first().getByText('In Wartung', { exact: true }).waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const asset = findAsset(overview, entities.asset.id);
  assertTrue(!!asset, 'Asset fehlt nach Wartungsupdate in /api/wms/overview');
  assertTrue(statusMatches(asset.status, 'In Wartung'), 'Asset-Status In Wartung wurde nicht persisted');
});

await runStep('Check-out: Status Verliehen + Reload + API-Roundtrip', async () => {
  await clickNav(page, 'Ein-/Auslagerung');
  const selects = page.locator('select.field-input');
  await selects.nth(0).selectOption(entities.asset.id);
  await page.getByPlaceholder('z. B. Event-Team Nord / Messe Köln').fill(`Team UI-Test ${runSuffix}`);

  await capturePost(page, '/api/wms/assets', async () => {
    await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
  });

  await clickNav(page, 'Inventar');
  const searchInput = page.getByPlaceholder('Suche nach Asset, Inventarnummer oder Seriennummer');
  await searchInput.fill(entities.asset.updatedName);
  const row = page.locator('table tbody tr', {
    has: page.locator('td', { hasText: entities.asset.updatedName }),
  });
  await row.first().getByText('Verliehen', { exact: true }).waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Inventar', 'Gerätebestand');
  await searchInput.fill(entities.asset.updatedName);
  const persistedRow = page.locator('table tbody tr', {
    has: page.locator('td', { hasText: entities.asset.updatedName }),
  });
  await persistedRow.first().getByText('Verliehen', { exact: true }).waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const asset = findAsset(overview, entities.asset.id);
  assertTrue(!!asset, 'Asset fehlt nach Check-out in /api/wms/overview');
  assertTrue(statusMatches(asset.status, 'Verliehen'), 'Asset-Status Verliehen wurde nicht persisted');
});

await runStep('Check-in: Status Verfügbar + Reload + API-Roundtrip', async () => {
  await clickNav(page, 'Ein-/Auslagerung');
  const selects = page.locator('select.field-input');
  await selects.nth(1).selectOption(entities.asset.id);
  await page.getByPlaceholder('Kurzer Zustandsbericht inkl. Sichtprüfung').fill(`Alles in Ordnung ${runSuffix}`);

  await capturePost(page, '/api/wms/assets', async () => {
    await page.getByRole('button', { name: 'Rücknahme speichern', exact: true }).click();
  });

  await clickNav(page, 'Inventar');
  const searchInput = page.getByPlaceholder('Suche nach Asset, Inventarnummer oder Seriennummer');
  await searchInput.fill(entities.asset.updatedName);
  const row = page.locator('table tbody tr', {
    has: page.locator('td', { hasText: entities.asset.updatedName }),
  });
  await row.first().getByText('Verfügbar', { exact: true }).waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Inventar', 'Gerätebestand');
  await searchInput.fill(entities.asset.updatedName);
  const persistedRow = page.locator('table tbody tr', {
    has: page.locator('td', { hasText: entities.asset.updatedName }),
  });
  await persistedRow.first().getByText('Verfügbar', { exact: true }).waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const asset = findAsset(overview, entities.asset.id);
  assertTrue(!!asset, 'Asset fehlt nach Check-in in /api/wms/overview');
  assertTrue(statusMatches(asset.status, 'Verfügbar'), 'Asset-Status Verfügbar wurde nicht persisted');
});

await runStep('Defekt/Ticket: Create + Persistenz + API-Roundtrip', async () => {
  await clickNav(page, 'Defekte / Tickets');
  await page.locator('label:has-text("Asset *") input').first().fill(entities.asset.updatedName);
  await page.locator('label:has-text("Problemkurztext *") input').first().fill(entities.ticket.issue);
  await page.getByPlaceholder('Symptome, Zeitpunkt, Auswirkung').fill(entities.ticket.comment);

  const maintenanceCreate = await capturePost(page, '/api/wms/maintenance', async () => {
    await page.getByRole('button', { name: 'Meldung anlegen', exact: true }).click();
  });
  assertTrue(maintenanceCreate.json?.issue === entities.ticket.issue, 'Ticket-Response enthält nicht den erwarteten Issue-Text');

  await page.getByText(entities.ticket.issue, { exact: true }).first().waitFor({ timeout: 10000 });

  await reloadAndOpen(page, 'Defekte / Tickets', 'Ticketübersicht');
  await page.getByText(entities.ticket.issue, { exact: true }).first().waitFor({ timeout: 10000 });

  const overview = await fetchOverview(context);
  const ticket = findTicket(overview, entities.ticket.issue);
  assertTrue(!!ticket, 'Neu angelegtes Ticket fehlt in /api/wms/overview');
  assertTrue(ticket.assetName === entities.asset.updatedName, 'Ticket referenziert nicht das erwartete Asset');
});

await runStep('Validierung: Pflichtfelder führen zu sauberer Nutzerführung', async () => {
  await clickNav(page, 'Defekte / Tickets');
  await page.locator('label:has-text("Asset *") input').first().fill('');
  await page.locator('label:has-text("Problemkurztext *") input').first().fill('');
  await page.getByRole('button', { name: 'Meldung anlegen', exact: true }).click();
  await page.getByText('Bitte Asset und Problemkurztext ausfüllen').waitFor({ timeout: 10000 });
});

await runStep('Import/Export: CSV-Export und Template-Download starten', async () => {
  await clickNav(page, 'Import / Export');

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: 'Inventar als CSV exportieren' }).click();
  const download = await downloadPromise;
  assertTrue(download.suggestedFilename().endsWith('.csv'), `Unerwarteter Dateiname: ${download.suggestedFilename()}`);

  const templatePromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: 'Beispiel-Excel herunterladen', exact: true }).click();
  const template = await templatePromise;
  assertTrue(template.suggestedFilename().endsWith('.xlsx'), `Unerwarteter Template-Dateiname: ${template.suggestedFilename()}`);
});

const result = {
  consoleErrors,
  pageErrors,
  stepFailures,
  roundtripChecks,
};

console.log(`UI_RESULT ${JSON.stringify(result)}`);

await context.close();
await browser.close();

if (consoleErrors.length || pageErrors.length || stepFailures.length) {
  process.exitCode = 1;
}
