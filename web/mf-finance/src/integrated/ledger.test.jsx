import { act, configure, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LedgerWorkspace from './LedgerWorkspace';
import ExpenseDocument from './ExpenseDocument';
import { PERMISSIONS } from './quote-api';
import { CATEGORIES, CONFIRM_DOCUMENT, EXPENSES, OPERATION, PAY, PAYMENTS, RECEIPT, RECEIVABLE, RECEIVABLES, REQUEST_DOCUMENT, SPEND, VERIFY, decimalAmount, minorAmount } from './ledger-api';
import { fileRequest } from './ledger-files';
import { useLedgerCommand, useLedgerQuery } from './use-ledger';

configure({ asyncUtilTimeout: 10000 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const obligation = { orderId: 'order-1', orderNumber: 'OT-19', orderStatus: 'completed', agreedAmountMinor: '10001', paidAmountMinor: '0', balanceMinor: '10001', currency: 'BOB', balanceVersion: 3, policyCode: 'FULL_AFTER_COMPLETION_V1', payments: [], observedAt: '2026-11-07T20:00:00Z' };
const receipt = { id: 'receipt-1', number: 'RC-19', paymentId: 'payment-1', orderId: obligation.orderId, orderNumber: obligation.orderNumber, amountMinor: '10001', currency: 'BOB', method: 'cash', employeeId: 'employee-1', actorSubject: 'subject-1', recordedAt: '2026-11-07T20:01:00Z', fiscalStatus: 'internal_only' };
const category = { id: 'category-1', code: 'utilities', name: 'Servicios básicos', active: true };
const expense = { id: 'expense-1', description: 'Agua del taller', category, expenseDate: '2026-11-01', amountMinor: '12345', currency: 'BOB', method: 'cash', employeeId: 'employee-1', document: null };
const page = (items, total = items.length) => ({ items, page: { total, limit: 20, offset: 0 }, totalAmountMinor: '12345' });
function setup(view = 'payments', override, permissions = ['payments:read', 'payments:write', 'expenses:read', 'expenses:write']) {
  const session = { requestBusiness: vi.fn(async (query, variables) => {
    const custom = override?.(query, variables);
    if (custom !== undefined) return custom;
    if (query === PERMISSIONS) return { data: { securityCatalog: { effective: permissions } } };
    if (query === RECEIVABLES) return { data: { receivables: page([obligation], 41) } };
    if (query === RECEIVABLE) return { data: { receivable: obligation } };
    if (query === PAYMENTS) return { data: { servicePayments: page([]) } };
    if (query === RECEIPT) return { data: { paymentReceipt: receipt } };
    if (query === CATEGORIES) return { data: { expenseCategories: [category] } };
    if (query === EXPENSES) return { data: { operatingExpenses: page([expense], 41) } };
    if (query === PAY) return { data: { recordServicePayment: { payment: {}, receipt, receivable: { ...obligation, balanceMinor: '0' } } } };
    if (query === SPEND) return { data: { recordOperatingExpense: { expense } } };
    throw new Error('Unexpected mocked SessionPort request');
  }) };
  render(<LedgerWorkspace session={session} view={view} />);
  return session;
}

describe('ledger money and file boundaries (local unit tests)', () => {
  it.each([['0.01', '1'], ['100,01', '10001'], ['9999999999.99', '999999999999'], ['00001.1', '110']])('converts %s to exact minor strings', (input, expected) => expect(minorAmount(input)).toBe(expected));
  it.each(['0', '-1', '1.001', '1e3', '1,000.00', 'Infinity', '', '10000000000'])('rejects invalid amount %s', input => expect(() => minorAmount(input)).toThrow());
  it('formats integers without Float conversion', () => { expect(decimalAmount('999999999999')).toBe('9999999999.99'); expect(decimalAmount('-1')).toBe('-0.01'); });
  it('allows only BFF binary grants, without cookies, redirects or bearer tokens', () => {
    const target = { url: '/finance-files/documents/12345678-1234-1234-1234-123456789012/content', method: 'PUT', headersJson: JSON.stringify({ 'X-Finance-Grant': 'opaque' }) };
    expect(fileRequest(target, 'PUT').options).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(() => fileRequest({ ...target, url: 'http://127.0.0.1:3003/content' }, 'PUT')).toThrow();
    expect(() => fileRequest({ ...target, headersJson: JSON.stringify({ Authorization: 'Bearer forbidden' }) }, 'PUT')).toThrow();
    expect(() => fileRequest({ ...target, url: target.url + '?redirect=other' }, 'PUT')).toThrow();
    expect(() => fileRequest({ ...target, url: target.url + '#other' }, 'PUT')).toThrow();
  });
});

describe('ledger command and stale reads (mocked transport, not integration)', () => {
  it.each(['UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION_ERROR', 'GRAPHQL_VALIDATION_FAILED'])('keeps a prior uncertain command after retry returns %s', async code => {
    const run = vi.fn()
      .mockRejectedValueOnce({ extensions: { code: 'SERVICE_UNAVAILABLE', statusCode: 503 } })
      .mockRejectedValueOnce({ extensions: { code } })
      .mockResolvedValueOnce({ financialOperation: { outcome: 'applied', resultJson: JSON.stringify({ receipt }) } });
    const applied = vi.fn();
    const { result } = renderHook(() => useLedgerCommand(run, applied));
    await act(async () => result.current.start(PAY, { orderId: 'o', input: { amountMinor: '10001', method: 'cash', expectedVersion: 3, confirmReceived: true } }, 'recordServicePayment'));
    const original = structuredClone(run.mock.calls[0]);
    await act(async () => result.current.retry());
    expect(run.mock.calls[1]).toEqual(original);
    expect(result.current.pending.variables).toEqual(original[1]);
    await act(async () => result.current.start(PAY, { orderId: 'replacement', input: {} }, 'recordServicePayment'));
    expect(run).toHaveBeenCalledTimes(2);
    await act(async () => result.current.reconcile());
    expect(run.mock.calls[2]).toEqual([OPERATION, { operationId: original[1].input.operationId }]);
    expect(result.current.pending).toBeNull();
    expect(applied).toHaveBeenCalledTimes(1);
  });
  it.each(['UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION_ERROR', 'GRAPHQL_VALIDATION_FAILED'])('clears a definitive first-attempt refusal %s without prior uncertainty', async code => {
    const run = vi.fn().mockRejectedValueOnce({ extensions: { code } }).mockResolvedValueOnce({ recordServicePayment: { receipt } });
    const { result } = renderHook(() => useLedgerCommand(run, vi.fn()));
    await act(async () => result.current.start(PAY, { input: { amountMinor: '10001' } }, 'recordServicePayment'));
    expect(result.current.pending).toBeNull();
    await act(async () => result.current.start(PAY, { input: { amountMinor: '10001' } }, 'recordServicePayment'));
    expect(run.mock.calls[1][1].input.operationId).not.toBe(run.mock.calls[0][1].input.operationId);
  });
  it('retains the exact operation and body after a timeout, even when OPERATION_NOT_FOUND', async () => {
    const run = vi.fn().mockRejectedValue(new Error('timeout'));
    const applied = vi.fn();
    const { result } = renderHook(() => useLedgerCommand(run, applied));
    await act(async () => result.current.start(PAY, { orderId: 'o', input: { amountMinor: '10001', method: 'cash', expectedVersion: 3, confirmReceived: true } }, 'recordServicePayment'));
    const original = structuredClone(run.mock.calls[0]);
    await act(async () => result.current.start(PAY, { orderId: 'other', input: {} }, 'recordServicePayment'));
    expect(run).toHaveBeenCalledTimes(1);
    run.mockRejectedValueOnce({ extensions: { code: 'OPERATION_NOT_FOUND' } });
    await act(async () => result.current.reconcile());
    expect(result.current.pending.variables.input.operationId).toBe(original[1].input.operationId);
    run.mockResolvedValueOnce({ recordServicePayment: { receipt } });
    await act(async () => result.current.retry());
    expect(run.mock.calls[2]).toEqual(original);
    expect(result.current.pending).toBeNull();
    expect(applied).toHaveBeenCalledTimes(1);
  });
  it('reconciles a committed result without issuing another mutation', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ financialOperation: { outcome: 'applied', resultJson: JSON.stringify({ receipt }) } });
    const applied = vi.fn();
    const { result } = renderHook(() => useLedgerCommand(run, applied));
    await act(async () => result.current.start(PAY, { input: { amountMinor: '10001' } }, 'recordServicePayment'));
    await act(async () => result.current.reconcile());
    expect(run.mock.calls[1][0]).toBe(OPERATION);
    expect(applied.mock.calls[0][1].receipt).toEqual(receipt);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('requires a confirmed rejection before allowing a new duplicate intent', async () => {
    const run = vi.fn().mockRejectedValueOnce({ extensions: { code: 'EXPENSE_POSSIBLE_DUPLICATE' } }).mockResolvedValueOnce({ financialOperation: { outcome: 'rejected', resultJson: JSON.stringify({ code: 'EXPENSE_POSSIBLE_DUPLICATE', candidate: expense }) } }).mockResolvedValueOnce({ recordOperatingExpense: { expense } });
    const rejected = vi.fn();
    const { result } = renderHook(() => useLedgerCommand(run, vi.fn(), rejected));
    await act(async () => result.current.start(SPEND, { input: { amountMinor: '12345' } }, 'recordOperatingExpense'));
    const firstId = result.current.pending.variables.input.operationId;
    await act(async () => result.current.reconcile());
    expect(rejected.mock.calls[0][1].candidate.id).toBe(expense.id);
    await act(async () => result.current.start(SPEND, { input: { amountMinor: '12345', duplicateOf: expense.id, duplicateReason: 'Otro pago autorizado' } }, 'recordOperatingExpense'));
    expect(run.mock.calls[2][1].input.operationId).not.toBe(firstId);
  });
  it('does not overwrite a newer page with an older response', async () => {
    const old = deferred(); const fresh = deferred();
    const run = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result, rerender } = renderHook(({ offset }) => useLedgerQuery(run, EXPENSES, { offset }), { initialProps: { offset: 0 } });
    rerender({ offset: 20 });
    await act(async () => fresh.resolve({ marker: 'new' }));
    await act(async () => old.resolve({ marker: 'old' }));
    expect(result.current.data.marker).toBe('new');
  });
});

describe('CU19/CU20 screens with mocked SessionPort/jsdom', () => {
  it('keeps reconciliation readable after only write permission is revoked', async () => {
    let effective = ['expenses:read', 'expenses:write'];
    const session = setup('expenses', query => {
      if (query === PERMISSIONS) return { data: { securityCatalog: { effective } } };
      if (query === SPEND) return Promise.reject(new Error('Resultado de transporte desconocido'));
      if (query === OPERATION) return { data: { financialOperation: { outcome: 'applied', resultJson: JSON.stringify({ expense }) } } };
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar gasto' }));
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: expense.description } });
    fireEvent.mouseDown(screen.getByLabelText('Categoría', { selector: '#ledger-expense_categoryId' }));
    fireEvent.click(await screen.findByText('Servicios básicos', { selector: '.ant-select-item-option-content' }));
    fireEvent.change(screen.getByLabelText('Importe (BOB)'), { target: { value: '123.45' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Revisé los datos y confirmo el registro de este gasto.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y registrar gasto' }));
    await screen.findByText('Resultado incierto: no significa rechazo. No registres otra operación.');
    effective = ['expenses:read'];
    await waitFor(() => expect(screen.queryByText('Consultando permisos vigentes…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('Actualizar permisos'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar el mismo envío' })).toBeDisabled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Consultar resultado' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado' }));
    await screen.findByText(/Gasto registrado: Agua del taller/);
    expect(session.requestBusiness.mock.calls.filter(([query]) => query === SPEND)).toHaveLength(1);
  });
  it('rejects a partial amount beside the payment field before any command', async () => {
    const session = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver saldo OT-19' }));
    const amount = await screen.findByLabelText(/Importe recibido/);
    fireEvent.change(amount, { target: { value: '1.00' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirmo que recibí el pago y quiero registrar el cobro de esta orden.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción y registrar cobro' }));
    await screen.findByText('En esta etapa sólo podés registrar el saldo íntegro: BOB 100.01.');
    expect(session.requestBusiness.mock.calls.some(([query]) => [PAY, VERIFY].includes(query))).toBe(false);
    expect(amount).toHaveFocus();
  });
  it.each([['payments', false], ['expenses', false], ['payments', true], ['expenses', true]])('reconciles %s pending intention after read revocation (write also revoked: %s)', async (module, revokeWrite) => {
    let effective = [module + ':read', module + ':write'];
    const mutation = module === 'payments' ? PAY : SPEND;
    const session = setup(module, query => {
      if (query === PERMISSIONS) return { data: { securityCatalog: { effective } } };
      if (query === mutation) return Promise.reject(new Error('response lost'));
      if (query === OPERATION) return { data: { financialOperation: { outcome: 'applied', resultJson: JSON.stringify(module === 'payments' ? { receipt } : { expense }) } } };
    });
    if (module === 'payments') {
      fireEvent.click(await screen.findByRole('button', { name: 'Ver saldo OT-19' }));
      fireEvent.change(await screen.findByLabelText(/Importe recibido/), { target: { value: '100.01' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo que recibí/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción y registrar cobro' }));
    } else {
      const create = await screen.findByRole('button', { name: 'Registrar gasto' });
      await waitFor(() => expect(create).toBeEnabled()); fireEvent.click(create);
      fireEvent.change(await screen.findByLabelText('Descripción'), { target: { value: expense.description } });
      fireEvent.mouseDown(screen.getAllByLabelText('Categoría').find(item => item.closest('form')?.getAttribute('class')?.includes('vertical')));
      fireEvent.click(await screen.findByText('Servicios básicos', { selector: '.ant-select-item-option-content' }));
      fireEvent.change(screen.getByLabelText('Fecha del gasto (America/La_Paz)'), { target: { value: expense.expenseDate } });
      fireEvent.change(screen.getByLabelText('Importe (BOB)'), { target: { value: '123.45' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /Revisé los datos y confirmo el registro/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar y registrar gasto' }));
    }
    await screen.findByText('response lost');
    const submitted = session.requestBusiness.mock.calls.find(([query]) => query === mutation)[1];
    const generalReads = () => session.requestBusiness.mock.calls.filter(([query]) => [RECEIVABLES, RECEIVABLE, PAYMENTS, RECEIPT, EXPENSES, CATEGORIES].includes(query));
    const readCount = generalReads().length;
    effective = revokeWrite ? [] : [module + ':write'];
    fireEvent.click(screen.getByRole('button', { name: /Actualizar permisos/ }));
    await waitFor(() => expect(screen.queryByText('Consultando permisos vigentes…')).not.toBeInTheDocument());
    expect(screen.getByText(module === 'payments' ? 'Se requiere payments:read para consultar cobros y saldos.' : 'Se requiere expenses:read para consultar gastos y categorías.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp('Intención: ' + submitted.input.operationId))).toBeVisible();
    const reconcile = screen.getByRole('button', { name: 'Consultar resultado' });
    const retry = screen.getByRole('button', { name: 'Reintentar el mismo envío' });
    if (revokeWrite) {
      expect(reconcile).toBeDisabled(); expect(retry).toBeDisabled();
      effective = [module + ':write'];
      fireEvent.click(screen.getByRole('button', { name: /Actualizar permisos/ }));
      await waitFor(() => expect(reconcile).toBeEnabled());
    } else { expect(reconcile).toBeEnabled(); expect(retry).toBeEnabled(); }
    fireEvent.click(reconcile);
    if (module === 'payments') expect(await screen.findByText('Comprobante interno RC-19')).toBeVisible();
    else expect(await screen.findByText(/Gasto registrado: Agua del taller/)).toBeVisible();
    expect(session.requestBusiness.mock.calls.find(([query]) => query === OPERATION)[1]).toEqual({ operationId: submitted.input.operationId });
    expect(session.requestBusiness.mock.calls.filter(([query]) => query === mutation)).toHaveLength(1);
    expect(generalReads()).toHaveLength(readCount);
    expect(screen.queryByText('Órdenes y saldos')).not.toBeInTheDocument();
    expect(screen.queryByText('Cobros registrados')).not.toBeInTheDocument();
    expect(screen.queryByText('Gastos registrados')).not.toBeInTheDocument();
  });
  it('honors dynamic permissions without business reads or mutations', async () => {
    const session = setup('payments', undefined, []);
    await screen.findByText('Se requiere payments:read para consultar cobros y saldos.');
    await waitFor(() => expect(session.requestBusiness).toHaveBeenCalledTimes(1));
  });
  it('shows agreed/prior/balance server amounts, requires human receipt, then shows internal receipt', async () => {
    const session = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver saldo OT-19' }));
    const amount = await screen.findByLabelText(/Importe recibido/);
    expect(await screen.findByText('Importe acordado')).toBeInTheDocument();
    expect(screen.getByText('Pagos previos')).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: '100,01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción y registrar cobro' }));
    await screen.findByText('Confirmá la recepción efectiva.');
    expect(session.requestBusiness.mock.calls.filter(([query]) => query === PAY)).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo que recibí/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción y registrar cobro' }));
    await screen.findByText('Comprobante interno RC-19');
    const call = session.requestBusiness.mock.calls.find(([query]) => query === PAY);
    expect(call[1]).toMatchObject({ orderId: 'order-1', input: { amountMinor: '10001', expectedVersion: 3, method: 'cash', confirmReceived: true } });
    expect(call[1].input.referenceVerificationId).toBeUndefined();
  });
  it('uses server pagination and server expense total, not sums of the current page', async () => {
    const session = setup('expenses');
    await screen.findByText('Agua del taller');
    expect(screen.getByText('Total del período calculado por Finanzas:')).toBeInTheDocument();
    const next = screen.getAllByTitle('2').find(item => !item.closest('[hidden]'));
    fireEvent.click(next);
    await waitFor(() => expect(session.requestBusiness.mock.calls.some(([query, variables]) => query === EXPENSES && variables.offset === 20)).toBe(true));
  });
  it('records human noncash verification before enabling the payment', async () => {
    const session = setup('payments', (query, variables) => query === VERIFY ? { data: { verifyPaymentReference: { verification: { id: 'verification-1', orderId: variables.orderId, method: variables.input.method, amountMinor: variables.input.amountMinor, reference: 'BANK-19', verifiedAt: '2026-11-07T20:00:00Z' } } } } : undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver saldo OT-19' }));
    fireEvent.change(await screen.findByLabelText(/Importe recibido/), { target: { value: '100.01' } });
    fireEvent.mouseDown(screen.getByLabelText('Medio de pago'));
    fireEvent.click(await screen.findByText('Transferencia bancaria', { selector: '.ant-select-item-option-content' }));
    fireEvent.change(await screen.findByLabelText('Referencia comprobada'), { target: { value: 'BANK-19' } });
    fireEvent.change(screen.getByLabelText('Cómo comprobaste la recepción'), { target: { value: 'Recepción revisada personalmente en la cuenta del taller' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Comprobé personalmente la referencia y el importe recibido.' }));
    const pay = screen.getByRole('button', { name: 'Confirmar recepción y registrar cobro' });
    expect(pay).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar comprobación humana' }));
    await screen.findByText(/Comprobación registrada: BANK-19/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo que recibí/ }));
    expect(pay).toBeEnabled();
    fireEvent.click(pay);
    await waitFor(() => expect(session.requestBusiness.mock.calls.some(([query, variables]) => query === PAY && variables.input.referenceVerificationId === 'verification-1')).toBe(true));
  });
  it('confirms an expense and requires a reason plus a distinct intent for a duplicate candidate', async () => {
    let first = true;
    const session = setup('expenses', query => {
      if (query === SPEND && first) { first = false; return { errors: [{ message: 'Posible duplicado', extensions: { code: 'EXPENSE_POSSIBLE_DUPLICATE' } }] }; }
      if (query === OPERATION) return { data: { financialOperation: { outcome: 'rejected', resultJson: JSON.stringify({ code: 'EXPENSE_POSSIBLE_DUPLICATE', candidate: expense }) } } };
    });
    const create = await screen.findByRole('button', { name: 'Registrar gasto' });
    await waitFor(() => expect(create).toBeEnabled()); fireEvent.click(create);
    fireEvent.change(await screen.findByLabelText('Descripción'), { target: { value: expense.description } });
    const categorySelect = screen.getAllByLabelText('Categoría').find(item => item.closest('form')?.getAttribute('class')?.includes('vertical'));
    fireEvent.mouseDown(categorySelect);
    fireEvent.click(await screen.findByText('Servicios básicos', { selector: '.ant-select-item-option-content' }));
    fireEvent.change(screen.getByLabelText('Fecha del gasto (America/La_Paz)'), { target: { value: expense.expenseDate } });
    fireEvent.change(screen.getByLabelText('Importe (BOB)'), { target: { value: '123,45' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé los datos y confirmo el registro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y registrar gasto' }));
    await screen.findByRole('button', { name: 'Consultar resultado' });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado' }));
    await screen.findByText('Posible gasto duplicado: la intención anterior fue rechazada.');
    fireEvent.change(screen.getByLabelText('Por qué es otro gasto legítimo'), { target: { value: 'Segundo suministro independiente autorizado' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé los datos y confirmo una nueva intención/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar otro gasto con nueva intención' }));
    await screen.findByText(/Gasto registrado: Agua del taller/);
    const calls = session.requestBusiness.mock.calls.filter(([query]) => query === SPEND);
    expect(calls).toHaveLength(2);
    expect(calls[0][1].input.amountMinor).toBe('12345');
    expect(calls[1][1].input).toMatchObject({ duplicateOf: expense.id, duplicateReason: 'Segundo suministro independiente autorizado' });
    expect(calls[1][1].input.operationId).not.toBe(calls[0][1].input.operationId);
  });
  it('keeps server failures distinct from empty financial results', async () => {
    setup('expenses', query => query === EXPENSES ? Promise.reject(new Error('Servidor financiero no disponible')) : undefined);
    await screen.findByText('Servidor financiero no disponible');
    expect(screen.getByText('Consulta no disponible; no se presume un saldo cero.')).toBeInTheDocument();
  });
  it('never submits a bank verification or a payment from render effects', async () => {
    const session = setup();
    await screen.findByRole('button', { name: 'Ver saldo OT-19' });
    expect(session.requestBusiness.mock.calls.some(([query]) => [VERIFY, PAY, SPEND].includes(query))).toBe(false);
  });
  it('uploads actual selected bytes only with a grant and attaches only a server-confirmed document', async () => {
    const target = { url: '/finance-files/documents/12345678-1234-1234-1234-123456789012/content', method: 'PUT', headersJson: JSON.stringify({ 'X-Finance-Grant': 'opaque', 'Content-Type': 'image/png' }) };
    const document = { id: '12345678-1234-1234-1234-123456789012', fileName: 'respaldo.png', state: 'available' };
    const run = vi.fn(async query => query === REQUEST_DOCUMENT ? { requestExpenseDocument: { document: { ...document, state: 'pending' }, upload: target } } : { confirmExpenseDocument: document });
    const onDocument = vi.fn(); const onBusy = vi.fn();
    const transport = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', transport);
    try {
      render(<ExpenseDocument run={run} onDocument={onDocument} onBusy={onBusy} />);
      const file = { name: 'respaldo.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      fireEvent.change(screen.getByLabelText('Seleccionar respaldo'), { target: { files: [file] } });
      await waitFor(() => expect(onDocument).toHaveBeenCalledWith(document));
      expect(run.mock.calls[0][1].input).toMatchObject({ fileName: file.name, sizeBytes: 3, contentType: 'image/png' });
      expect(run.mock.calls[0][1].input.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(run.mock.calls[1][0]).toBe(CONFIRM_DOCUMENT);
      expect(transport.mock.calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'omit', body: file });
      expect(transport.mock.calls[0][1].headers.Authorization).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });
  it('allows continuing without an optional document when the BFF refuses storage before issuing metadata', async () => {
    const run = vi.fn().mockRejectedValue({ message: 'Respaldo no disponible', extensions: { code: 'DOCUMENT_STORAGE_UNAVAILABLE' } });
    const onDocument = vi.fn(); const onBusy = vi.fn();
    render(<ExpenseDocument run={run} onDocument={onDocument} onBusy={onBusy} />);
    const file = { name: 'respaldo.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    fireEvent.change(screen.getByLabelText('Seleccionar respaldo'), { target: { files: [file] } });
    await screen.findByText('DOCUMENT_STORAGE_UNAVAILABLE: Respaldo no disponible');
    expect(onDocument).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Respaldo pendiente de confirmación. No se presume adjunto.')).not.toBeInTheDocument();
  });
  it('keeps an uncertain document request after a later forbidden retry with its original body', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce({ message: 'Sin permiso', extensions: { code: 'FORBIDDEN' } });
    const onBusy = vi.fn();
    render(<ExpenseDocument run={run} onDocument={vi.fn()} onBusy={onBusy} />);
    const file = { name: 'respaldo.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    fireEvent.change(screen.getByLabelText('Seleccionar respaldo'), { target: { files: [file] } });
    await screen.findByText('timeout');
    const retry = screen.getByRole('button', { name: 'Reintentar y conciliar respaldo' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await screen.findByText('FORBIDDEN: Sin permiso');
    expect(run.mock.calls[1]).toEqual(run.mock.calls[0]);
    expect(screen.getByText('Respaldo pendiente de confirmación. No se presume adjunto.')).toBeInTheDocument();
    expect(onBusy.mock.calls.some(([busy]) => busy === false)).toBe(false);
  });
});
