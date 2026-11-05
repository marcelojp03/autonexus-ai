import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixturePath = 'output/stack/cu16-proof.accounts.private.json';
const output = resolve('output/cu27');
const accounts = JSON.parse(readFileSync(resolve(fixturePath), 'utf8')).accounts;
const accountKeys = Object.keys(accounts);
const adminPresent = Object.hasOwn(accounts, 'admin');
const report = {
  status: 'blocked',
  pass: false,
  rejection: {
    status: 'NOT_RUN',
    code: adminPresent ? 'ADMIN_AUTHORITY_AND_RESTORE_NOT_VERIFIED' : 'ADMIN_FIXTURE_MISSING',
    blocker: adminPresent
      ? 'Fixture changed since bounded inspection. Admin security:write authority, exact employee/role identity and durable restoration must be verified before any mutation; this recorder performs no acceptance actions.'
      : 'Approved fixture contains mechanicA, mechanicB, chief, reception and finance, but no admin account. Missing an approved admin fixture with security:write for exact role snapshot, revocation and finally restoration. No other credentials were searched or used.',
  },
  fixture: { path: fixturePath, accountKeys, valuesPrinted: false },
  stages: [{ name: 'safe_fixture_key_preflight', status: 'BLOCKED' }],
  meaningfulSteps: 1,
  employeeSubjectMatchVerified: false,
  exactRoleVersionVerified: false,
  restorationStrategyVerified: false,
  mutationsAttempted: 0,
  restoration: { required: false, status: 'NOT_NEEDED_NO_MUTATION' },
  browserLaunched: false,
  originalProfileOpened: false,
  ownerRejectionObserved: false,
  statuses: { pwa: 'BLOCKED_PREFLIGHT', s3: false, visual: 'NOT_RUN', mobile: 'NOT_RUN_INDEPENDENT' },
  independentS3: false,
  visual: 'NOT_RUN',
  exit: 2,
  finishedAt: new Date().toISOString(),
};
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'pwa-rejection.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, code: report.rejection.code, accountKeys, mutationsAttempted: 0, exit: report.exit }));
process.exitCode = report.exit;
