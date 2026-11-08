import { BusinessError } from './business-error.js';

export const LEDGER_PERMISSIONS = Object.freeze({
  receivables: 'payments:read', receivable: 'payments:read', servicePayments: 'payments:read',
  paymentReceipt: 'payments:read', verifyPaymentReference: 'payments:write', recordServicePayment: 'payments:write',
  expenseCategories: 'expenses:read', operatingExpenses: 'expenses:read', operatingExpense: 'expenses:read',
  recordOperatingExpense: 'expenses:write', requestExpenseDocument: 'expenses:write', confirmExpenseDocument: 'expenses:write',
  expenseDocumentDownload: 'expenses:read', financialSummary: ['payments:read', 'expenses:read'],
  // The owner checks the module and original actor, including write-only reconciliation.
  financialOperation: null,
} as const);
export interface LedgerArgs { [key: string]: unknown; input?: Record<string, unknown>; }
type Projection = (value: unknown) => unknown;
const unavailable = (): never => { throw new BusinessError(503, 'SERVICE_UNAVAILABLE'); };
const invalid = (): never => { throw new BusinessError(400, 'VALIDATION_ERROR'); };
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : unavailable();
const text: Projection = v => typeof v === 'string' ? v : unavailable();
const integer: Projection = v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647 ? v : unavailable();
const boolean: Projection = v => typeof v === 'boolean' ? v : unavailable();
const money: Projection = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) ? v : unavailable();
const signedMoney: Projection = v => typeof v === 'string' && /^(0|-?[1-9][0-9]*)$/.test(v) ? v : unavailable();
const nullable = (project: Projection): Projection => v => v === null ? null : project(v);
const list = (project: Projection): Projection => v => Array.isArray(v) ? v.map(project) : unavailable();
function shape(fields: Record<string, Projection>): Projection {
  return value => { const item = record(value); return Object.fromEntries(Object.entries(fields).map(([key, project]) => [key, project(item[key])])); };
}
function strings(names: string): Record<string, Projection> { return Object.fromEntries(names.split(' ').map(key => [key, text])); }
const page = shape({ total: integer, limit: integer, offset: integer });
const payment = shape({ ...strings('id orderId orderNumber obligationId currency method receiptId receiptNumber recordedAt actorSubject employeeId'), amountMinor: money, referenceVerificationId: nullable(text) });
const receivable = shape({ ...strings('orderId orderNumber orderStatus sagaId quoteId quoteLinkId currency policyCode observedAt'), orderVersion: integer, quoteVersion: integer, balanceVersion: integer,
  agreedAmountMinor: money, paidAmountMinor: money, balanceMinor: money, payments: list(payment) });
const receipt = shape({ ...strings('id number paymentId orderId orderNumber currency method recordedAt actorSubject employeeId fiscalStatus'), amountMinor: money, referenceVerificationId: nullable(text) });
const verification = shape({ ...strings('id orderId method reference status verifiedAt verifierSubject employeeId note'), amountMinor: money });
const category = shape({ ...strings('id code name'), active: boolean });
const document = shape({ ...strings('id fileName contentType sha256 state createdAt'), sizeBytes: integer, expenseId: nullable(text) });
function fileTarget(method: 'PUT' | 'GET'): Projection {
  return value => {
    const target = record(shape(strings('url method expiresAt headersJson'))(value));
    if (target.method !== method || typeof target.url !== 'string'
      || !new RegExp('^/finance-files/documents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/content$', 'i').test(target.url)
      || !Number.isFinite(Date.parse(String(target.expiresAt)))) return unavailable();
    let headers: Record<string, unknown>;
    try { headers = record(JSON.parse(String(target.headersJson))); } catch { return unavailable(); }
    const keys = Object.keys(headers).map(key => key.toLowerCase());
    if (new Set(keys).size !== keys.length || keys.some(key => !['x-finance-grant', ...(method === 'PUT' ? ['content-type'] : [])].includes(key))) return unavailable();
    const header = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    if (typeof header('x-finance-grant') !== 'string' || !/^[a-f0-9]{64}$/.test(String(header('x-finance-grant')))
      || (method === 'PUT' && !['image/jpeg', 'image/png'].includes(String(header('content-type'))))) return unavailable();
    return target;
  };
}
const documentUpload: Projection = value => {
  const result = record(shape({ document, upload: nullable(fileTarget('PUT')), replayed: boolean })(value));
  if (result.upload !== null && record(result.upload).url !== '/finance-files/documents/' + record(result.document).id + '/content') return unavailable();
  return result;
};
const documentResult = shape({ document, replayed: boolean });
const expense = shape({ ...strings('id description expenseDate currency method recordedAt actorSubject employeeId'), amountMinor: money, category,
  document: nullable(document), duplicateOf: nullable(text), duplicateReason: nullable(text) });
const paymentResult = shape({ payment, receivable, receipt, replayed: boolean });
const referenceResult = shape({ verification, replayed: boolean });
const expenseResult = shape({ expense, replayed: boolean });
const ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  VALIDATION_ERROR: 400, IDEMPOTENCY_CONFLICT: 409, VERSION_CONFLICT: 409, COLLECTION_CONTEXT_UNAVAILABLE: 503,
  OBLIGATION_NOT_FOUND: 404, ORDER_NOT_FINALIZED: 409, OBLIGATION_MISMATCH: 409, BALANCE_INCONSISTENT: 409,
  PAYMENT_AMOUNT_INVALID: 409, PAYMENT_PARTIAL_UNSUPPORTED: 409, PAYMENT_EXCEEDS_BALANCE: 409, NO_BALANCE_DUE: 409,
  PAYMENT_REFERENCE_UNVERIFIED: 409, PAYMENT_REFERENCE_ALREADY_USED: 409, PAYMENT_NOT_FOUND: 404,
  EXPENSE_NOT_FOUND: 404, EXPENSE_CATEGORY_INVALID: 409, EXPENSE_POSSIBLE_DUPLICATE: 409,
  DOCUMENT_NOT_FOUND: 404, DOCUMENT_NOT_AVAILABLE: 409, DOCUMENT_TYPE_NOT_ALLOWED: 400,
  DOCUMENT_STORAGE_UNAVAILABLE: 503, OPERATION_NOT_FOUND: 404, PERSISTENCE_UNAVAILABLE: 503,
});
function operation(value: unknown): unknown {
  const item = record(value);
  const base = record(shape({ ...strings('operationId action outcome committedAt'), status: integer, errorCode: nullable(text) })(item));
  let result: unknown;
  try { result = JSON.parse(String(text(item.resultJson))); } catch { return unavailable(); }
  if (base.outcome === 'applied' && base.status === 200 && base.errorCode === null) {
    const actions: Record<string, Projection> = { record_payment: paymentResult, verify_reference: referenceResult, record_expense: expenseResult, request_document: documentResult, confirm_document: documentResult };
    if (!Object.hasOwn(actions, String(base.action))) return unavailable();
    const project = actions[String(base.action)];
    result = project(result);
  } else if (base.outcome === 'rejected' && typeof base.errorCode === 'string' && ERROR_STATUS[base.errorCode] === base.status && (base.status === 409 || base.status === 404)) {
    const rejected = record(result);
    if (rejected.code !== base.errorCode || rejected.statusCode !== base.status) return unavailable();
    result = { code: base.errorCode, statusCode: base.status, replayed: boolean(rejected.replayed),
      ...(base.errorCode === 'EXPENSE_POSSIBLE_DUPLICATE' && rejected.candidate != null ? { candidate: expense(rejected.candidate) } : {}) };
  } else return unavailable();
  return { ...base, resultJson: JSON.stringify(result) };
}
function query(args: LedgerArgs, keys: readonly string[]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (!keys.includes(key)) return invalid();
    if (value == null) continue;
    if (key === 'limit' || key === 'offset') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < (key === 'limit' ? 1 : 0) || value > (key === 'limit' ? 100 : 2147483647)) return invalid();
    } else if (typeof value !== 'string') return invalid();
    if ((key === 'from' || key === 'to') && (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return invalid();
    if (key === 'status' && !['pending', 'paid', 'all'].includes(String(value))) return invalid();
    params.set(key, String(value));
  }
  if (typeof args.from === 'string' && typeof args.to === 'string' && args.from > args.to) return invalid();
  return params.size ? '?' + params.toString() : '';
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return invalid();
  return encodeURIComponent(value);
}

export class HttpLedgerGateway {
  constructor(private readonly baseUrl: string, private readonly transport: typeof fetch = fetch) {}

  async call(name: string, args: LedgerArgs, token: string): Promise<unknown> {
    let path: string;
    let project: Projection;
    let fields: string[] | undefined;
    switch (name) {
      case 'receivables': path = '/receivables' + query(args, ['status', 'limit', 'offset']); project = shape({ items: list(receivable), page }); break;
      case 'receivable': path = '/receivables/' + id(args.orderId); project = receivable; break;
      case 'servicePayments': path = '/payments' + query(args, ['from', 'to', 'limit', 'offset']); project = shape({ items: list(payment), page, totalAmountMinor: money }); break;
      case 'paymentReceipt': path = '/payments/' + id(args.paymentId) + '/receipt'; project = receipt; break;
      case 'expenseCategories': path = '/expense-categories'; project = list(category); break;
      case 'operatingExpenses': path = '/expenses' + query(args, ['from', 'to', 'categoryId', 'limit', 'offset']); project = shape({ items: list(expense), page, totalAmountMinor: money }); break;
      case 'operatingExpense': path = '/expenses/' + id(args.id); project = expense; break;
      case 'financialOperation': path = '/financial-operations/' + id(args.operationId); project = operation; break;
      case 'financialSummary': path = '/financial-summary' + query(args, ['from', 'to']); project = shape({ ...strings('from to timeZone currency generatedAt'), paymentCount: integer, expenseCount: integer, receivedAmountMinor: money, expenseAmountMinor: money, netMovementMinor: signedMoney }); break;
      case 'verifyPaymentReference': path = '/orders/' + id(args.orderId) + '/payment-reference-verifications'; project = referenceResult; fields = ['operationId', 'method', 'amountMinor', 'reference', 'note']; break;
      case 'recordServicePayment': path = '/orders/' + id(args.orderId) + '/payments'; project = paymentResult; fields = ['operationId', 'expectedVersion', 'amountMinor', 'method', 'confirmReceived', 'referenceVerificationId']; break;
      case 'recordOperatingExpense': path = '/expenses'; project = expenseResult; fields = ['operationId', 'description', 'categoryId', 'expenseDate', 'amountMinor', 'method', 'documentId', 'duplicateOf', 'duplicateReason']; break;
      case 'requestExpenseDocument': path = '/expense-documents'; project = documentUpload; fields = ['operationId', 'fileName', 'contentType', 'sizeBytes', 'sha256']; break;
      case 'confirmExpenseDocument': path = '/expense-documents/' + id(args.input?.documentId) + '/confirm'; project = document; fields = ['operationId', 'documentId']; break;
      case 'expenseDocumentDownload': path = '/expense-documents/' + id(args.documentId) + '/download'; project = fileTarget('GET'); break;
      default: return invalid();
    }
    let body: string | undefined;
    if (fields) {
      const input = args.input;
      if (!input || Object.keys(input).some(key => !fields.includes(key))) return invalid();
      id(input.operationId);
      if (fields.includes('amountMinor') && (typeof input.amountMinor !== 'string' || !/^[1-9][0-9]{0,11}$/.test(input.amountMinor))) return invalid();
      body = JSON.stringify(Object.fromEntries(fields.filter(key => input[key] !== undefined && !(name === 'confirmExpenseDocument' && key === 'documentId')).map(key => [key, input[key]])));
    }
    return project(await this.request(path, token, body));
  }

  private async request(path: string, token: string, body?: string): Promise<unknown> {
    let response: Response;
    try { response = await this.transport(this.baseUrl + path, { method: body ? 'POST' : 'GET', body,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { return unavailable(); }
    if (response.status === 401) throw new BusinessError(401, 'UNAUTHENTICATED');
    if (response.status === 403) throw new BusinessError(403, 'FORBIDDEN');
    let payload: unknown;
    try { payload = await response.json(); } catch { return unavailable(); }
    if (response.status === 200 || response.status === 201) return payload;
    const code = record(payload).code;
    if (typeof code === 'string' && ERROR_STATUS[code] === response.status) throw new BusinessError(response.status, code);
    return unavailable();
  }
}
