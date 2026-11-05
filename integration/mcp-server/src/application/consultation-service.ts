import { agendaProjection, agendaPageMetadata, orderProjection, executionOwnerProjection, ownerPage, outputSchema,
  parseToolInput, OperationsReadError, type ConsultationReader, type ConsultationEnvelope } from '../domain/consultation.js';

function page(total: number, limit: number, offset: number, returned: number) {
  const hasMore = offset + returned < total;
  return { total, limit, offset, hasMore, nextOffset: hasMore ? offset + returned : null };
}
export class ConsultationService {
  constructor(private readonly reader: ConsultationReader) {}
  async execute(toolName: string, input: unknown): Promise<ConsultationEnvelope> {
    const args = parseToolInput(toolName, input);
    const scope: 'global' | 'team' | 'self' = toolName.includes('orders') || toolName === 'autonexus_get_order' ? 'global' : toolName.includes('team') ? 'team' : 'self';
    const base = { source: 'operations' as const, scope };
    try {
      const raw = await this.reader.read(toolName, args);
      let observedAt = new Date().toISOString();
      let data: unknown;
      let pagination: ReturnType<typeof page> | undefined;
      let period: { from: string; to: string; timeZone: 'America/La_Paz' } | undefined;
      if (toolName === 'autonexus_get_order') {
        const order = orderProjection.parse(raw);
        if (order.id.toLowerCase() !== String(args['id']).toLowerCase()) throw new OperationsReadError('OWNER_INVALID_RESPONSE');
        data = order;
      } else if (toolName.includes('execution')) {
        const execution = executionOwnerProjection.parse(raw);
        if (execution.assignmentId.toLowerCase() !== String(args['assignmentId']).toLowerCase()) throw new OperationsReadError('OWNER_INVALID_RESPONSE');
        const limit = Number(args['advanceLimit']);
        const offset = Number(args['advanceOffset']);
        pagination = page(execution.advances.length, limit, offset, execution.advances.slice(offset, offset + limit).length);
        data = { ...execution, advances: execution.advances.slice(offset, offset + limit).map(advance => {
          const { evidences, ...metadata } = advance;
          return { ...metadata, evidenceCounts: { pending: evidences.filter(e => e.state === 'pending').length,
            available: evidences.filter(e => e.state === 'available').length, failed: evidences.filter(e => e.state === 'failed').length } };
        }) };
      } else {
        const result = toolName === 'autonexus_list_orders' ? ownerPage(orderProjection).parse(raw) : ownerPage(agendaProjection).parse(raw);
        if (result.limit !== args['limit'] || result.offset !== args['offset'] || result.items.length > result.limit
          || result.items.length !== Math.min(result.limit, Math.max(0, result.total - result.offset))) throw new OperationsReadError('OWNER_INVALID_RESPONSE');
        data = result.items;
        pagination = page(result.total, result.limit, result.offset, result.items.length);
        if (toolName.includes('agenda')) {
          const metadata = agendaPageMetadata.parse(raw);
          if (metadata.from !== args['from'] || metadata.to !== args['to']) throw new OperationsReadError('OWNER_INVALID_RESPONSE');
          period = { from: metadata.from, to: metadata.to, timeZone: metadata.timeZone };
          observedAt = metadata.observedAt;
        }
      }
      return outputSchema.parse({ ...base, observedAt, ok: true, data,
        ...(pagination ? { page: pagination } : {}), ...(period ? { period } : {}) }) as ConsultationEnvelope;
    } catch (error) {
      const failure = error instanceof OperationsReadError ? error : new OperationsReadError('OWNER_INVALID_RESPONSE');
      return { ...base, observedAt: new Date().toISOString(), ok: false,
        error: { code: failure.code, status: failure.status, message: 'Operations consultation failed' } };
    }
  }
}
