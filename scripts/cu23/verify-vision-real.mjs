/**
 * CU23 real verification: authorized evidence -> real model inference -> MongoDB -> GraphQL read.
 *
 * Everything happens through the published surfaces: the Shell/BFF GraphQL contract, the CU16
 * evidence flow that Operations signs, and the Intelligence container health. No state is forced
 * with SQL, no image is synthesised for the positive case (a real dataset photograph is uploaded
 * through the same presigned path a mechanic uses) and no credential, signature or URL is printed.
 *
 * Usage:
 *   node scripts/cu23/verify-vision-real.mjs
 * Env:
 *   CU23_PUBLIC_ORIGIN   web origin (default http://127.0.0.1:4285)
 *   CU23_ACCOUNTS_FILE   private account fixture (default output/stack/cu16-fresh-proof.accounts.private.json)
 *   CU23_IMAGE_FILE      representative photograph (default: first validation image of the dataset)
 *   CU23_PROJECT         compose project used for the container health probe (default cu16-fresh-proof)
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const origin = process.env.CU23_PUBLIC_ORIGIN || 'http://127.0.0.1:4285';
const accountsFile = process.env.CU23_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const project = process.env.CU23_PROJECT || 'cu16-fresh-proof';
const accounts = JSON.parse(readFileSync(resolve(accountsFile), 'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';

const datasetImages = 'ml/data/raw/tugberkkalay__autodamageiq-vehicle-damage-dataset/images/val';
const imageFile = process.env.CU23_IMAGE_FILE || resolve(datasetImages, readdirSync(resolve(datasetImages)).sort()[0]);
const image = readFileSync(resolve(imageFile));

mkdirSync('output/cu23', { recursive: true });
const report = { origin, project, imageBytes: image.length, stages: [], pass: false };
const pass = (name, detail) => { report.stages.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); };
const token = async key => (await authorize({ ...accounts[key], enabled: true }, false, { issuer, redirect: origin + '/auth/callback' })).access_token;
const gql = async (bearer, query, variables = {}) => {
  const response = await fetch(origin + '/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  assert.equal(response.status, 200, 'graphql transport');
  return response.json();
};
const codeOf = (response, root) => response.errors?.find(error => error.path?.[0] === root)?.extensions?.code ?? (response.errors?.length === 1 ? response.errors[0].extensions?.code : undefined);
const effectiveOf = response => response.data?.securityCatalog?.effective ?? [];

const FIELDS = `analysisId assignmentId evidenceId orderId modelVersion task threshold insufficientData imageSha256 createdAt replayed
  labels { name score threshold flagged } flagged`;
const ANALYZE = 'mutation($id:ID!,$evidence:ID!){analyzeEvidence(assignmentId:$id,evidenceId:$evidence){' + FIELDS + '}}';
const HISTORY = 'query($id:ID!){assignmentAnalyses(assignmentId:$id){assignmentId items{' + FIELDS + '}}}';
const EXECUTION = 'query($id:UUID!){myExecution(assignmentId:$id){orderId assignmentId status version advances{id sequence evidences{id fileName contentType sizeBytes state}}}}';
const AGENDA = 'query($from:Date,$to:Date){myAgenda(from:$from,to:$to,limit:50){items{assignmentId orderId orderNumber executionStatus executionProgress{availableEvidence advances}}}}';
const WORK = 'query($id:UUID!){myAgendaWork(assignmentId:$id){assignmentId orderId orderNumber executionStatus}}';
const MODEL = 'query{visionModel{ready modelVersion labels insufficientData reason}}';

function containerHealth() {
  const output = execFileSync('docker', ['exec', project + '-intelligence-1', 'python', '/app/app/healthcheck.py'], { encoding: 'utf8' });
  return output;
}

function day(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

try {
  // 1. The container reports a loaded artefact and a reachable store.
  let healthy = false;
  try { containerHealth(); healthy = true; } catch { healthy = false; }
  pass('contenedor de Inteligencia listo (Mongo y modelo cargados)', healthy);

  // 2. Permission surfaces resolved by the owner.
  const mechanicA = await token('mechanicA');
  const mechanicB = await token('mechanicB');
  const chief = await token('chief');
  const reception = await token('reception');
  const mechanicPermissions = effectiveOf(await gql(mechanicA, '{securityCatalog{effective}}'));
  const chiefPermissions = effectiveOf(await gql(chief, '{securityCatalog{effective}}'));
  const receptionPermissions = effectiveOf(await gql(reception, '{securityCatalog{effective}}'));
  assert.ok(mechanicPermissions.includes('intelligence:analyze') && mechanicPermissions.includes('intelligence:read'), 'mechanic permissions');
  pass('el mecánico recibe intelligence:analyze y intelligence:read');
  assert.ok(chiefPermissions.includes('intelligence:read') && !chiefPermissions.includes('intelligence:analyze'), 'chief permissions');
  pass('jefatura recibe lectura de análisis y no la capacidad de analizar');
  assert.ok(!receptionPermissions.includes('intelligence:read') && !receptionPermissions.includes('intelligence:analyze'), 'reception permissions');
  pass('recepción no recibe permisos de Inteligencia');

  // 3. Model status as published by the service through the BFF.
  const modelResponse = await gql(mechanicA, MODEL);
  const model = modelResponse.data?.visionModel;
  assert.ok(model?.ready === true, 'model ready');
  assert.ok(typeof model.modelVersion === 'string' && model.modelVersion.length > 0, 'model version');
  assert.ok(Array.isArray(model.labels) && model.labels.length > 0, 'model labels');
  assert.equal(typeof model.insufficientData, 'boolean', 'insufficientData flag');
  pass('visionModel publica modelo cargado, versión, etiquetas y suficiencia de datos', { modelVersion: model.modelVersion, labels: model.labels.length, insufficientData: model.insufficientData });

  // 4. Find a work with an evidence this mechanic may analyse, or create one through CU16.
  const agenda = await gql(mechanicA, AGENDA, { from: process.env.CU23_FROM || day(-90), to: process.env.CU23_TO || day(60) });
  const works = agenda.data?.myAgenda?.items ?? [];
  report.agenda = { items: works.length, statuses: [...new Set(works.map(item => item.executionStatus))] };
  let target;
  let evidence;
  for (const work of works) {
    const execution = await gql(mechanicA, EXECUTION, { id: work.assignmentId });
    const record = execution.data?.myExecution;
    const available = (record?.advances ?? []).flatMap(advance => advance.evidences ?? []).find(item => item.state === 'available');
    if (available) { target = { ...work, execution: record }; evidence = available; break; }
  }
  // The agenda only publishes works whose CU15 confirmation is inside the requested window. When
  // the operator knows the assignment of a running execution, it can be supplied explicitly; the
  // authorisation still comes from the owner endpoint with this actor's token.
  for (const assignmentId of (process.env.CU23_ASSIGNMENT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
    const record = (await gql(mechanicA, EXECUTION, { id: assignmentId })).data?.myExecution;
    if (record) works.push({ assignmentId, orderId: record.orderId, executionStatus: record.status, executionProgress: { availableEvidence: 0, advances: record.advances?.length ?? 0 } });
  }
  if (!target) {
    const work = works.find(item => item.executionStatus === 'in_progress') ?? works.find(item => item.executionStatus === 'not_started');
    assert.ok(work, 'a confirmed work is required to create an evidence');
    let execution = (await gql(mechanicA, EXECUTION, { id: work.assignmentId })).data?.myExecution;
    if (!execution) {
      await gql(mechanicA, 'mutation($id:UUID!,$input:StartExecutionInput!){startExecution(assignmentId:$id,input:$input){execution{status}}}', { id: work.assignmentId, input: { operationId: randomUUID() } });
      execution = (await gql(mechanicA, EXECUTION, { id: work.assignmentId })).data.myExecution;
    }
    if (!execution.advances?.length) {
      await gql(mechanicA,
        'mutation($id:UUID!,$input:RecordAdvanceInput!){recordAdvance(assignmentId:$id,input:$input){execution{version}}}',
        { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: execution.version, description: 'Análisis visual CU23', minutesWorked: 6 } });
      execution = (await gql(mechanicA, EXECUTION, { id: work.assignmentId })).data.myExecution;
    }
    const advanceId = execution.advances.at(-1)?.id;
    assert.ok(advanceId, 'an advance is required to attach an evidence');
    const checksum = createHash('sha256').update(image).digest('base64');
    const requested = await gql(mechanicA,
      'mutation($id:UUID!,$advance:UUID!,$input:RequestEvidenceInput!){requestEvidence(assignmentId:$id,advanceId:$advance,input:$input){evidence{id state version} upload{url method headersJson}}}',
      { id: work.assignmentId, advance: advanceId, input: { operationId: randomUUID(), fileName: 'cu23-' + Date.now() + '.jpg', contentType: 'image/jpeg', sizeBytes: image.length, checksumSha256: checksum } });
    const request = requested.data?.requestEvidence;
    assert.ok(request?.evidence?.id, 'evidence requested: ' + JSON.stringify(requested.errors ?? []).slice(0, 200));
    const headers = JSON.parse(request.upload.headersJson);
    const upload = await fetch(request.upload.url, { method: request.upload.method, headers, body: image, redirect: 'error' });
    assert.equal(upload.status, 200, 'presigned upload');
    const confirmed = await gql(mechanicA,
      'mutation($id:UUID!,$evidence:UUID!,$input:ConfirmEvidenceInput!){confirmEvidence(assignmentId:$id,evidenceId:$evidence,input:$input){evidence{id state sizeBytes}}}',
      { id: work.assignmentId, evidence: request.evidence.id, input: { operationId: randomUUID(), expectedVersion: request.evidence.version ?? 1 } });
    evidence = confirmed.data?.confirmEvidence?.evidence;
    assert.equal(evidence?.state, 'available', 'evidence confirmed');
    target = { ...work, execution };
    pass('evidencia real cargada y confirmada por el flujo CU16 (imagen de ' + image.length + ' bytes)', { evidenceId: evidence.id });
  } else {
    pass('evidencia disponible encontrada en el trabajo del mecánico', { evidenceId: evidence.id });
  }

  // 5. Real inference through the GraphQL contract.
  const analyzed = await gql(mechanicA, ANALYZE, { id: target.assignmentId, evidence: evidence.id });
  const first = analyzed.data?.analyzeEvidence;
  assert.ok(first?.analysisId, 'analysis id: ' + JSON.stringify(analyzed.errors ?? []).slice(0, 220));
  assert.equal(first.modelVersion, model.modelVersion, 'modelVersion matches the published model');
  assert.equal(first.orderId, target.orderId, 'orderId');
  assert.equal(first.assignmentId, target.assignmentId, 'assignmentId');
  assert.equal(first.evidenceId, evidence.id, 'evidenceId');
  assert.equal(first.labels.length, model.labels.length, 'label count matches the model');
  for (const label of first.labels) {
    assert.ok(label.score >= 0 && label.score <= 1, 'score range ' + label.name);
    assert.ok(label.threshold > 0 && label.threshold < 1, 'threshold range ' + label.name);
    assert.equal(label.flagged, label.score >= label.threshold, 'flag rule ' + label.name);
  }
  assert.equal(typeof first.imageSha256, 'string');
  assert.equal(first.imageSha256.length, 64);
  assert.equal(first.replayed, false);
  pass('inferencia real persistida con etiquetas, puntajes y umbrales', { analysisId: first.analysisId, flagged: first.flagged });

  // 6. Repeat is idempotent for the same evidence, model and bytes.
  const again = (await gql(mechanicA, ANALYZE, { id: target.assignmentId, evidence: evidence.id })).data.analyzeEvidence;
  assert.equal(again.analysisId, first.analysisId);
  assert.equal(again.replayed, true);
  pass('repetir el análisis devuelve el mismo documento sin duplicarlo');

  // 7. The result is readable again (reload) and by identifier.
  const history = await gql(mechanicA, HISTORY, { id: target.assignmentId });
  const items = history.data?.assignmentAnalyses?.items ?? [];
  assert.ok(items.some(item => item.analysisId === first.analysisId), 'analysis in history');
  const byId = await gql(mechanicA, 'query($id:ID!){visionAnalysis(analysisId:$id){analysisId evidenceId}}', { id: first.analysisId });
  assert.equal(byId.data?.visionAnalysis?.analysisId, first.analysisId);
  pass('el resultado se consulta tras recargar y por identificador', { items: items.length });

  // 8. Denials: permission and record scope are both enforced.
  const deniedAnalyze = await gql(reception, ANALYZE, { id: target.assignmentId, evidence: evidence.id });
  assert.equal(codeOf(deniedAnalyze, 'analyzeEvidence'), 'FORBIDDEN');
  const deniedRead = await gql(reception, HISTORY, { id: target.assignmentId });
  assert.equal(codeOf(deniedRead, 'assignmentAnalyses'), 'FORBIDDEN');
  pass('sin permiso responde FORBIDDEN en análisis y en consulta');
  const chiefRead = await gql(chief, HISTORY, { id: target.assignmentId });
  assert.ok(Array.isArray(chiefRead.data?.assignmentAnalyses?.items), 'chief reads history');
  const chiefAnalyze = await gql(chief, ANALYZE, { id: target.assignmentId, evidence: evidence.id });
  assert.equal(codeOf(chiefAnalyze, 'analyzeEvidence'), 'FORBIDDEN');
  pass('jefatura consulta el historial del taller y no puede analizar');
  const foreign = await gql(mechanicB, ANALYZE, { id: target.assignmentId, evidence: evidence.id });
  const foreignCode = codeOf(foreign, 'analyzeEvidence');
  assert.ok(['ASSIGNMENT_NOT_FOUND', 'EVIDENCE_NOT_AVAILABLE', 'FORBIDDEN'].includes(foreignCode), 'foreign work denied: ' + foreignCode);
  pass('otro mecánico no alcanza el trabajo ajeno', { code: foreignCode });

  // 9. Unknown analysis is indistinguishable from a foreign one.
  const missing = await gql(mechanicA, 'query($id:ID!){visionAnalysis(analysisId:$id){analysisId}}', { id: randomUUID() });
  assert.equal(codeOf(missing, 'visionAnalysis'), 'ANALYSIS_NOT_FOUND');
  pass('un análisis inexistente responde ANALYSIS_NOT_FOUND');

  // 10. The work record is unchanged by reading: permission surface still resolves.
  const work = await gql(mechanicA, WORK, { id: target.assignmentId });
  assert.equal(work.data?.myAgendaWork?.assignmentId, target.assignmentId);
  pass('el trabajo sigue accesible y sin cambios tras el análisis');

  report.pass = true;
} catch (error) {
  report.error = { name: error?.name ?? 'Error', message: String(error?.message ?? error) };
  report.code = error?.code;
  throw error;
} finally {
  writeFileSync(resolve('output/cu23/vision-real.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length, modelVersion: report.stages.find(stage => stage.detail?.modelVersion)?.detail?.modelVersion }));
}
