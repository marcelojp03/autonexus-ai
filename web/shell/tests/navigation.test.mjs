import assert from 'node:assert/strict';
import test from 'node:test';
import {employeeEntryPath, sessionLabel} from '../src/navigation.ts';
import {employeeLanding} from '../../mf-employees/src/app/features/agenda/agenda.contract.ts';

test('team access takes precedence over self access without depending on role names', () => {
  assert.equal(employeeEntryPath(['agenda:read:self', 'agenda:read:team']), '/employees/agenda/team');
  assert.equal(employeeEntryPath(['agenda:read:self']), '/employees/agenda');
  assert.equal(employeeEntryPath(['employees:read', 'agenda:read:team']), '/employees/list');
  assert.equal(employeeEntryPath([]), '/employees/assistant');
  for (const effective of [[], ['agenda:read:self'], ['agenda:read:team', 'agenda:read:self'], ['employees:read', 'agenda:read:team']]) {
    assert.equal(employeeEntryPath(effective), '/employees/' + employeeLanding(effective));
  }
});

test('session labels are readable and preserve multi-role presentation', () => {
  assert.equal(sessionLabel(['jefe_taller']), 'Jefe de taller');
  assert.equal(sessionLabel(['mecanico', 'jefe_taller']), 'Mecánico · Jefe de taller');
  assert.equal(sessionLabel(['limited_custom']), 'Rol personalizado');
  assert.equal(sessionLabel([]), '');
});
