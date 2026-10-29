import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, chmodSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { ensure, origin } from './bootstrap.mjs';

const idp = 'http://keycloak:8080/identity';
const realmPath = '/realms/autonexus';
const oidc = realmPath + '/protocol/openid-connect';
const owners = { employees: 'http://employees:3002', operations: 'http://operations:8081', finance: 'http://finance:8000' };
const roles = { mechanicA: 'mecanico', mechanicB: 'mecanico', chief: 'jefe_taller', reception: 'recepcionista', finance: 'responsable_financiero' };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function civilDate(now = new Date(), days = 0) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function privateWrite(file, value) {
  mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, file); chmodSync(file, 0o600);
  if (process.platform !== 'win32') { const dir = openSync(resolve(file, '..'), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
}
export function openLedger(stateDir, publicOrigin, now = new Date()) {
  publicOrigin = origin(publicOrigin);
  const file = resolve(stateDir, 'manifest.json');
  let state;
  if (existsSync(file)) {
    state = JSON.parse(readFileSync(file, 'utf8'));
    ensure(state.version === 1 && state.steps && state.accounts && state.publicOrigin === publicOrigin, 'DEMO_MANIFEST_DRIFT');
  } else {
    ensure(!existsSync(resolve(stateDir, 'accounts.json')), 'DEMO_LEDGER_MISSING');
    state = { version: 1, scenarioId: randomUUID(), publicOrigin, createdAt: now.toISOString(), date: civilDate(now, 7), steps: {}, accounts: {} };
    for (const [key, roleName] of Object.entries(roles)) state.accounts[key] = { key, roleName, password: 'Demo-' + randomBytes(32).toString('hex'), credentialState: 'prepared' };
    privateWrite(file, state);
  }
  ensure(state.date >= civilDate(now), 'DEMO_SCENARIO_EXPIRED_NEW_VERSION_REQUIRED');
  return { state, save() { privateWrite(file, state); }, exportAccounts() { privateWrite(resolve(stateDir, 'accounts.json'), { version: 1, scenarioId: state.scenarioId, accounts: state.accounts }); } };
}

export function idpTransportUrl(value, publicOrigin, allowedPath) {
  const url = new URL(value, publicOrigin + '/identity/');
  ensure(url.origin === publicOrigin && !url.username && !url.password && !url.hash && allowedPath(url.pathname), 'DEMO_UNTRUSTED_IDP_URL');
  return idp + url.pathname.slice('/identity'.length) + url.search;
}
const decodeHtml = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
export function callbackCode(value, publicOrigin, state) {
  const url = new URL(value);
  ensure(url.origin === publicOrigin && url.pathname === '/auth/callback' && !url.username && !url.password && !url.search, 'DEMO_CALLBACK_INVALID');
  const params = new URLSearchParams(url.hash.slice(1));
  ensure(params.getAll('state').length === 1 && params.get('state') === state && params.getAll('code').length === 1 && params.get('code') && !params.has('error'), 'DEMO_PKCE_STATE_OR_CODE_INVALID');
  if (params.has('iss')) ensure(params.get('iss') === publicOrigin + '/identity' + realmPath, 'DEMO_ISSUER_INVALID');
  return params.get('code');
}
export async function pkceLogin(publicOrigin, account, request = fetch) {
  origin(publicOrigin);
  const verifier = randomBytes(48).toString('base64url'), state = randomUUID();
  const redirectUri = publicOrigin + '/auth/callback';
  const cookies = new Map();
  const send = async (url, options = {}) => {
    const response = await request(url, { ...options, headers: { ...options.headers, Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
    return response;
  };
  const params = new URLSearchParams({ client_id: 'autonexus-shell', redirect_uri: redirectUri, response_type: 'code', response_mode: 'fragment', scope: 'openid profile', state, nonce: randomUUID(), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'login' });
  let response = await send(idp + oidc + '/auth?' + params);
  ensure(response.status === 200, 'DEMO_LOGIN_FORM_FAILED');
  const html = await response.text();
  const form = html.match(/<form\b[^>]*\bid=["']kc-form-login["'][^>]*>/i)?.[0];
  const action = form?.match(/\baction=["']([^"']+)["']/i)?.[1];
  ensure(action, 'DEMO_LOGIN_FORM_INVALID');
  const transport = idpTransportUrl(decodeHtml(action), publicOrigin, path => path === '/identity' + realmPath + '/login-actions/authenticate');
  response = await send(transport, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: account.username, password: account.password, credentialId: '' }) });
  ensure(response.status === 302 || response.status === 303, 'DEMO_LOGIN_REJECTED');
  const code = callbackCode(response.headers.get('location'), publicOrigin, state);
  const tokenResponse = await request(idp + oidc + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'autonexus-shell', redirect_uri: redirectUri, code, code_verifier: verifier }), redirect: 'error', signal: AbortSignal.timeout(15000) });
  ensure(tokenResponse.status === 200, 'DEMO_PKCE_EXCHANGE_FAILED');
  const tokens = await tokenResponse.json();
  ensure(typeof tokens.access_token === 'string' && Number.isFinite(tokens.expires_in) && tokens.expires_in > 15, 'DEMO_TOKEN_INVALID');
  const user = await request(idp + oidc + '/userinfo', { headers: { Authorization: 'Bearer ' + tokens.access_token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  ensure(user.status === 200, 'DEMO_USERINFO_FAILED');
  const identity = await user.json();
  ensure(typeof identity.sub === 'string' && (!account.subject || identity.sub === account.subject), 'DEMO_SUBJECT_DRIFT');
  return { token: tokens.access_token, subject: identity.sub, expiresIn: tokens.expires_in };
}

export function session(publicOrigin, admin, client, request = fetch, { now = Date.now } = {}) {
  let adminToken, managementToken;
  const login = account => pkceLogin(publicOrigin, account, request);
  const humanToken = async (force = false) => {
    if (force || !adminToken || now() >= adminToken.renewAt) {
      const started = now(), issued = await login(admin);
      adminToken = { token: issued.token, renewAt: started + (issued.expiresIn - 15) * 1000 };
    }
    return adminToken.token;
  };
  const machineToken = async () => {
    if (!managementToken || now() >= managementToken.renewAt) {
      const started = now();
      const response = await request(idp + oidc + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client.clientId, client_secret: client.clientSecret }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      ensure(response.status === 200, 'DEMO_MANAGEMENT_LOGIN_FAILED');
      const issued = await response.json();
      ensure(typeof issued.access_token === 'string' && Number.isFinite(issued.expires_in) && issued.expires_in > 15, 'DEMO_MANAGEMENT_TOKEN_INVALID');
      managementToken = { token: issued.access_token, renewAt: started + (issued.expires_in - 15) * 1000 };
    }
    return managementToken.token;
  };
  const managementRequest = async (url, options = {}) => request(url, { ...options, headers: { Authorization: 'Bearer ' + await machineToken(), 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const api = async (owner, path, method = 'GET', body) => {
    ensure(Object.hasOwn(owners, owner) && path.startsWith('/') && !path.startsWith('//'), 'DEMO_OWNER_INVALID');
    const serialized = body === undefined ? {} : { body: JSON.stringify(body) };
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await humanToken(attempt === 1);
      const response = await request(owners[owner] + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...serialized, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
      ensure([200, 201, 202].includes(response.status), 'DEMO_OWNER_HTTP_' + response.status);
      return response.json();
    }
  };
  const setCredential = async account => {
    ensure(uuid(account.employeeId) && uuid(account.subject) && account.username === 'employee-' + account.employeeId, 'DEMO_CREDENTIAL_OWNERSHIP_INVALID');
    ensure(client.clientId === 'autonexus-employees-admin' && typeof client.clientSecret === 'string', 'DEMO_MANAGEMENT_CLIENT_INVALID');
    const base = idp + '/admin' + realmPath + '/users/' + account.subject;
    const response = await managementRequest(base);
    ensure(response.status === 200, 'DEMO_IDENTITY_READ_FAILED');
    const user = await response.json();
    ensure(user.id === account.subject && user.username === account.username && user.attributes?.employeeId?.length === 1 && user.attributes.employeeId[0] === account.employeeId && user.enabled, 'DEMO_IDENTITY_OWNERSHIP_DRIFT');
    const changed = await managementRequest(base + '/reset-password', { method: 'PUT', body: JSON.stringify({ type: 'password', value: account.password, temporary: false }) });
    ensure(changed.status === 204, 'DEMO_CREDENTIAL_SET_UNCERTAIN');
  };
  return { api, login, setCredential };
}

export async function command(ledger, api, key, owner, path, body, resultKey, read) {
  let step = ledger.state.steps[key];
  if (!step) {
    step = ledger.state.steps[key] = { owner, path, body: { ...body, operationId: randomUUID() }, resultKey, state: 'prepared' };
    ledger.save();
  }
  ensure(step.owner === owner && step.path === path && step.resultKey === resultKey, 'DEMO_COMMAND_DRIFT');
  if (step.state !== 'done') {
    const result = await api(step.owner, step.path, 'POST', step.body);
    const value = resultKey ? result[resultKey] : result;
    ensure(value && (uuid(value.id) || uuid(value.sagaId)), 'DEMO_RESULT_INVALID');
    step.result = value; step.state = 'done'; ledger.save();
  }
  return read ? read(step.result) : step.result;
}
export async function prepareCredential(ledger, account, transport) {
  const creation = ledger.state.steps['employee.' + account.key];
  ensure(creation?.state === 'done' && creation.result.id === account.employeeId && uuid(account.subject), 'DEMO_ACCOUNT_NOT_OWNED');
  if (account.credentialState === 'verified') return;
  if (account.credentialState === 'prepared') {
    account.credentialState = 'attempted'; ledger.save();
    await transport.setCredential(account);
  }
  try {
    const identity = await transport.login(account);
    ensure(identity.subject === account.subject, 'DEMO_SUBJECT_DRIFT');
  } catch { throw new Error('DEMO_CREDENTIAL_UNCERTAIN_NO_RESET_ALLOWED'); }
  account.credentialState = 'verified'; ledger.save();
}

export async function seed(ledger, transport, { wait = pause, attempts = 180 } = {}) {
  const { state } = ledger, { api } = transport;
  const marker = 'DEMO-' + state.scenarioId.slice(0, 8).toUpperCase();
  const poll = async (read, ready, code) => {
    for (let n = 0; n < attempts; n++) { const value = await read(); if (ready(value)) return value; if (n + 1 < attempts) await wait(500); }
    throw new Error(code);
  };
  const create = (key, owner, path, body, resultKey) => command(ledger, api, key, owner, path, body, resultKey, async value => {
    const current = await api(owner, path + '/' + value.id);
    ensure(current.id === value.id, 'DEMO_RESOURCE_DRIFT');
    return current;
  });
  const people = {};
  for (const [key, account] of Object.entries(state.accounts)) {
    const mechanicEnabled = key === 'mechanicA' || key === 'mechanicB';
    let employee = await create('employee.' + key, 'employees', '/employees', { firstName: mechanicEnabled ? 'Mecánico' : 'Personal', lastName: marker + '-' + key, document: marker + '-' + key, email: (marker + '-' + key).toLowerCase() + '@example.invalid', phone: '+59170000000', jobTitle: 'Demostración local', startDate: civilDate(new Date(state.createdAt)), specialties: mechanicEnabled ? ['Diagnóstico general'] : [], mechanicEnabled, access: { requested: true } }, 'employee');
    employee = await poll(() => api('employees', '/employees/' + employee.id), e => e.access.status === 'synced', 'DEMO_EMPLOYEE_SYNC_TIMEOUT');
    ensure(employee.status === 'active' && uuid(employee.access.subject) && (!account.subject || account.subject === employee.access.subject), 'DEMO_EMPLOYEE_DRIFT');
    Object.assign(account, { employeeId: employee.id, username: 'employee-' + employee.id, subject: employee.access.subject }); ledger.save();
    await prepareCredential(ledger, account, transport);
    const rolePath = '/security/employees/' + employee.id + '/roles';
    await command(ledger, api, 'role.' + key, 'employees', rolePath, { roleName: account.roleName }, 'assignment', async saved => {
      const current = await api('employees', rolePath);
      ensure(current.items.some(item => item.id === saved.id && item.roleName === account.roleName && item.subject === account.subject && item.status === 'active' && item.syncStatus === 'synced'), 'DEMO_ROLE_DRIFT');
    });
    if (mechanicEnabled) {
      ensure(employee.mechanicEnabled && employee.specialties.includes('Diagnóstico general'), 'DEMO_MECHANIC_DRIFT');
      const weekday = new Date(state.date + 'T12:00:00Z').getUTCDay() || 7;
      await command(ledger, api, 'shift.' + key, 'employees', '/staffing/employees/' + employee.id + '/shifts', { weekday, startsAt: '08:00', endsAt: '17:00' }, 'shift', async saved => {
        const schedule = await api('employees', '/staffing/employees/' + employee.id + '/schedule');
        ensure(schedule.shifts.some(shift => shift.id === saved.id && shift.active === true && shift.weekday === weekday && shift.startsAt <= '09:00' && shift.endsAt >= '09:30'), 'DEMO_SHIFT_DRIFT');
      });
    }
    people[key] = employee;
  }
  ensure(new Set(Object.values(state.accounts).map(a => a.subject)).size === 5, 'DEMO_SUBJECTS_NOT_DISTINCT');
  ledger.exportAccounts();
  for (const [index, key] of ['mechanicA', 'mechanicB'].entries()) {
    const tag = marker + '-' + (index + 1), flow = key + '.';
    const customer = await create(flow + 'customer', 'operations', '/customers', { firstName: index ? 'Lucía' : 'Daniel', lastName: 'Cliente demostración ' + tag, document: tag, email: tag.toLowerCase() + '@example.invalid', phone: '+59170000001' }, 'customer');
    const vehicle = await create(flow + 'vehicle', 'operations', '/vehicles', { customerId: customer.id, plate: 'DM' + state.scenarioId.slice(0, 6).toUpperCase() + index, make: index ? 'Toyota' : 'Kia', model: index ? 'Corolla' : 'Rio', year: 2024, fuelType: 'gasolina' }, 'vehicle');
    const service = await create(flow + 'service', 'operations', '/services', { name: (index ? 'Revisión de frenos ' : 'Diagnóstico preventivo ') + tag, description: 'Servicio de demostración local', category: 'reparacion', estimatedMinutes: 30, referenceRate: 150 }, 'service');
    const reception = await create(flow + 'reception', 'operations', '/receptions', { vehicleId: vehicle.id, mileage: index ? 42000 : 18000, reason: service.name, symptoms: 'Solicitud de revisión preventiva', visibleConditions: 'Sin fotografías ni datos privados' }, 'reception');
    const order = await create(flow + 'order', 'operations', '/orders', { receptionId: reception.id, description: service.name, priority: index ? 'normal' : 'alta', notes: 'Escenario demostrativo: conservar las ediciones posteriores.', services: [{ serviceId: service.id, quantity: 1 }] }, 'order');
    let quote = await create(flow + 'quote', 'finance', '/quotes', { orderReference: order.id, orderNumber: order.number, customerReference: customer.id, vehicleReference: vehicle.id, vehiclePlate: vehicle.plate, validUntil: state.date, notes: tag, items: [{ serviceReference: service.id, description: service.name, quantity: 1, unitPrice: 150 }] }, 'quote');
    quote = await command(ledger, api, flow + 'approval', 'finance', '/quotes/' + quote.id + '/decision', { decision: 'approved', evidence: 'Aprobación explícita de demostración ' + tag }, 'quote', saved => api('finance', '/quotes/' + saved.id));
    const employee = await api('employees', '/employees/' + people[key].id);
    const confirmation = await command(ledger, api, flow + 'confirmation', 'operations', '/orders/' + order.id + '/confirmations', { expectedVersion: order.version, quoteId: quote.id, quoteVersion: quote.version, employeeId: employee.id, employeeVersion: employee.version, requiredSpecialty: 'Diagnóstico general', startsAt: state.date + 'T09:00:00-04:00', endsAt: state.date + 'T09:30:00-04:00' }, null);
    const saga = await poll(() => api('operations', '/confirmations/' + confirmation.sagaId), s => ['confirmed', 'rejected'].includes(s.status), 'DEMO_SAGA_PENDING_RETRY_SAME_MANIFEST');
    ensure(saga.status === 'confirmed', 'DEMO_SAGA_REJECTED');
    const current = await api('operations', '/orders/' + order.id);
    ensure(current.status === 'confirmed', 'DEMO_ORDER_NOT_CONFIRMED');
  }
  if (!state.completedAt) { state.completedAt = new Date().toISOString(); ledger.save(); }
  ledger.exportAccounts();
  return { employees: 5, jobs: 2, date: state.date };
}

export function demoFailure(error) {
  const code = /^DEMO_[A-Z0-9_]+$/.test(error.message ?? '') ? error.message : /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : /^[A-Za-z]+$/.test(error.name ?? '') ? error.name.toUpperCase() : 'DEMO_FAILED';
  const location = String(error.stack ?? '').match(/demo[.]mjs:[0-9]+:[0-9]+/)?.[0] ?? 'NO_LOCATION';
  const cause = /^[A-Z0-9_]+$/.test(error.cause?.code ?? '') ? error.cause.code : 'WITHHELD';
  return { code, location, cause };
}
export async function run({ enabled = process.env.DEMO_ENABLED, configDir = '/run/config', stateDir = '/demo-state', now = new Date() } = {}) {
  ensure(enabled === 'true', 'DEMO_EXPLICIT_ENABLE_REQUIRED');
  const config = readFileSync(resolve(configDir, 'service.env'), 'utf8');
  const publicOrigin = config.match(/^PUBLIC_ORIGIN='([^'\r\n]+)'$/m)?.[1];
  origin(publicOrigin);
  const ledger = openLedger(stateDir, publicOrigin, now);
  const admin = JSON.parse(readFileSync(resolve(configDir, 'admin-account.json'), 'utf8'));
  const client = JSON.parse(readFileSync(resolve(configDir, 'employees-client.json'), 'utf8'));
  return seed(ledger, session(publicOrigin, admin, client));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    ensure(process.argv.length === 3 && process.argv[2] === '--run', 'DEMO_USE_RUN');
    const result = await run();
    console.log('PASS demo; employees=' + result.employees + '; confirmedJobs=' + result.jobs + '; date=' + result.date + '; private values omitted');
  } catch (error) {
    console.error('FAIL demo ' + JSON.stringify(demoFailure(error)) + '; private values omitted');
    process.exitCode = 1;
  }
}
