import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

class AcceptanceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new AcceptanceError(code); };
const equal = (actual, expected, code) => check(actual === expected, code);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const owners = { operations: 'http://operations:8081', employees: 'http://employees:3002', finance: 'http://finance:8000' };
const fields = 'assignmentId orderId orderNumber employee { id fullName status } vehicle { id plate make model } startsAt endsAt priority status description notes services { serviceId serviceName quantity estimatedMinutes } orderVersion assignmentVersion observedAt confirmationObservation';
const pageFields = 'actor { employeeId fullName status scopes } items { ' + fields + ' } total limit offset from to timeZone observedAt';
const selfPath = '/employees/agenda', teamPath = selfPath + '/team';
const rows = 'anx-agenda nz-table tbody tr';
const consultButton = 'anx-agenda form.toolbar:has(input[name=from]) button[type=submit]';
const normalize = value => value.replace(/\s+/gu, ' ').trim();

export function matchesGraphResponse(response, origin, field, expectedVariables = {}) {
  const request = response.request();
  if (response.url() !== origin + '/graphql' || request.method() !== 'POST') return false;
  const body = request.postDataJSON();
  const queryField = new RegExp(String.fromCharCode(92) + 'b' + field + String.fromCharCode(92) + 's*' + String.fromCharCode(92) + '(');
  return queryField.test(body?.query ?? '') && Object.entries(expectedVariables).every(([key, value]) => (body?.variables?.[key] ?? undefined) === (value ?? undefined));
}

export function chromiumRuntime(makeRequire = createRequire) {
  const application = makeRequire('/app/web/mf-employees/package.json');
  // Playwright is a locked peer of this direct dev dependency under pnpm.
  return makeRequire(application.resolve('@vitest/browser-playwright'))('playwright').chromium;
}

export function relayAddress(value) {
  let url;
  try { url = new URL(value); } catch { throw new AcceptanceError('RELAY_ORIGIN_INVALID'); }
  check(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash && url.origin === value, 'RELAY_LOOPBACK_HTTP_REQUIRED');
  const port = Number(url.port || 80);
  check(port >= 1 && port <= 65535, 'RELAY_PORT_INVALID');
  return { host: '127.0.0.1', port };
}

export async function startRelay(publicOrigin) {
  const address = relayAddress(publicOrigin), sockets = new Set();
  let failed = false;
  const server = createServer(client => {
    const upstream = createConnection({ host: 'web', port: 8080 });
    let connected = false;
    upstream.once('connect', () => { connected = true; });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {
        if (socket === upstream && !connected) failed = true;
        client.destroy(); upstream.destroy();
      });
    }
    client.pipe(upstream); upstream.pipe(client);
    client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(address.port, address.host, accept);
  });
  server.on('error', () => { failed = true; });
  return {
    healthy: () => !failed,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    },
  };
}

export function sanitizedError(error) {
  return {
    code: error instanceof AcceptanceError ? error.code : 'ACCEPTANCE_FAILED',
    refs: [...new Set(String(error?.stack ?? '').match(/(?:acceptance|demo|bootstrap)\.mjs:\d+:\d+/g) ?? [])],
  };
}

export function validateLedger(state, configuredOrigin) {
  check(state?.version === 1 && typeof state.completedAt === 'string' && Number.isFinite(Date.parse(state.completedAt)), 'SEED_NOT_COMPLETED');
  relayAddress(state.publicOrigin);
  equal(state.publicOrigin, configuredOrigin, 'PUBLIC_ORIGIN_DRIFT');
  check(/^\d{4}-\d{2}-\d{2}$/.test(state.date), 'SEED_DATE_INVALID');
  const accounts = ['mechanicA', 'mechanicB', 'chief'].map(key => state.accounts?.[key]);
  for (const account of accounts) check(account?.credentialState === 'verified' && uuid(account.subject) && uuid(account.employeeId) &&
    typeof account.username === 'string' && typeof account.password === 'string' && account.password.length > 0, 'SEED_ACCOUNT_INVALID');
  equal(new Set(accounts.map(account => account.subject)).size, 3, 'SEED_SUBJECTS_NOT_DISTINCT');
  equal(new Set(accounts.map(account => account.employeeId)).size, 3, 'SEED_EMPLOYEES_NOT_DISTINCT');
  for (const key of ['mechanicA', 'mechanicB']) {
    for (const step of ['order', 'confirmation']) equal(state.steps?.[key + '.' + step]?.state, 'done', 'SEED_STEP_INCOMPLETE');
    check(uuid(state.steps[key + '.order'].result?.id) && typeof state.steps[key + '.order'].result?.number === 'string', 'SEED_ORDER_INVALID');
  }
  return state;
}

const workKeys = new Set('assignmentId orderId orderNumber employee vehicle startsAt endsAt priority status description notes services orderVersion assignmentVersion observedAt confirmationObservation'.split(' '));
function keys(value, allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'SNAPSHOT_INVALID');
  check(Object.keys(value).every(key => allowed.has(key)), 'SNAPSHOT_PRIVACY_VIOLATION');
}
export function minimalWork(work) {
  keys(work, workKeys);
  keys(work.employee, new Set(['id', 'fullName', 'status']));
  keys(work.vehicle, new Set(['id', 'plate', 'make', 'model']));
  check(Array.isArray(work.services) && work.services.length > 0, 'SERVICES_MISSING');
  for (const service of work.services) keys(service, new Set(['serviceId', 'serviceName', 'quantity', 'estimatedMinutes']));
}
function minimalPage(page) {
  keys(page, new Set('actor items total limit offset from to timeZone observedAt'.split(' ')));
  keys(page.actor, new Set(['employeeId', 'fullName', 'status', 'scopes']));
  check(Array.isArray(page.items), 'AGENDA_ITEMS_INVALID');
  for (const work of page.items) minimalWork(work);
}
export function restResult(response, status, code) {
  equal(response.status, status, 'OWNER_STATUS_MISMATCH');
  if (code) {
    equal(response.body?.code ?? response.body?.error, code, 'OWNER_CODE_MISMATCH');
    keys(response.body, new Set(['statusCode', 'message', 'code', 'error']));
    check(response.body?.data == null && response.body?.items == null && response.body?.orderId == null, 'DENIAL_DATA_LEAK');
  }
  return response.body;
}
export function graphDenied(response, code, statusCode) {
  equal(response.status, 200, 'GRAPHQL_ENVELOPE_STATUS');
  const { body } = response;
  keys(body, new Set(['data', 'errors']));
  check(body?.data == null || Object.values(body.data).every(value => value == null), 'GRAPHQL_DENIAL_DATA_LEAK');
  check(Array.isArray(body?.errors) && body.errors.length > 0 && body.errors.every(error =>
    error.extensions?.code === code && error.extensions?.statusCode === statusCode), 'GRAPHQL_DENIAL_CODE');
}

async function integrationProbes(state, admin, stage) {
  const { session } = await import('./demo.mjs');
  const transport = session(state.publicOrigin, admin);
  const tokens = new Map();
  const request = async (url, account, body) => {
    let issued = tokens.get(account.subject);
    if (!issued || Date.now() >= issued.renewAt) {
      const started = Date.now();
      issued = await transport.login(account);
      issued.renewAt = started + (issued.expiresIn - 15) * 1000;
      tokens.set(account.subject, issued);
    }
    equal(issued.subject, account.subject, 'LOGIN_SUBJECT_DRIFT');
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + issued.token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    return { status: response.status, body: await response.json() };
  };
  const read = (owner, path, account, body) => request(owners[owner] + path, account, body);
  const gql = (account, query, variables = {}) => request(state.publicOrigin + '/graphql', account, { query, variables });
  const range = '?from=' + state.date + '&to=' + state.date;
  const jobs = [];
  await stage('owner-own-snapshots', async () => {
    for (const key of ['mechanicA', 'mechanicB']) {
      const account = state.accounts[key], order = state.steps[key + '.order'].result;
      const page = restResult(await read('operations', '/agenda/me' + range, account), 200);
      minimalPage(page);
      equal(page.actor.employeeId, account.employeeId, 'OWNER_ACTOR_MISMATCH');
      equal(page.timeZone, 'America/La_Paz', 'OWNER_ZONE_MISMATCH');
      equal(page.from, state.date, 'OWNER_DATE_MISMATCH'); equal(page.to, state.date, 'OWNER_DATE_MISMATCH');
      equal(page.total, 1, 'OWNER_JOB_COUNT'); equal(page.items.length, 1, 'OWNER_JOB_COUNT');
      const work = page.items[0];
      equal(work.orderId, order.id, 'OWNER_ORDER_MISMATCH'); equal(work.orderNumber, order.number, 'OWNER_ORDER_MISMATCH');
      equal(work.employee.id, account.employeeId, 'OWNER_EMPLOYEE_MISMATCH'); equal(work.status, 'confirmed', 'OWNER_NOT_CONFIRMED');
      check(uuid(work.assignmentId) && typeof work.description === 'string' && (work.notes === null || typeof work.notes === 'string'), 'OWNER_WORK_INVALID');
      const command = state.steps[key + '.confirmation'].body;
      equal(Date.parse(work.startsAt), Date.parse(command.startsAt), 'OWNER_INTERVAL_MISMATCH');
      equal(Date.parse(work.endsAt), Date.parse(command.endsAt), 'OWNER_INTERVAL_MISMATCH');
      const detail = restResult(await read('operations', '/agenda/me/' + work.assignmentId, account), 200);
      minimalWork(detail); equal(detail.orderId, order.id, 'OWNER_DETAIL_MISMATCH');
      const graph = await gql(account, 'query($date:Date!){myAgenda(from:$date,to:$date){' + pageFields + '}}', { date: state.date });
      equal(graph.status, 200, 'GRAPHQL_STATUS'); check(!graph.body.errors, 'GRAPHQL_READ_FAILED');
      const graphPage = graph.body.data?.myAgenda; minimalPage(graphPage);
      equal(graphPage.total, 1, 'GRAPHQL_JOB_COUNT'); equal(graphPage.items.length, 1, 'GRAPHQL_JOB_COUNT');
      equal(graphPage.items[0].assignmentId, work.assignmentId, 'GRAPHQL_WORK_MISMATCH');
      jobs.push(work);
    }
    check(jobs[0].assignmentId !== jobs[1].assignmentId, 'ASSIGNMENTS_NOT_DISTINCT');
  });
  await stage('owner-isolation-and-no-crud-shortcuts', async () => {
    for (const [index, key] of ['mechanicA', 'mechanicB'].entries()) {
      const account = state.accounts[key], other = jobs[1 - index];
      restResult(await read('operations', '/agenda/me' + range + '&employeeId=' + other.employee.id, account), 400, 'VALIDATION_ERROR');
      restResult(await read('operations', '/agenda/me/' + other.assignmentId, account), 404, 'AGENDA_WORK_NOT_FOUND');
      for (const path of ['/agenda/team' + range, '/agenda/team/' + other.assignmentId]) restResult(await read('operations', path, account), 403, 'AGENDA_ACCESS_DENIED');
      for (const path of ['/agenda/context?scope=team', '/agenda/team/employees']) restResult(await read('employees', path, account), 403, 'AGENDA_ACCESS_DENIED');
      restResult(await read('employees', '/agenda/assignments/check', account, { scope: 'self', assignmentIds: [other.assignmentId] }), 404, 'AGENDA_WORK_NOT_FOUND');
      restResult(await read('employees', '/agenda/assignments/check', account, { scope: 'team', assignmentIds: [other.assignmentId] }), 403, 'AGENDA_ACCESS_DENIED');
      for (const [owner, path] of [['operations', '/orders'], ['operations', '/customers'], ['finance', '/quotes']]) restResult(await read(owner, path, account), 403, 'forbidden');
      for (const [owner, path] of [['operations', '/orders/' + other.orderId],
        ['operations', '/customers/' + state.steps[(index ? 'mechanicA' : 'mechanicB') + '.customer'].result.id],
        ['finance', '/quotes/' + state.steps[(index ? 'mechanicA' : 'mechanicB') + '.quote'].result.id]]) restResult(await read(owner, path, account), 403, 'forbidden');
      const empty = restResult(await read('operations', '/agenda/me' + range + '&priority=urgente', account), 200);
      minimalPage(empty); equal(empty.total, 0, 'EMPTY_TOTAL'); equal(empty.items.length, 0, 'EMPTY_ITEMS');
    }
  });
  await stage('bff-alias-fields-idor-and-no-shortcuts', async () => {
    for (const [index, key] of ['mechanicA', 'mechanicB'].entries()) {
      const account = state.accounts[key];
      for (const query of ['{teamAgenda {total}}', '{a:teamAgenda {total} b:teamAgenda {total}}',
        '{own:myAgenda {total} other:teamAgenda {total}}', '{agendaTeamEmployees {total}}',
        '{teamAgendaWork(assignmentId:"' + jobs[index].assignmentId + '"){assignmentId}}',
        '{orders {items {id}}}', '{customers {items {id}}}', '{quotes {items {id}}}']) graphDenied(await gql(account, query), 'FORBIDDEN', 403);
      graphDenied(await gql(account, '{myAgendaWork(assignmentId:"' + jobs[1 - index].assignmentId + '"){assignmentId}}'), 'AGENDA_WORK_NOT_FOUND', 404);
      graphDenied(await gql(account, '{myAgenda(employeeId:"' + jobs[1 - index].employee.id + '"){total}}'), 'BAD_REQUEST', 400);
      for (const selection of ['employee {document}', 'vehicle {customerId}', 'services {unitPrice}', 'customerId', 'quoteId']) {
        graphDenied(await gql(account, '{myAgenda {items {' + selection + '}}}'), 'BAD_REQUEST', 400);
      }
    }
  });
  await stage('owner-chief-team', async () => {
    const account = state.accounts.chief;
    const page = restResult(await read('operations', '/agenda/team' + range + '&limit=100', account), 200); minimalPage(page);
    for (const job of jobs) {
      check(page.items.some(item => item.assignmentId === job.assignmentId), 'TEAM_JOB_MISSING');
      const detail = restResult(await read('operations', '/agenda/team/' + job.assignmentId, account), 200);
      minimalWork(detail); equal(detail.orderId, job.orderId, 'TEAM_DETAIL_MISMATCH');
    }
  });
  return jobs;
}

async function browserProbes(browser, state, admin, jobs, evidenceDir, stage) {
  const contexts = [];
  const faults = { console: 0, page: 0, network: 0, http: 0, transport: 0 };
  const origin = state.publicOrigin;
  async function graphAction(page, field, action, expectedVariables = {}) {
    const response = page.waitForResponse(response => matchesGraphResponse(response, origin, field, expectedVariables));
    const [result] = await Promise.all([response, action()]);
    equal(result.status(), 200, 'UI_GRAPHQL_STATUS');
    const body = await result.json(); check(!body.errors && body.data?.[field], 'UI_GRAPHQL_FAILED');
    return body.data[field];
  }
  async function pageFor(account) {
    const context = await browser.newContext({ timezoneId: 'Pacific/Auckland', locale: 'en-NZ', viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    const handle = { page, authenticating: true };
    const isOidc = value => {
      try { const url = new URL(value); return url.origin === origin && (url.pathname.startsWith('/identity/') || url.pathname === '/auth/callback'); }
      catch { return false; }
    };
    page.on('console', message => {
      if (message.type() === 'error' && !(handle.authenticating && /net::ERR_ABORTED/.test(message.text()) &&
        isOidc(message.location().url || origin))) faults.console++;
    });
    page.on('pageerror', () => faults.page++);
    page.on('requestfailed', request => {
      if (!(handle.authenticating && isOidc(request.url()) && request.failure()?.errorText === 'net::ERR_ABORTED')) faults.network++;
    });
    page.on('request', request => {
      if (['fetch', 'xhr'].includes(request.resourceType())) {
        const url = new URL(request.url());
        if (url.origin !== origin || !(url.pathname === '/graphql' || url.pathname.startsWith('/identity/') ||
          url.pathname.startsWith('/mfs/') || url.pathname.startsWith('/assets/') || url.pathname === '/runtime-config.js')) faults.transport++;
      }
    });
    page.on('response', response => { if (response.status() >= 400) faults.http++; });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await login(handle, account);
    return handle;
  }
  async function login(handle, account) {
    const { page } = handle; handle.authenticating = true;
    await page.locator('#session-login').click(); await page.locator('#username').waitFor({ state: 'visible' });
    const target = new URL(page.url());
    check(target.origin === origin && target.pathname.startsWith('/identity/realms/autonexus/'), 'BROWSER_IDP_ORIGIN');
    equal(target.searchParams.get('client_id'), 'autonexus-shell', 'BROWSER_OIDC_CLIENT');
    equal(target.searchParams.get('redirect_uri'), origin + '/auth/callback', 'BROWSER_OIDC_CALLBACK');
    equal(target.searchParams.get('response_type'), 'code', 'BROWSER_OIDC_CODE_FLOW');
    equal(target.searchParams.get('code_challenge_method'), 'S256', 'BROWSER_PKCE_METHOD');
    check(/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('code_challenge') ?? ''), 'BROWSER_PKCE_CHALLENGE');
    check(target.searchParams.get('nonce') && target.searchParams.get('state'), 'BROWSER_OIDC_STATE_NONCE');
    await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password);
    await page.locator('#kc-login').click(); await page.locator('#session-logout').waitFor({ state: 'visible' });
    handle.authenticating = false;
  }
  async function noTokens(page) {
    const clean = await page.evaluate(async () => {
      const token = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
      for (const storage of [localStorage, sessionStorage]) for (const key of Object.keys(storage)) {
        if (/(?:access.?token|refresh.?token|id.?token|authorization)/i.test(key) || token.test(storage.getItem(key) ?? '')) return false;
      }
      const databases = await indexedDB.databases();
      for (const database of databases) {
        const db = await new Promise((accept, reject) => { const request = indexedDB.open(database.name); request.onsuccess = () => accept(request.result); request.onerror = () => reject(); });
        try {
          for (const name of db.objectStoreNames) {
            const values = await new Promise((accept, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => accept(request.result); request.onerror = () => reject(); });
            if (token.test(JSON.stringify(values)) || /"(?:access_token|refresh_token|id_token|accessToken|refreshToken)"\s*:/.test(JSON.stringify(values))) return false;
          }
        } finally { db.close(); }
      }
      return true;
    });
    check(clean, 'PERSISTED_TOKEN');
  }
  async function logout(handle) {
    const { page } = handle; await noTokens(page); handle.authenticating = true;
    await page.locator('#session-logout').click(); await page.locator('#session-login').waitFor({ state: 'visible' });
    handle.authenticating = false;
    await page.locator('anx-agenda').waitFor({ state: 'detached' });
    equal(await page.locator(rows).count(), 0, 'LOGOUT_ROWS_RETAINED');
    equal(await page.locator('anx-agenda .observations').count(), 0, 'LOGOUT_DETAIL_RETAINED');
    equal(await page.locator('#session-identity').innerText(), '', 'LOGOUT_IDENTITY_RETAINED');
    equal(await page.locator('#employee-create, #order-refresh, [data-mf=finance]').count(), 0, 'LOGOUT_MODULE_RETAINED');
    await noTokens(page);
  }
  async function consult(page, path, priority = '', employeeId = '') {
    if (new URL(page.url()).pathname !== path) await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await page.locator('anx-agenda input[name=from]').fill(state.date);
    await page.locator('anx-agenda input[name=to]').fill(state.date);
    await page.locator('anx-agenda select[name=priority]').selectOption(priority);
    if (path === teamPath) await page.locator('anx-agenda select[name=employeeId]').selectOption(employeeId);
    const result = await graphAction(page, path === teamPath ? 'teamAgenda' : 'myAgenda', () => page.locator(consultButton).click(), { from: state.date, to: state.date, priority: priority || undefined, employeeId: employeeId || undefined });
    minimalPage(result); equal(result.from, state.date, 'UI_DATE_MISMATCH'); equal(result.to, state.date, 'UI_DATE_MISMATCH');
    await page.locator('anx-agenda > p').filter({ hasText: state.date }).waitFor({ state: 'visible' });
    return result;
  }
  async function visibleJob(page, job, other) {
    const row = page.locator(rows).filter({ hasText: job.orderNumber }); await row.waitFor({ state: 'visible' });
    if (other) equal(await page.locator(rows).filter({ hasText: other.orderNumber }).count(), 0, 'UI_FOREIGN_ROW');
    const start = new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(job.startsAt));
    const end = new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(job.endsAt));
    const clock = normalize(await row.locator('.clock').innerText());
    check(clock.includes(normalize(start)) && clock.includes(end), 'UI_LAPAZ_CLOCK');
    equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Pacific/Auckland', 'UI_TEST_ZONE');
    return row;
  }
  async function capture(page, key) {
    equal(new URL(page.url()).origin, origin, 'SCREENSHOT_ORIGIN');
    await page.locator('#session-logout').waitFor({ state: 'visible' });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      const file = resolve(evidenceDir, key + '-' + name + '.png');
      await page.screenshot({ path: file, fullPage: true, mask: [page.locator('#session-identity')] }); chmodSync(file, 0o600);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  async function detail(page, job) {
    const row = await visibleJob(page, job);
    const result = await graphAction(page, 'myAgendaWork', () => row.getByRole('link', { name: 'Ver trabajo ' + job.orderNumber, exact: true }).click());
    minimalWork(result); equal(result.assignmentId, job.assignmentId, 'UI_DETAIL_ASSIGNMENT');
    await detailVisible(page, job);
  }
  async function detailVisible(page, job) {
    await page.locator('anx-agenda h3').filter({ hasText: job.orderNumber }).waitFor({ state: 'visible' });
    const observations = page.locator('anx-agenda .observations');
    equal(await observations.nth(0).innerText(), job.description, 'UI_DESCRIPTION');
    equal(await observations.nth(1).innerText(), job.notes || 'Sin notas adicionales.', 'UI_NOTES');
    equal(await observations.locator('*').count(), 0, 'UI_NOTES_NOT_TEXT');
    for (const service of job.services) {
      const item = page.locator('anx-agenda li').filter({ hasText: service.serviceName });
      await item.waitFor({ state: 'visible' });
      check(normalize(await item.innerText()).includes(normalize(service.serviceName + ' · Cantidad ' + service.quantity + ' · ' + service.estimatedMinutes + ' min estimados')), 'UI_SERVICE_SNAPSHOT');
    }
  }
  try {
    let first;
    for (const [index, key] of ['mechanicA', 'mechanicB'].entries()) await stage('browser-' + key + '-own-detail-reload-empty-logout', async () => {
      const handle = await pageFor(state.accounts[key]), { page } = handle; if (!first) first = handle;
      const own = jobs[index], other = jobs[1 - index];
      const result = await consult(page, selfPath); equal(result.total, 1, 'UI_JOB_COUNT');
      await visibleJob(page, own, other); await capture(page, key + '-agenda');
      await detail(page, own); await page.reload({ waitUntil: 'domcontentloaded' });
      await detailVisible(page, own); await capture(page, key + '-detail');
      const foreign = page.waitForResponse(response => response.url() === origin + '/graphql' &&
        /myAgendaWork/.test(response.request().postDataJSON()?.query ?? ''));
      const [denied] = await Promise.all([foreign, page.goto(origin + selfPath + '/' + other.assignmentId, { waitUntil: 'domcontentloaded' })]);
      graphDenied({ status: denied.status(), body: await denied.json() }, 'AGENDA_WORK_NOT_FOUND', 404);
      await page.locator('anx-agenda .ant-alert-error').waitFor({ state: 'visible' });
      equal(await page.locator('anx-agenda .observations').count(), 0, 'UI_FOREIGN_DETAIL_RETAINED');
      const empty = await consult(page, selfPath, 'urgente'); equal(empty.total, 0, 'UI_EMPTY_TOTAL'); equal(empty.items.length, 0, 'UI_EMPTY_ITEMS');
      await page.locator('anx-agenda p[role=status]:not([aria-live])').waitFor({ state: 'visible' });
      equal(await page.locator(rows).count(), 0, 'UI_EMPTY_RETAINED_ROWS');
      await logout(handle);
    });
    await stage('browser-same-context-subject-switch', async () => {
      await login(first, state.accounts.mechanicB); await consult(first.page, selfPath);
      await visibleJob(first.page, jobs[1], jobs[0]); await logout(first);
    });
    await stage('browser-chief-team-date-personal-filter', async () => {
      const handle = await pageFor(state.accounts.chief), { page } = handle;
      await consult(page, teamPath); for (const job of jobs) await visibleJob(page, job);
      await capture(page, 'chief-team');
      await page.locator('anx-agenda details summary').click();
      await page.locator('anx-agenda input[name=search]').fill(jobs[0].employee.fullName);
      const staff = await graphAction(page, 'agendaTeamEmployees', () => page.locator('anx-agenda form.toolbar:has(input[name=search]) button[type=submit]').click(), { search: jobs[0].employee.fullName, offset: 0 });
      check(staff.items.some(employee => employee.id === jobs[0].employee.id), 'UI_STAFF_MISSING');
      for (const employee of staff.items) keys(employee, new Set(['id', 'fullName', 'status']));
      const filtered = await consult(page, teamPath, '', jobs[0].employee.id);
      equal(filtered.total, 1, 'UI_EMPLOYEE_FILTER'); await visibleJob(page, jobs[0], jobs[1]);
      const priority = await consult(page, teamPath, 'alta');
      check(priority.items.every(job => job.priority === 'alta'), 'UI_PRIORITY_FILTER');
      await visibleJob(page, jobs[0], jobs[1]);
      await logout(handle);
    });
    await stage('browser-admin-angular-react-angular-deep-reload', async () => {
      const handle = await pageFor(admin), { page } = handle;
      await page.goto(origin + '/operations/orders', { waitUntil: 'domcontentloaded' });
      await page.locator('#order-refresh').waitFor({ state: 'visible' });
      await page.locator('nz-table tbody tr').filter({ hasText: jobs[0].orderNumber }).waitFor({ state: 'visible' });
      await page.locator('[data-shell-link][data-module=finance]').click();
      await page.locator('[data-mf=finance] #quotes-reload').waitFor({ state: 'visible' });
      await page.locator('[data-mf=finance] [data-testid="quote-select-' + state.steps['mechanicA.quote'].result.id + '"]').waitFor({ state: 'visible' });
      equal(await page.locator('#order-refresh').count(), 0, 'OPERATIONS_NOT_UNMOUNTED');
      await page.locator('[data-shell-link][data-module=employees]').click();
      await page.locator('[data-shell-link][href="/employees/list"]').click();
      await page.locator('#employee-create').waitFor({ state: 'visible' });
      equal(await page.locator('[data-mf=finance]').count(), 0, 'FINANCE_NOT_UNMOUNTED');
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#employee-create').waitFor({ state: 'visible' });
      await logout(handle);
    });
    await stage('browser-console-page-network-and-graphql-transport', async () => {
      for (const [kind, count] of Object.entries(faults)) equal(count, 0, 'BROWSER_' + kind.toUpperCase() + '_FAILURES');
    });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}

export async function run({ configDir = '/run/config', stateDir = '/demo-state', evidenceDir = '/evidence' } = {}) {
  const report = { status: 'FAIL', stages: [], limitations: [
    { stage: 'visual-pixels-and-focus', status: 'NOT_APPROVED', code: 'HUMAN_VISUAL_REVIEW_REQUIRED' },
    { stage: 'seed-repeat-persistence-recovery', status: 'NOT_RUN', code: 'MAIN_AGENT_SEPARATE_ACCEPTANCE' },
    { stage: 'revocation-inactivity-dependency-outage-offline', status: 'NOT_RUN', code: 'BASELINE_ONLY_NO_BUSINESS_MUTATION' },
  ] };
  let relay, browser;
  const stage = async (name, action) => {
    try { const value = await action(); report.stages.push({ stage: name, status: 'PASS' }); return value; }
    catch (error) { report.stages.push({ stage: name, status: 'FAIL', ...sanitizedError(error) }); throw error; }
  };
  try {
    let state, admin;
    await stage('configuration-and-seed', async () => {
      const config = readFileSync(resolve(configDir, 'service.env'), 'utf8');
      state = validateLedger(JSON.parse(readFileSync(resolve(stateDir, 'manifest.json'), 'utf8')), config.match(/^PUBLIC_ORIGIN='([^'\r\n]+)'$/m)?.[1]);
      admin = JSON.parse(readFileSync(resolve(configDir, 'admin-account.json'), 'utf8'));
      mkdirSync(evidenceDir, { recursive: true, mode: 0o700 }); chmodSync(evidenceDir, 0o700);
    });
    await stage('public-origin-tcp-relay', async () => { relay = await startRelay(state.publicOrigin); });
    const jobs = await stage('owner-bff-integration', () => integrationProbes(state, admin, stage));
    await stage('real-chromium-launch', async () => {
      const chromium = chromiumRuntime();
      browser = await chromium.launch({ headless: true });
    });
    await stage('browser-baseline', () => browserProbes(browser, state, admin, jobs, evidenceDir, stage));
    await stage('relay-health', async () => check(relay.healthy(), 'RELAY_TRANSPORT_FAILURE'));
    report.status = 'PASS';
  } catch { report.status = 'FAIL'; }
  finally {
    for (const [name, resource] of [['chromium-cleanup', browser], ['relay-cleanup', relay]]) if (resource) {
      try { await stage(name, () => resource.close()); } catch { report.status = 'FAIL'; }
    }
    try { const { privateWrite } = await import('./demo.mjs'); privateWrite(resolve(evidenceDir, 'result.json'), report); }
    catch (error) { report.status = 'FAIL'; report.stages.push({ stage: 'evidence-write', status: 'FAIL', ...sanitizedError(error) }); }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.error('FAIL ACCEPTANCE_USE_RUN'); process.exitCode = 1;
  } else {
    const result = await run();
    console.log(result.status + ' acceptance; private diagnostics omitted; visual approval not granted');
    if (result.status !== 'PASS') process.exitCode = 1;
  }
}
