import type {
  Command,
  Employee,
  History,
  PageQuery,
  Transition,
} from '../domain/employee.js';
import type { IdentityDesired } from './identity-gateway.js';
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface MutationResult {
  employee: Employee;
  replayed: boolean;
}
export type IdentityOutcome =
  { subject: string } | { code: string; conflict: boolean };
export interface EmployeeRepository {
  get(id: string): Promise<Employee>;
  list(query: PageQuery): Promise<Page<Employee>>;
  history(id: string, query: PageQuery): Promise<Page<History>>;
  execute(
    command: Command,
    actor: string,
    apply: (current: Employee | null) => Transition,
  ): Promise<MutationResult>;
  synchronize(
    id: string,
    attempt: (desired: IdentityDesired) => Promise<IdentityOutcome>,
  ): Promise<void>;
}
