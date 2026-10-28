import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Input, Space, Table, Tag, Typography } from 'antd';
import QuoteEditor from './QuoteEditor';
import { PERMISSIONS, ORDERS, QUOTES, CREATE, REVISE, DECIDE, explain, money, workshopDate } from './quote-api';

const PAGE_SIZE = 20;
export default function IntegratedApp({ session, basePath }) {
  const [identity, setIdentity] = useState({ session, key: 0 });
  if (identity.session !== session) setIdentity({ session, key: identity.key + 1 });
  return <FinanceWorkspace key={identity.key} session={session} basePath={basePath} />;
}

function FinanceWorkspace({ session, basePath }) {
  const [access, setAccess] = useState(null);
  const [orders, setOrders] = useState({ items: [], total: 0 });
  const [quotes, setQuotes] = useState({ items: [], total: 0 });
  const [orderPage, setOrderPage] = useState(1);
  const [quotePage, setQuotePage] = useState(1);
  const [orderFilter, setOrderFilter] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSearchDraft, setOrderSearchDraft] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [uncertain, setUncertain] = useState(null);
  const [ordersError, setOrdersError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [completedOrders, setCompletedOrders] = useState(null);
  const [completedQuotes, setCompletedQuotes] = useState(null);
  const [stale, setStale] = useState(false);
  const generation = useRef({ value: 0 });
  const orderRequest = useRef({ value: 0 });
  const quoteRequest = useRef({ value: 0 });
  const submitting = useRef(false);
  const lastOperation = useRef(null);
  const permissions = access?.session === session ? access.effective : [];
  const canRead = permissions.includes('quotes:read');
  const canWrite = permissions.includes('quotes:write');
  const canDecide = permissions.includes('quotes:decide');
  const canOrders = permissions.includes('orders:read');
  const orderQuery = useMemo(() => ({ orderPage, orderSearch }), [orderPage, orderSearch]);
  const quoteQuery = useMemo(() => ({ quotePage, orderFilter }), [quotePage, orderFilter]);
  const loadingOrders = canOrders && completedOrders !== orderQuery;
  const loadingQuotes = canRead && completedQuotes !== quoteQuery;
  const selected = quotes.items.find(quote => quote.id === selectedId);
  const pending = selected?.status === 'pending' && selected.validUntil >= workshopDate();
  const evidenceValid = evidence.trim().length >= 1 && Array.from(evidence.trim()).length <= 300;

  const run = useCallback(async (query, variables = {}) => {
    if (!session) throw new Error('Esta vista requiere la sesión del Shell.');
    const result = await session.requestBusiness(query, variables);
    if (result.errors?.length) throw result.errors[0];
    return result.data;
  }, [session]);

  useEffect(() => {
    const epoch = ++generation.current.value;
    const sessionGeneration = generation.current;
    const ordersCounter = orderRequest.current;
    const quotesCounter = quoteRequest.current;
    run(PERMISSIONS).then(data => {
      if (generation.current.value === epoch) setAccess({ session, effective: data.securityCatalog.effective });
    }).catch(failure => {
      if (generation.current.value === epoch) setError(explain(failure));
    });
    return () => { sessionGeneration.value++; ordersCounter.value++; quotesCounter.value++; };
  }, [run, session]);

  const loadOrders = useCallback(() => {
    if (!canOrders) return;
    const request = ++orderRequest.current.value;
    const epoch = generation.current.value;
    const fetchOrders = async () => {
      let data = await run(ORDERS, { limit: PAGE_SIZE, offset: orderSearch ? 0 : (orderPage - 1) * PAGE_SIZE });
      if (orderSearch) {
        const all = [...data.orders.items];
        let offset = data.orders.items.length;
        while (offset < data.orders.total) {
          if (epoch !== generation.current.value || request !== orderRequest.current.value) return;
          const next = await run(ORDERS, { limit: PAGE_SIZE, offset });
          if (!next.orders.items.length) break;
          all.push(...next.orders.items);
          offset += next.orders.items.length;
        }
        const search = orderSearch.toLocaleLowerCase('es');
        const matches = all.filter(order => [order.id, order.number, order.vehiclePlate].some(value => value.toLocaleLowerCase('es').includes(search)));
        data = { orders: { total: matches.length, items: matches.slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE) } };
      }
      return data;
    };
    return fetchOrders().then(data => {
      if (epoch === generation.current.value && request === orderRequest.current.value) { setOrders(data.orders); setOrdersError(null); }
    }).catch(failure => {
      if (epoch === generation.current.value && request === orderRequest.current.value) setOrdersError(explain(failure));
    }).finally(() => {
      if (epoch === generation.current.value && request === orderRequest.current.value) setCompletedOrders(orderQuery);
    });
  }, [canOrders, orderPage, orderSearch, orderQuery, run]);

  const loadQuotes = useCallback(() => {
    if (!canRead) return;
    const request = ++quoteRequest.current.value;
    const epoch = generation.current.value;
    return run(QUOTES, { limit: PAGE_SIZE, offset: (quotePage - 1) * PAGE_SIZE, ...(orderFilter ? { orderReference: orderFilter } : {}) }).then(data => {
      if (epoch !== generation.current.value || request !== quoteRequest.current.value) return;
      setQuotes(data.quotes);
      setStale(false);
      setError(null);
    }).catch(failure => {
      if (epoch === generation.current.value && request === quoteRequest.current.value) { setError(explain(failure)); setStale(true); }
    }).finally(() => {
      if (epoch === generation.current.value && request === quoteRequest.current.value) setCompletedQuotes(quoteQuery);
    });
  }, [canRead, orderFilter, quotePage, quoteQuery, run]);

  useEffect(() => {
    const counter = orderRequest.current;
    loadOrders();
    return () => { counter.value++; };
  }, [loadOrders]);
  useEffect(() => {
    const counter = quoteRequest.current;
    loadQuotes();
    return () => { counter.value++; };
  }, [loadQuotes]);

  const reloadOrders = () => {
    if (!canOrders) return;
    setCompletedOrders(null);
    setOrdersError(null);
    return loadOrders();
  };
  const reloadQuotes = () => {
    if (!canRead) return;
    setCompletedQuotes(null);
    return loadQuotes();
  };

  const selectQuote = quote => {
    setSelectedId(quote.id);
    setEvidence('');
    setReason('');
    setEditor(null);
  };

  const mutate = async (query, variables, field) => {
    if (submitting.current || loadingQuotes || !canRead || (field === 'decideQuote' ? !canDecide : !canWrite) || (field === 'createQuote' && !canOrders)) return;
    const fingerprint = JSON.stringify({ query, variables });
    if (lastOperation.current?.fingerprint !== fingerprint) lastOperation.current = { fingerprint, operationId: crypto.randomUUID() };
    const submittedVariables = { ...variables, input: { ...variables.input, operationId: lastOperation.current.operationId } };
    submitting.current = true;
    setBusy(true);
    setMutationError(null);
    setNotice(null);
    const epoch = generation.current.value;
    try {
      const data = await run(query, submittedVariables);
      if (epoch !== generation.current.value) return;
      const quote = data[field].quote;
      setQuotes(previous => ({ ...previous, items: [quote, ...previous.items.filter(item => item.id !== quote.id).map(item => field === 'reviseQuote' && item.id === variables.id ? { ...item, status: 'superseded' } : item)] }));
      setSelectedId(quote.id);
      setEditor(null);
      setUncertain(null);
      lastOperation.current = null;
      setEvidence('');
      setReason('');
      setNotice(field === 'decideQuote' ? 'Decisión registrada. Aprobar no confirma el servicio ni asigna mecánico.' : 'Cotización guardada. Importes calculados por Finanzas.');
      await Promise.all([reloadQuotes(), reloadOrders()]);
    } catch (failure) {
      if (epoch === generation.current.value) {
        const code = failure?.extensions?.code ?? failure?.code;
        setMutationError(explain(failure));
        setStale(true);
        setEditor(null);
        setUncertain(code ? null : { query, variables, field });
      }
    } finally {
      if (epoch === generation.current.value) { submitting.current = false; setBusy(false); }
    }
  };

  const save = values => {
    if (!canWrite || !canRead || busy || stale || loadingQuotes) return;
    if (editor.quote) {
      const quote = editor.quote;
      if (quote.status !== 'pending') return;
      return mutate(REVISE, { id: quote.id, input: { expectedVersion: quote.version, ...values } }, 'reviseQuote');
    }
    if (!canOrders || loadingOrders) return;
    const order = editor.order;
    return mutate(CREATE, { input: { orderReference: order.id, orderNumber: order.number, customerReference: order.customerId, vehicleReference: order.vehicleId, vehiclePlate: order.vehiclePlate, ...values } }, 'createQuote');
  };

  const decide = decision => {
    if (!canDecide || !canRead || !pending || !evidenceValid || busy || stale || loadingQuotes || editor) return;
    return mutate(DECIDE, { id: selected.id, input: { decision, evidence: evidence.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}) } }, 'decideQuote');
  };

  const disabled = busy || loadingQuotes;
  return (
    <div data-mf="finance" style={{ padding: 16, minWidth: 0, overflowWrap: 'anywhere' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>Cotizaciones</Typography.Title>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Aprobar una cotización no confirma el servicio ni asigna mecánico. La confirmación corresponde a CU15." id="quote-scope-notice" />
      {error && <Alert type="error" showIcon title={error} id="quote-error" style={{ marginBottom: 16 }} />}
      {mutationError && <Alert type="error" showIcon title={mutationError} id="quote-mutation-error" style={{ marginBottom: 16 }} />}
      {uncertain && <Alert type="warning" title="Resultado incierto: no se asume rechazo. Reintentá el mismo envío de forma idempotente." action={<Button id="quote-retry" disabled={busy || loadingQuotes || !canRead} onClick={() => mutate(uncertain.query, uncertain.variables, uncertain.field)}>Reintentar el mismo envío</Button>} />}
      {notice && <Alert type="success" title={notice} role="status" style={{ marginBottom: 16 }} />}
      {!access && !error && <Typography.Paragraph role="status">Consultando permisos…</Typography.Paragraph>}
      {access && !canRead && <Alert type="warning" title="No tenés permiso quotes:read para consultar cotizaciones." />}
      <Card title="Órdenes disponibles" size="small" style={{ marginBottom: 16 }} extra={<Button id="orders-reload" disabled={!canOrders || busy} loading={loadingOrders} onClick={reloadOrders}>Recargar órdenes</Button>}>
        {!canOrders ? <Typography.Paragraph>Se requiere orders:read para consultar órdenes. La consulta de cotizaciones es independiente.</Typography.Paragraph> : <>
          <Space wrap style={{ marginBottom: 16 }}>
            <label htmlFor="quote-order-search">Buscar orden por número, placa o ID</label>
            <Input id="quote-order-search" value={orderSearchDraft} disabled={busy || !!uncertain} onChange={event => setOrderSearchDraft(event.target.value)} />
            <Button id="quote-order-search-submit" disabled={busy || loadingOrders || !!uncertain} onClick={() => { if (orderSearchDraft.trim() === orderSearch && orderPage === 1) reloadOrders(); else { orderRequest.current.value++; setOrderSearch(orderSearchDraft.trim()); setOrderPage(1); } setEditor(null); }}>Buscar órdenes</Button>
          </Space>
          {ordersError && !loadingOrders && <Alert type="error" title={ordersError} />}
          <Table rowKey="id" size="small" loading={loadingOrders} dataSource={orders.items} scroll={{ x: 650 }}
            pagination={{ current: orderPage, pageSize: PAGE_SIZE, total: orders.total, showSizeChanger: false, disabled: busy || !!uncertain, onChange: page => { orderRequest.current.value++; setOrderPage(page); setEditor(null); } }}
            locale={{ emptyText: <Empty description="Sin órdenes pendientes de cotización" /> }} columns={[
              { title: 'Orden', dataIndex: 'number' }, { title: 'Vehículo', dataIndex: 'vehiclePlate' }, { title: 'Cliente', dataIndex: 'customerName' },
              { title: 'Servicios', render: (_, order) => order.items.map(item => item.serviceName + ' ×' + item.quantity).join(', ') },
              { title: 'Acción', render: (_, order) => <Button data-testid={'quote-order-' + order.id} disabled={!canRead || !canWrite || busy || stale || loadingOrders || loadingQuotes || !!uncertain} onClick={() => { setEditor({ order }); setSelectedId(null); setEvidence(''); setReason(''); }}>Cotizar {order.number}</Button> },
            ]} />
          {!canWrite && <Typography.Text type="secondary">Sin permiso quotes:write: solo consulta.</Typography.Text>}
        </>}
      </Card>
      {canRead && <Card title="Cotizaciones y versiones" size="small" extra={<Button id="quotes-reload" aria-label="Recargar cotizaciones" disabled={busy} loading={loadingQuotes} onClick={() => { setEditor(null); setMutationError(null); reloadQuotes(); }}>Recargar cotizaciones</Button>}>
        <Space wrap style={{ marginBottom: 16 }}>
          <label htmlFor="quote-order-filter">ID de orden</label>
          <Input id="quote-order-filter" placeholder="Todas las órdenes" value={orderFilter} disabled={busy || !!uncertain} onChange={event => { quoteRequest.current.value++; setOrderFilter(event.target.value); setQuotePage(1); setSelectedId(null); setEditor(null); setEvidence(''); setReason(''); }} />
        </Space>
        <Table rowKey="id" size="small" loading={loadingQuotes} dataSource={quotes.items} scroll={{ x: 750 }}
          pagination={{ current: quotePage, pageSize: PAGE_SIZE, total: quotes.total, showSizeChanger: false, disabled: busy || !!uncertain, onChange: page => { quoteRequest.current.value++; setQuotePage(page); setSelectedId(null); setEditor(null); setEvidence(''); setReason(''); } }}
          locale={{ emptyText: <Empty description="Sin cotizaciones" /> }} columns={[
            { title: 'Orden', dataIndex: 'orderNumber' }, { title: 'Versión', dataIndex: 'version', render: value => 'v' + value },
            { title: 'Estado', dataIndex: 'status', render: value => <Tag>{value}</Tag> },
            { title: 'Total servidor', render: (_, quote) => money(quote.total, quote.currency) },
            { title: 'Vigencia', dataIndex: 'validUntil' },
            { title: 'Acción', render: (_, quote) => <Button data-testid={'quote-select-' + quote.id} aria-pressed={selectedId === quote.id} type={selectedId === quote.id ? 'primary' : 'default'} disabled={disabled || !!uncertain} onClick={() => selectQuote(quote)}>Ver {quote.orderNumber} v{quote.version}</Button> },
          ]} />
        {selected && <section id="quote-detail" data-quote-id={selected.id} aria-label="Cotización seleccionada" style={{ marginTop: 24 }}>
          <Typography.Title level={4}>{selected.orderNumber} · v{selected.version} · {selected.status}</Typography.Title>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="ID cotización">{selected.id}</Descriptions.Item>
            <Descriptions.Item label="ID orden">{selected.orderReference}</Descriptions.Item>
            <Descriptions.Item label="ID cliente">{selected.customerReference}</Descriptions.Item>
            <Descriptions.Item label="ID vehículo">{selected.vehicleReference}</Descriptions.Item>
            <Descriptions.Item label="Subtotal">{money(selected.subtotal, selected.currency)}</Descriptions.Item>
            <Descriptions.Item label={'Descuento (' + selected.discountPercent + ' %)'}>{money(selected.discountAmount, selected.currency)}</Descriptions.Item>
            <Descriptions.Item label={'Impuesto (' + selected.taxPercent + ' %)'}>{money(selected.taxAmount, selected.currency)}</Descriptions.Item>
            <Descriptions.Item label="Total servidor">{money(selected.total, selected.currency)}</Descriptions.Item>
            <Descriptions.Item label="Válida hasta (America/La_Paz)">{selected.validUntil}</Descriptions.Item>
            <Descriptions.Item label="Notas">{selected.notes || '—'}</Descriptions.Item>
            {selected.decision && <Descriptions.Item label="Decisión registrada">{selected.decision.decision} · {selected.decision.evidence} · {selected.decision.reason || 'Sin motivo'} · {selected.decision.decidedAt}</Descriptions.Item>}
          </Descriptions>
          <Table size="small" rowKey="serviceReference" pagination={false} scroll={{ x: 500 }} dataSource={selected.items} columns={[
            { title: 'Servicio', dataIndex: 'description' }, { title: 'Cantidad', dataIndex: 'quantity' },
            { title: 'Tarifa', render: (_, item) => money(item.unitPrice, selected.currency) },
            { title: 'Importe servidor', render: (_, item) => money(item.lineTotal, selected.currency) },
          ]} />
          {selected.status !== 'pending' && <Typography.Paragraph>Esta versión es de solo lectura. Las aprobadas son inmutables; las reemplazadas (superseded) conservan el historial.</Typography.Paragraph>}
          {selected.status === 'pending' && !pending && <Alert type="warning" title="Cotización vencida: no se puede decidir. Revisá su vigencia en una nueva versión." />}
          {canWrite && selected.status === 'pending' && <Button id="quote-revise" disabled={disabled || stale || !!uncertain} onClick={() => { setEditor({ quote: selected }); setEvidence(''); setReason(''); }}>Revisar cotización seleccionada</Button>}
          {canDecide && pending && !editor && <section aria-label="Decisión de cotización" style={{ marginTop: 16 }}>
            <Typography.Paragraph>Decisión para {selected.orderNumber} · v{selected.version} · ID {selected.id}</Typography.Paragraph>
            <label htmlFor="quote-evidence">Evidencia de autorización (obligatoria, 1–300 caracteres)</label>
            <Input.TextArea id="quote-evidence" maxLength={300} value={evidence} disabled={disabled || stale} onChange={event => setEvidence(event.target.value)} aria-describedby="quote-evidence-help" />
            <Typography.Paragraph id="quote-evidence-help" type="secondary">Registrá el mecanismo y la autorización real del cliente; no se completa automáticamente.</Typography.Paragraph>
            <label htmlFor="quote-reason">Motivo opcional</label>
            <Input.TextArea id="quote-reason" value={reason} disabled={disabled || stale} onChange={event => setReason(event.target.value)} />
            <Space wrap style={{ marginTop: 12 }}>
              <Button id="quote-approve" type="primary" disabled={disabled || stale || !!uncertain || !evidenceValid} loading={busy} onClick={() => decide('approved')}>Aprobar {selected.orderNumber} v{selected.version}</Button>
              <Button id="quote-reject" danger disabled={disabled || stale || !!uncertain || !evidenceValid} loading={busy} onClick={() => decide('rejected')}>Rechazar {selected.orderNumber} v{selected.version}</Button>
            </Space>
          </section>}
          {!canDecide && <Typography.Paragraph type="secondary">Sin permiso quotes:decide para registrar decisiones.</Typography.Paragraph>}
        </section>}
        {!selected && <Typography.Paragraph type="secondary">Seleccioná explícitamente una cotización para consultar su desglose, revisar o registrar la decisión.</Typography.Paragraph>}
      </Card>}
      {editor && canRead && canWrite && <Card size="small" style={{ marginTop: 16 }}><QuoteEditor key={editor.quote?.id ?? editor.order.id} {...editor} busy={busy || stale || loadingQuotes || (!!editor.order && loadingOrders)} onSubmit={save} onCancel={() => setEditor(null)} /></Card>}
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>Ruta del módulo: {basePath}. Operaciones definitivas online; importes y moneda proporcionados por Finanzas.</Typography.Paragraph>
    </div>
  );
}
