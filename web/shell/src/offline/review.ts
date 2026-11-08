export const inspectionLabels = ['crack', 'dent', 'glass_shatter', 'scratch'] as const;
export const inspectionReasons = ['operator_manual', 'model_unavailable', 'inference_failed', 'insufficient_resources', 'below_thresholds', 'input_rejected'] as const;
export interface InspectionReview {
  schemaVersion: 1;
  mode: 'manual' | 'assisted';
  interpretation: string;
  labels?: string[];
  reason: typeof inspectionReasons[number];
  reviewedAt: string;
}

export function validateInspectionReview(value: unknown): asserts value is InspectionReview {
  const review = value as InspectionReview;
  if (!review || typeof review !== 'object' || Array.isArray(review)
    || Object.keys(review).some(key => !['schemaVersion', 'mode', 'interpretation', 'labels', 'reason', 'reviewedAt'].includes(key))
    || review.schemaVersion !== 1 || !['manual', 'assisted'].includes(review.mode)
    || !inspectionReasons.includes(review.reason) || typeof review.interpretation !== 'string'
    || review.interpretation.trim().length < 3 || review.interpretation.length > 1600
    || typeof review.reviewedAt !== 'string' || !review.reviewedAt.includes('T') || !Number.isFinite(Date.parse(review.reviewedAt))
    || ('labels' in review && (!Array.isArray(review.labels) || new Set(review.labels).size !== review.labels.length
      || review.labels.some(label => !inspectionLabels.includes(label as typeof inspectionLabels[number]))))) {
    throw new Error('OFFLINE_INSPECTION_REVIEW_INVALID');
  }
}

export function reviewDescription(review: InspectionReview): string {
  validateInspectionReview(review);
  return '[Inspección ' + review.mode + '; motivo: ' + review.reason + '; etiquetas humanas: '
    + (review.labels?.join(', ') || 'ninguna') + '] ' + review.interpretation;
}
