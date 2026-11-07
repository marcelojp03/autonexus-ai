export function previousWeek(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = type => parts.find(p => p.type === type).value;
  const day = new Date(part('year') + '-' + part('month') + '-' + part('day') + 'T00:00:00Z');
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7 - 7);
  const from = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  return {from, to: day.toISOString().slice(0, 10), timeZone: 'America/La_Paz'};
}

export function periodIds(period) {
  const start = new Date(period.from + 'T00:00:00Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(period.from) || !Number.isFinite(start.getTime())
      || start.toISOString().slice(0, 10) !== period.from || start.getUTCDay() !== 1
      || end.toISOString().slice(0, 10) !== period.to || period.timeZone !== 'America/La_Paz') {
    throw new Error('CU28_INVALID_PERIOD');
  }
  // UUIDv8 encodes the civil Monday injectively; purpose suffixes separate operation and event IDs.
  const prefix = 'a0280001-0000-8000-8000-' + period.from.replaceAll('-', '');
  return {operationId: prefix + '0001', eventId: prefix + '0002'};
}

export function httpBody(response) {
  const status = response.statusCode;
  if (status === 401 || status === 403) throw new Error('CU28_AUTHORIZATION_REQUIRED');
  if (!Number.isInteger(status) || status < 200 || status >= 300) throw new Error('CU28_HTTP_UNAVAILABLE');
  if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) {
    throw new Error('CU28_INVALID_RESPONSE');
  }
  return response.body;
}

export function acceptedJob(response) {
  const job = httpBody(response);
  if (typeof job.jobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(job.jobId)) throw new Error('CU28_INVALID_JOB');
  return {jobId: job.jobId};
}

export function acquiredDelivery(response) {
  const delivery = httpBody(response);
  const ids = periodIds(delivery.period ?? {});
  if (delivery.operationId !== ids.operationId || delivery.eventId !== ids.eventId
      || !['pending', 'delivered'].includes(delivery.status)
      || !(delivery.jobId === null || typeof delivery.jobId === 'string' && /^[0-9a-f-]{36}$/i.test(delivery.jobId))
      || !(delivery.report === null || delivery.report && typeof delivery.report === 'object' && !Array.isArray(delivery.report))
      || (delivery.report !== null && delivery.jobId === null) || (delivery.status === 'delivered' && delivery.report === null)) {
    throw new Error('CU28_INVALID_DELIVERY');
  }
  return {period: delivery.period, ...ids, jobId: delivery.jobId, resumeJobId: delivery.jobId,
    hasJob: Boolean(delivery.jobId), ready: delivery.report !== null,
    delivered: delivery.status === 'delivered', report: delivery.report, deadline: Date.now() + 600000};
}

export function evaluateJob(response, context, now) {
  const job = httpBody(response);
  if (now >= context.deadline) throw new Error('CU28_REPORT_POLL_TIMEOUT');
  if (job.jobId !== context.jobId || job.period?.from !== context.period.from
      || job.period?.to !== context.period.to || job.period?.timeZone !== context.period.timeZone) {
    throw new Error('CU28_JOB_MISMATCH');
  }
  if (job.status === 'failed' || job.status === 'interrupted') {
    throw new Error(job.failure?.code === 'AUTHORIZATION_EXPIRED'
      ? 'CU28_AUTHORIZATION_REQUIRED' : 'CU28_REPORT_TERMINAL_FAILURE');
  }
  if (job.status === 'succeeded') return {ready: true, report: job.report};
  if (!['queued', 'running'].includes(job.status)) throw new Error('CU28_INVALID_JOB_STATE');
  // Reserve the next wait and HTTP timeout inside the ten-minute budget.
  if (now + 25000 >= context.deadline) throw new Error('CU28_REPORT_POLL_TIMEOUT');
  return {ready: false, jobId: context.jobId};
}

export function weeklyEvent(report, period, jobId) {
  const ids = periodIds(period);
  if (!report || report.report !== 'operations-narrative' || report.period?.from !== period.from
      || report.period?.to !== period.to || report.period?.timeZone !== period.timeZone
      || !Number.isFinite(Date.parse(report.generatedAt)) || typeof report.promptVersion !== 'string'
      || !report.figures || !Array.isArray(report.claims) || !Array.isArray(report.provenance)
      || !Array.isArray(report.references) || !Array.isArray(report.limitations)
      || report.financialData?.included !== false || typeof report.financialData.note !== 'string'
      || report.narrative?.verified !== true || typeof report.narrative.text !== 'string'
      || !['llm', 'deterministic'].includes(report.narrative.path)
      || report.narrative.generative !== (report.narrative.path === 'llm')) {
    throw new Error('CU28_INVALID_VERIFIED_REPORT');
  }
  const data = {
    jobId, operationId: ids.operationId, report: report.report,
    period: {from: period.from, to: period.to, timeZone: period.timeZone},
    generatedAt: report.generatedAt, promptVersion: report.promptVersion,
    figures: report.figures, claims: report.claims, provenance: report.provenance,
    references: report.references, limitations: report.limitations,
    financialData: {included: false, note: report.financialData.note},
    narrative: {text: report.narrative.text, path: report.narrative.path,
      model: report.narrative.model, verified: true, generative: report.narrative.generative},
  };
  return {
    eventId: ids.eventId, eventType: 'automation.weekly.report.generated.v1', schemaVersion: 1,
    aggregateType: 'weekly_report', aggregateId: ids.operationId, aggregateVersion: 1,
    occurredAt: report.generatedAt, producer: 'agent', correlationId: ids.operationId,
    causationId: ids.operationId, initiatedBy: 'n8n-schedule', executedBy: 'delegated-employee', data,
  };
}

export function deliveryReceipt(response, eventId) {
  const body = httpBody(response);
  if (body.eventId !== eventId || !['recorded', 'duplicate'].includes(body.status)) {
    throw new Error('CU28_DELIVERY_UNCONFIRMED');
  }
  return {eventId, status: body.status};
}
