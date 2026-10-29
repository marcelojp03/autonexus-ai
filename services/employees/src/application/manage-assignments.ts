import {
  assignmentBody,
  type AssignmentCommand,
} from '../domain/assignment.js';
import { uuid } from '../domain/employee.js';
import type { AssignmentRepository } from './assignment-repository.js';
export class ManageAssignments {
  constructor(private readonly repository: AssignmentRepository) {}
  execute(
    id: unknown,
    command: AssignmentCommand,
    body: unknown,
    clientId: string,
  ) {
    return this.repository.execute(
      uuid(id),
      command,
      assignmentBody(command, body),
      clientId,
    );
  }
  get(id: unknown) {
    return this.repository.get(uuid(id));
  }
  operation(id: unknown) {
    return this.repository.operation(uuid(id));
  }
}
