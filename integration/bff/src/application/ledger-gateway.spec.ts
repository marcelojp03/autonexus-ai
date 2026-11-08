import { HttpLedgerGateway } from './ledger-gateway.js';
import { BusinessGraphql } from './business-graphql.js';
import { HttpEmployeesGateway } from './employees-gateway.js';
import { HttpOperationsGateway } from './operations-gateway.js';
import { HttpFinanceGateway } from './finance-gateway.js';
import { HttpAgendaGateway } from './agenda-gateway.js';
import { bffEnvironment } from '../infrastructure/config/environment.js';

const ID = '00000000-0000-4000-8000-000000000001';
const category = { id: ID, code: 'utilities', name: 'Servicios', active: true };
const summary = { from: '2026-11-01', to: '2026-11-07', timeZone: 'America/La_Paz', currency: 'BOB', paymentCount: 0, expenseCount: 1,
  receivedAmountMinor: '0', expenseAmountMinor: '999999999999', netMovementMinor: '-999999999999', generatedAt: '2026-11-07T00:00:00Z' };
const expense = { id: ID, description: 'Synthetic utilities', category, expenseDate: '2026-11-01', amountMinor: '999999999999', currency: 'BOB', method: 'cash', document: null,
  duplicateOf: null, duplicateReason: null, recordedAt: '2026-11-07T00:00:00Z', actorSubject: 'human', employeeId: ID };
const verification = { id: ID, orderId: ID, method: 'qr', amountMinor: '9000', reference: 'HUMAN-123', status: 'human_verified', verifiedAt: '2026-11-07T00:00:00Z', verifierSubject: 'human', employeeId: ID, note: 'Human observation' };
const payment = { id: ID, orderId: ID, orderNumber: 'OT-SYN', obligationId: ID, amountMinor: '9000', currency: 'BOB', method: 'cash', referenceVerificationId: null, receiptId: ID, receiptNumber: 'INT-SYN', recordedAt: '2026-11-07T00:00:00Z', actorSubject: 'human', employeeId: ID };
const receivable = { orderId: ID, orderNumber: 'OT-SYN', orderStatus: 'completed', orderVersion: 7, sagaId: ID, quoteId: ID, quoteVersion: 2, quoteLinkId: ID,
  agreedAmountMinor: '9000', paidAmountMinor: '9000', balanceMinor: '0', currency: 'BOB', balanceVersion: 1, policyCode: 'FULL_AFTER_COMPLETION_V1', payments: [payment], observedAt: '2026-11-07T00:00:00Z' };
const receipt = { id: ID, number: 'INT-SYN', paymentId: ID, orderId: ID, orderNumber: 'OT-SYN', amountMinor: '9000', currency: 'BOB', method: 'cash', recordedAt: '2026-11-07T00:00:00Z', actorSubject: 'human', employeeId: ID, fiscalStatus: 'internal_non_fiscal', referenceVerificationId: null };
const page = { total: 1, limit: 50, offset: 0 };
function setup(payload: unknown = summary, permissions = ['payments:read', 'expenses:read', 'payments:write', 'expenses:write']) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload));
  const ledger = new HttpLedgerGateway('http://127.0.0.1:8000', transport);
  const employees = new HttpEmployeesGateway('http://127.0.0.1:3002', vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ effective: permissions })));
  const graphql = new BusinessGraphql(employees, new HttpOperationsGateway('http://127.0.0.1:8081'), new HttpFinanceGateway('http://127.0.0.1:8000'), bffEnvironment({}).schemaPaths,
    new HttpAgendaGateway('http://127.0.0.1:8081', 'http://127.0.0.1:3002'), undefined, undefined, undefined, ledger);
  return { transport, ledger, graphql };
}
describe('CU19/CU20 owner projections and human-token forwarding', () => {
  it.each([
    ['receivables', {}, '/receivables', { items: [receivable], page }], ['receivable', { orderId: ID }, '/receivables/' + ID, receivable],
    ['servicePayments', {}, '/payments', { items: [payment], page, totalAmountMinor: '9000' }], ['paymentReceipt', { paymentId: ID }, '/payments/' + ID + '/receipt', receipt],
    ['expenseCategories', {}, '/expense-categories', [category]], ['operatingExpenses', {}, '/expenses', { items: [expense], page, totalAmountMinor: '999999999999' }],
    ['operatingExpense', { id: ID }, '/expenses/' + ID, expense],
  ])('projects %s against its exact owner route', async (name, args, path, payload) => {
    const { ledger, transport } = setup(payload);
    expect(await ledger.call(String(name), args as Record<string, unknown>, 'human')).toEqual(payload);
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:8000' + path);
    expect(transport.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer human' } });
  });
  it('preserves exact large minor-unit strings and negative net movement, removing private fields', async () => {
    const { ledger } = setup({ ...summary, token: 'private', approvedQuotes: 'not income' });
    expect(await ledger.call('financialSummary', { from: summary.from, to: summary.to }, 'human')).toEqual(summary);
  });
  it.each(['receivedAmountMinor', 'paymentCount', 'netMovementMinor'])('never invents zero for missing %s', async field => {
    const payload: Record<string, unknown> = { ...summary }; delete payload[field];
    await expect(setup(payload).ledger.call('financialSummary', {}, 'human')).rejects.toMatchObject({ statusCode: 503 });
  });
  it.each([0, 1.5, '-1', '00', null])('rejects invalid upstream money %s', async value => {
    await expect(setup({ ...summary, receivedAmountMinor: value }).ledger.call('financialSummary', {}, 'human')).rejects.toMatchObject({ statusCode: 503 });
  });
  it.each([
    ['verifyPaymentReference', { operationId: ID, method: 'qr', amountMinor: '9000', reference: 'HUMAN-123', note: 'Human observation' }, { verification, replayed: true }],
    ['recordServicePayment', { operationId: ID, expectedVersion: 0, amountMinor: '9000', method: 'cash', confirmReceived: true }, { payment, receivable, receipt, replayed: false }],
    ['recordOperatingExpense', { operationId: ID, description: 'Synthetic utilities', categoryId: ID, expenseDate: '2026-11-01', amountMinor: '999999999999', method: 'cash' }, { expense, replayed: false }],
  ])('forwards the unchanged %s intent and projects its result', async (name, input, payload) => {
    const { ledger, transport } = setup(payload);
    expect(await ledger.call(String(name), { orderId: ID, input }, 'human')).toEqual(payload);
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual(input);
    expect(transport.mock.calls[0][1]?.method).toBe('POST');
  });
  it.each([['PAYMENT_PARTIAL_UNSUPPORTED', 409], ['EXPENSE_POSSIBLE_DUPLICATE', 409], ['PAYMENT_NOT_FOUND', 404], ['PERSISTENCE_UNAVAILABLE', 503]])('preserves only safe financial error %s', async (code, status) => {
    const { ledger, transport } = setup(); transport.mockResolvedValueOnce(Response.json({ code, message: 'private SQL and JWT', candidate: { secret: true } }, { status: Number(status) }));
    await expect(ledger.call('paymentReceipt', { paymentId: ID }, 'human')).rejects.toMatchObject({ code, statusCode: status });
  });
  it.each([['QUOTE_NOT_FOUND', 404], ['PAYMENT_NOT_FOUND', 500], ['private', 409]])('does not invent financial errors for %s/%s', async (code, status) => {
    const { ledger, transport } = setup(); transport.mockResolvedValueOnce(Response.json({ code }, { status: Number(status) }));
    await expect(ledger.call('expenseCategories', {}, 'human')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
  });
  it('keeps a timeout uncertain rather than rejecting or applying a payment', async () => {
    const { ledger, transport } = setup(); transport.mockRejectedValueOnce(new Error('private connection'));
    await expect(ledger.call('expenseCategories', {}, 'human')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
  });
  it('sanitizes stored applied operation results recursively', async () => {
    const payload = { operationId: ID, action: 'record_expense', outcome: 'applied', status: 200, committedAt: '2026-11-07T00:00:00Z', errorCode: null,
      resultJson: JSON.stringify({ expense: { ...expense, duplicateKey: 'private', token: 'private' }, replayed: false, token: 'private' }), fingerprint: 'private' };
    const result = await setup(payload).ledger.call('financialOperation', { operationId: ID }, 'human');
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('sanitizes stored rejections without losing the authorized duplicate candidate', async () => {
    const payload = { operationId: ID, action: 'record_expense', outcome: 'rejected', status: 409, committedAt: '2026-11-07T00:00:00Z', errorCode: 'EXPENSE_POSSIBLE_DUPLICATE',
      resultJson: JSON.stringify({ code: 'EXPENSE_POSSIBLE_DUPLICATE', statusCode: 409, replayed: false, message: 'private SQL', candidate: { ...expense, secret: 'private' } }) };
    const result = await setup(payload).ledger.call('financialOperation', { operationId: ID }, 'human') as { resultJson: string };
    expect(JSON.parse(result.resultJson).candidate).toEqual(expense); expect(result.resultJson).not.toContain('private');
  });
  it.each([{ limit: 0 }, { offset: -1 }, { from: '2026-02-30' }, { from: '2026-11-07', to: '2026-11-01' }, { unknown: 'x' }])('rejects invalid list input before HTTP', async args => {
    const { ledger, transport } = setup(); await expect(ledger.call('servicePayments', args, 'human')).rejects.toMatchObject({ statusCode: 400 }); expect(transport).not.toHaveBeenCalled();
  });
});
describe('CU19/CU20 GraphQL permission policy', () => {
  const caller = { subject: 'human', roles: ['responsable_financiero'] };
  it.each([['payments:read'], ['expenses:read'], ['quotes:read'], ['payments:*']])('requires both read grants for summary, not %s', async permission => {
    const { graphql, transport } = setup(summary, [permission]);
    const result = await graphql.run({ query: '{financialSummary(from:"2026-11-01",to:"2026-11-07"){receivedAmountMinor}}' }, caller, 'human');
    expect(result.errors?.[0].extensions.code).toBe('FORBIDDEN'); expect(transport).not.toHaveBeenCalled();
  });
  it('serves the summary only from ledger with both grants', async () => {
    const { graphql } = setup();
    const result = await graphql.run({ query: '{financialSummary(from:"2026-11-01",to:"2026-11-07"){receivedAmountMinor netMovementMinor}}' }, caller, 'human');
    expect(result.errors).toBeUndefined(); expect(result.data).toEqual({ financialSummary: { receivedAmountMinor: '0', netMovementMinor: '-999999999999' } });
  });
  it('allows write-only reconciliation to be reauthorized by the owner', async () => {
    const { graphql, transport } = setup(undefined, ['expenses:write']);
    transport.mockResolvedValueOnce(Response.json({ code: 'OPERATION_NOT_FOUND' }, { status: 404 }));
    const result = await graphql.run({ query: '{financialOperation(operationId:"' + ID + '"){operationId}}' }, caller, 'human');
    expect(result.errors?.[0].extensions).toEqual({ code: 'OPERATION_NOT_FOUND', statusCode: 404 }); expect(transport).toHaveBeenCalledOnce();
  });
  it('checks every root before returning partial data', async () => {
    const { graphql, transport } = setup([category], ['expenses:read']);
    const result = await graphql.run({ query: '{expenseCategories{id} secret:servicePayments{totalAmountMinor}}' }, caller, 'human');
    expect(result.errors?.[0].extensions.code).toBe('FORBIDDEN'); expect(transport).not.toHaveBeenCalled();
  });
});
