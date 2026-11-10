package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.util.UUID;

/** An external appointment proposal. PENDING_REVIEW never blocks appointment capacity. */
public record AppointmentRequest(
        UUID id, UUID operationId, String clientId, String requesterSubject,
        UUID customerId, UUID vehicleId, UUID serviceId, Instant requestedStartsAt,
        String timeZone, String notes, String status, Instant createdAt,
        Instant reviewedAt, String reviewerSubject, String reviewReason,
        UUID appointmentId, int version) {}
