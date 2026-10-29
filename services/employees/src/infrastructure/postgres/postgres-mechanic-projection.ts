import { eligibility } from '../../domain/assignment.js';
import { type Employee, type PageQuery } from '../../domain/employee.js';
import { Cu15Database } from './cu15-database.js';
export class PostgresMechanicProjection extends Cu15Database {
  page(q: PageQuery) {
    return this.transaction(async (r) => {
      const predicate =
        "($1::text IS NULL OR strpos(lower((record->>'firstName') || ' ' || (record->>'lastName')),lower($1))>0)";
      const rows = (await r.query(
        'SELECT record FROM employees.employee_records WHERE ' +
          predicate +
          " ORDER BY lower(record->>'lastName'),id LIMIT $2 OFFSET $3",
        [q.search ?? null, q.limit, q.offset],
      )) as Array<{ record: Employee }>;
      const count = (await r.query(
        'SELECT count(*) FROM employees.employee_records WHERE ' + predicate,
        [q.search ?? null],
      )) as Array<{ count: string }>;
      return {
        items: rows.map(({ record: e }) => {
          const eligibilityReasons = eligibility(e);
          return {
            id: e.id,
            fullName: e.firstName + ' ' + e.lastName,
            jobTitle: e.jobTitle,
            status: e.status,
            version: e.version,
            mechanicEnabled: e.mechanicEnabled ?? false,
            specialties: e.specialties,
            eligible: !eligibilityReasons.length,
            eligibilityReasons,
          };
        }),
        total: Number(count[0]!.count),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }
}
