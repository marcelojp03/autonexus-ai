import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import { OperationsFailure } from './operations-api';
import type { Page } from './operations.contract';

export interface ConfirmationSaga {
  sagaId: string; orderId: string; status: 'running' | 'recovery_pending' | 'compensating' | 'compensation_pending' | 'confirmed' | 'rejected';
  phase: string; version: number; orderVersion: number; operationId: string; nextAttemptAt: string | null; errorCode: string | null;
  quoteId: string; quoteVersion: number; employeeId: string; employeeVersion: number; requiredSpecialty: string; startsAt: string; endsAt: string;
  assignmentId: string | null; quoteLinkId: string | null;
  steps: { operationId: string; command: string; direction: string; status: string; attempts: number; errorCode: string | null; resourceVersion: number | null }[];
}
export interface Mechanic { id: string; fullName: string; jobTitle: string; status: string; version: number; mechanicEnabled: boolean; specialties: string[]; eligible: boolean; eligibilityReasons: string[]; }
export interface ApprovedQuote { id: string; orderReference: string; version: number; status: string; total: number; currency: string; validUntil: string; }
export interface ConfirmationAvailability {
  employeeId: string; date: string; absent: boolean; available: { start: string; end: string }[];
  assignments: { id: string; startsAt: string; endsAt: string; reference: string }[];
  reservations: { id: string; sagaId: string; startsAt: string; endsAt: string; status: string; orderConfirmedObserved: boolean }[] | null;
}
export interface StartConfirmation { operationId: string; expectedVersion: number; quoteId: string; quoteVersion: number; employeeId: string; employeeVersion: number; requiredSpecialty: string; startsAt: string; endsAt: string; }
export interface PendingConfirmation { operationId: string; orderId: string; sagaId?: string; }
export const terminal = (saga: ConfirmationSaga): boolean => saga.status === 'confirmed' || saga.status === 'rejected';
export const intervalValid = (start: string, end: string, now = Date.now()): boolean => /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(start) && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(end) && start.slice(0, 10) === end.slice(0, 10) && start < end && Date.parse(start + ':00-04:00') > now;
export const SAGA_FIELDS = 'sagaId orderId status phase version orderVersion operationId nextAttemptAt errorCode quoteId quoteVersion employeeId employeeVersion requiredSpecialty startsAt endsAt assignmentId quoteLinkId steps { operationId command direction status attempts errorCode resourceVersion }';
export const START_CONFIRMATION = `mutation StartServiceConfirmation($orderId: UUID!, $input: StartServiceConfirmationInput!) { startServiceConfirmation(orderId: $orderId, input: $input) { ${SAGA_FIELDS} } }`;
export const RETRY_CONFIRMATION = `mutation RetryServiceConfirmation($id: UUID!, $input: ConfirmationRetryInput!) { retryServiceConfirmation(id: $id, input: $input) { ${SAGA_FIELDS} } }`;

@Injectable({ providedIn: 'root' })
export class ConfirmationsApi {
  private readonly session = inject(SESSION_PORT);
  async run<T>(query: string, variables: Readonly<Record<string, unknown>> = {}): Promise<T> {
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new OperationsFailure(result.errors[0]);
    if (!result.data) throw new OperationsFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: 'No se pudo consultar el estado. Conservá la operación y volvé a consultar.' });
    return result.data as T;
  }
  async catalog(): Promise<string[]> { return (await this.run<{ securityCatalog: { effective: string[] } }>('query SecurityCatalog { securityCatalog { catalog { id module operation description } effective roles } }')).securityCatalog.effective; }
  async mechanics(search: string, offset: number): Promise<Page<Mechanic>> { return (await this.run<{ confirmationMechanics: Page<Mechanic> }>('query ConfirmationMechanics($limit: Int, $offset: Int, $search: String) { confirmationMechanics(limit: $limit, offset: $offset, search: $search) { items { id fullName jobTitle status version mechanicEnabled specialties eligible eligibilityReasons } total limit offset } }', { limit: 20, offset, search })).confirmationMechanics; }
  async quotes(orderReference: string, offset: number): Promise<Page<ApprovedQuote>> { return (await this.run<{ quotes: Page<ApprovedQuote> }>('query ConfirmationQuotes($orderReference: String, $offset: Int) { quotes(orderReference: $orderReference, status: approved, limit: 20, offset: $offset) { items { id orderReference version status total currency validUntil } total limit offset } }', { orderReference, offset })).quotes; }
  async availability(employeeId: string, date: string): Promise<ConfirmationAvailability> { return (await this.run<{ confirmationAvailability: ConfirmationAvailability }>('query ConfirmationAvailability($employeeId: UUID!, $date: Date!) { confirmationAvailability(employeeId: $employeeId, date: $date) { employeeId date absent available { start end } assignments { id startsAt endsAt reference } reservations { id sagaId startsAt endsAt status orderConfirmedObserved } } }', { employeeId, date })).confirmationAvailability; }
  async saga(id: string): Promise<ConfirmationSaga> { return (await this.run<{ confirmationSaga: ConfirmationSaga }>(`query ConfirmationSaga($id: UUID!) { confirmationSaga(id: $id) { ${SAGA_FIELDS} } }`, { id })).confirmationSaga; }
  async byOperation(operationId: string): Promise<ConfirmationSaga> { return (await this.run<{ confirmationByOperation: ConfirmationSaga }>(`query ConfirmationByOperation($operationId: UUID!) { confirmationByOperation(operationId: $operationId) { ${SAGA_FIELDS} } }`, { operationId })).confirmationByOperation; }
  async forOrder(orderId: string): Promise<ConfirmationSaga[]> { return (await this.run<{ orderConfirmations: ConfirmationSaga[] }>(`query OrderConfirmations($orderId: UUID!) { orderConfirmations(orderId: $orderId) { ${SAGA_FIELDS} } }`, { orderId })).orderConfirmations; }
  async start(orderId: string, input: StartConfirmation): Promise<ConfirmationSaga> { return (await this.run<{ startServiceConfirmation: ConfirmationSaga }>(START_CONFIRMATION, { orderId, input })).startServiceConfirmation; }
  async retry(id: string, input: { operationId: string; expectedVersion: number }): Promise<ConfirmationSaga> { return (await this.run<{ retryServiceConfirmation: ConfirmationSaga }>(RETRY_CONFIRMATION, { id, input })).retryServiceConfirmation; }
}
