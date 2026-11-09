import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Empty, Form, Grid, Input, Pagination, Select, Space, Table, Typography } from 'antd';
import { PERMISSIONS, workshopDate } from './quote-api';
import { CATEGORIES, EXPENSES, METHODS, PAY, PAYMENTS, RECEIPT, RECEIVABLE, RECEIVABLES, SPEND, VERIFY, decimalAmount, ledgerCivilDate, ledgerMoney, ledgerStamp, methodName, minorAmount, policyName } from './ledger-api';
import { useLedgerCommand, useLedgerQuery, useLedgerRun } from './use-ledger';
import ExpenseDocument from './ExpenseDocument';

const SIZE = 20;
const gap = { marginBottom: 16 };
const muted = { color: 'rgba(0, 0, 0, 0.65)' };
const amountCell = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

function QueryError({ state }) {
  return state.error && !state.loading ? <Alert type="error" showIcon title={state.error} action={<Button onClick={state.reload}>Reintentar consulta</Button>} style={gap} /> : null;
}
function PendingCommand({ command, canRead, canWrite }) {
  return <>
    {command.error && <Alert type="error" showIcon title={command.error} style={gap} />}
    {command.pending && <Alert type="warning" showIcon style={gap} title={command.busy ? 'Enviando la intención…' : 'Resultado incierto: no significa rechazo. No registres otra operación.'}
      description={<><p>Intención: {command.pending.variables.input.operationId}. Se conservan el identificador y el contenido exactos mientras esta sesión permanece abierta. No cierres ni recargues la página antes de conciliar.</p>
        <Space wrap><Button disabled={command.busy || !(canRead || canWrite)} onClick={command.reconcile}>Consultar resultado</Button><Button disabled={command.busy || !canWrite} onClick={command.retry}>Reintentar el mismo envío</Button></Space></>} />}
  </>;
}
/** Bloque apilado para pantallas estrechas: la tabla ancha recortaba la acción principal en un teléfono. */
export function CompactCard({ title, meta, amounts = [], note, actions = [] }) {
  return <article style={{ border: '1px solid #d9d9d9', borderRadius: 12, padding: 12, marginBottom: 12, background: '#fff', display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <Typography.Text strong style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{title}</Typography.Text>
      {meta ? <Typography.Text style={muted}>{meta}</Typography.Text> : null}
    </div>
    {amounts.length ? <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8, margin: 0 }}>
      {amounts.map(([label, value]) => <div key={label}>
        <dt style={{ ...muted, fontSize: 12 }}>{label}</dt>
        <dd style={{ margin: 0, fontWeight: 600, ...amountCell }}>{value}</dd>
      </div>)}
    </dl> : null}
    {note ? <Typography.Paragraph style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }} ellipsis={{ rows: 2, tooltip: note }}>{note}</Typography.Paragraph> : null}
    {actions.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{actions}</div> : null}
  </article>;
}
/**
 * Una sola fuente de datos para dos presentaciones: tabla en escritorio y bloques apilados en
 * pantalla estrecha, donde ninguna acción queda fuera del área visible.
 */
function LedgerRows({ state, field, columns, rowKey, page, setPage, disabled, empty, label, renderCompact }) {
  const result = state.data?.[field];
  const screens = Grid.useBreakpoint();
  const compact = screens.md === false;
  const items = result?.items ?? [];
  const total = result?.page.total ?? 0;
  if (!compact) return <><QueryError state={state} /><Table size="small" rowKey={rowKey} loading={state.loading} scroll={{ x: 700 }} dataSource={items} columns={columns}
    locale={{ emptyText: state.error ? 'Consulta no disponible; no se presume un saldo cero.' : <Empty description={empty} /> }}
    pagination={{ current: page, pageSize: SIZE, total, showSizeChanger: false, disabled: disabled || state.loading, onChange: setPage }} /></>;
  return <>
    <QueryError state={state} />
    {state.loading && <Typography.Paragraph role="status">Consultando…</Typography.Paragraph>}
    <div role="list" aria-label={label}>
      {items.map(item => <div role="listitem" key={item[rowKey]}>{renderCompact(item)}</div>)}
    </div>
    {!state.loading && !items.length && <Typography.Paragraph style={{ ...muted, textAlign: 'center', margin: '16px 0' }}>
      {state.error ? 'Consulta no disponible; no se presume un saldo cero.' : empty}</Typography.Paragraph>}
    {total > SIZE && <Pagination simple size="small" current={page} pageSize={SIZE} total={total} disabled={disabled || state.loading}
      onChange={setPage} style={{ textAlign: 'center', marginTop: 12 }} />}
  </>;
}
/** Identificador interno: dato secundario, nunca la referencia principal de la pantalla. */
export function InternalReference({ label, value }) {
  return <details><summary style={{ ...muted, cursor: 'pointer' }}>{label}</summary><p style={{ ...muted, margin: '4px 0 0', overflowWrap: 'anywhere' }}>{value}</p></details>;
}
function Receipt({ receipt }) {
  if (!receipt) return null;
  return <section aria-label="Comprobante interno" style={{ marginTop: 24 }}>
    <Typography.Title level={4}>Comprobante interno {receipt.number}</Typography.Title>
    <Alert type="info" title="Este comprobante no es una factura fiscal. El cobro no entrega el vehículo." style={gap} />
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: 'order', label: 'Orden', children: receipt.orderNumber }, { key: 'amount', label: 'Importe recibido', children: ledgerMoney(receipt.amountMinor, receipt.currency) },
      { key: 'method', label: 'Medio de pago', children: methodName(receipt.method) }, { key: 'date', label: 'Registrado', children: ledgerStamp(receipt.recordedAt) },
      { key: 'actor', label: 'Responsable', children: <InternalReference label="Ver ID del responsable" value={receipt.employeeId} /> },
      { key: 'id', label: 'Comprobante', children: <InternalReference label="Referencia del pago" value={receipt.paymentId} /> },
    ]} />
  </section>;
}

export default function LedgerWorkspace({ session, view }) {
  const run = useLedgerRun(session);
  const permissions = useLedgerQuery(run, PERMISSIONS, {});
  const effective = permissions.data?.securityCatalog.effective ?? [];
  return <div style={{ padding: 16, minWidth: 0, overflowWrap: 'anywhere' }}>
    <Space wrap style={gap}><Typography.Title level={3} style={{ margin: 0 }}>{view === 'payments' ? 'Cobros' : 'Gastos operativos'}</Typography.Title><Button onClick={permissions.reload} loading={permissions.loading}>Actualizar permisos</Button></Space>
    <QueryError state={permissions} />
    {permissions.loading && <Typography.Paragraph role="status">Consultando permisos vigentes…</Typography.Paragraph>}
    <div hidden={view !== 'payments'}><Payments run={run} canRead={effective.includes('payments:read')} canWrite={effective.includes('payments:write')} /></div>
    <div hidden={view !== 'expenses'}><Expenses run={run} canRead={effective.includes('expenses:read')} canWrite={effective.includes('expenses:write')} /></div>
  </div>;
}

function Payments({ run, canRead, canWrite }) {
  const [page, setPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [orderId, setOrderId] = useState(null);
  const [receiptId, setReceiptId] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [verification, setVerification] = useState(null);
  const [form] = Form.useForm();
  const screens = Grid.useBreakpoint();
  const method = Form.useWatch('method', form) ?? 'cash';
  const receivables = useLedgerQuery(run, RECEIVABLES, { status, limit: SIZE, offset: (page - 1) * SIZE }, canRead);
  const payments = useLedgerQuery(run, PAYMENTS, { limit: SIZE, offset: (paymentPage - 1) * SIZE }, canRead);
  const detail = useLedgerQuery(run, RECEIVABLE, { orderId }, canRead && !!orderId);
  const savedReceipt = useLedgerQuery(run, RECEIPT, { paymentId: receiptId }, canRead && !!receiptId);
  const selected = detail.data?.receivable;
  const command = useLedgerCommand(run, (intent, result) => {
    if (intent.field === 'verifyPaymentReference') { setVerification(result.verification); return; }
    setReceipt(result.receipt); setReceiptId(null); setVerification(null); form.resetFields();
    receivables.reload(); payments.reload(); detail.reload();
  }, () => { setVerification(null); detail.reload(); });
  const blocked = command.busy || !!command.pending || !canWrite || detail.loading || !selected;
  const submit = async verify => {
    if (blocked) return;
    try {
      const values = await form.validateFields(verify ? ['amount', 'method', 'reference', 'note', 'humanVerified'] : ['amount', 'method', 'received']);
      const amountMinor = minorAmount(values.amount);
      if (verify) return command.start(VERIFY, { orderId, input: { method: values.method, amountMinor, reference: values.reference.trim(), note: values.note.trim() } }, 'verifyPaymentReference');
      if (values.method !== 'cash' && (!verification || verification.amountMinor !== amountMinor || verification.method !== values.method || verification.orderId !== orderId)) return;
      return command.start(PAY, { orderId, input: { expectedVersion: selected.balanceVersion, amountMinor, method: values.method, confirmReceived: true, ...(values.method !== 'cash' ? { referenceVerificationId: verification.id } : {}) } }, 'recordServicePayment');
    } catch (failure) { const first = failure?.errorFields?.[0]?.name; if (first) form.scrollToField(first, { focus: true }); }
  };
  if (!canRead) return <>
    <PendingCommand command={command} canRead={canRead} canWrite={canWrite} />
    <Alert type="warning" title="Se requiere payments:read para consultar cobros y saldos." />
    <Receipt receipt={receipt} />
  </>;
  const paymentColumns = [
    { title: 'Orden', dataIndex: 'orderNumber' }, { title: 'Recibido', render: (_, item) => <span style={amountCell}>{ledgerMoney(item.amountMinor, item.currency)}</span> },
    { title: 'Medio', dataIndex: 'method', render: methodName }, { title: 'Fecha', dataIndex: 'recordedAt', render: value => <span style={amountCell}>{ledgerStamp(value)}</span> },
    { title: 'Comprobante', render: (_, item) => <Button disabled={command.busy} onClick={() => { setReceipt(null); setReceiptId(item.id); }}>Ver {item.receiptNumber}</Button> },
  ];
  return <>
    <Alert type="info" showIcon title="Cobro íntegro del saldo tras finalizar el servicio. Sin abonos, anticipos ni comprobación bancaria automática. Finanzas revalida cada operación online." style={gap} />
    <PendingCommand command={command} canRead={canRead} canWrite={canWrite} />
    <Card size="small" className="ledger-card" title="Órdenes y saldos" style={gap} extra={<Button disabled={!!command.pending} onClick={() => { receivables.reload(); detail.reload(); }}>Recargar saldos</Button>}>
      <Select aria-label="Estado de cobro" value={status} disabled={!!command.pending} style={{ width: 220, marginBottom: 16 }} onChange={value => { setStatus(value); setPage(1); setOrderId(null); setVerification(null); }} options={[{ value: 'pending', label: 'Pendientes de cobro' }, { value: 'paid', label: 'Saldadas' }, { value: 'all', label: 'Todas' }]} />
      <LedgerRows state={receivables} field="receivables" rowKey="orderId" page={page} setPage={setPage} disabled={!!command.pending} label="Órdenes y saldos" empty="Sin órdenes en este estado. Podés consultar los cobros registrados debajo." columns={[
        { title: 'Orden', dataIndex: 'orderNumber' }, { title: 'Acordado', render: (_, item) => <span style={amountCell}>{ledgerMoney(item.agreedAmountMinor, item.currency)}</span> },
        { title: 'Cobrado', render: (_, item) => <span style={amountCell}>{ledgerMoney(item.paidAmountMinor, item.currency)}</span> }, { title: 'Saldo pendiente', render: (_, item) => <span style={amountCell}>{ledgerMoney(item.balanceMinor, item.currency)}</span> },
        { title: 'Detalle', render: (_, item) => <Button disabled={!!command.pending} onClick={() => { setOrderId(item.orderId); setVerification(null); form.resetFields(); }}>Ver saldo {item.orderNumber}</Button> },
      ]} renderCompact={item => <CompactCard title={item.orderNumber} meta={item.orderStatus === 'completed' ? 'Servicio finalizado' : item.orderStatus}
        amounts={[['Acordado', ledgerMoney(item.agreedAmountMinor, item.currency)], ['Cobrado', ledgerMoney(item.paidAmountMinor, item.currency)], ['Saldo pendiente', ledgerMoney(item.balanceMinor, item.currency)]]}
        actions={[<Button key="open" type={BigInt(item.balanceMinor) > 0n ? 'primary' : 'default'} style={{ flex: 1 }} disabled={!!command.pending}
          onClick={() => { setOrderId(item.orderId); setVerification(null); form.resetFields(); }}>{BigInt(item.balanceMinor) > 0n ? 'Ver saldo y cobrar' : 'Ver comprobantes'}</Button>]} />} />
    </Card>
    {orderId && <Card size="small" title="Detalle de la obligación" style={gap}>
      <QueryError state={detail} />{detail.loading && <p role="status">Consultando saldo vigente…</p>}
      {selected && <>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 3 }} items={[
          { key: 'order', label: 'Orden', children: selected.orderNumber }, { key: 'total', label: 'Importe acordado', children: <span style={amountCell}>{ledgerMoney(selected.agreedAmountMinor, selected.currency)}</span> },
          { key: 'paid', label: 'Pagos previos', children: <span style={amountCell}>{ledgerMoney(selected.paidAmountMinor, selected.currency)}</span> }, { key: 'balance', label: 'Saldo pendiente', children: <span style={amountCell}>{ledgerMoney(selected.balanceMinor, selected.currency)}</span> },
          { key: 'policy', label: 'Condición de cobro', children: policyName(selected.policyCode) },
        ]} />
        <InternalReference label="Referencia técnica del saldo" value={`Versión ${selected.balanceVersion} · ${selected.policyCode}`} />
        {selected.payments.length === 0 ? <Typography.Paragraph style={{ ...muted, margin: '12px 0' }}>Sin pagos previos registrados</Typography.Paragraph>
          : screens.md === false ? <div role="list" aria-label="Pagos previos" style={{ marginTop: 12 }}>
            {selected.payments.map(item => <div role="listitem" key={item.id}>
              <CompactCard title={item.orderNumber} meta={`${methodName(item.method)} · ${ledgerStamp(item.recordedAt)}`}
                amounts={[['Recibido', ledgerMoney(item.amountMinor, item.currency)]]}
                actions={[<Button key="receipt" style={{ flex: 1 }} disabled={command.busy} onClick={() => { setReceipt(null); setReceiptId(item.id); }}>Ver comprobante</Button>]} />
            </div>)}
          </div>
            : <Table size="small" rowKey="id" dataSource={selected.payments} columns={paymentColumns} pagination={false} scroll={{ x: 650 }} />}
        {!canWrite ? <p>Solo consulta: se requiere payments:write para registrar cobros.</p> : BigInt(selected.balanceMinor) <= 0n ? <Alert type="success" title="Esta orden no tiene saldo pendiente." /> :
          <Form name="ledger-payment" form={form} layout="vertical" scrollToFirstError={{ focus: true }} onFinish={() => submit(false)} initialValues={{ method: 'cash' }} disabled={blocked} onValuesChange={changed => { if (Object.keys(changed).some(key => ['amount', 'method', 'reference', 'note', 'humanVerified'].includes(key))) setVerification(null); }} style={{ marginTop: 16, maxWidth: 700 }}>
            <Form.Item name="amount" label={`Importe recibido (${selected.currency}, saldo ${decimalAmount(selected.balanceMinor)})`} rules={[{ required: true, message: 'Ingresá el importe recibido.' }, { validator: (_, value) => { try { const parsed = minorAmount(value ?? ''); if (selected.policyCode === 'FULL_AFTER_COMPLETION_V1' && parsed !== selected.balanceMinor) throw new Error('En esta etapa sólo podés registrar el saldo íntegro: ' + ledgerMoney(selected.balanceMinor, selected.currency) + '.'); return Promise.resolve(); } catch (error) { return Promise.reject(error); } } }]}><Input inputMode="decimal" placeholder="0,00" /></Form.Item>
            <Form.Item name="method" label="Medio de pago" rules={[{ required: true }]}><Select options={METHODS} /></Form.Item>
            {method !== 'cash' && <>
              <Alert type="warning" title="Comprobación humana: revisá la recepción real en el medio correspondiente. El sistema no consulta al banco." style={gap} />
              <Form.Item name="reference" label="Referencia comprobada" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_/-]{3,120}$/, message: 'Usá 3–120 letras, números, guiones, barras o guion bajo.' }]}><Input maxLength={120} /></Form.Item>
              <Form.Item name="note" label="Cómo comprobaste la recepción" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={1600} /></Form.Item>
              <Form.Item name="humanVerified" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error('Confirmá la comprobación humana.')) }]}><Checkbox>Comprobé personalmente la referencia y el importe recibido.</Checkbox></Form.Item>
              <Button disabled={blocked} onClick={() => submit(true)}>Registrar comprobación humana</Button>
              {verification && <Alert type="success" title={`Comprobación registrada: ${verification.reference} · ${verification.verifiedAt}`} style={{ marginTop: 12 }} />}
            </>}
            <Form.Item name="received" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error('Confirmá la recepción efectiva.')) }]} style={{ marginTop: 16 }}><Checkbox>Confirmo que recibí el pago y quiero registrar el cobro de esta orden.</Checkbox></Form.Item>
            <Button type="primary" disabled={blocked || (method !== 'cash' && !verification)} htmlType="submit">Confirmar recepción y registrar cobro</Button>
          </Form>}
      </>}
    </Card>}
    <Card size="small" className="ledger-card" title="Cobros registrados" extra={<Button onClick={payments.reload}>Recargar cobros</Button>}>
      {payments.data && <p>Total recibido (todos los registros): <strong style={amountCell}>{ledgerMoney(payments.data.servicePayments.totalAmountMinor)}</strong></p>}
      <LedgerRows state={payments} field="servicePayments" rowKey="id" page={paymentPage} setPage={setPaymentPage} label="Cobros registrados" empty="Todavía no se registraron cobros. Seleccioná una orden con saldo válido." columns={paymentColumns}
        renderCompact={item => <CompactCard title={item.orderNumber} meta={`${methodName(item.method)} · ${ledgerStamp(item.recordedAt)}`}
          amounts={[['Recibido', ledgerMoney(item.amountMinor, item.currency)]]}
          actions={[<Button key="receipt" style={{ flex: 1 }} disabled={command.busy} onClick={() => { setReceipt(null); setReceiptId(item.id); }}>Ver comprobante</Button>]} />} />
      <QueryError state={savedReceipt} /><Receipt receipt={receipt ?? savedReceipt.data?.paymentReceipt} />
    </Card>
  </>;
}

function Expenses({ run, canRead, canWrite }) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(false);
  const [document, setDocument] = useState(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [candidate, setCandidate] = useState(null);
  const [duplicateBody, setDuplicateBody] = useState(null);
  const [recorded, setRecorded] = useState(null);
  const [form] = Form.useForm();
  const [filterForm] = Form.useForm();
  const categories = useLedgerQuery(run, CATEGORIES, {}, canRead);
  const expenses = useLedgerQuery(run, EXPENSES, { ...filters, limit: SIZE, offset: (page - 1) * SIZE }, canRead);
  const command = useLedgerCommand(run, (_, result) => { setRecorded(result.expense); setEditing(false); setCandidate(null); setDuplicateBody(null); setDocument(null); form.resetFields(); expenses.reload(); }, (intent, result) => {
    if (result.code === 'EXPENSE_POSSIBLE_DUPLICATE' && result.candidate) { setCandidate(result.candidate); setDuplicateBody(intent.variables.input); form.setFieldValue('confirmed', false); }
  });
  const blocked = command.busy || !!command.pending || documentBusy || !canWrite;
  const submit = async () => {
    if (blocked) return;
    try {
      const values = await form.validateFields();
      const input = candidate ? { ...duplicateBody, duplicateOf: candidate.id, duplicateReason: values.duplicateReason.trim() } : {
        description: values.description.trim(), categoryId: values.categoryId, expenseDate: values.expenseDate, amountMinor: minorAmount(values.amount), method: values.method, ...(document ? { documentId: document.id } : {}),
      };
      delete input.operationId;
      return command.start(SPEND, { input }, 'recordOperatingExpense');
    } catch { /* Form fields expose validation errors. */ }
  };
  if (!canRead) return <>
    <PendingCommand command={command} canRead={canRead} canWrite={canWrite} />
    <Alert type="warning" title="Se requiere expenses:read para consultar gastos y categorías." />
    {recorded && <Alert type="success" showIcon title={`Gasto registrado: ${recorded.description} · ${ledgerMoney(recorded.amountMinor, recorded.currency)} · ID ${recorded.id}`} style={gap} />}
  </>;
  return <>
    <Alert type="info" showIcon title="Gastos operativos del taller. El responsable y la fecha de registro se determinan en el servidor. No se elimina ni reemplaza el historial." style={gap} />
    <PendingCommand command={command} canRead={canRead} canWrite={canWrite} />
    {recorded && <Alert type="success" showIcon title={`Gasto registrado: ${recorded.description} · ${ledgerMoney(recorded.amountMinor, recorded.currency)} · ID ${recorded.id}`} style={gap} />}
    <Card className="ledger-card" title="Gastos registrados" size="small" style={gap} extra={<Button type="primary" disabled={blocked || editing} onClick={() => { setEditing(true); setCandidate(null); setDuplicateBody(null); }}>Registrar gasto</Button>}>
      {!canWrite && <p>Solo consulta: se requiere expenses:write para registrar gastos.</p>}
      <Form name="ledger-expense-filters" form={filterForm} layout="inline" onFinish={values => { setFilters(Object.fromEntries(Object.entries(values).filter(([, value]) => value))); setPage(1); }} style={{ gap: 12, marginBottom: 16 }}>
        <Form.Item name="from" label="Desde"><Input type="date" /></Form.Item><Form.Item name="to" label="Hasta"><Input type="date" /></Form.Item>
        <Form.Item name="categoryId" label="Categoría"><Select allowClear placeholder="Todas las categorías" options={(categories.data?.expenseCategories ?? []).map(item => ({ value: item.id, label: item.name }))} style={{ minWidth: 180 }} /></Form.Item>
        <Space wrap><Button htmlType="submit">Filtrar gastos</Button><Button onClick={expenses.reload}>Recargar gastos</Button></Space>
      </Form>
      {expenses.data && <p>Total del período calculado por Finanzas: <strong style={amountCell}>{ledgerMoney(expenses.data.operatingExpenses.totalAmountMinor)}</strong></p>}
      <LedgerRows state={expenses} field="operatingExpenses" rowKey="id" page={page} setPage={setPage} label="Gastos registrados" empty="No hay gastos para estos filtros. Registrá un gasto autorizado o cambiá el período." columns={[
        { title: 'Descripción', dataIndex: 'description', render: value => <Typography.Text style={{ overflowWrap: 'anywhere' }} ellipsis={{ tooltip: value }}>{value}</Typography.Text> },
        { title: 'Categoría', render: (_, item) => item.category.name },
        { title: 'Fecha', dataIndex: 'expenseDate', render: value => <span style={amountCell}>{ledgerCivilDate(value)}</span> },
        { title: 'Importe', render: (_, item) => <span style={amountCell}>{ledgerMoney(item.amountMinor, item.currency)}</span> }, { title: 'Medio', dataIndex: 'method', render: methodName },
        { title: 'Responsable', render: (_, item) => <InternalReference label="Ver ID del responsable" value={item.employeeId} /> },
        { title: 'Respaldo', render: (_, item) => item.document ? <ExpenseDocument run={run} document={item.document} readOnly /> : <Typography.Text style={muted}>Sin respaldo adjunto</Typography.Text> },
      ]} renderCompact={item => <CompactCard title={item.description} meta={`${item.category.name} · ${ledgerCivilDate(item.expenseDate)} · ${methodName(item.method)}`}
        amounts={[['Importe registrado', ledgerMoney(item.amountMinor, item.currency)]]}
        actions={[...(item.document
          ? [<ExpenseDocument key="document" run={run} document={item.document} readOnly />]
          : [<Typography.Text key="none" style={muted}>Sin respaldo adjunto</Typography.Text>]),
          <InternalReference key="employee" label="Ver ID del responsable" value={item.employeeId} />]} />} />
    </Card>
    {editing && <Card size="small" title="Nuevo gasto operativo">
      <QueryError state={categories} />
      <Form name="ledger-expense" form={form} layout="vertical" scrollToFirstError={{ focus: true }} initialValues={{ method: 'cash', expenseDate: workshopDate() }} disabled={blocked} onFinish={submit} style={{ maxWidth: 700 }}>
        <Form.Item name="description" label="Descripción" rules={[{ required: true, whitespace: true, min: 3, max: 1600 }]}><Input.TextArea maxLength={1600} disabled={blocked || !!candidate} /></Form.Item>
        <Form.Item name="categoryId" label="Categoría" rules={[{ required: true, message: 'Seleccioná una categoría vigente.' }]}><Select disabled={blocked || !!candidate} loading={categories.loading} options={(categories.data?.expenseCategories ?? []).filter(item => item.active).map(item => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="expenseDate" label="Fecha del gasto (America/La_Paz)" rules={[{ required: true }, { validator: (_, value) => value && value <= workshopDate() ? Promise.resolve() : Promise.reject(new Error('La fecha no puede ser futura.')) }]}><Input type="date" max={workshopDate()} disabled={blocked || !!candidate} /></Form.Item>
        <Form.Item name="amount" label="Importe (BOB)" rules={[{ required: true }, { validator: (_, value) => { try { minorAmount(value ?? ''); return Promise.resolve(); } catch (error) { return Promise.reject(error); } } }]}><Input inputMode="decimal" placeholder="0,00" disabled={blocked || !!candidate} /></Form.Item>
        <Form.Item name="method" label="Medio de pago" rules={[{ required: true }]}><Select options={METHODS} disabled={blocked || !!candidate} /></Form.Item>
        <ExpenseDocument run={run} document={document} onDocument={setDocument} onBusy={setDocumentBusy} disabled={command.busy || !!command.pending || !canWrite || !!candidate} />
        {candidate && <>
          <Alert type="warning" title="Posible gasto duplicado: la intención anterior fue rechazada." description={`${candidate.description} · ${candidate.expenseDate} · ${ledgerMoney(candidate.amountMinor, candidate.currency)} · ID ${candidate.id}. Solo continuá si es un gasto distinto real; se creará una intención nueva sin reemplazar el original.`} style={gap} />
          <Form.Item name="duplicateReason" label="Por qué es otro gasto legítimo" rules={[{ required: true, whitespace: true, min: 10, max: 500 }]}><Input.TextArea maxLength={500} /></Form.Item>
        </>}
        <Form.Item name="confirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error('Confirmá el registro del gasto.')) }]}><Checkbox>Revisé los datos y confirmo {candidate ? 'una nueva intención para otro gasto legítimo' : 'el registro de este gasto'}.</Checkbox></Form.Item>
        <Space wrap><Button type="primary" htmlType="submit" disabled={blocked || categories.loading || !!categories.error}>{candidate ? 'Confirmar otro gasto con nueva intención' : 'Confirmar y registrar gasto'}</Button>
          <Button disabled={blocked} onClick={() => { setEditing(false); setCandidate(null); setDuplicateBody(null); form.resetFields(); setDocument(null); }}>Cancelar</Button></Space>
      </Form>
    </Card>}
  </>;
}
