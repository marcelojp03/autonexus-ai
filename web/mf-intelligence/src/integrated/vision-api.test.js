import { describe, expect, it } from 'vitest';
import { ANALYZE, ANALYSES, MODEL, canAnalyze, explain, labelText, percent, summary, workshopDate } from './vision-api.js';

const analysis = {
  labels: [
    { name: 'scratch', score: 0.82, threshold: 0.35, flagged: true },
    { name: 'dent', score: 0.11, threshold: 0.4, flagged: false },
  ],
};

describe('CU23 web contract', () => {
  it('requests only the fields the schema publishes', () => {
    for (const query of [MODEL, ANALYSES, ANALYZE]) {
      expect(query).not.toMatch(/fragment/i);
    }
    expect(ANALYZE).toContain('analyzeEvidence(assignmentId: $assignmentId, evidenceId: $evidenceId)');
    expect(ANALYSES).toContain('assignmentAnalyses(assignmentId: $assignmentId)');
  });

  it('summarises only the labels above their threshold', () => {
    expect(summary(analysis)).toBe('Rayón (82%)');
    expect(summary({ labels: [] })).toBe('Sin señales sobre el umbral del modelo');
  });

  it('formats scores as percentages and known labels in Spanish', () => {
    expect(percent(0.8266)).toBe(82.7);
    expect(labelText('glass_shatter')).toBe('Cristal roto');
    expect(labelText('unknown_condition')).toBe('unknown_condition');
  });

  it('requires both the permission and a ready model before offering analysis', () => {
    expect(canAnalyze(['intelligence:analyze'], { ready: true })).toBe(true);
    expect(canAnalyze(['intelligence:read'], { ready: true })).toBe(false);
    expect(canAnalyze(['intelligence:analyze'], { ready: false })).toBe(false);
    expect(canAnalyze(null, { ready: true })).toBe(false);
  });

  it('explains MODEL_NOT_READY without promising a prediction', () => {
    expect(explain({ extensions: { code: 'MODEL_NOT_READY' } })).toContain('modelo visual no está disponible');
    expect(explain({ code: 'EVIDENCE_NOT_AVAILABLE' })).toContain('no está disponible o no pertenece');
  });

  it('uses the workshop calendar day, not UTC midnight', () => {
    // 2026-11-01T02:30Z is still 2026-10-31 in America/La Paz (UTC-4).
    expect(workshopDate(new Date('2026-11-01T02:30:00Z'))).toBe('2026-10-31');
    expect(workshopDate(new Date('2026-11-01T02:30:00Z'), 1)).toBe('2026-11-01');
  });
});
