import { z } from 'zod';

const uuid = z.uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const version = z.number().int().positive();
const timestamp = z.iso.datetime({ offset: true });
const priority = z.enum(['baja', 'normal', 'alta', 'urgente']);
const orderStatus = z.enum(['pending_quote', 'quote_requested', 'quote_approved', 'cancelled', 'confirmation_pending', 'confirmed', 'completed']);
const executionStatus = z.enum(['in_progress', 'pending_verification', 'completed']);
const format = { responseFormat: z.enum(['json', 'markdown']).default('json') };
const paging = { limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(100000).default(0) };
const civilDate = z.iso.date().refine(value => value.slice(0, 4) !== '0000');
const agendaFields = { from: civilDate, to: civilDate, priority: priority.optional(), ...paging, ...format };
const periodValid = (input: { from: string; to: string }) => {
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000 + 1;
  return days >= 1 && days <= 31;
};
const agendaInput = z.strictObject(agendaFields).refine(periodValid, 'Invalid date interval');
const teamAgendaInput = z.strictObject({ ...agendaFields, employeeId: uuid.optional() }).refine(periodValid, 'Invalid date interval');
const executionInput = z.strictObject({ assignmentId: uuid, advanceLimit: paging.limit, advanceOffset: paging.offset, ...format });

const service = z.object({ serviceId: uuid, serviceName: z.string().min(1).max(200), quantity: count, estimatedMinutes: count });
export const orderProjection = z.object({ id: uuid, number: z.string().min(1).max(100), status: orderStatus, priority,
  version, createdAt: timestamp, updatedAt: timestamp, items: z.array(service).max(20) });
export const agendaProjection = z.object({ assignmentId: uuid, orderId: uuid, orderNumber: z.string().min(1).max(100),
  employee: z.object({ id: uuid }), startsAt: timestamp, endsAt: timestamp, priority,
  status: z.enum(['confirmed', 'completed']), orderVersion: version, assignmentVersion: version,
  observedAt: timestamp, confirmationObservation: z.enum(['observed', 'pending']),
  executionStatus: z.enum(['not_started', 'in_progress', 'pending_verification', 'completed']),
  executionProgress: z.object({ advances: count, lastAdvanceAt: timestamp.nullable(), availableEvidence: count }),
  services: z.array(service).max(20) });
const evidenceCounts = z.object({ pending: count, available: count, failed: count });
const advanceFields = { id: uuid, sequence: version, minutesWorked: count, occurredAt: timestamp, recordedAt: timestamp, version };
const executionFields = { id: uuid, orderId: uuid, orderNumber: z.string().min(1).max(100),
  assignmentId: uuid, employeeId: uuid, status: executionStatus, startedAt: timestamp, version, evidenceSummary: evidenceCounts };
export const executionOwnerProjection = z.object({ ...executionFields,
  advances: z.array(z.object({ ...advanceFields, evidences: z.array(z.object({ state: z.enum(['pending', 'available', 'failed']) })) })) });
export const executionProjection = z.object({ ...executionFields,
  advances: z.array(z.object({ ...advanceFields, evidenceCounts })) });
export const ownerPage = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item).max(50), total: count,
  limit: z.number().int().min(1).max(50), offset: count });
export const agendaPageMetadata = z.object({ from: civilDate, to: civilDate,
  timeZone: z.literal('America/La_Paz'), observedAt: timestamp });

const pageSchema = z.strictObject({ total: count, limit: z.number().int().min(1).max(50), offset: count,
  hasMore: z.boolean(), nextOffset: count.nullable() });
const envelopeFields = { source: z.literal('operations'), observedAt: timestamp, scope: z.enum(['global', 'self', 'team']) };
const successEnvelope = z.strictObject({ ...envelopeFields, ok: z.literal(true), data: z.union([z.array(orderProjection), orderProjection,
    z.array(agendaProjection), executionProjection]), period: z.strictObject({ from: civilDate, to: civilDate,
      timeZone: z.literal('America/La_Paz') }).optional(), page: pageSchema.optional() });
const errorEnvelope = z.strictObject({ ...envelopeFields, ok: z.literal(false), error: z.strictObject({ code: z.enum([
    'OWNER_UNAUTHORIZED', 'OWNER_FORBIDDEN', 'OWNER_NOT_FOUND', 'OWNER_UNAVAILABLE', 'OWNER_INVALID_RESPONSE', 'OWNER_RESPONSE_TOO_LARGE', 'OWNER_TIMEOUT'
  ]), status: z.number().int(), message: z.literal('Operations consultation failed') }) });
export const outputSchema = z.strictObject({ ...envelopeFields, ok: z.boolean(),
  data: successEnvelope.shape.data.optional(), period: successEnvelope.shape.period,
  page: successEnvelope.shape.page, error: errorEnvelope.shape.error.optional()
}).superRefine((value, context) => {
  if (!(value.ok ? successEnvelope : errorEnvelope).safeParse(value).success) {
    context.addIssue({ code: 'custom', message: 'Invalid consultation envelope' });
  }
});
export type ConsultationEnvelope = z.infer<typeof successEnvelope> | z.infer<typeof errorEnvelope>;
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
function definition(name: string, title: string, description: string, inputSchema: z.ZodType, scope: string, permission: string) {
  return { name, title, description, inputSchema, outputSchema, scope, permission, annotations };
}
export const TOOL_DEFINITIONS = [
  definition('autonexus_list_orders', 'List orders', 'List globally authorized orders without personal data or prices.',
    z.strictObject({ ...paging, status: z.enum(['pending_quote', 'quote_requested', 'quote_approved', 'cancelled', 'confirmation_pending', 'confirmed']).optional(), ...format }), 'mcp:orders:read', 'orders:read'),
  definition('autonexus_get_order', 'Get order', 'Read one globally authorized order with safe service metadata.',
    z.strictObject({ id: uuid, ...format }), 'mcp:orders:read', 'orders:read'),
  definition('autonexus_list_my_agenda', 'My agenda', 'Read the active employee agenda for an inclusive civil date interval in America/La_Paz.', agendaInput, 'mcp:agenda:read:self', 'agenda:read:self'),
  definition('autonexus_list_team_agenda', 'Team agenda', 'Read an authorized team agenda for an inclusive civil date interval in America/La_Paz.', teamAgendaInput, 'mcp:agenda:read:team', 'agenda:read:team'),
  definition('autonexus_get_my_execution', 'My execution', 'Read execution metadata by assignmentId; advances are paginated locally from the bounded full owner aggregate.', executionInput, 'mcp:executions:read:self', 'executions:read:self'),
  definition('autonexus_get_team_execution', 'Team execution', 'Read authorized team execution metadata by assignmentId; advances are paginated locally from the bounded full owner aggregate.', executionInput, 'mcp:executions:read:team', 'executions:read:team')
] as const;

export class ConsultationInputError extends Error {
  constructor() { super('Unknown tool or invalid consultation arguments'); this.name = 'ConsultationInputError'; }
}
export function parseToolInput(toolName: string, input: unknown): Record<string, unknown> {
  const tool = TOOL_DEFINITIONS.find(tool => tool.name === toolName);
  if (!tool) throw new ConsultationInputError();
  const result = tool.inputSchema.safeParse(input);
  if (!result.success) throw new ConsultationInputError();
  return result.data as Record<string, unknown>;
}
export class OperationsReadError extends Error {
  constructor(public readonly code: 'OWNER_UNAUTHORIZED' | 'OWNER_FORBIDDEN' | 'OWNER_NOT_FOUND' | 'OWNER_UNAVAILABLE' | 'OWNER_INVALID_RESPONSE' | 'OWNER_RESPONSE_TOO_LARGE' | 'OWNER_TIMEOUT', public readonly status = 503) {
    super('Operations consultation failed'); this.name = 'OperationsReadError';
  }
}
export interface ConsultationReader { read(toolName: string, input: unknown): Promise<unknown> }
