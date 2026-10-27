/** CU03 web contract types and documents, kept 1:1 with contracts/graphql/employees.graphql. */
export type EmployeeStatus = 'active' | 'inactive';
export type AccessStatus = 'not_requested' | 'pending' | 'synced' | 'failed' | 'conflict';
export type HistoryAction = 'created' | 'updated' | 'deactivated';

export interface EmployeeAccess {
  requested: boolean;
  status: AccessStatus;
  subject: string | null;
  attempts: number;
  errorCode: string | null;
}
export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  document: string;
  email: string;
  phone: string;
  jobTitle: string;
  startDate: string;
  specialties: string[];
  status: EmployeeStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  access: EmployeeAccess;
}
export interface EmployeePage {
  items: Employee[];
  total: number;
  limit: number;
  offset: number;
}
export interface EmployeeHistoryEntry {
  id: string;
  version: number;
  action: HistoryAction;
  occurredAt: string;
  actorSubject: string;
  operationId: string;
  snapshot: Employee;
}
export interface EmployeeHistoryPage {
  items: EmployeeHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}
export interface EmployeeMutationResult {
  employee: Employee;
  replayed: boolean;
}
export interface EmployeeFieldsInput {
  firstName: string;
  lastName: string;
  document: string;
  email: string;
  phone: string;
  jobTitle: string;
  startDate: string;
  specialties: string[];
}
export interface CreateEmployeeVariables {
  input: EmployeeFieldsInput & { operationId: string; access?: { requested: boolean } };
}
export interface UpdateEmployeeVariables {
  id: string;
  input: EmployeeFieldsInput & { operationId: string; expectedVersion: number; access?: { requested: boolean } };
}
export interface CommandVariables {
  id: string;
  input: { operationId: string; expectedVersion: number };
}

const EMPLOYEE = `
  id firstName lastName document email phone jobTitle startDate specialties
  status version createdAt updatedAt
  access { requested status subject attempts errorCode }
`;

export const EMPLOYEES_QUERY = `
  query Employees($limit: Int, $offset: Int, $status: EmployeeStatus, $search: String) {
    employees(limit: $limit, offset: $offset, status: $status, search: $search) {
      total limit offset
      items { ${EMPLOYEE} }
    }
  }
`;
export const EMPLOYEE_QUERY = `
  query Employee($id: UUID!) { employee(id: $id) { ${EMPLOYEE} } }
`;
export const EMPLOYEE_HISTORY_QUERY = `
  query EmployeeHistory($id: UUID!, $limit: Int, $offset: Int) {
    employeeHistory(id: $id, limit: $limit, offset: $offset) {
      total limit offset
      items { id version action occurredAt actorSubject operationId snapshot { ${EMPLOYEE} } }
    }
  }
`;
export const CREATE_EMPLOYEE = `
  mutation CreateEmployee($input: CreateEmployeeInput!) {
    createEmployee(input: $input) { replayed employee { ${EMPLOYEE} } }
  }
`;
export const UPDATE_EMPLOYEE = `
  mutation UpdateEmployee($id: UUID!, $input: UpdateEmployeeInput!) {
    updateEmployee(id: $id, input: $input) { replayed employee { ${EMPLOYEE} } }
  }
`;
export const DEACTIVATE_EMPLOYEE = `
  mutation DeactivateEmployee($id: UUID!, $input: EmployeeCommandInput!) {
    deactivateEmployee(id: $id, input: $input) { replayed employee { ${EMPLOYEE} } }
  }
`;
export const RETRY_ACCESS = `
  mutation RetryEmployeeAccess($id: UUID!, $input: EmployeeCommandInput!) {
    retryEmployeeAccess(id: $id, input: $input) { replayed employee { ${EMPLOYEE} } }
  }
`;
