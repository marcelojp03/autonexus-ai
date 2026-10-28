export const PERMISSIONS = 'query SecurityPermissions { securityCatalog { effective } }';
export const ORDERS = `query Orders($limit: Int, $offset: Int) {
  orders(limit: $limit, offset: $offset, status: pending_quote) {
    total items { id number customerId customerName vehicleId vehiclePlate priority
      items { serviceId serviceName quantity referenceRate } }
  }
}`;
const FIELDS = `id orderReference orderNumber customerReference vehicleReference vehiclePlate
  version status subtotal discountPercent discountAmount taxPercent taxAmount total currency notes validUntil
  decision { decision evidence reason decidedAt }
  items { serviceReference description quantity unitPrice lineTotal }`;
export const QUOTES = 'query Quotes($limit: Int, $offset: Int, $orderReference: String) { quotes(limit: $limit, offset: $offset, orderReference: $orderReference) { total items { ' + FIELDS + ' } } }';
export const CREATE = 'mutation CreateQuote($input: CreateQuoteInput!) { createQuote(input: $input) { quote { ' + FIELDS + ' } } }';
export const REVISE = 'mutation ReviseQuote($id: UUID!, $input: ReviseQuoteInput!) { reviseQuote(id: $id, input: $input) { quote { ' + FIELDS + ' } } }';
export const DECIDE = 'mutation DecideQuote($id: UUID!, $input: DecideQuoteInput!) { decideQuote(id: $id, input: $input) { quote { ' + FIELDS + ' } } }';

export function workshopDate(date = new Date(), days = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type).value;
  const calendar = new Date(value('year') + '-' + value('month') + '-' + value('day') + 'T12:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return calendar.toISOString().slice(0, 10);
}

const FAILURES = {
  FORBIDDEN: 'No tenés permiso para esta operación.',
  VERSION_CONFLICT: 'La versión cambió. Recargá las cotizaciones y revisá los datos antes de reintentar.',
  QUOTE_NOT_PENDING: 'La cotización ya no está pendiente. Recargá las cotizaciones.',
  QUOTE_APPROVED_IMMUTABLE: 'La cotización aprobada es inmutable.',
  QUOTE_ALREADY_DECIDED: 'La cotización ya fue decidida. Recargá las cotizaciones.',
  QUOTE_EXPIRED: 'La cotización está vencida.',
  DISCOUNT_NOT_AUTHORIZED: 'El descuento supera el máximo autorizado.',
  VALIDATION_ERROR: 'Revisá las fechas, cantidades e importes ingresados.',
};
export const explain = error => FAILURES[error?.extensions?.code ?? error?.code] ?? error?.message ?? 'No se pudo completar la operación. Intentá recargar.';
export const money = (value, currency) => currency + ' ' + Number(value).toFixed(2);
