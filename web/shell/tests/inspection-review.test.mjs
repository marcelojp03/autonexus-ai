import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDescription, validateInspectionReview } from '../src/offline/review.ts';

const review = { schemaVersion: 1, mode: 'manual', reason: 'model_unavailable', interpretation: 'Inspección manual del panel', labels: ['dent'], reviewedAt: '2026-11-07T12:00:00Z' };
test('manual review preserves explicit human information without a prediction', () => {
  assert.doesNotThrow(() => validateInspectionReview(review));
  const description = reviewDescription(review);
  for (const text of ['manual', 'model_unavailable', 'dent', review.interpretation]) assert.ok(description.includes(text));
  assert.ok(reviewDescription({ ...review, interpretation: 'x'.repeat(1600) }).length <= 2000);
});
test('review optional fields are strict and labels never inferred', () => {
  for (const change of [{ labels: ['dent', 'dent'] }, { labels: ['other'] }, { labels: null }, { interpretation: 'xx' }, { interpretation: 'x'.repeat(1601) }, { mode: 'auto' }, { reason: 'unknown' }, { reviewedAt: 'yesterday' }, { author: 'editable' }]) {
    assert.throws(() => validateInspectionReview({ ...review, ...change }));
  }
  const { labels, ...withoutLabels } = review;
  assert.doesNotThrow(() => validateInspectionReview(withoutLabels));
});
