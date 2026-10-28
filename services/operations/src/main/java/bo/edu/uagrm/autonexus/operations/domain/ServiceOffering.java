package bo.edu.uagrm.autonexus.operations.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** CU09 catalog entry offered for appointments and quotations. */
public record ServiceOffering(
        UUID id,
        String name,
        String description,
        String category,
        int estimatedMinutes,
        BigDecimal referenceRate,
        boolean active,
        int version,
        Instant createdAt,
        Instant updatedAt) {

    public static final Set<String> CREATE_KEYS =
            Set.of("operationId", "name", "description", "category", "estimatedMinutes", "referenceRate");
    public static final Set<String> UPDATE_KEYS =
            Set.of("operationId", "expectedVersion", "name", "description", "category", "estimatedMinutes", "referenceRate");

    public record Draft(String name, String description, String category, int estimatedMinutes, BigDecimal referenceRate) {
        public static Draft from(Map<String, Object> body) {
            return new Draft(
                    Validation.text(body.get("name"), 3, 80),
                    Validation.text(body.get("description"), 1, 300),
                    Validation.category(body.get("category")),
                    Validation.estimatedMinutes(body.get("estimatedMinutes")),
                    Validation.rate(body.get("referenceRate")));
        }

        /** Case-insensitive uniqueness key. */
        public String nameKey() {
            return name.toLowerCase(java.util.Locale.ROOT);
        }
    }
}
