/** T21 acceptance: real browser screens -> BFF -> owner APIs -> PostgreSQL. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = process.cwd();
const primary = resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const { chromium } = createRequire(resolve(root, 'web/mf-employees/package.json'))(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const shell = 'http://127.0.0.1:4200';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const stages = [], issues = [], failures = [], mutations = [];
let browser;
const pages = [];
const credentials = key => accounts.find(account => account.key === key);
const graphql = async (query, variables = {}) => {
  const token = (await authorize(credentials('administrador'))).access_token;
  const response = await fetch('http://127.0.0.1:3004/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return result.data;
};
const waitMutation = (page, field) => page.waitForResponse(response => response.url().endsWith('/graphql') && response.request().postDataJSON()?.query.includes(field), { timeout: 30000 }).then(async response => {
  const result = await response.json();
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return result.data[field];
});
const clickMutation = async (page, selector, field) => {
  const result = waitMutation(page, field);
  await page.locator(selector).click();
  return result;
};
const pageFor = async (key, route) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => issues.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') issues.push({ type: 'console', message: message.text() }); });
  page.on('requestfailed', request => failures.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText }));
  page.on('response', async response => {
    if (!response.url().endsWith('/graphql') || response.request().method() !== 'POST') return;
    const query = response.request().postDataJSON()?.query;
    if (!query?.includes('mutation')) return;
    const body = await response.json().catch(() => ({}));
    mutations.push({ actor: key, fields: Object.keys(body.data ?? {}), errors: body.errors?.map(error => error.extensions?.code) ?? [] });
  });
  await page.goto(shell + route, { waitUntil: 'domcontentloaded' });
  if (await page.locator('#session-login').isVisible()) await page.locator('#session-login').click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(credentials(key).username);
  await page.locator('#password').fill(credentials(key).password);
  await page.locator('#kc-login').click();
  return page;
};
const reload = async (page, selector) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(selector).waitFor({ state: 'visible', timeout: 45000 });
};
try {
  // Synthetic prerequisites only. Reception, orders, quote versions and decisions
  // below are all submitted through screens; no route interception or mocks.
  const customer = (await graphql('mutation($input:CreateCustomerInput!){createCustomer(input:$input){customer{id}}}', { input: { operationId: randomUUID(), firstName: 'T21', lastName: 'Sintético ' + suffix, document: 'T21-' + suffix, phone: '+591 70000021' } })).createCustomer.customer;
  const vehicles = [];
  for (const index of [1, 2]) vehicles.push((await graphql('mutation($input:CreateVehicleInput!){createVehicle(input:$input){vehicle{id plate}}}', { input: { operationId: randomUUID(), customerId: customer.id, plate: 'T' + index + suffix, make: 'Kia', model: 'Prueba T21', year: 2024, fuelType: 'gasolina' } })).createVehicle.vehicle);
  const service = (await graphql('mutation($input:CreateServiceInput!){createService(input:$input){service{id name}}}', { input: { operationId: randomUUID(), name: 'T21 frenos ' + suffix, description: 'Servicio sintético de aceptación T21', category: 'reparacion', estimatedMinutes: 45, referenceRate: 200 } })).createService.service;
  stages.push('existing-customer-vehicles-and-catalog-fixtures');
  browser = await chromium.launch();
  const reception = await pageFor('recepcionista', '/operations/receptions');
  await reception.locator('#reception-table').waitFor({ state: 'visible', timeout: 45000 });
  const orders = [];
  for (const vehicle of vehicles) {
    if (!new URL(reception.url()).pathname.endsWith('/receptions')) await reception.locator('#order-receptions-link').click();
    await reception.locator('#reception-search').fill(vehicle.plate);
    await reception.locator('#reception-search-vehicle').click();
    await reception.locator('#reception-vehicle option[value="' + vehicle.id + '"]').waitFor({ state: 'attached' });
    await reception.locator('#reception-vehicle').selectOption(vehicle.id);
    await reception.locator('#reception-mileage').fill('55000');
    await reception.locator('#reception-reason').fill('Ruido al frenar ' + suffix);
    await reception.locator('#reception-symptoms').fill('Vibración reportada por cliente sintético');
    await reception.locator('#reception-conditions').fill('Raspón visible documentado, sin fotografías');
    const received = (await clickMutation(reception, '#reception-save', 'createReception')).reception;
    assert.equal(received.vehicleId, vehicle.id);
    assert.equal(received.customerId, customer.id);
    const row = '[data-reception-id="' + received.id + '"]';
    await reception.locator(row).waitFor({ state: 'visible' });
    await reload(reception, row);
    assert.match(await reception.locator(row).innerText(), /55000/);
    // The real owner rejects an already open reception, preserving the form.
    await reception.locator('#reception-vehicle-id').fill(vehicle.id);
    await reception.locator('#reception-mileage').fill('55000');
    await reception.locator('#reception-reason').fill('Intento duplicado controlado');
    await reception.locator('#reception-save').click();
    await reception.locator('#reception-error').waitFor({ state: 'visible' });
    assert.match(await reception.locator('#reception-error').innerText(), /recepción|recepcion/i);
    await reception.locator('[data-reception-create-order="' + received.id + '"]').click();
    await reception.locator('#order-reception-summary').waitFor({ state: 'visible' });
    await reception.locator('#order-description').fill('Revisar sistema de frenos ' + suffix);
    await reception.locator('#order-priority').selectOption('alta');
    await reception.locator('#order-notes').fill('Solicitud sintética desde pantalla');
    await reception.locator('#order-service-search').fill(service.name);
    await reception.locator('#order-load-services').click();
    await reception.locator('#order-service-0 option[value="' + service.id + '"]').waitFor({ state: 'attached' });
    await reception.locator('#order-service-0').selectOption(service.id);
    await reception.locator('#order-quantity-0').fill('2');
    const order = (await clickMutation(reception, '#order-save', 'createWorkOrder')).order;
    orders.push(order);
    assert.equal(order.status, 'pending_quote');
    assert.equal(order.items[0].referenceRate, 200);
    await reception.locator('#order-notice').waitFor({ state: 'visible' });
    await reload(reception, '[data-order-id="' + order.id + '"]');
    await reception.locator('[data-order-detail="' + order.id + '"]').click();
    assert.match(await reception.locator('#order-detail').innerText(), /alta/);
    assert.match(await reception.locator('#order-items').innerText(), /200/);
  }
  stages.push('receptions-orders-from-ui-persist-reload-copied-rates-business-error');
  const finance = await pageFor('responsable_financiero', '/finance');
  await finance.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 45000 });
  const quotes = [];
  for (const order of orders) {
    await finance.getByTestId('quote-order-' + order.id).click();
    await finance.locator('#quote-discount').fill('10');
    const quote = (await clickMutation(finance, '#quote-create', 'createQuote')).quote;
    assert.equal(quote.customerReference, customer.id);
    assert.equal(quote.vehicleReference, order.vehicleId);
    assert.equal(quote.subtotal, 400);
    assert.equal(quote.discountAmount, 40);
    assert.equal(quote.total, Math.round((quote.subtotal - quote.discountAmount + quote.taxAmount) * 100) / 100);
    quotes.push(quote);
    await finance.locator('#quotes-reload:not([disabled])').waitFor({ state: 'visible' });
  }
  stages.push('finance-ui-creates-two-pending-quotes-stable-ids-server-calculation');
  await finance.locator('#quote-order-filter').fill(orders[0].id);
  await finance.getByTestId('quote-select-' + quotes[0].id).click();
  await finance.locator('#quote-revise').click();
  await finance.locator('#quote-discount').fill('5');
  const revised = (await clickMutation(finance, '#quote-revise-submit', 'reviseQuote')).quote;
  assert.equal(revised.version, 2);
  quotes[0] = revised;
  await reload(finance, '[data-mf="finance"]');
  await finance.locator('#quote-order-filter').fill(orders[0].id);
  await finance.getByTestId('quote-select-' + revised.id).click();
  assert.match(await finance.locator('#quote-detail').innerText(), /v2/);
  assert.match(await finance.locator('[data-mf="finance"]').innerText(), /superseded/);
  stages.push('quote-revision-v2-and-superseded-v1-persist');
  // Same receptionist session crosses Angular -> React, no second login.
  await reception.locator('a[data-module="finance"]').click();
  await reception.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await reception.locator('#kc-login').count(), 0);
  await reception.locator('#quote-order-filter').fill(orders[1].id);
  await reception.getByTestId('quote-select-' + quotes[1].id).click();
  assert.ok(await reception.locator('#quote-approve').isDisabled(), 'empty evidence must not submit');
  await reception.locator('#quote-evidence').fill('Teléfono: cliente sintético rechaza el importe para prueba T21');
  await reception.locator('#quote-reason').fill('No autoriza presupuesto de prueba');
  const rejected = (await clickMutation(reception, '#quote-reject', 'decideQuote')).quote;
  assert.equal(rejected.id, quotes[1].id);
  assert.equal(rejected.status, 'rejected');
  const untouched = await graphql('query($id:UUID!){quote(id:$id){status}}', { id: quotes[0].id });
  assert.equal(untouched.quote.status, 'pending', 'deciding a selected row must not change another pending quote');
  await reception.locator('#quote-order-filter').fill(orders[0].id);
  await reception.getByTestId('quote-select-' + quotes[0].id).click();
  await reception.locator('#quote-evidence').fill('Presencial: cliente sintético autoriza v2 en prueba T21');
  const approved = (await clickMutation(reception, '#quote-approve', 'decideQuote')).quote;
  assert.equal(approved.id, quotes[0].id);
  assert.equal(approved.status, 'approved');
  await reload(reception, '[data-mf="finance"]');
  await reception.locator('#quote-order-filter').fill(orders[0].id);
  await reception.getByTestId('quote-select-' + approved.id).click();
  assert.match(await reception.locator('#quote-detail').innerText(), /approved/);
  assert.match(await reception.locator('#quote-detail').innerText(), /cliente sintético autoriza/);
  assert.equal(await reception.locator('#quote-approve').count(), 0);
  assert.match(await reception.locator('#quote-scope-notice').innerText(), /no confirma el servicio ni asigna mecánico/);
  const persisted = await graphql('query($id:UUID!){order(id:$id){status version items{referenceRate}}}', { id: orders[0].id });
  assert.equal(persisted.order.status, 'pending_quote');
  stages.push('selected-rejection-then-approval-real-evidence-persist-no-confirmation');
  // Finance still has the earlier pending snapshot. The owner must reject a
  // revision after another actor approved it, and the UI must recover by reload.
  await finance.locator('#quote-revise').click();
  await finance.locator('#quote-discount').fill('4');
  const conflictResponse = finance.waitForResponse(response => response.url().endsWith('/graphql') && response.request().postDataJSON()?.query.includes('reviseQuote'));
  await finance.locator('#quote-revise-submit').click();
  const conflict = await (await conflictResponse).json();
  assert.equal(conflict.errors[0].extensions.code, 'QUOTE_APPROVED_IMMUTABLE');
  await finance.locator('#quote-mutation-error').waitFor({ state: 'visible' });
  assert.match(await finance.locator('#quote-mutation-error').innerText(), /inmutable/);
  await finance.locator('#quotes-reload').click();
  await finance.getByTestId('quote-select-' + approved.id).click();
  assert.match(await finance.locator('#quote-detail').innerText(), /approved/);
  assert.equal(await finance.locator('#quote-revise').count(), 0);
  stages.push('stale-approved-version-rejected-and-reload-recovers');
  assert.ok(await reception.getByTestId('quote-order-' + orders[0].id).isDisabled(), 'receptionist cannot create quotes');
  const mechanic = await pageFor('mecanico', '/finance');
  await mechanic.locator('#module-access').waitFor({ state: 'visible', timeout: 30000 });
  await mechanic.waitForFunction(() => document.getElementById('module-access')?.textContent.includes('Acceso insuficiente'));
  assert.equal(await mechanic.locator('[data-mf="finance"]').count(), 0);
  stages.push('permissions-receptionist-read-decide-not-write-mechanic-denied');
  await reception.screenshot({ path: resolve(root, 'output/playwright/t21-finance-desktop.png'), fullPage: true });
  await reception.setViewportSize({ width: 390, height: 844 });
  await reception.screenshot({ path: resolve(root, 'output/playwright/t21-finance-mobile.png'), fullPage: true });
  const storage = await reception.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]);
  assert.ok(storage.every(value => !/eyJ[A-Za-z0-9_-]+\./.test(value)), 'no persisted JWT');
  assert.deepEqual(issues, [], 'no browser console/page errors');
  stages.push('responsive-evidence-no-token-storage-console-clean');
  console.log(JSON.stringify({ pass: true, stages, references: { customerId: customer.id, orderIds: orders.map(order => order.id), quoteIds: quotes.map(quote => quote.id) } }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stages, error: String(error?.stack ?? error) }));
  process.exitCode = 1;
} finally {
  mkdirSync(resolve(root, 'output/playwright'), { recursive: true });
  const views = await Promise.all(pages.map(async page => ({ path: new URL(page.url()).pathname, text: (await page.locator('body').innerText().catch(() => '')).slice(-4000) })));
  writeFileSync(resolve(root, 'output/playwright/t21-business-diagnostic.json'), JSON.stringify({ stages, issues, failures, mutations, views }, null, 2));
  await browser?.close();
}
