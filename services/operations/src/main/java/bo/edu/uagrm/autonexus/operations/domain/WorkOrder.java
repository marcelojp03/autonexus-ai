package bo.edu.uagrm.autonexus.operations.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * CU12 work order: the formal request to perform work. It starts pending quotation and never
 * assigns a mechanic; confirmation and assignment belong to CU15.
 */
public record WorkOrder(
        UUID id,
        String number,
        UUID receptionId,
        UUID vehicleId,
        String vehiclePlate,
        UUID customerId,
        String customerName,
        String description,
        String priority,
        String notes,
        String status,
        int version,
        Instant createdAt,
        Instant updatedAt,
        List<Item> items) {

    public static final Set<String> CREATE_KEYS = Set.of("operationId", "receptionId", "description", "priority", "notes", "services");

    public record Item(UUID serviceId, String serviceName, int quantity, int estimatedMinutes, BigDecimal referenceRate) {}

    public record Draft(UUID receptionId, String description, String priority, String notes, List<RequestedService> services) {
        public static Draft from(Map<String, Object> body) {
            Object raw = body.get("services");
            if (!(raw instanceof List<?> list) || list.isEmpty() || list.size() > 20) throw OperationsError.invalid();
            List<RequestedService> services = new ArrayList<>();
            for (Object item : list) {
                if (!(item instanceof Map<?, ?> map)) throw OperationsError.invalid();
                if (map.keySet().stream().anyMatch(key -> !Set.of("serviceId", "quantity").contains(key))) {
                    throw OperationsError.invalid();
                }
                services.add(new RequestedService(
                        Validation.uuid(map.get("serviceId")),
                        Validation.quantity(map.get("quantity"))));
            }
            return new Draft(
                    Validation.uuid(body.get("receptionId")),
                    Validation.text(body.get("description"), 3, 1000),
                    Validation.priority(body.get("priority")),
                    Validation.optionalText(body.get("notes"), 1000),
                    services);
        }
    }

    public record RequestedService(UUID serviceId, int quantity) {}
}
