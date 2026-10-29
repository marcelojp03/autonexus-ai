import type {
  AssignmentCommand,
  AssignmentResource,
  CommandBody,
  CommandResult,
} from '../domain/assignment.js';
export interface AssignmentRepository {
  execute(
    sagaId: string,
    command: AssignmentCommand,
    body: CommandBody,
    clientId: string,
  ): Promise<CommandResult>;
  get(sagaId: string): Promise<AssignmentResource>;
  operation(operationId: string): Promise<CommandResult>;
}
