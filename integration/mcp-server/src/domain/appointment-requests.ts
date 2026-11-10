import { z } from "zod";

export const appointmentRequestInput = z.strictObject({
  operationId: z.uuid(),
  customerId: z.uuid(),
  vehicleId: z.uuid(),
  serviceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).max(64),
  notes: z.string().max(500).optional(),
});
export const reconcileAppointmentRequestInput = z.strictObject({
  operationId: z.uuid(),
});

const request = z.strictObject({
  id: z.uuid(),
  operationId: z.uuid(),
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]),
  customerId: z.uuid(),
  vehicleId: z.uuid(),
  serviceId: z.uuid(),
  requestedStartsAt: z.iso.datetime({ offset: true }),
  timeZone: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  reviewedAt: z.iso.datetime({ offset: true }).nullable(),
  reviewReason: z.string().nullable(),
  appointmentId: z.uuid().nullable(),
  version: z.number().int().positive(),
});
export const appointmentRequestResult = z.strictObject({
  outcome: z.enum(["RECORDED", "UNKNOWN"]),
  operationId: z.uuid(),
  request: request.nullable(),
  replayed: z.boolean(),
  message: z.string().max(180),
});
export type AppointmentRequestInput = z.infer<typeof appointmentRequestInput>;

export function projectAppointmentRequest(
  raw: unknown,
  clientId: string,
  operationId: string,
) {
  const envelope = z
    .strictObject({ request: z.unknown(), replayed: z.boolean().optional() })
    .parse(raw);
  const value = z.record(z.string(), z.unknown()).parse(envelope.request);
  if (value["clientId"] !== clientId || value["operationId"] !== operationId)
    throw new Error("OWNER_INVALID_RESPONSE");
  const projection = request.parse({
    id: value["id"],
    operationId: value["operationId"],
    status: value["status"],
    customerId: value["customerId"],
    vehicleId: value["vehicleId"],
    serviceId: value["serviceId"],
    requestedStartsAt: value["requestedStartsAt"],
    timeZone: value["timeZone"],
    createdAt: value["createdAt"],
    reviewedAt: value["reviewedAt"],
    reviewReason: value["reviewReason"],
    appointmentId: value["appointmentId"],
    version: value["version"],
  });
  return {
    outcome: "RECORDED" as const,
    operationId,
    request: projection,
    replayed: envelope.replayed ?? false,
    message:
      projection.status === "PENDING_REVIEW"
        ? "Request recorded for staff review; no appointment time is reserved."
        : "Request status reconciled from Operations.",
  };
}
