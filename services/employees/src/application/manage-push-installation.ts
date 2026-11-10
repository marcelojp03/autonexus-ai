import { EmployeeError, object, only } from '../domain/employee.js';
import { Cu15Database } from '../infrastructure/postgres/cu15-database.js';

export class ManagePushInstallation extends Cu15Database {
  async register(subject: string, input: unknown): Promise<void> {
    const body = object(input);
    only(body, ['fid', 'appId', 'platform']);
    const fid = body.fid;
    const appId = body.appId;
    if (typeof fid !== 'string' || fid.length < 20 || fid.length > 256 || !/^[A-Za-z0-9_-]+$/.test(fid))
      throw new EmployeeError(400, 'INVALID_INSTALLATION');
    if (appId !== 'bo.edu.uagrm.autonexus.autonexus_mobile' || body.platform !== 'android')
      throw new EmployeeError(400, 'INVALID_INSTALLATION');
    await this.transaction(async (runner) => {
      const matches = await runner.query(
        "SELECT id FROM employees.employee_records WHERE subject=$1 AND record->>'status'='active' AND record->>'mechanicEnabled'='true' FOR UPDATE",
        [subject],
      ) as Array<{id: string}>;
      if (!matches[0]) throw new EmployeeError(403, 'MECHANIC_ACCOUNT_REQUIRED');
      await runner.query(
        `INSERT INTO employees.push_installations(fid,employee_id,subject,app_id,platform)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(fid) DO UPDATE SET employee_id=EXCLUDED.employee_id,subject=EXCLUDED.subject,
           app_id=EXCLUDED.app_id,platform=EXCLUDED.platform,updated_at=now(),last_seen_at=now(),state='active'`,
        [fid, matches[0].id, subject, appId, 'android'],
      );
    });
  }

  async unregister(subject: string, input: unknown): Promise<void> {
    const body = object(input);
    only(body, ['fid']);
    const fid = body.fid;
    if (typeof fid !== 'string' || fid.length < 20 || fid.length > 256 || !/^[A-Za-z0-9_-]+$/.test(fid))
      throw new EmployeeError(400, 'INVALID_INSTALLATION');
    await this.transaction(async (runner) => {
      await runner.query(
        "UPDATE employees.push_installations SET state='inactive',updated_at=now() WHERE fid=$1 AND subject=$2",
        [fid, subject],
      );
    });
  }
}
