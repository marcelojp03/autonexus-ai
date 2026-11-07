import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
const workflow = JSON.parse(readFileSync(new URL('../../infra/n8n/workflows/execution-review-event.json', import.meta.url)));
const id = 'aaaaaaaa-1111-4111-8111-111111111111';
const node = name => workflow.nodes.find(n => n.name === name);
const code = (name, json, state = {}, source = {}) => JSON.parse(JSON.stringify(runInNewContext('(function(){' + node(name).parameters.jsCode + '})()', {
  $json: json, $env: {CU28_WEBHOOK_SECRET: 'test-secret-123456789'},
  $getWorkflowStaticData: () => state, $: () => ({first: () => ({json: source})}),
})[0].json));

test('HTTP/FS: missing registry entry never appends; legacy workshop alias and destination keys survive restart', {timeout: 10000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cu28-destination-'));
  const file = join(dir, 'channel.jsonl');
  const legacy = JSON.stringify({eventId: id, eventType: 'legacy'}) + '\n';
  writeFileSync(file, legacy);
  let child;
  const start = async () => {
    child = spawn(process.execPath, [fileURLToPath(new URL('./channel.mjs', import.meta.url))], {
      env: {...process.env, CU28_CHANNEL_PORT: '0', CU28_CHANNEL_HOST: '127.0.0.1', CU28_CHANNEL_FILE: file, CU28_CHANNEL_DESTINATIONS: 'workshop,secondary'}, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const [data] = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => {throw Error('channel exited');})]);
    return 'http://' + JSON.parse(String(data).trim().split('\n')[0]).listening;
  };
  const stop = async () => {const ended = once(child, 'exit'); child.kill(); await ended;};
  try {
    let base = await start();
    const post = async path => {const r = await fetch(base + path, {method: 'POST', body: JSON.stringify({eventId: id})}); return {status: r.status, body: await r.json()};};
    for (let i = 0; i < 2; i++) assert.deepEqual(await post('/destinations/absent/channel'), {status: 404, body: {error: 'CU28_RECIPIENT_NOT_FOUND', destinationId: 'absent'}});
    assert.equal(readFileSync(file, 'utf8'), legacy);
    assert.equal((await post('/channel')).body.status, 'duplicate');
    const next = await post('/destinations/secondary/channel');
    assert.equal(next.body.status, 'recorded'); assert.equal(next.body.destinationId, 'secondary');
    assert.equal((await post('/destinations/workshop/channel')).body.status, 'duplicate');
    const bytes = readFileSync(file, 'utf8'); assert.ok(bytes.startsWith(legacy)); assert.equal(bytes.trim().split('\n').length, 2);
    await stop(); base = await start();
    assert.equal((await post('/destinations/secondary/channel')).body.status, 'duplicate');
    assert.equal(readFileSync(file, 'utf8'), bytes);
  } finally {if (child && child.exitCode === null) await stop(); rmSync(dir, {recursive: true, force: true});}
});

test('receiver authenticates first, strips unauthorized data, defaults workshop, validates local IDs', () => {
  assert.deepEqual(code('Autenticar y sanear', {headers: {'x-autonexus-destination': 'https://bad'}, body: {secret: 'private'}}), {authorized: false});
  const auth = destination => code('Autenticar y sanear', {headers: {'x-autonexus-secret': 'test-secret-123456789', ...destination}});
  assert.equal(auth({}).destinationId, 'workshop');
  for (const value of ['workshop', 'a', 'a-1', 'a'.repeat(64)]) assert.equal(auth({'x-autonexus-destination': value}).destinationValid, true);
  for (const value of ['', 'A', '../workshop', 'a'.repeat(65), ['workshop'], 'https://bad']) assert.equal(auth({'x-autonexus-destination': value}).destinationValid, false);
});

test('legacy static UUID dedupes only workshop; namespaced keys isolate destinations', () => {
  const state = {delivered: {[id]: 'old', ['secondary:' + id]: 'new'}};
  for (const [destinationId, duplicate] of [['workshop', true], ['secondary', true], ['third', false]]) assert.equal(code('¿Ya entregado? (estado duradero)', {eventId: id, destinationId}, state).duplicate, duplicate);
  assert.equal(state.delivered[id], 'old');
});

test('receipt validation gates marking and stores audit IDs/result/time only', () => {
  const source = {eventId: id, destinationId: 'workshop'};
  const good = {status: 'recorded', eventId: id, destinationId: 'workshop'};
  for (const [statusCode, body, accepted, missing] of [
    [200, good, true, false], [202, {...good, status: 'duplicate'}, true, false],
    [404, {error: 'CU28_RECIPIENT_NOT_FOUND'}, false, true], [500, good, false, false],
    [200, {...good, destinationId: 'secondary'}, false, false], [200, {...good, eventId: 'wrong'}, false, false],
    [200, {status: 'ok'}, false, false], [404, {error: 'other'}, false, false], [undefined, {}, false, false],
  ]) {
    const state = {delivered: {[id]: 'old'}};
    const result = code('Validar recibo y auditar', {statusCode, body, headers: {secret: 'private'}}, state, source);
    assert.equal(result.accepted, accepted); assert.equal(result.recipientNotFound, missing);
    assert.deepEqual(Object.keys(state.delivered), [id]);
    assert.deepEqual(Object.keys(state.audit[0]).sort(), ['at', 'destinationId', 'eventId', 'result']);
    if (accepted) {code('Recordar entrega', result, state); assert.ok(state.delivered['workshop:' + id]); assert.equal(state.delivered[id], 'old');}
    else assert.throws(() => code('Recordar entrega', result, state), /CU28_CHANNEL_RECEIPT_REQUIRED/);
  }
});

test('graph gates destination and receipt before marking; fixed host, HTTP options and safe persistence', () => {
  const next = (name, output = 0) => workflow.connections[name].main[output].map(e => e.node);
  assert.deepEqual(next('¿Secreto válido?'), ['¿Destino válido?']);
  assert.deepEqual(next('¿Secreto válido?', 1), ['No autorizado']);
  assert.deepEqual(next('¿Destino válido?'), ['¿Ya entregado? (estado duradero)']);
  assert.deepEqual(next('¿Destino válido?', 1), ['Destino inválido']);
  assert.deepEqual(next('Canal local de prueba'), ['Validar recibo y auditar']);
  assert.deepEqual(next('Canal local de prueba', 1), ['Validar recibo y auditar']);
  assert.deepEqual(next('Validar recibo y auditar'), ['¿Recibo aceptado?']);
  assert.deepEqual(next('¿Recibo aceptado?'), ['Recordar entrega']);
  assert.deepEqual(next('¿Recibo aceptado?', 1), ['¿Destinatario inexistente?']);
  assert.deepEqual(next('¿Destinatario inexistente?'), ['Destinatario inexistente']);
  assert.deepEqual(next('¿Destinatario inexistente?', 1), ['Canal no disponible']);
  assert.equal(workflow.settings.saveDataErrorExecution, 'none');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  const http = node('Canal local de prueba').parameters;
  assert.equal(http.options.response.response.fullResponse, true); assert.equal(http.options.response.response.neverError, true);
  assert.equal(http.options.redirect.redirect.followRedirects, false);
  assert.equal(http.url, "={{ 'http://host.docker.internal:5680/destinations/' + $json.destinationId + '/channel' }}");
  assert.equal(node('Destino inválido').parameters.options.responseCode, 400);
  assert.equal(node('Destinatario inexistente').parameters.options.responseCode, 404);
});
