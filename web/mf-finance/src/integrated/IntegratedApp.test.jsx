import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IntegratedApp from './IntegratedApp';
import { CREATE, DECIDE, ORDERS, PERMISSIONS, QUOTES, REVISE, workshopDate } from './quote-api';

configure({ asyncUtilTimeout: 5000 });
const ALL = ['quotes:read', 'quotes:write', 'quotes:decide', 'orders:read'];
const order = {
  id: 'order-1', number: 'WO-1', customerId: 'customer-uuid', customerName: 'Nombre no es ID',
  vehicleId: 'vehicle-uuid', vehiclePlate: 'PLACA', priority: 'normal',
  items: [{ serviceId: 'service-uuid', serviceName: 'Diagnóstico', quantity: 2, referenceRate: 100 }],
};
const makeQuote = (id, overrides = {}) => ({
  id, orderReference: 'order-' + id, orderNumber: 'WO-' + id, customerReference: 'customer-uuid',
  vehicleReference: 'vehicle-uuid', vehiclePlate: 'PLACA', version: 1, status: 'pending',
  subtotal: 200, discountPercent: 5, discountAmount: 10, taxPercent: 7.5, taxAmount: 14.25,
  total: 204.25, currency: 'USD', validUntil: '2099-12-31', notes: null, decision: null,
  items: [{ serviceReference: 'service-uuid', description: 'Diagnóstico', quantity: 2, unitPrice: 100, lineTotal: 200 }],
  ...overrides,
});
const page = items => ({ items, total: items.length });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function setup({ permissions = ALL, quotes = [makeQuote('a'), makeQuote('b')], override } = {}) {
  const state = { quotes };
  const requestBusiness = vi.fn(async (query, variables) => {
    const custom = override?.(query, variables, state);
    if (custom !== undefined) return custom;
    if (query === PERMISSIONS) return { data: { securityCatalog: { effective: permissions } } };
    if (query === ORDERS) return { data: { orders: page([order]) } };
    if (query === QUOTES) return { data: { quotes: page(state.quotes.filter(quote => !variables.orderReference || quote.orderReference === variables.orderReference)) } };
    if (query === CREATE) {
      const quote = makeQuote('created', { orderReference: variables.input.orderReference, orderNumber: variables.input.orderNumber });
      state.quotes = [quote, ...state.quotes];
      return { data: { createQuote: { quote } } };
    }
    if (query === REVISE) {
      const current = state.quotes.find(quote => quote.id === variables.id);
      const quote = { ...current, ...variables.input, id: 'revised', version: current.version + 1 };
      state.quotes = [quote, ...state.quotes.map(item => item.id === current.id ? { ...item, status: 'superseded' } : item)];
      return { data: { reviseQuote: { quote } } };
    }
    if (query === DECIDE) {
      state.quotes = state.quotes.map(quote => quote.id === variables.id ? { ...quote, status: variables.input.decision } : quote);
      return { data: { decideQuote: { quote: state.quotes.find(quote => quote.id === variables.id) } } };
    }
    throw new Error('Unexpected query');
  });
  const session = { requestBusiness };
  const view = render(<IntegratedApp session={session} basePath="/finance" />);
  return { ...view, session, state, calls: query => requestBusiness.mock.calls.filter(call => call[0] === query) };
}
const choose = async (id = 'b') => {
  const button = await screen.findByTestId('quote-select-' + id);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};

describe('CU13/CU14 integrated quotes', () => {
  it('requires explicit selection, real evidence, and decides the second pending quote only once', async () => {
    const pending = deferred();
    const app = setup({ override: query => query === DECIDE ? pending.promise : undefined });
    await screen.findByTestId('quote-select-b');
    expect(screen.queryByRole('button', { name: /Aprobar WO/ })).not.toBeInTheDocument();
    await choose();
    const approve = screen.getByRole('button', { name: 'Aprobar WO-b v1' });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Evidencia de autorización/), { target: { value: '   ' } });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(app.calls(DECIDE)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Evidencia de autorización/), { target: { value: 'a'.repeat(301) } });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Evidencia de autorización/), { target: { value: 'Teléfono: cliente autorizó el presupuesto' } });
    fireEvent.change(screen.getByLabelText('Motivo opcional'), { target: { value: 'Conforme' } });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(app.calls(DECIDE)).toHaveLength(1);
    expect(app.calls(DECIDE)[0][1]).toMatchObject({ id: 'b', input: { decision: 'approved', evidence: 'Teléfono: cliente autorizó el presupuesto', reason: 'Conforme' } });
    await act(async () => pending.resolve({ data: { decideQuote: { quote: makeQuote('b', { status: 'approved' }) } } }));
  });

  it('clears evidence when changing selection and rejects the selected quote with optional reason omitted', async () => {
    const app = setup();
    await choose('a');
    fireEvent.change(screen.getByLabelText(/Evidencia de autorización/), { target: { value: 'Autorización de a' } });
    await choose('b');
    expect(screen.getByLabelText(/Evidencia de autorización/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Evidencia de autorización/), { target: { value: 'Correo: cliente rechazó' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar WO-b v1' }));
    await waitFor(() => expect(app.calls(DECIDE)).toHaveLength(1));
    expect(app.calls(DECIDE)[0][1]).toMatchObject({ id: 'b', input: { decision: 'rejected', evidence: 'Correo: cliente rechazó' } });
    expect(app.calls(DECIDE)[0][1].input).not.toHaveProperty('reason');
  });

  it('creates with real customer/vehicle IDs, editable date and rates, without a fixed tax or client totals', async () => {
    const app = setup();
    fireEvent.click(await screen.findByTestId('quote-order-order-1'));
    const date = screen.getByLabelText('Válida hasta (America/La_Paz)');
    expect(date).toHaveValue(workshopDate(new Date(), 7));
    fireEvent.change(date, { target: { value: '2099-05-06' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tarifa Diagnóstico' }), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización de WO-1' }));
    await waitFor(() => expect(app.calls(CREATE)).toHaveLength(1));
    const input = app.calls(CREATE)[0][1].input;
    expect(input).toMatchObject({ orderReference: order.id, customerReference: order.customerId, vehicleReference: order.vehicleId, validUntil: '2099-05-06', items: [{ serviceReference: 'service-uuid', quantity: 2, unitPrice: 125 }] });
    expect(input).not.toHaveProperty('taxPercent');
    expect(input).not.toHaveProperty('currency');
    expect(input).not.toHaveProperty('total');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Cotización seleccionada' })).toHaveAttribute('data-quote-id', 'created'));
    expect(screen.getByText('Impuesto (7.5 %)')).toBeInTheDocument();
    expect(screen.getAllByText('USD 204.25').length).toBeGreaterThan(0);
  });

  it('blocks an empty or past validity date', async () => {
    const app = setup();
    fireEvent.click(await screen.findByTestId('quote-order-order-1'));
    const date = screen.getByLabelText('Válida hasta (America/La_Paz)');
    fireEvent.change(date, { target: { value: '2000-01-01' } });
    expect(screen.getByRole('button', { name: 'Crear cotización de WO-1' })).toBeDisabled();
    fireEvent.change(date, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Crear cotización de WO-1' })).toBeDisabled();
    expect(app.calls(CREATE)).toHaveLength(0);
  });

  it('revises the selected pending version using expectedVersion and keeps superseded history immutable', async () => {
    const app = setup();
    await choose('b');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar cotización seleccionada' }));
    expect(screen.queryByLabelText(/Evidencia de autorización/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Cantidad Diagnóstico' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));
    await waitFor(() => expect(app.calls(REVISE)).toHaveLength(1));
    expect(app.calls(REVISE)[0][1]).toMatchObject({ id: 'b', input: { expectedVersion: 1, discountPercent: 5, items: [{ quantity: 3 }] } });
    expect(app.calls(REVISE)[0][1].input).not.toHaveProperty('taxPercent');
    await choose('b');
    expect(screen.getByRole('region', { name: 'Cotización seleccionada' })).toHaveTextContent('superseded');
    expect(screen.queryByRole('button', { name: 'Revisar cotización seleccionada' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Evidencia de autorización/)).not.toBeInTheDocument();
  });

  it('requires reload after a version conflict and keeps the selected ID through reordering', async () => {
    const app = setup({ override: query => query === REVISE ? { errors: [{ message: 'conflict', extensions: { code: 'VERSION_CONFLICT' } }] } : undefined });
    await choose('b');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar cotización seleccionada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva versión' }));
    await screen.findByText(/La versión cambió/);
    expect(screen.getByRole('button', { name: 'Revisar cotización seleccionada' })).toBeDisabled();
    app.state.quotes = [makeQuote('b', { status: 'superseded' }), makeQuote('a')];
    fireEvent.click(screen.getByRole('button', { name: 'Recargar cotizaciones' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Cotización seleccionada' })).toHaveTextContent('superseded'));
    expect(screen.getByRole('region', { name: 'Cotización seleccionada' })).toHaveAttribute('data-quote-id', 'b');
    expect(screen.queryByText(/La versión cambió/)).not.toBeInTheDocument();
  });

  it('loads quotes without orders permission and exposes read-only capabilities', async () => {
    const app = setup({ permissions: ['quotes:read'] });
    await choose();
    expect(app.calls(ORDERS)).toHaveLength(0);
    expect(app.calls(QUOTES)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Revisar cotización seleccionada' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Evidencia de autorización/)).not.toBeInTheDocument();
  });

  it('does not let an orders failure block a quote reader or decider', async () => {
    const app = setup({ permissions: ['quotes:read', 'quotes:decide', 'orders:read'], override: query => query === ORDERS ? { errors: [{ code: 'FORBIDDEN' }] } : undefined });
    await choose();
    expect(screen.getByRole('button', { name: 'Aprobar WO-b v1' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Revisar cotización seleccionada' })).not.toBeInTheDocument();
    expect(app.calls(QUOTES)).toHaveLength(1);
  });

  it('fails closed without effective quote permissions, regardless of roles', async () => {
    const app = setup({ permissions: [] });
    await screen.findByText(/No tenés permiso quotes:read/);
    expect(app.calls(QUOTES)).toHaveLength(0);
    expect(app.calls(ORDERS)).toHaveLength(0);
  });

  it.each(['approved', 'rejected', 'superseded', 'expired'])('shows %s versions as immutable read-only records', async status => {
    setup({ quotes: [makeQuote('b', { status })] });
    await choose();
    expect(screen.queryByRole('button', { name: 'Revisar cotización seleccionada' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Evidencia de autorización/)).not.toBeInTheDocument();
  });

  it('does not allow a decision on a pending quote whose workshop date expired', async () => {
    setup({ quotes: [makeQuote('b', { validUntil: '2000-01-01' })] });
    await choose();
    expect(screen.getByText(/Cotización vencida/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Evidencia de autorización/)).not.toBeInTheDocument();
  });

  it('discards obsolete filter responses and old-session responses after unmount', async () => {
    const old = deferred();
    const fresh = deferred();
    const app = setup({ override: (query, variables) => query === QUOTES && variables.orderReference === 'old' ? old.promise : query === QUOTES && variables.orderReference === 'fresh' ? fresh.promise : undefined });
    await choose();
    fireEvent.change(screen.getByLabelText('ID de orden'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('ID de orden'), { target: { value: 'fresh' } });
    await act(async () => fresh.resolve({ data: { quotes: page([makeQuote('fresh')]) } }));
    expect(screen.getByTestId('quote-select-fresh')).toBeInTheDocument();
    await act(async () => old.resolve({ data: { quotes: page([makeQuote('old')]) } }));
    expect(screen.queryByTestId('quote-select-old')).not.toBeInTheDocument();
    expect(screen.getByTestId('quote-select-fresh')).toBeInTheDocument();
    const late = deferred();
    const requestBusiness = vi.fn(() => late.promise);
    app.rerender(<IntegratedApp session={{ requestBusiness }} basePath="/finance" />);
    app.unmount();
    await act(async () => late.resolve({ data: { securityCatalog: { effective: ALL } } }));
    expect(requestBusiness).toHaveBeenCalledTimes(1);
  });

  it('renders server breakdown rather than recalculating totals', async () => {
    setup({ quotes: [makeQuote('b', { subtotal: 999, total: 1234, discountAmount: 17, taxAmount: 252 })] });
    await choose();
    const detail = within(screen.getByRole('region', { name: 'Cotización seleccionada' }));
    expect(detail.getByText('USD 999.00')).toBeInTheDocument();
    expect(detail.getByText('USD 17.00')).toBeInTheDocument();
    expect(detail.getByText('USD 252.00')).toBeInTheDocument();
    expect(detail.getByText('USD 1234.00')).toBeInTheDocument();
  });

  it('retries an uncertain decision with the same operationId and content', async () => {
    let attempts = 0;
    const app = setup({ override: query => {
      if (query !== DECIDE) return undefined;
      if (++attempts === 1) throw new Error('Network timeout');
      return undefined;
    } });
    await choose('b');
    fireEvent.change(screen.getByLabelText(/Evidencia de autorización/), { target: { value: 'Presencial: aceptación expresa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar WO-b v1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar el mismo envío' }));
    await waitFor(() => expect(app.calls(DECIDE)).toHaveLength(2));
    expect(app.calls(DECIDE)[0][1]).toEqual(app.calls(DECIDE)[1][1]);
  });

  it('finds an order by plate beyond the first server page', async () => {
    const other = { ...order, id: 'beyond-page', number: 'WO-99', vehiclePlate: 'BUSCAR' };
    const app = setup({ override: (query, variables) => query === ORDERS ? { data: { orders: { total: 21, items: variables.offset === 20 ? [other] : Array.from({ length: 20 }, (_, index) => ({ ...order, id: 'order-' + index })) } } } : undefined });
    await screen.findByTestId('quote-order-order-0');
    fireEvent.change(screen.getByLabelText('Buscar orden por número, placa o ID'), { target: { value: 'BUSCAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar órdenes' }));
    await screen.findByTestId('quote-order-beyond-page');
    expect(app.calls(ORDERS).some(call => call[1].offset === 20)).toBe(true);
    expect(screen.queryByTestId('quote-order-order-0')).not.toBeInTheDocument();
  });
});

describe('workshop calendar', () => {
  it('uses La Paz rather than UTC and adds calendar days across year/leap boundaries', () => {
    expect(workshopDate(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
    expect(workshopDate(new Date('2027-01-01T02:00:00Z'), 7)).toBe('2027-01-07');
    expect(workshopDate(new Date('2028-02-29T02:00:00Z'), 1)).toBe('2028-02-29');
  });
});
