import { readFileSync } from 'node:fs';
import {
  buildSchema,
  execute,
  type GraphQLError,
  parse,
  validate,
  type DocumentNode,
  type FieldNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql';
import { BusinessError, publicMessage } from './business-error.js';
import type { CommandInput, EmployeePageQuery, EmployeeQuery, EmployeesGateway, SecurityHistoryQuery, StaffingCommand } from './employees-gateway.js';
import type { OperationsCommand, OperationsGateway, OperationsPageQuery } from './operations-gateway.js';
import type { FinanceGateway, QuoteCommand, QuoteQuery } from './finance-gateway.js';
import type { AgendaGateway, AgendaQuery, AgendaEmployeesQuery } from './agenda-gateway.js';

/** Closed permission catalog published by the Employees owner. */
type Permission =
  | 'employees:read' | 'employees:write'
  | 'schedules:read' | 'schedules:write'
  | 'security:read' | 'security:write'
  | 'customers:read' | 'customers:write'
  | 'vehicles:read' | 'vehicles:write'
  | 'catalog:read' | 'catalog:write'
  | 'appointments:read' | 'appointments:write'
  | 'receptions:read' | 'receptions:write'
  | 'orders:read' | 'orders:write'
  | 'quotes:read' | 'quotes:write' | 'quotes:decide'
  | 'confirmations:read' | 'confirmations:write'
  | 'agenda:read:self' | 'agenda:read:team'
  | 'executions:read:self' | 'executions:read:team' | 'executions:write';

export interface CallerIdentity { readonly subject: string; readonly roles: readonly string[]; }

/** Root-field permission policy: CU03 stays employees:write (administrator only). */
const FIELD_PERMISSION: Readonly<Record<string, Permission | null>> = Object.freeze({
  myAgenda: 'agenda:read:self',
  myAgendaWork: 'agenda:read:self',
  teamAgenda: 'agenda:read:team',
  teamAgendaWork: 'agenda:read:team',
  agendaTeamEmployees: 'agenda:read:team',
  myExecution: 'executions:read:self',
  teamExecution: 'executions:read:team',
  myEvidenceDownload: 'executions:read:self',
  teamEvidenceDownload: 'executions:read:team',
  startExecution: 'executions:write',
  recordAdvance: 'executions:write',
  requestEvidence: 'executions:write',
  confirmEvidence: 'executions:write',
  retryEvidence: 'executions:write',
  confirmationSaga: 'confirmations:read',
  confirmationByOperation: 'confirmations:read',
  orderConfirmations: 'confirmations:read',
  confirmationMechanics: 'confirmations:read',
  confirmationAvailability: 'confirmations:read',
  startServiceConfirmation: 'confirmations:write',
  retryServiceConfirmation: 'confirmations:write',
  employees: 'employees:read',
  employee: 'employees:read',
  employeeHistory: 'employees:read',
  createEmployee: 'employees:write',
  updateEmployee: 'employees:write',
  deactivateEmployee: 'employees:write',
  retryEmployeeAccess: 'employees:write',
  staffingEmployees: 'schedules:read',
  employeeSchedule: 'schedules:read',
  employeeAvailability: 'schedules:read',
  createShift: 'schedules:write',
  updateShift: 'schedules:write',
  deactivateShift: 'schedules:write',
  createAbsence: 'schedules:write',
  cancelAbsence: 'schedules:write',
  securityCatalog: null,
  securityRoles: 'security:read',
  securityRole: 'security:read',
  employeeRoles: 'security:read',
  securityHistory: 'security:read',
  createRole: 'security:write',
  updateRole: 'security:write',
  retryRoleSync: 'security:write',
  assignRole: 'security:write',
  revokeRole: 'security:write',
  customers: 'customers:read',
  customer: 'customers:read',
  createCustomer: 'customers:write',
  updateCustomer: 'customers:write',
  deactivateCustomer: 'customers:write',
  vehicles: 'vehicles:read',
  vehicle: 'vehicles:read',
  createVehicle: 'vehicles:write',
  updateVehicle: 'vehicles:write',
  deactivateVehicle: 'vehicles:write',
  services: 'catalog:read',
  service: 'catalog:read',
  createService: 'catalog:write',
  updateService: 'catalog:write',
  deactivateService: 'catalog:write',
  appointments: 'appointments:read',
  appointment: 'appointments:read',
  createAppointment: 'appointments:write',
  rescheduleAppointment: 'appointments:write',
  cancelAppointment: 'appointments:write',
  receptions: 'receptions:read',
  reception: 'receptions:read',
  createReception: 'receptions:write',
  orders: 'orders:read',
  order: 'orders:read',
  createWorkOrder: 'orders:write',
  quotes: 'quotes:read',
  quote: 'quotes:read',
  createQuote: 'quotes:write',
  reviseQuote: 'quotes:write',
  decideQuote: 'quotes:decide',
});
const CACHE_TTL_MS = 30000;
const MAX_QUERY_LENGTH = 4000;
const MAX_VARIABLES_BYTES = 65536;
const MAX_DEPTH = 6;
const MAX_SELECTIONS = 120;

export interface GraphqlRequest {
  readonly query?: unknown;
  readonly variables?: unknown;
  readonly operationName?: unknown;
}
export interface GraphqlErrorBody {
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly extensions: { readonly code: string; readonly statusCode: number };
}
export interface GraphqlResponse {
  readonly data?: unknown;
  readonly errors?: readonly GraphqlErrorBody[];
}
export class BadRequest extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BadRequest'; }
}

export class BusinessGraphql {
  private readonly schema: GraphQLSchema;
  private readonly cache = new Map<string, { expires: number; permissions: ReadonlySet<string> }>();

  constructor(
    private readonly gateway: EmployeesGateway,
    private readonly operations: OperationsGateway,
    private readonly finance: FinanceGateway,
    schemaPaths: readonly string[],
    private readonly agenda: AgendaGateway,
  ) {
    this.schema = buildSchema(schemaPaths.map(path => readFileSync(path, 'utf8')).join('\n\n'));
  }

  async run(request: GraphqlRequest, identity: CallerIdentity, token: string): Promise<GraphqlResponse> {
    const document = this.document(request);
    const { operationName, variables } = this.operation(document, request);
    const roots = this.rootFields((document.definitions[0] as OperationDefinitionNode).selectionSet);
    const required = roots.map(field => FIELD_PERMISSION[field]);
    if (required.some(permission => permission === undefined)) {
      return { errors: [{ message: publicMessage('FORBIDDEN'), extensions: { code: 'FORBIDDEN', statusCode: 403 } }] };
    }
    const needed = required.filter((permission): permission is Permission => typeof permission === 'string');
    if (needed.length) {
      const granted = await this.effectivePermissions(identity, token);
      if (!needed.every(permission => granted.has(permission))) {
        return { errors: [{ message: publicMessage('FORBIDDEN'), extensions: { code: 'FORBIDDEN', statusCode: 403 } }] };
      }
    }
    const result = await execute({
      schema: this.schema,
      document,
      rootValue: this.rootValue(token),
      contextValue: { token },
      variableValues: variables,
      operationName,
    });
    const errors = result.errors?.map(error => this.toBody(error));
    if (errors?.length) return { ...(result.data ? { data: result.data } : {}), errors };
    return { data: result.data };
  }

  /** Resolved by the owner from the token roles plus the persisted assignments; fails closed. */
  private async effectivePermissions(identity: CallerIdentity, token: string): Promise<ReadonlySet<string>> {
    const key = identity.subject + '|' + [...identity.roles].sort().join(',');
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expires > now) return cached.permissions;
    const response = (await this.gateway.permissions(token)) as { effective?: unknown };
    const effective = Array.isArray(response?.effective) ? response.effective : [];
    const permissions: ReadonlySet<string> = new Set(effective.filter((item): item is string => typeof item === 'string'));
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { expires: now + CACHE_TTL_MS, permissions });
    return permissions;
  }

  private document(request: GraphqlRequest): DocumentNode {
    if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > MAX_QUERY_LENGTH) {
      throw new BadRequest('BAD_REQUEST');
    }
    let document: DocumentNode;
    try { document = parse(request.query); } catch { throw new BadRequest('BAD_REQUEST'); }
    const operations = document.definitions.filter((definition): definition is OperationDefinitionNode => definition.kind === 'OperationDefinition');
    if (operations.length !== 1 || document.definitions.length !== 1) throw new BadRequest('BAD_REQUEST');
    this.inspect(operations[0].selectionSet, 1, { count: 0 });
    if (validate(this.schema, document).length) throw new BadRequest('BAD_REQUEST');
    return document;
  }

  /** Rejects unknown root fields, named fragments, introspection and unbounded nesting. */
  private inspect(selectionSet: SelectionSetNode, depth: number, budget: { count: number }): void {
    if (depth > MAX_DEPTH) throw new BadRequest('BAD_REQUEST');
    for (const selection of selectionSet.selections) {
      budget.count += 1;
      if (budget.count > MAX_SELECTIONS) throw new BadRequest('BAD_REQUEST');
      if (selection.kind === 'Field') {
        const field = selection as FieldNode;
        const name = field.name.value;
        if (name.startsWith('__')) throw new BadRequest('BAD_REQUEST');
        if (depth === 1 && !(name in FIELD_PERMISSION)) throw new BadRequest('BAD_REQUEST');
        if (field.selectionSet) this.inspect(field.selectionSet, depth + 1, budget);
      } else if (selection.kind === 'InlineFragment') {
        // A root inline fragment would hide the field names from the permission policy.
        if (depth === 1) throw new BadRequest('BAD_REQUEST');
        this.inspect(selection.selectionSet, depth, budget);
      } else {
        throw new BadRequest('BAD_REQUEST');
      }
    }
  }

  private rootFields(selectionSet: SelectionSetNode): string[] {
    const names: string[] = [];
    for (const selection of selectionSet.selections) {
      if (selection.kind === 'Field') names.push(selection.name.value);
    }
    return names;
  }

  private operation(document: DocumentNode, request: GraphqlRequest) {
    const operation = document.definitions[0] as OperationDefinitionNode;
    const operationName = request.operationName === undefined || request.operationName === null ? undefined : request.operationName;
    if (operationName !== undefined && (typeof operationName !== 'string' || operationName.length > 64)) throw new BadRequest('BAD_REQUEST');
    let variables: Record<string, unknown> | undefined;
    if (request.variables !== undefined && request.variables !== null) {
      if (typeof request.variables !== 'object' || Array.isArray(request.variables)) throw new BadRequest('BAD_REQUEST');
      let serialized: string;
      try { serialized = JSON.stringify(request.variables); } catch { throw new BadRequest('BAD_REQUEST'); }
      if (serialized.length > MAX_VARIABLES_BYTES) throw new BadRequest('BAD_REQUEST');
      variables = request.variables as Record<string, unknown>;
    }
    return { operation, operationName: operationName as string | undefined, variables };
  }

  private rootValue(token: string) {
    return {
      myAgenda: (args: AgendaQuery) => this.agenda.list('self', args, token),
      myAgendaWork: (args: { assignmentId: string }) => this.agenda.work('self', args.assignmentId, token),
      teamAgenda: (args: AgendaQuery) => this.agenda.list('team', args, token),
      teamAgendaWork: (args: { assignmentId: string }) => this.agenda.work('team', args.assignmentId, token),
      agendaTeamEmployees: (args: AgendaEmployeesQuery) => this.agenda.employees(args, token),
      myExecution: (args: { assignmentId: string }) => this.operations.execution('me', args.assignmentId, token),
      teamExecution: (args: { assignmentId: string }) => this.operations.execution('team', args.assignmentId, token),
      myEvidenceDownload: (args: { assignmentId: string; evidenceId: string }) =>
        this.operations.evidenceDownload('me', args.assignmentId, args.evidenceId, token),
      teamEvidenceDownload: (args: { assignmentId: string; evidenceId: string }) =>
        this.operations.evidenceDownload('team', args.assignmentId, args.evidenceId, token),
      startExecution: (args: { assignmentId: string; input: OperationsCommand }) =>
        this.operations.startExecution(args.assignmentId, args.input, token),
      recordAdvance: (args: { assignmentId: string; input: OperationsCommand }) =>
        this.operations.recordAdvance(args.assignmentId, args.input, token),
      requestEvidence: (args: { assignmentId: string; advanceId: string; input: OperationsCommand }) =>
        this.operations.requestEvidence(args.assignmentId, args.advanceId, args.input, token),
      confirmEvidence: (args: { assignmentId: string; evidenceId: string; input: OperationsCommand }) =>
        this.operations.confirmEvidence(args.assignmentId, args.evidenceId, args.input, token),
      retryEvidence: (args: { assignmentId: string; evidenceId: string; input: OperationsCommand }) =>
        this.operations.retryEvidence(args.assignmentId, args.evidenceId, args.input, token),
      confirmationSaga: (args: { id: string }) => this.operations.confirmationSaga(args.id, token),
      confirmationByOperation: (args: { operationId: string }) => this.operations.confirmationByOperation(args.operationId, token),
      orderConfirmations: (args: { orderId: string }) => this.operations.orderConfirmations(args.orderId, token),
      startServiceConfirmation: (args: { orderId: string; input: OperationsCommand }) => this.operations.startServiceConfirmation(args.orderId, args.input, token),
      retryServiceConfirmation: (args: { id: string; input: OperationsCommand }) => this.operations.retryServiceConfirmation(args.id, args.input, token),
      confirmationMechanics: (args: EmployeePageQuery) => this.gateway.confirmationMechanics(args, token),
      confirmationAvailability: (args: { employeeId: string; date: string }) => this.gateway.confirmationAvailability(args.employeeId, args.date, token),
      employees: (args: EmployeePageQuery) => this.gateway.list(args ?? {}, token),
      employee: (args: { id: string }) => this.gateway.get(args.id, token),
      employeeHistory: (args: { id: string; limit?: number; offset?: number }) => this.gateway.history(args.id, args, token),
      createEmployee: (args: { input: CommandInput }) => this.gateway.create(args.input, token),
      updateEmployee: (args: { id: string; input: CommandInput }) => this.gateway.update(args.id, args.input, token),
      deactivateEmployee: (args: { id: string; input: CommandInput }) => this.gateway.deactivate(args.id, args.input, token),
      retryEmployeeAccess: (args: { id: string; input: CommandInput }) => this.gateway.retryAccess(args.id, args.input, token),
      staffingEmployees: (args: EmployeeQuery) => this.gateway.staffingEmployees(args ?? {}, token),
      employeeSchedule: (args: { id: string }) => this.gateway.schedule(args.id, token),
      employeeAvailability: (args: { id: string; date: string }) => this.gateway.availability(args.id, args.date, token),
      createShift: (args: { employeeId: string; input: CommandInput }) => this.gateway.createShift(args.employeeId, args.input, token),
      updateShift: (args: { id: string; input: CommandInput }) => this.gateway.updateShift(args.id, args.input, token),
      deactivateShift: (args: { id: string; input: StaffingCommand }) => this.gateway.deactivateShift(args.id, args.input, token),
      createAbsence: (args: { employeeId: string; input: CommandInput }) => this.gateway.createAbsence(args.employeeId, args.input, token),
      cancelAbsence: (args: { id: string; input: StaffingCommand }) => this.gateway.cancelAbsence(args.id, args.input, token),
      securityCatalog: () => this.gateway.permissions(token),
      securityRoles: () => this.gateway.securityRoles(token),
      securityRole: (args: { name: string }) => this.gateway.securityRole(args.name, token),
      employeeRoles: (args: { employeeId: string }) => this.gateway.employeeRoles(args.employeeId, token),
      securityHistory: (args: SecurityHistoryQuery) => this.gateway.securityHistory(args ?? {}, token),
      createRole: (args: { input: CommandInput }) => this.gateway.createRole(args.input, token),
      updateRole: (args: { name: string; input: CommandInput }) => this.gateway.updateRole(args.name, args.input, token),
      retryRoleSync: (args: { name: string; input: CommandInput }) => this.gateway.retryRoleSync(args.name, args.input, token),
      assignRole: (args: { employeeId: string; input: CommandInput }) => this.gateway.assignRole(args.employeeId, args.input, token),
      revokeRole: (args: { employeeId: string; roleName: string; input: CommandInput }) => this.gateway.revokeRole(args.employeeId, args.roleName, args.input, token),
      customers: (args: OperationsPageQuery) => this.operations.customers(args ?? {}, token),
      customer: (args: { id: string }) => this.operations.customer(args.id, token),
      createCustomer: (args: { input: OperationsCommand }) => this.operations.createCustomer(args.input, token),
      updateCustomer: (args: { id: string; input: OperationsCommand }) => this.operations.updateCustomer(args.id, args.input, token),
      deactivateCustomer: (args: { id: string; input: OperationsCommand }) => this.operations.deactivateCustomer(args.id, args.input, token),
      vehicles: (args: OperationsPageQuery) => this.operations.vehicles(args ?? {}, token),
      vehicle: (args: { id: string }) => this.operations.vehicle(args.id, token),
      createVehicle: (args: { input: OperationsCommand }) => this.operations.createVehicle(args.input, token),
      updateVehicle: (args: { id: string; input: OperationsCommand }) => this.operations.updateVehicle(args.id, args.input, token),
      deactivateVehicle: (args: { id: string; input: OperationsCommand }) => this.operations.deactivateVehicle(args.id, args.input, token),
      services: (args: OperationsPageQuery) => this.operations.services(args ?? {}, token),
      service: (args: { id: string }) => this.operations.service(args.id, token),
      createService: (args: { input: OperationsCommand }) => this.operations.createService(args.input, token),
      updateService: (args: { id: string; input: OperationsCommand }) => this.operations.updateService(args.id, args.input, token),
      deactivateService: (args: { id: string; input: OperationsCommand }) => this.operations.deactivateService(args.id, args.input, token),
      appointments: (args: OperationsPageQuery) => this.operations.appointments(args ?? {}, token),
      appointment: (args: { id: string }) => this.operations.appointment(args.id, token),
      createAppointment: (args: { input: OperationsCommand }) => this.operations.createAppointment(args.input, token),
      rescheduleAppointment: (args: { id: string; input: OperationsCommand }) => this.operations.rescheduleAppointment(args.id, args.input, token),
      cancelAppointment: (args: { id: string; input: OperationsCommand }) => this.operations.cancelAppointment(args.id, args.input, token),
      receptions: (args: OperationsPageQuery) => this.operations.receptions(args ?? {}, token),
      reception: (args: { id: string }) => this.operations.reception(args.id, token),
      createReception: (args: { input: OperationsCommand }) => this.operations.createReception(args.input, token),
      orders: (args: OperationsPageQuery) => this.operations.orders(args ?? {}, token),
      order: (args: { id: string }) => this.operations.order(args.id, token),
      createWorkOrder: (args: { input: OperationsCommand }) => this.operations.createWorkOrder(args.input, token),
      quotes: (args: QuoteQuery) => this.finance.quotes(args ?? {}, token),
      quote: (args: { id: string }) => this.finance.quote(args.id, token),
      createQuote: (args: { input: QuoteCommand }) => this.finance.createQuote(args.input, token),
      reviseQuote: (args: { id: string; input: QuoteCommand }) => this.finance.reviseQuote(args.id, args.input, token),
      decideQuote: (args: { id: string; input: QuoteCommand }) => this.finance.decideQuote(args.id, args.input, token),
    };
  }

  private toBody(error: GraphQLError): GraphqlErrorBody {
    const original = error.originalError;
    if (original instanceof BusinessError) {
      const code = original.statusCode === 401 ? 'UNAUTHENTICATED' : original.statusCode === 403 ? 'FORBIDDEN' : original.code;
      return {
        message: publicMessage(code),
        ...(error.path ? { path: error.path } : {}),
        extensions: { code, statusCode: original.statusCode },
      };
    }
    return {
      message: publicMessage('SERVICE_UNAVAILABLE'),
      ...(error.path ? { path: error.path } : {}),
      extensions: { code: 'SERVICE_UNAVAILABLE', statusCode: 503 },
    };
  }
}
