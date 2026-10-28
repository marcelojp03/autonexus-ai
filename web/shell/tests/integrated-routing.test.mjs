import assert from 'node:assert/strict';
import test from 'node:test';
import { connectIntegratedRouter } from '../../integrated-routing.ts';
function setup(path = '/operations/vehicles') {
  const browser = new EventTarget();
  browser.location = new URL(path, 'http://127.0.0.1:4200');
  const calls = [];
  const router = { url: '/customers', currentNavigation: () => null, navigateByUrl: async (url, options) => { calls.push({ url, options }); router.url = url; return true; } };
  const disconnect = connectIntegratedRouter(router, '/operations', browser);
  const route = path => { if (path) browser.location = new URL(path, 'http://127.0.0.1:4200'); browser.dispatchEvent(new Event('single-spa:routing-event')); };
  return { browser, router, calls, disconnect, route };
}
test('a Shell link synchronizes a stale Angular router without pushing history', () => {
  const { route, calls } = setup(); route();
  assert.deepEqual(calls, [{ url: '/vehicles', options: { replaceUrl: true } }]);
});
test('same router URL and an already targeted navigation are not duplicated', () => {
  const { route, calls, router } = setup(); router.url = '/vehicles'; route();
  router.url = '/customers'; router.currentNavigation = () => ({ extractedUrl: { toString: () => '/vehicles' } }); route();
  assert.equal(calls.length, 0);
});
test('prefix boundary never routes another module or a similar module name', () => {
  const { route, calls } = setup();
  for (const path of ['/finance', '/employees/list', '/operations-other/vehicles', '/Operations']) route(path);
  assert.equal(calls.length, 0);
});
test('module root, query and fragment use the router-relative URL', () => {
  const { route, calls } = setup(); route('/operations'); route('/operations/orders?receptionId=synthetic#detail');
  assert.deepEqual(calls.map(call => call.url), ['/', '/orders?receptionId=synthetic#detail']);
});
test('back/forward sequences converge and repeated routing events add no navigation', () => {
  const { route, calls } = setup(); route('/operations/vehicles'); route('/operations/customers'); route('/operations/vehicles'); route(); route();
  assert.deepEqual(calls.map(call => call.url), ['/vehicles', '/customers', '/vehicles']);
});
test('unmount disconnects the observer', () => {
  const { route, disconnect, calls } = setup(); disconnect(); route(); assert.equal(calls.length, 0);
});
