import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, InputNumber, Input, Select, Space, Table, Tag, Typography, message } from 'antd';

const { Title, Text } = Typography;

const ORDERS = `query Orders($limit: Int, $status: WorkOrderStatus) {
  orders(limit: $limit, status: $status) {
    items { id number vehiclePlate customerName description priority status createdAt items { serviceId serviceName quantity referenceRate } }
  }
}`;
const QUOTES = `query Quotes($orderReference: String) {
  quotes(orderReference: $orderReference) {
    items { id orderReference orderNumber vehiclePlate version status subtotal discountAmount taxAmount total validUntil
      decision { decision evidence decidedAt } items { serviceReference description quantity unitPrice lineTotal } }
  }
}`;
const CREATE_QUOTE = `mutation CreateQuote($input: CreateQuoteInput!) {
  createQuote(input: $input) { quote { id version status total } orderStatusHint }
}`;
const DECIDE_QUOTE = `mutation DecideQuote($id: UUID!, $input: DecideQuoteInput!) {
  decideQuote(id: $id, input: $input) { quote { id status } orderStatusHint }
}`;

const FAILURES = {
  FORBIDDEN: 'No tenés permiso para esta operación.',
  QUOTE_NOT_PENDING: 'La cotización ya no está pendiente.',
  QUOTE_APPROVED_IMMUTABLE: 'La cotización aprobada no se puede modificar.',
  QUOTE_ALREADY_DECIDED: 'La cotización ya fue decidida.',
  QUOTE_EXPIRED: 'La cotización está vencida.',
  DISCOUNT_NOT_AUTHORIZED: 'El descuento supera el máximo autorizado (20 %).',
  QUOTE_TOTAL_MISMATCH: 'El total enviado no coincide con el calculado por Finanzas.',
  VALIDATION_ERROR: 'Revisá los datos ingresados.',
};

const explain = (error) => FAILURES[error?.code] ?? error?.message ?? 'No se pudo completar la operación.';
const money = (value) => Number(value ?? 0).toFixed(2);
const localDate = (value) => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

export default function IntegratedApp({ session, basePath }) {
  const [orders, setOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [evidence, setEvidence] = useState('');

  const run = useCallback(async (query, variables) => {
    if (!session) throw { code: 'NO_SESSION_PORT', message: 'Esta vista requiere la sesión del Shell.' };
    const result = await session.requestBusiness(query, variables);
    if (result.errors?.length) throw result.errors[0];
    return result.data;
  }, [session]);

  const loadOrders = useCallback(async () => {
    setError(null);
    try {
      const data = await run(ORDERS, { limit: 50, status: 'pending_quote' });
      setOrders(data.orders.items);
    } catch (failure) {
      setError(explain(failure));
    }
  }, [run]);

  const loadQuotes = useCallback(async (orderReference) => {
    try {
      const data = await run(QUOTES, orderReference ? { orderReference } : {});
      setQuotes(data.quotes.items);
    } catch (failure) {
      setError(explain(failure));
    }
  }, [run]);

  useEffect(() => {
    loadOrders();
    loadQuotes();
  }, [loadOrders, loadQuotes]);

  const createQuote = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await run(CREATE_QUOTE, {
        input: {
          operationId: crypto.randomUUID(),
          orderReference: selected.id,
          orderNumber: selected.number,
          customerReference: selected.customerName ?? selected.id,
          vehicleReference: selected.vehiclePlate,
          vehiclePlate: selected.vehiclePlate,
          discountPercent: Number(discount ?? 0),
          taxPercent: 13,
          validUntil: localDate(),
          items: selected.items.map(item => ({
            serviceReference: item.serviceId,
            description: item.serviceName,
            quantity: item.quantity,
            unitPrice: Number(item.referenceRate),
          })),
        },
      });
      message.success('Cotización creada; el total lo calculó Finanzas.');
      await loadQuotes(selected.id);
    } catch (failure) {
      setError(explain(failure));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (quote, decision) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run(DECIDE_QUOTE, {
        id: quote.id,
        input: { operationId: crypto.randomUUID(), decision, evidence: evidence || 'Registro presencial' },
      });
      message.success(decision === 'approved' ? 'Decisión registrada: aprobada. El servicio no está confirmado.' : 'Decisión registrada: rechazada.');
      setEvidence('');
      await loadQuotes(quote.orderReference);
      await loadOrders();
    } catch (failure) {
      setError(explain(failure));
    } finally {
      setBusy(false);
    }
  };

  const orderColumns = useMemo(() => [
    { title: 'Orden', dataIndex: 'number', key: 'number', render: (value) => <strong>{value}</strong> },
    { title: 'Vehículo', dataIndex: 'vehiclePlate' },
    { title: 'Cliente', dataIndex: 'customerName' },
    { title: 'Prioridad', dataIndex: 'priority', render: (value) => <Tag color={value === 'urgente' ? 'red' : value === 'alta' ? 'orange' : 'blue'}>{value}</Tag> },
    { title: 'Servicios', dataIndex: 'items', render: (items) => items.map(item => `${item.serviceName} ×${item.quantity}`).join(', ') },
    { title: 'Estado', dataIndex: 'status', render: () => <Tag>Pendiente de cotización</Tag> },
    { title: '', key: 'action', render: (_, row) => <Button size="small" type={selected?.id === row.id ? 'primary' : 'default'} onClick={() => { setSelected(row); loadQuotes(row.id); }}>Cotizar</Button> },
  ], [selected, loadQuotes]);

  const quoteColumns = [
    { title: 'Orden', dataIndex: 'orderNumber' },
    { title: 'Versión', dataIndex: 'version', render: (value) => `v${value}` },
    { title: 'Estado', dataIndex: 'status', render: (value) => <Tag color={value === 'approved' ? 'green' : value === 'rejected' ? 'red' : value === 'superseded' ? 'default' : 'blue'}>{value}</Tag> },
    { title: 'Subtotal', dataIndex: 'subtotal', render: money },
    { title: 'IVA', dataIndex: 'taxAmount', render: money },
    { title: 'Total', dataIndex: 'total', render: (value) => <strong>{money(value)}</strong> },
    { title: 'Decisión', dataIndex: 'decision', render: (decision) => decision ? `${decision.decision} · ${decision.evidence}` : '—' },
  ];

  return (
    <div data-mf="finance" style={{ padding: 16 }}>
      <Title level={4} style={{ marginTop: 0 }}>Cotizaciones</Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Aprobar una cotización no confirma el servicio ni asigna mecánico. La confirmación corresponde a la Saga de la orden."
        id="quote-scope-notice"
      />
      {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} id="quote-error" />}

      <Card title="Órdenes pendientes de cotización" size="small" style={{ marginBottom: 16 }}>
        <Table rowKey="id" size="small" dataSource={orders} columns={orderColumns} pagination={false}
          locale={{ emptyText: <Empty description="Sin órdenes pendientes" /> }} />
        {selected && (
          <Space style={{ marginTop: 12 }} align="end">
            <span>Descuento % <InputNumber id="quote-discount" min={0} max={20} value={discount} onChange={(value) => setDiscount(value ?? 0)} /></span>
            <Button type="primary" id="quote-create" loading={busy} onClick={createQuote}>Crear cotización de {selected.number}</Button>
          </Space>
        )}
      </Card>

      <Card title="Cotizaciones" size="small">
        <Table rowKey="id" size="small" dataSource={quotes} columns={quoteColumns} pagination={false}
          expandable={{
            expandedRowRender: (quote) => (
              <Descriptions size="small" column={1} bordered>
                {quote.items.map(item => (
                  <Descriptions.Item key={item.serviceReference} label={item.description}>
                    {item.quantity} × {money(item.unitPrice)} = {money(item.lineTotal)}
                  </Descriptions.Item>
                ))}
                <Descriptions.Item label="Válida hasta">{quote.validUntil}</Descriptions.Item>
              </Descriptions>
            ),
          }}
          locale={{ emptyText: <Empty description="Sin cotizaciones" /> }} />
        {quotes.some(quote => quote.status === 'pending') && (
          <Space style={{ marginTop: 12 }} align="end">
            <Input id="quote-evidence" placeholder="Evidencia de la decisión" value={evidence} onChange={(event) => setEvidence(event.target.value)} style={{ width: 260 }} />
            {quotes.filter(quote => quote.status === 'pending').slice(0, 1).map(quote => (
              <Space key={quote.id}>
                <Button id="quote-approve" type="primary" loading={busy} onClick={() => decide(quote, 'approved')}>Aprobar v{quote.version}</Button>
                <Button id="quote-reject" danger loading={busy} onClick={() => decide(quote, 'rejected')}>Rechazar v{quote.version}</Button>
              </Space>
            ))}
          </Space>
        )}
      </Card>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        Ruta del módulo: {basePath}. Los importes definitivos los calcula Finanzas.
      </Text>
    </div>
  );
}
