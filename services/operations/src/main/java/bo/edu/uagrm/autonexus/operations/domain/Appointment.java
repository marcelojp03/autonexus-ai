package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * CU10 appointment: a reserved slot for a vehicle and service. It is deliberately *not* a work
 * order nor a mechanic assignment: it has no order number, mechanic or execution state.
 */
public record Appointment(
        UUID id,
        UUID customerId,
        String customerName,
        UUID vehicleId,
        String vehiclePlate,
        UUID serviceId,
        String serviceName,
        Instant startsAt,
        Instant endsAt,
        String status,
        String notes,
        String cancelReason,
        int version,
        Instant createdAt,
        Instant updatedAt) {

    public static final Set<String> CREATE_KEYS =
            Set.of("operationId", "customerId", "vehicleId", "serviceId", "startsAt", "notes");
    public static final Set<String> RESCHEDULE_KEYS =
            Set.of("operationId", "expectedVersion", "startsAt", "notes");
    public static final Set<String> CANCEL_KEYS = Set.of("operationId", "expectedVersion", "reason");

    public record Draft(UUID customerId, UUID vehicleId, UUID serviceId, Instant startsAt, String notes) {
        public static Draft from(Map<String, Object> body) {
            return new Draft(
                    Validation.uuid(body.get("customerId")),
                    Validation.uuid(body.get("vehicleId")),
                    Validation.uuid(body.get("serviceId")),
                    Validation.instant(body.get("startsAt")),
                    Validation.optionalText(body.get("notes"), 500));
        }
    }
}
