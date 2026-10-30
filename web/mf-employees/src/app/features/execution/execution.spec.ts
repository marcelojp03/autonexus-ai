import { describe, expect, it } from 'vitest';
import { canUpload, evidenceSizeAllowed, evidenceType, executionError, mayWriteExecution, type AgendaWorkRef } from './execution.contract';

describe('CU16 evidence contract', () => {
  it('allows only the closed MIME types and declared size ceilings', () => {
    expect(evidenceType({ type: 'image/png' })).toBe('image/png');
    expect(evidenceType({ type: 'IMAGE/WEBP' })).toBe('image/webp');
    expect(evidenceType({ type: 'application/pdf' })).toBeNull();
    expect(evidenceSizeAllowed(5 * 1024 * 1024, 'image/jpeg')).toBe(true);
    expect(evidenceSizeAllowed(5 * 1024 * 1024 + 1, 'image/jpeg')).toBe(false);
    expect(evidenceSizeAllowed(20 * 1024 * 1024, 'video/mp4')).toBe(true);
    expect(canUpload(null, 1)).toBe(false);
  });

  it('keeps pending, failed and available semantics separate', () => {
    expect(executionError({ code: 'EVIDENCE_STORAGE_UNAVAILABLE' })).toMatch(/almacenamiento privado/);
    expect(executionError({ code: 'EVIDENCE_STATE_CONFLICT' })).toMatch(/no está en un estado/);
    expect(executionError({ code: 'EXECUTION_ACCESS_DENIED' })).toMatch(/asignada/);
  });

  it('allows write controls only for the current active assignee, never a read-team actor on someone else’s work', () => {
    const work: AgendaWorkRef = {
      assignmentId: 'assignment-1', orderNumber: 'OT-1', employee: { id: 'mechanic-1', status: 'active' },
      startsAt: '2026-10-30T12:00:00Z', status: 'confirmed', executionStatus: 'not_started',
      executionProgress: { advances: 0, lastAdvanceAt: null, availableEvidence: 0 },
      vehicle: { plate: 'SYN-001', make: 'Test', model: 'Fixture' },
    };
    expect(mayWriteExecution(work, 'mechanic-1', true)).toBe(true);
    expect(mayWriteExecution(work, 'manager-1', true)).toBe(false);
    expect(mayWriteExecution(work, 'mechanic-1', false)).toBe(false);
    expect(mayWriteExecution({ ...work, employee: { ...work.employee, status: 'inactive' } }, 'mechanic-1', true)).toBe(false);
  });
});
