import { createHash, randomUUID } from 'node:crypto';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import {
  EmployeeError,
  type Command,
  type Employee,
  type History,
  type PageQuery,
  type Transition,
} from '../../domain/employee.js';
import type {
  EmployeeRepository,
  IdentityOutcome,
  MutationResult,
  Page,
} from '../../application/employee-repository.js';
import type { IdentityDesired } from '../../application/identity-gateway.js';
import { dataSourceOptions } from './data-source-options.js';
type RecordRow = { record: Employee };
export class PostgresEmployeeRepository
  implements EmployeeRepository, OnApplicationShutdown
{
  private source?: DataSource;
  private initializing?: Promise<DataSource>;
  private async database(): Promise<DataSource> {
    this.source ??= new DataSource(dataSourceOptions());
    if (!this.source.isInitialized) {
      this.initializing ??= this.source.initialize();
      try {
        await this.initializing;
      } finally {
        this.initializing = undefined;
      }
    }
    return this.source;
  }
  async onApplicationShutdown() {
    try {
      await this.initializing;
    } catch {
      /* no initialized pool */
    }
    if (this.source?.isInitialized) await this.source.destroy();
  }
  private failure(error: unknown): never {
    if (error instanceof EmployeeError) throw error;
    const sql = error as { code?: string; constraint?: string };
    if (sql.code === '23505' && sql.constraint === 'employee_document_unique')
      throw new EmployeeError(409, 'DUPLICATE_DOCUMENT');
    if (sql.code === '23505' && sql.constraint === 'employee_email_unique')
      throw new EmployeeError(409, 'DUPLICATE_EMAIL');
    throw new EmployeeError(503, 'PERSISTENCE_UNAVAILABLE');
  }
  private async locked<T>(
    keys: string[],
    work: (r: QueryRunner) => Promise<T>,
  ): Promise<T> {
    let runner: QueryRunner | undefined;
    const acquired: string[] = [];
    try {
      runner = (await this.database()).createQueryRunner();
      await runner.connect();
      for (const key of keys) {
        const rows = await this.rows<Array<{ acquired: boolean }>>(
          runner,
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
          [key],
        );
        if (!rows[0]?.acquired)
          throw new EmployeeError(503, 'PERSISTENCE_UNAVAILABLE');
        acquired.push(key);
      }
      return await work(runner);
    } catch (error) {
      return this.failure(error);
    } finally {
      if (runner) {
        for (const key of acquired.reverse()) {
          try {
            await runner.query(
              'SELECT pg_advisory_unlock(hashtextextended($1,0))',
              [key],
            );
          } catch {
            /* broken connections are discarded by pg */
          }
        }
        await runner.release();
      }
    }
  }
  private rows<T>(
    runner: QueryRunner,
    sql: string,
    parameters: unknown[],
  ): Promise<T> {
    return runner.query(sql, parameters) as Promise<T>;
  }
  private async find(r: QueryRunner, id: string): Promise<Employee | null> {
    const rows = await this.rows<RecordRow[]>(
      r,
      'SELECT record FROM employees.employee_records WHERE id=$1',
      [id],
    );
    return rows[0]?.record ?? null;
  }
  get(id: string): Promise<Employee> {
    return this.locked([], async (r) => {
      const employee = await this.find(r, id);
      if (!employee) throw new EmployeeError(404, 'EMPLOYEE_NOT_FOUND');
      return employee;
    });
  }
  list(q: PageQuery): Promise<Page<Employee>> {
    return this.locked([], async (r) => {
      const values: unknown[] = [];
      const clauses: string[] = [];
      if (q.status) {
        values.push(q.status);
        clauses.push("record->>'status'=$" + values.length);
      }
      if (q.search) {
        values.push(q.search.toLowerCase());
        const p = '$' + values.length;
        clauses.push(
          "(strpos(lower(record->>'firstName')," +
            p +
            ")>0 OR strpos(lower(record->>'lastName')," +
            p +
            ")>0 OR strpos(lower((record->>'firstName')||' '||(record->>'lastName'))," +
            p +
            ")>0 OR strpos(lower(record->>'document')," +
            p +
            ')>0)',
        );
      }
      const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
      const count = await this.rows<Array<{ count: string }>>(
        r,
        'SELECT count(*) FROM employees.employee_records' + where,
        values,
      );
      const rows = await this.rows<RecordRow[]>(
        r,
        'SELECT record FROM employees.employee_records' +
          where +
          " ORDER BY record->>'createdAt',id LIMIT $" +
          (values.length + 1) +
          ' OFFSET $' +
          (values.length + 2),
        [...values, q.limit, q.offset],
      );
      return {
        items: rows.map((row) => row.record),
        total: Number(count[0]!.count),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }
  history(id: string, q: PageQuery): Promise<Page<History>> {
    return this.locked([], async (r) => {
      if (!(await this.find(r, id)))
        throw new EmployeeError(404, 'EMPLOYEE_NOT_FOUND');
      const rows = await this.rows<Array<{ entry: History }>>(
        r,
        'SELECT entry FROM employees.employee_history WHERE employee_id=$1 ORDER BY version,id LIMIT $2 OFFSET $3',
        [id, q.limit, q.offset],
      );
      const count = await this.rows<Array<{ count: string }>>(
        r,
        'SELECT count(*) FROM employees.employee_history WHERE employee_id=$1',
        [id],
      );
      return {
        items: rows.map((row) => row.entry),
        total: Number(count[0]!.count),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }
  execute(
    c: Command,
    actor: string,
    apply: (current: Employee | null) => Transition,
  ): Promise<MutationResult> {
    const keys = [
      'operation:' + c.operationId,
      ...(c.id ? ['employee:' + c.id] : []),
    ];
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ actor, command: c }))
      .digest('hex');
    return this.locked(keys, async (r) => {
      await r.startTransaction();
      try {
        const previous = await this.rows<
          Array<{ fingerprint: string; result: Employee }>
        >(
          r,
          'SELECT fingerprint,result FROM employees.employee_operations WHERE operation_id=$1',
          [c.operationId],
        );
        if (previous[0]) {
          if (previous[0].fingerprint !== fingerprint)
            throw new EmployeeError(409, 'IDEMPOTENCY_CONFLICT');
          await r.commitTransaction();
          return { employee: previous[0].result, replayed: true };
        }
        const change = apply(c.id ? await this.find(r, c.id) : null),
          employee = change.employee;
        const assignments = await this.rows<
          Array<{ required_specialty: string }>
        >(
          r,
          "SELECT required_specialty FROM employees.employee_assignments WHERE employee_id=$1 AND saga_id IS NOT NULL AND status IN ('reserved','confirmed') AND ends_at>now()",
          [employee.id],
        );
        if (
          assignments.some(
            (a) =>
              employee.status !== 'active' ||
              !employee.mechanicEnabled ||
              !employee.specialties.includes(a.required_specialty),
          )
        )
          throw new EmployeeError(409, 'AFFECTS_PENDING_ASSIGNMENT');
        await r.query(
          'INSERT INTO employees.employee_records(id,record,subject) VALUES($1,$2::jsonb,$3) ON CONFLICT(id) DO UPDATE SET record=EXCLUDED.record,subject=EXCLUDED.subject',
          [employee.id, JSON.stringify(employee), employee.access.subject],
        );
        if (change.action) {
          const entry: History = {
            id: randomUUID(),
            employeeId: employee.id,
            operationId: c.operationId,
            action: change.action,
            actorSubject: actor,
            occurredAt: employee.updatedAt,
            version: employee.version,
            snapshot: employee,
          };
          await r.query(
            'INSERT INTO employees.employee_history(id,employee_id,version,entry) VALUES($1,$2,$3,$4::jsonb)',
            [entry.id, employee.id, employee.version, JSON.stringify(entry)],
          );
        }
        if (change.synchronize) {
          const desired: IdentityDesired = {
            employeeId: employee.id,
            subject: employee.access.subject,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            enabled: employee.status === 'active',
          };
          await r.query(
            'INSERT INTO employees.identity_intents(employee_id,version,desired) VALUES($1,$2,$3::jsonb) ON CONFLICT(employee_id) DO UPDATE SET version=EXCLUDED.version,desired=EXCLUDED.desired',
            [employee.id, employee.version, JSON.stringify(desired)],
          );
        }
        await r.query(
          'INSERT INTO employees.employee_operations(operation_id,fingerprint,result) VALUES($1,$2,$3::jsonb)',
          [c.operationId, fingerprint, JSON.stringify(employee)],
        );
        await r.commitTransaction();
        return { employee, replayed: false };
      } catch (error) {
        await r.rollbackTransaction();
        throw error;
      }
    });
  }
  async synchronize(
    id: string,
    attempt: (desired: IdentityDesired) => Promise<IdentityOutcome>,
  ): Promise<void> {
    await this.locked(['employee:' + id], async (r) => {
      const intents = await this.rows<
        Array<{ version: number; desired: IdentityDesired }>
      >(
        r,
        'SELECT version,desired FROM employees.identity_intents WHERE employee_id=$1',
        [id],
      );
      if (!intents[0]) return;
      const intent = intents[0],
        employee = await this.find(r, id);
      if (!employee || employee.version !== intent.version)
        throw new EmployeeError(503, 'PERSISTENCE_UNAVAILABLE');
      employee.access.attempts++;
      employee.access.status = 'pending';
      employee.access.errorCode = null;
      await r.query(
        'UPDATE employees.employee_records SET record=$2::jsonb WHERE id=$1',
        [id, JSON.stringify(employee)],
      );
      // Session lock remains held, but no SQL transaction spans the remote request.
      const outcome = await attempt(intent.desired);
      if ('subject' in outcome) {
        employee.access.subject = outcome.subject;
        employee.access.status = 'synced';
        employee.access.errorCode = null;
      } else {
        employee.access.status = outcome.conflict ? 'conflict' : 'failed';
        employee.access.errorCode = outcome.code;
      }
      await r.startTransaction();
      try {
        await r.query(
          "UPDATE employees.employee_records SET record=$2::jsonb,subject=$3 WHERE id=$1 AND (record->>'version')::integer=$4",
          [
            id,
            JSON.stringify(employee),
            employee.access.subject,
            intent.version,
          ],
        );
        if ('subject' in outcome)
          await r.query(
            'DELETE FROM employees.identity_intents WHERE employee_id=$1 AND version=$2',
            [id, intent.version],
          );
        await r.commitTransaction();
      } catch (error) {
        await r.rollbackTransaction();
        throw error;
      }
    });
  }
}
