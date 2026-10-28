import { useState } from 'react';
import { Button, Input, InputNumber, Space, Table, Typography } from 'antd';
import { workshopDate } from './quote-api';

export default function QuoteEditor({ order, quote, busy, onSubmit, onCancel }) {
  const [items, setItems] = useState(() => quote
    ? quote.items.map(({ serviceReference, description, quantity, unitPrice }) => ({ serviceReference, description, quantity, unitPrice }))
    : order.items.map(item => ({ serviceReference: item.serviceId, description: item.serviceName, quantity: item.quantity, unitPrice: Number(item.referenceRate) })));
  const [discount, setDiscount] = useState(quote?.discountPercent ?? 0);
  const [validUntil, setValidUntil] = useState(() => quote?.validUntil ?? workshopDate(new Date(), 7));
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(validUntil) && validUntil >= workshopDate()
    && discount !== null && discount >= 0 && discount <= 20 && items.length > 0
    && items.every(item => Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99
      && item.unitPrice !== null && Number.isFinite(item.unitPrice) && item.unitPrice >= 0);
  const update = (index, field, value) => setItems(previous => previous.map((item, i) => i === index ? { ...item, [field]: value } : item));
  return (
    <section aria-label={quote ? 'Revisión de cotización' : 'Nueva cotización'}>
      <Typography.Title level={5}>{quote ? 'Revisar ' + quote.orderNumber + ' · v' + quote.version : 'Cotizar ' + order.number}</Typography.Title>
      <Typography.Paragraph type="secondary">Cantidades y tarifas propuestas. El servidor calcula los importes y aplica la configuración fiscal; no se envían totales ni una tasa fija.</Typography.Paragraph>
      <Table rowKey="serviceReference" size="small" pagination={false} scroll={{ x: 480 }} dataSource={items} columns={[
        { title: 'Servicio', dataIndex: 'description' },
        { title: 'Cantidad', render: (_, item, index) => <InputNumber aria-label={'Cantidad ' + item.description} min={1} max={99} precision={0} disabled={busy} value={item.quantity} onChange={value => update(index, 'quantity', value)} /> },
        { title: 'Tarifa unitaria', render: (_, item, index) => <InputNumber aria-label={'Tarifa ' + item.description} min={0} precision={2} disabled={busy} value={item.unitPrice} onChange={value => update(index, 'unitPrice', value)} /> },
      ]} />
      <Space wrap align="end" style={{ marginTop: 16 }}>
        <label htmlFor="quote-discount">Descuento %<br /><InputNumber id="quote-discount" min={0} max={20} value={discount} disabled={busy} onChange={setDiscount} /></label>
        <label htmlFor="quote-valid-until">Válida hasta (America/La_Paz)<br /><Input id="quote-valid-until" type="date" min={workshopDate()} value={validUntil} disabled={busy} onChange={event => setValidUntil(event.target.value)} /></label>
      </Space>
      <label htmlFor="quote-notes" style={{ display: 'block', marginTop: 16 }}>Notas opcionales</label>
      <Input.TextArea id="quote-notes" maxLength={1000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} />
      {!valid && <Typography.Paragraph type="danger" role="alert">Ingresá una vigencia desde hoy en el calendario del taller, descuento de 0 a 20 %, cantidades de 1 a 99 y tarifas no negativas.</Typography.Paragraph>}
      <Space wrap style={{ marginTop: 16 }}>
        <Button id={quote ? 'quote-revise-submit' : 'quote-create'} type="primary" loading={busy} disabled={!valid || busy} onClick={() => valid && onSubmit({ items, discountPercent: discount, validUntil, notes: notes.trim() || null })}>
          {quote ? 'Guardar nueva versión' : 'Crear cotización de ' + order.number}
        </Button>
        <Button disabled={busy} onClick={onCancel}>Cancelar edición</Button>
      </Space>
    </section>
  );
}
