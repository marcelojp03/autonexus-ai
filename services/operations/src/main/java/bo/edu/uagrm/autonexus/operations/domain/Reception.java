package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** CU11 reception and visual inspection of the vehicle before any work starts. */
public record Reception(
        UUID id,
        UUID vehicleId,
        String vehiclePlate,
        UUID customerId,
        String customerName,
        UUID appointmentId,
        int mileage,
        String reason,
        String symptoms,
        String visibleConditions,
        boolean hasOrder,
        Instant receivedAt,
        int version) {

    public static final Set<String> CREATE_KEYS =
            Set.of("operationId", "vehicleId", "appointmentId", "mileage", "reason", "symptoms", "visibleConditions");

    public record Draft(UUID vehicleId, UUID appointmentId, int mileage, String reason, String symptoms, String visibleConditions) {
        public static Draft from(Map<String, Object> body) {
            Object appointment = body.get("appointmentId");
            return new Draft(
                    Validation.uuid(body.get("vehicleId")),
                    appointment == null ? null : Validation.uuid(appointment),
                    Validation.mileage(body.get("mileage")),
                    Validation.text(body.get("reason"), 3, 300),
                    Validation.optionalText(body.get("symptoms"), 1000),
                    Validation.optionalText(body.get("visibleConditions"), 1000));
        }
    }
}
