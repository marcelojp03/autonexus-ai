package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.AppointmentRequest;
import java.time.Instant;
import java.util.UUID;

public interface AppointmentRequestRepository {
    Mutation<AppointmentRequest> create(UUID operationId, String clientId, String requester,
            UUID customerId, UUID vehicleId, UUID serviceId, Instant startsAt, String timeZone, String notes);
    AppointmentRequest byOperation(UUID operationId, String clientId, String requester);
    Page<AppointmentRequest> pending(int limit, int offset);
    Mutation<AppointmentRequest> approve(UUID operationId, Instant startsAt, String reviewer);
    Mutation<AppointmentRequest> reject(UUID operationId, String reason, String reviewer);
}
