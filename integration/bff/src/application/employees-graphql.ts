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
import type { CommandInput, EmployeePageQuery, EmployeeQuery, EmployeesGateway, StaffingCommand } from './employees-gateway.js';

type Role = 'administrador' | 'jefe_taller';
export interface CallerIdentity { readonly subject: string; readonly roles: readonly string[]; }

/** Root-field policy: CU03 employee operations stay administrator-only. */
const ROOT_POLICY: Readonly<Record<string, readonly Role[]>> = Object.freeze({
  employees: ['administrador'],
  employee: ['administrador'],
  employeeHistory: ['administrador'],
  createEmployee: ['administrador'],
  updateEmployee: ['administrador'],
  deactivateEmployee: ['administrador'],
  retryEmployeeAccess: ['administrador'],
  staffingEmployees: ['administrador', 'jefe_taller'],
  employeeSchedule: ['administrador', 'jefe_taller'],
  employeeAvailability: ['administrador', 'jefe_taller'],
  createShift: ['administrador', 'jefe_taller'],
  updateShift: ['administrador', 'jefe_taller'],
  deactivateShift: ['administrador', 'jefe_taller'],
  createAbsence: ['administrador', 'jefe_taller'],
  cancelAbsence: ['administrador', 'jefe_taller'],
});
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

export class EmployeesGraphql {
  private readonly schema: GraphQLSchema;

  constructor(private readonly gateway: EmployeesGateway, schemaPaths: readonly string[]) {
    this.schema = buildSchema(schemaPaths.map(path => readFileSync(path, 'utf8')).join('\n\n'));
  }

  async run(request: GraphqlRequest, identity: CallerIdentity, token: string): Promise<GraphqlResponse> {
    const document = this.document(request);
    const { operationName, variables } = this.operation(document, request);
    const roots = this.rootFields((document.definitions[0] as OperationDefinitionNode).selectionSet);
    if (!roots.every(field => ROOT_POLICY[field]!.some(role => identity.roles.includes(role)))) {
      return { errors: [{ message: publicMessage('FORBIDDEN'), extensions: { code: 'FORBIDDEN', statusCode: 403 } }] };
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
        if (depth === 1 && !(name in ROOT_POLICY)) throw new BadRequest('BAD_REQUEST');
        if (field.selectionSet) this.inspect(field.selectionSet, depth + 1, budget);
      } else if (selection.kind === 'InlineFragment') {
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
