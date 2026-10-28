package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.time.Year;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** CU07 vehicle aggregate. `customerName` and `ownerChanged` are read-model extras. */
public record Vehicle(
        UUID id,
        UUID customerId,
        String customerName,
        String plate,
        String make,
        String model,
        int year,
        String fuelType,
        String color,
        String status,
        int version,
        Instant createdAt,
        Instant updatedAt) {

    public static final Set<String> CREATE_KEYS = Set.of("operationId", "customerId", "plate", "make", "model", "year", "fuelType", "color");
    public static final Set<String> UPDATE_KEYS = Set.of("operationId", "expectedVersion", "customerId", "plate", "make", "model", "year", "fuelType", "color");

    public record Draft(UUID customerId, String plate, String make, String model, int year, String fuelType, String color) {
        public static Draft from(Map<String, Object> body) {
            return new Draft(
                    Validation.uuid(body.get("customerId")),
                    Validation.plate(body.get("plate")),
                    Validation.text(body.get("make"), 1, 60),
                    Validation.text(body.get("model"), 1, 60),
                    Validation.year(body.get("year"), Year.now().getValue()),
                    Validation.fuelType(body.get("fuelType")),
                    Validation.optionalText(body.get("color"), 40));
        }
    }
}
