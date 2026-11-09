// CU26 financiero — verificación real contra BFF → agente → Finance.
// Solo lectura de dinero: crea trabajos de reporte y consulta el resumen propietario; no registra cobros
// ni gastos. Las credenciales sintéticas se leen aquí y nunca se imprimen.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { login } from '../cu28/provision-scheduler.mjs';
import { internal } from '../mcp/local-admin.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const accounts = JSON.parse(readFileSync(resolve(root, 'output/stack/live-demo/accounts.json'), 'utf8')).accounts;
mkdirSync(resolve(root, 'output/cu26'), { recursive: true });
const ledger = resolve(root, 'output/cu26/financial-report-run.json');

const RUN = {
  dataPeriod: ['2026-11-07', '2026-11-08'],
  emptyPeriod: ['2026-10-01', '2026-10-02'],
  operationIds: {},
};
const state = existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')) : {};
Object.assign(RUN, { operationIds: state.operationIds ?? {} });
const save = () => writeFileSync(ledger, JSON.stringify({ ...RUN, at: new Date().toISOString() }, null, 2), { mode: 0o600 });

const report = { pass: false, checks: [], attempts: state.attempts ?? [] };
let stage = 'start';

async function token(account) {
  return (await login(accounts[account])).access_token;
}
function graphql(query, variables, bearer) {
  const result = internal('http://bff:3004/graphql', { token: bearer, method: 'POST', body: { query, variables } });
  const errors = result.data?.errors;
  if (errors?.length) {
    const error = new Error(errors[0].message);
    error.code = errors[0].extensions?.code;
    error.status = result.status;
    throw error;
  }
  assert.equal(result.status, 200);
  return result.data.data;
}

const JOB_FIELDS = `jobId status requestedAt startedAt finishedAt failureCode failureMessage
  period { from to timeZone }
  report { period { from to timeZone } generatedAt narrativePath model narrativeVerified promptVersion narrative
    figures { receivedMinor expenseMinor netMinor currency paymentCount expenseCount complete }
    claims { indicator label value unit source tool }
    provenance { service resource tool observedAt } limitations }`;

async function startReport(call, from, to, operationId) {
  const data = call(`mutation Start($from: Date!, $to: Date!, $operationId: UUID!) {
    startFinancialReport(from: $from, to: $to, operationId: $operationId) { ${JOB_FIELDS} } }`, { from, to, operationId });
  return data.startFinancialReport;
}

async function poll(call, jobId, budgetMs = 300000) {
  const started = Date.now();
  const seen = [];
  for (;;) {
    const job = call(`query Job($jobId: ID!) { financialReportJob(jobId: $jobId) { ${JOB_FIELDS} } }`, { jobId }).financialReportJob;
    if (seen.at(-1) !== job.status) seen.push(job.status);
    if (job.status === 'SUCCEEDED' || job.status === 'FAILED' || job.status === 'INTERRUPTED') return { job, seen, waitedMs: Date.now() - started };
    if (Date.now() - started > budgetMs) throw new Error('JOB_TIMEOUT_AFTER_' + seen.join('-'));
    await new Promise(done => setTimeout(done, 3000));
  }
}

function ownerSummary(bearer, from, to) {
  const result = internal('http://finance:8000/financial-summary?from=' + from + '&to=' + to, { token: bearer });
  assert.equal(result.status, 200);
  return result.data;
}

try {
  stage = 'finance-session';
  let financeToken = await token('finance');
  // El access token dura 60 s: una generación con modelo lo agota, así que se renueva y se repite.
  const financeCall = (query, variables) => {
    try { return graphql(query, variables, financeToken); }
    catch (error) {
      if (error.status === 401 || error.code === 'UNAUTHENTICATED' || /sesión no es válida/i.test(String(error.message))) {
        return token('finance').then(fresh => { financeToken = fresh; return graphql(query, variables, fresh); });
      }
      throw error;
    }
  };

  for (const [name, [from, to]] of Object.entries({ data: RUN.dataPeriod, empty: RUN.emptyPeriod })) {
    stage = name + '-period-start';
    RUN.operationIds[name] ??= randomUUID();
    save();
    const owner = ownerSummary(financeToken, from, to);
    const created = await startReport(financeCall, from, to, RUN.operationIds[name]);
    // Una repetición devuelve el mismo trabajo ya terminado: se acepta cualquier estado conocido.\n    assert.ok(['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(created.status), 'estado inicial ' + created.status);

    stage = name + '-period-poll';
    const { job, seen, waitedMs } = await poll(financeCall, created.jobId);
    assert.equal(job.status, 'SUCCEEDED', name + ' job status ' + job.status + ' ' + String(job.failureCode));
    const document = job.report;
    const figures = document.figures;

    // Cotejo exacto con el propietario: ni float ni ceros de relleno.
    assert.equal(figures.receivedMinor, owner.receivedAmountMinor);
    assert.equal(figures.expenseMinor, owner.expenseAmountMinor);
    assert.equal(figures.netMinor, owner.netMovementMinor);
    assert.equal(figures.paymentCount, owner.paymentCount);
    assert.equal(figures.expenseCount, owner.expenseCount);
    assert.equal(figures.currency, 'BOB');
    assert.equal(figures.complete, true);
    assert.equal(BigInt(figures.receivedMinor) - BigInt(figures.expenseMinor), BigInt(figures.netMinor));
    assert.deepEqual([document.period.from, document.period.to], [from, to]);
    assert.equal(document.provenance[0].service, 'finance');
    assert.ok(document.limitations.length > 0);
    assert.ok(document.claims.length >= 3);
    for (const claim of document.claims) assert.equal(claim.source, 'finance');
    if (name === 'empty') {
      assert.equal(owner.paymentCount, 0);
      assert.equal(owner.expenseCount, 0);
      assert.equal(figures.receivedMinor, '0');
      assert.equal(figures.netMinor, '0');
    }

    // Repetición con el mismo cuerpo: mismo trabajo, sin nueva generación.
    stage = name + '-period-replay';
    const replayed = await startReport(financeCall, from, to, RUN.operationIds[name]);
    assert.equal(replayed.jobId, created.jobId);
    assert.deepEqual(replayed.report?.figures ?? figures, figures);

    report.checks.push({ period: name, jobId: created.jobId, status: seen, waitedMs,
      narrativePath: document.narrativePath, model: document.model, verified: document.narrativeVerified,
      figures, claims: document.claims.length, sameOwnerValues: true, replaySameJob: true });
  }

  stage = 'operation-conflict';
  // El requisito es que NO devuelva un documento de otro período con el mismo identificador; el código
  // concreto puede llegar traducido por el BFF, así que se registra tal cual en vez de exigirlo.
  let conflict = null;
  try {
    const reused = await startReport(financeCall, RUN.emptyPeriod[0], RUN.emptyPeriod[1], RUN.operationIds.data);
    conflict = { returnedPeriod: reused.period ?? null, jobId: reused.jobId ?? null };
  } catch (error) {
    conflict = { code: error.code ?? null, message: String(error.message).slice(0, 120) };
  }
  assert.equal(conflict.returnedPeriod, undefined, 'same operationId with another period must not return another document');
  report.checks.push({ operationConflictRejected: true, code: conflict.code ?? null });

  stage = 'mechanic-denied';
  const mechanicToken = await token('mechanicA');
  const mechanicCall = (query, variables) => graphql(query, variables, mechanicToken);
  let create = null;
  try {
    const job = await startReport(mechanicCall, RUN.dataPeriod[0], RUN.dataPeriod[1], randomUUID());
    create = { jobId: job.jobId ?? null };
  } catch (error) {
    create = { code: error.code ?? null, message: String(error.message).slice(0, 120) };
  }
  assert.equal(create.jobId, undefined, 'mechanic must not create a financial report');
  let read = null;
  try {
    const job = graphql('query Job($jobId: ID!) { financialReportJob(jobId: $jobId) { jobId report { figures { receivedMinor } } } }', { jobId: report.checks[0].jobId }, mechanicToken).financialReportJob;
    read = { jobId: job?.jobId ?? null, figures: job?.report?.figures ?? null };
  } catch (error) {
    read = { code: error.code ?? null };
  }
  // La lectura puede fallar o devolver el trabajo sin documento, pero nunca cifras para un mecánico.
  assert.ok(read.figures === undefined || read.figures === null, 'mechanic must not read financial figures');
  report.checks.push({ mechanicBlocked: true, createCode: create.code ?? null, readCode: read.code ?? null });

  stage = 'isolated-store';
  // Una cuenta CON alcance operativo: si el almacén estuviera compartido, devolvería el trabajo.
  const operationalRead = internal('http://agent:3099/report/jobs/' + report.checks[0].jobId, { token: await token('chief') });
  assert.equal(operationalRead.status, 404, 'financial jobId must not resolve in the operational store');
  report.checks.push({ financialJobInvisibleToOperationalRoute: true });

  report.pass = true;
} catch (error) {
  report.failure = { stage, name: error.name, code: /^[A-Z_]+$/.test(error.message) ? error.message : null, message: error.message.split(String.fromCharCode(10))[0], actual: error.actual === undefined ? null : String(error.actual), expected: error.expected === undefined ? null : String(error.expected), at: (error.stack ?? '').split(String.fromCharCode(10)).find(line => line.includes('verify-financial-report-real.mjs:')) ?? null };
  process.exitCode = 1;
} finally {
  report.attempts.push({ at: new Date().toISOString(), pass: report.pass, stage, checks: report.checks.length, ...(report.failure ? { failure: report.failure } : {}) });
  writeFileSync(ledger, JSON.stringify({ ...RUN, report }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.map(c => c.period ?? Object.keys(c)[0]), ...(report.failure ? { failure: report.failure } : {}) }));
}
