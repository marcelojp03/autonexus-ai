export const PAYMENT_FIELDS = 'id orderId orderNumber amountMinor currency method receiptNumber recordedAt employeeId';
export const RECEIVABLE_FIELDS = `orderId orderNumber orderStatus agreedAmountMinor paidAmountMinor balanceMinor currency balanceVersion policyCode observedAt payments { ${PAYMENT_FIELDS} }`;
export const RECEIPT_FIELDS = 'id number paymentId orderId orderNumber amountMinor currency method recordedAt employeeId actorSubject fiscalStatus';
export const DOCUMENT_FIELDS = 'id fileName contentType sizeBytes sha256 state createdAt';
export const EXPENSE_FIELDS = `id description category { id name code active } expenseDate amountMinor currency method duplicateOf duplicateReason recordedAt employeeId document { ${DOCUMENT_FIELDS} }`;
export const RECEIVABLES = `query Receivables($status: String, $limit: Int, $offset: Int) { receivables(status: $status, limit: $limit, offset: $offset) { items { ${RECEIVABLE_FIELDS} } page { total limit offset } } }`;
export const RECEIVABLE = `query Receivable($orderId: UUID!) { receivable(orderId: $orderId) { ${RECEIVABLE_FIELDS} } }`;
export const PAYMENTS = `query ServicePayments($from: Date, $to: Date, $limit: Int, $offset: Int) { servicePayments(from: $from, to: $to, limit: $limit, offset: $offset) { items { ${PAYMENT_FIELDS} } page { total limit offset } totalAmountMinor } }`;
export const RECEIPT = `query PaymentReceipt($paymentId: UUID!) { paymentReceipt(paymentId: $paymentId) { ${RECEIPT_FIELDS} } }`;
export const CATEGORIES = 'query ExpenseCategories { expenseCategories { id code name active } }';
export const EXPENSES = `query OperatingExpenses($from: Date, $to: Date, $categoryId: UUID, $limit: Int, $offset: Int) { operatingExpenses(from: $from, to: $to, categoryId: $categoryId, limit: $limit, offset: $offset) { items { ${EXPENSE_FIELDS} } page { total limit offset } totalAmountMinor } }`;
export const VERIFY = 'mutation VerifyPaymentReference($orderId: UUID!, $input: VerifyPaymentReferenceInput!) { verifyPaymentReference(orderId: $orderId, input: $input) { verification { id orderId amountMinor method reference note verifiedAt verifierSubject } replayed } }';
export const PAY = `mutation RecordServicePayment($orderId: UUID!, $input: RecordServicePaymentInput!) { recordServicePayment(orderId: $orderId, input: $input) { payment { ${PAYMENT_FIELDS} } receivable { ${RECEIVABLE_FIELDS} } receipt { ${RECEIPT_FIELDS} } replayed } }`;
export const SPEND = `mutation RecordOperatingExpense($input: RecordOperatingExpenseInput!) { recordOperatingExpense(input: $input) { expense { ${EXPENSE_FIELDS} } replayed } }`;
export const OPERATION = 'query FinancialOperation($operationId: UUID!) { financialOperation(operationId: $operationId) { operationId action outcome status committedAt resultJson errorCode } }';
export const REQUEST_DOCUMENT = `mutation RequestExpenseDocument($input: RequestExpenseDocumentInput!) { requestExpenseDocument(input: $input) { document { ${DOCUMENT_FIELDS} } upload { url method expiresAt headersJson } replayed } }`;
export const CONFIRM_DOCUMENT = `mutation ConfirmExpenseDocument($input: ConfirmExpenseDocumentInput!) { confirmExpenseDocument(input: $input) { ${DOCUMENT_FIELDS} } }`;
export const DOWNLOAD_DOCUMENT = 'query ExpenseDocumentDownload($documentId: UUID!) { expenseDocumentDownload(documentId: $documentId) { url method expiresAt headersJson } }';

export function minorAmount(value) {
  if (!/^\d{1,10}(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Ingresá un importe positivo con hasta dos decimales, sin separadores de miles.');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount <= 0n || amount > 999999999999n) throw new Error('El importe debe ser mayor a cero y no superar 9999999999,99.');
  return amount.toString();
}
export function decimalAmount(minor) {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export const ledgerMoney = (minor, currency = 'BOB') => `${currency} ${decimalAmount(minor)}`;
export const METHODS = [{ value: 'cash', label: 'Efectivo' }, { value: 'bank_transfer', label: 'Transferencia bancaria' }, { value: 'qr', label: 'QR' }];
export const methodName = value => METHODS.find(item => item.value === value)?.label ?? value;
export const errorCode = error => error?.extensions?.code ?? error?.code;
export const ledgerError = error => {
  const code = errorCode(error);
  return `${code ? code + ': ' : ''}${error?.message ?? 'No se pudo consultar Finanzas. Reintentá la consulta.'}`;
};
