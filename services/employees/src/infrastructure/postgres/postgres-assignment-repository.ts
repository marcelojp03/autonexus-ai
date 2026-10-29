import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import type { AssignmentRepository } from '../../application/assignment-repository.js';
import {
  digest,
  requireMechanic,
  type Assignment,
  type AssignmentCommand,
  type AssignmentResource,
  type CommandBody,
  type CommandResult,
} from '../../domain/assignment.js';
import { EmployeeError, type Employee } from '../../domain/employee.js';
import { Cu15Database, employeeLock } from './cu15-database.js';

type Row = {
  id: string;
  saga_id: string;
  order_id: string;
  employee_id: string;
  required_specialty: string;
  starts_at: Date;
  ends_at: Date;
  status: Assignment['status'];
  version: number;
  order_confirmed_observed: boolean;
};
const view = (r: Row): Assignment => ({
  id: r.id,
  sagaId: r.saga_id,
  orderId: r.order_id,
  employeeId: r.employee_id,
  requiredSpecialty: r.required_specialty,
  startsAt: r.starts_at.toISOString(),
  endsAt: r.ends_at.toISOString(),
  status: r.status,
  version: r.version,
  orderConfirmedObserved: r.order_confirmed_observed,
});

export class PostgresAssignmentRepository
  extends Cu15Database
  implements AssignmentRepository
{
  async current(
    r: QueryRunner,
    sagaId: string,
  ): Promise<AssignmentResource | null> {
    const rows = (await r.query(
      'SELECT * FROM employees.employee_assignments WHERE saga_id=$1',
      [sagaId],
    )) as Row[];
    if (rows[0]) return view(rows[0]);
    const tombstones = (await r.query(
      'SELECT version FROM employees.cu15_tombstones WHERE saga_id=$1',
      [sagaId],
    )) as Array<{ version: number }>;
    return tombstones[0]
      ? {
          sagaId,
          status: 'released',
          version: tombstones[0].version,
          tombstone: true,
        }
      : null;
  }
  get(sagaId: string): Promise<AssignmentResource> {
    return this.transaction(async (r) => {
      const resource = await this.current(r, sagaId);
      if (!resource) throw new EmployeeError(404, 'ASSIGNMENT_NOT_FOUND');
      return resource;
    });
  }
  operation(operationId: string): Promise<CommandResult> {
    return this.transaction(async (r) => {
      const rows = (await r.query(
        'SELECT result FROM employees.cu15_operations WHERE operation_id=$1',
        [operationId],
      )) as Array<{ result: CommandResult }>;
      if (!rows[0]) throw new EmployeeError(404, 'OPERATION_NOT_FOUND');
      return rows[0].result;
    });
  }
  private async revalidate(
    r: QueryRunner,
    assignment: Assignment,
    employeeVersion?: number,
  ): Promise<void> {
    const employees = (await r.query(
      'SELECT record FROM employees.employee_records WHERE id=$1',
      [assignment.employeeId],
    )) as Array<{ record: Employee }>;
    requireMechanic(
      employees[0]?.record ?? null,
      assignment.requiredSpecialty,
      employeeVersion,
    );
    const start = assignment.startsAt,
      end = assignment.endsAt;
    const calendar = (await r.query(
      "SELECT ($1::timestamptz AT TIME ZONE 'America/La_Paz')::date = ($2::timestamptz AT TIME ZONE 'America/La_Paz')::date AS same_day",
      [start, end],
    )) as Array<{ same_day: boolean }>;
    if (!calendar[0]?.same_day)
      throw new EmployeeError(409, 'CROSSES_MIDNIGHT');
    const shifts = (await r.query(
      "SELECT id FROM employees.employee_shifts WHERE employee_id=$1 AND active AND weekday=EXTRACT(ISODOW FROM ($2::timestamptz AT TIME ZONE 'America/La_Paz')) AND starts_at <= ($2::timestamptz AT TIME ZONE 'America/La_Paz')::time AND ends_at >= ($3::timestamptz AT TIME ZONE 'America/La_Paz')::time AND (break_start IS NULL OR break_start >= ($3::timestamptz AT TIME ZONE 'America/La_Paz')::time OR break_end <= ($2::timestamptz AT TIME ZONE 'America/La_Paz')::time)",
      [assignment.employeeId, start, end],
    )) as Array<{ id: string }>;
    if (!shifts.length) throw new EmployeeError(409, 'OUTSIDE_WORKING_HOURS');
    const absences = (await r.query(
      "SELECT id FROM employees.employee_absences WHERE employee_id=$1 AND active AND starts_on <= ($2::timestamptz AT TIME ZONE 'America/La_Paz')::date AND ends_on >= ($2::timestamptz AT TIME ZONE 'America/La_Paz')::date",
      [assignment.employeeId, start],
    )) as Array<{ id: string }>;
    if (absences.length) throw new EmployeeError(409, 'EMPLOYEE_ABSENT');
    const overlaps = (await r.query(
      "SELECT id FROM employees.employee_assignments WHERE employee_id=$1 AND status IN ('reserved','confirmed') AND id<>$4 AND starts_at < $3::timestamptz AND ends_at > $2::timestamptz",
      [assignment.employeeId, start, end, assignment.id],
    )) as Array<{ id: string }>;
    if (overlaps.length) throw new EmployeeError(409, 'ASSIGNMENT_OVERLAP');
  }
  execute(
    sagaId: string,
    command: AssignmentCommand,
    body: CommandBody,
    clientId: string,
  ): Promise<CommandResult> {
    const fingerprint = digest({ clientId, command, sagaId, body });
    return this.transaction(async (r) => {
      for (const key of [
        'cu15-operation:' + body.operationId,
        'cu15-saga:' + sagaId,
      ])
        await r.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          key,
        ]);
      const previous = (await r.query(
        'SELECT result FROM employees.cu15_operations WHERE operation_id=$1',
        [body.operationId],
      )) as Array<{ result: CommandResult }>;
      if (previous[0]) {
        if (previous[0].result.fingerprint !== fingerprint)
          throw new EmployeeError(409, 'IDEMPOTENCY_CONFLICT');
        return { ...previous[0].result, replayed: true };
      }
      const current = await this.current(r, sagaId);
      const employeeId =
        current && !('tombstone' in current)
          ? current.employeeId
          : body.employeeId;
      const orderId =
        current && !('tombstone' in current) ? current.orderId : body.orderId;
      if (orderId)
        await r.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'cu15-order:' + orderId,
        ]);
      if (employeeId) await employeeLock(r, employeeId);
      let resource: AssignmentResource | null = null,
        errorCode: string | null = null;
      try {
        if (current?.status === 'released' && command !== 'release_assignment')
          throw new EmployeeError(409, 'ASSIGNMENT_RELEASED');
        if ((current?.version ?? 0) !== body.expectedVersion)
          throw new EmployeeError(409, 'VERSION_CONFLICT');
        if (command === 'reserve_assignment') {
          if (current)
            throw new EmployeeError(409, 'ASSIGNMENT_ALREADY_EXISTS');
          if (body.startsAt! <= new Date().toISOString())
            throw new EmployeeError(409, 'ASSIGNMENT_START_NOT_FUTURE');
          const candidate: Assignment = {
            id: randomUUID(),
            sagaId,
            orderId: body.orderId!,
            employeeId: body.employeeId!,
            requiredSpecialty: body.requiredSpecialty!,
            startsAt: body.startsAt!,
            endsAt: body.endsAt!,
            status: 'reserved',
            version: 1,
            orderConfirmedObserved: false,
          };
          await this.revalidate(r, candidate, body.employeeVersion);
          const occupied = (await r.query(
            "SELECT id FROM employees.employee_assignments WHERE order_id=$1 AND status IN ('reserved','confirmed')",
            [candidate.orderId],
          )) as unknown[];
          if (occupied.length)
            throw new EmployeeError(409, 'ORDER_ASSIGNMENT_IN_PROGRESS');
          await r.query(
            "INSERT INTO employees.employee_assignments(id,employee_id,starts_at,ends_at,status,reference,created_at,saga_id,order_id,required_specialty,version,order_confirmed_observed) VALUES($1,$2,$3,$4,'reserved',$5::text,now(),$6,$5::uuid,$7,1,false)",
            [
              candidate.id,
              candidate.employeeId,
              candidate.startsAt,
              candidate.endsAt,
              candidate.orderId,
              sagaId,
              candidate.requiredSpecialty,
            ],
          );
          resource = candidate;
        } else if (command === 'confirm_assignment') {
          if (!current || 'tombstone' in current)
            throw new EmployeeError(409, 'ASSIGNMENT_NOT_FOUND');
          if (current.status !== 'reserved')
            throw new EmployeeError(409, 'ASSIGNMENT_NOT_RESERVED');
          if (current.endsAt <= new Date().toISOString())
            throw new EmployeeError(409, 'ASSIGNMENT_ENDED');
          await this.revalidate(r, current);
          await r.query(
            "UPDATE employees.employee_assignments SET status='confirmed',version=version+1 WHERE saga_id=$1",
            [sagaId],
          );
          resource = {
            ...current,
            status: 'confirmed',
            version: current.version + 1,
          };
        } else if (!current) {
          await r.query(
            'INSERT INTO employees.cu15_tombstones(saga_id,version) VALUES($1,1)',
            [sagaId],
          );
          resource = {
            sagaId,
            status: 'released',
            version: 1,
            tombstone: true,
          };
        } else if (current.status === 'released') {
          resource = current;
        } else {
          await r.query(
            "UPDATE employees.employee_assignments SET status='released',version=version+1 WHERE saga_id=$1",
            [sagaId],
          );
          resource = {
            ...current,
            status: 'released',
            version: current.version + 1,
          };
        }
      } catch (error) {
        if (!(error instanceof EmployeeError) || error.status !== 409)
          throw error;
        errorCode = error.code;
      }
      const committedAt = new Date().toISOString();
      const result: CommandResult = {
        operationId: body.operationId,
        sagaId,
        command,
        fingerprint,
        outcome: errorCode ? 'rejected' : 'applied',
        resource,
        errorCode,
        committedAt,
        replayed: false,
      };
      await r.query(
        'INSERT INTO employees.cu15_operations(operation_id,saga_id,command,fingerprint,outcome,result,committed_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',
        [
          body.operationId,
          sagaId,
          command,
          fingerprint,
          result.outcome,
          JSON.stringify(result),
          committedAt,
        ],
      );
      await r.query(
        'INSERT INTO employees.cu15_audit(id,saga_id,operation_id,actor_subject,executed_by,occurred_at,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [
          randomUUID(),
          sagaId,
          body.operationId,
          body.initiatedBy,
          clientId,
          committedAt,
          JSON.stringify(result),
        ],
      );
      const eventId = randomUUID();
      const eventType = errorCode
        ? 'employees.cu15.command.rejected.v1'
        : 'employees.cu15.assignment.' + resource!.status + '.v1';
      const aggregateId =
        resource && !('tombstone' in resource) ? resource.id : sagaId;
      const data = errorCode
        ? { sagaId, operationId: body.operationId, command, errorCode }
        : {
            ...resource,
            ...('tombstone' in resource!
              ? {}
              : { assignmentId: (resource as Assignment).id }),
            ...(body.reasonCode ? { reasonCode: body.reasonCode } : {}),
          };
      const event = {
        eventId,
        schemaVersion: 1,
        eventType,
        producer: 'employees',
        aggregateType: 'assignment',
        aggregateId,
        aggregateVersion: resource?.version ?? current?.version ?? 0,
        correlationId: sagaId,
        causationId: body.operationId,
        occurredAt: committedAt,
        initiatedBy: body.initiatedBy,
        executedBy: clientId,
        data,
      };
      await r.query(
        'INSERT INTO employees.cu15_outbox(id,event_type,aggregate_type,aggregate_id,aggregate_version,saga_id,causation_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
        [
          eventId,
          eventType,
          event.aggregateType,
          aggregateId,
          event.aggregateVersion,
          sagaId,
          body.operationId,
          JSON.stringify(event),
          committedAt,
        ],
      );
      return result;
    });
  }
}
