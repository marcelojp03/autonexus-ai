import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { employeeLanding } from './agenda.contract';
import { SESSION_PORT } from '../../auth/session';
export const employeeEntryGuard: CanActivateFn = async () => {
  const session = inject(SESSION_PORT);
  const router = inject(Router);
  const subject = session.snapshot().identity?.subject;
  try {
    const result = await session.requestBusiness('query EmployeeEntry { securityCatalog { effective } }');
    if (!session.snapshot().authenticated || subject !== session.snapshot().identity?.subject) return false;
    const data = result.data as { securityCatalog?: { effective?: string[] } } | undefined;
    if (result.errors?.length || !Array.isArray(data?.securityCatalog?.effective)) return router.parseUrl('/agenda');
    return router.parseUrl(`/${employeeLanding(data.securityCatalog.effective)}`);
  } catch {
    return router.parseUrl('/agenda');
  }
};
