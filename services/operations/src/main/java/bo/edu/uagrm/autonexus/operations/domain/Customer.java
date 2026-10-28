package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** CU06 customer aggregate as persisted by the owner service. */
public record Customer(
        UUID id,
        String firstName,
        String lastName,
        String document,
        String phone,
        String email,
        String address,
        String status,
        int version,
        Instant createdAt,
        Instant updatedAt) {

    public static final Set<String> CREATE_KEYS = Set.of("operationId", "firstName", "lastName", "document", "phone", "email", "address");
    public static final Set<String> UPDATE_KEYS = Set.of("operationId", "expectedVersion", "firstName", "lastName", "document", "phone", "email", "address");

    public record Draft(String firstName, String lastName, String document, String phone, String email, String address) {
        public static Draft from(Map<String, Object> body) {
            return new Draft(
                    Validation.text(body.get("firstName"), 1, 100),
                    Validation.text(body.get("lastName"), 1, 100),
                    Validation.document(body.get("document")),
                    Validation.phone(body.get("phone")),
                    Validation.email(body.get("email")),
                    Validation.optionalText(body.get("address"), 200));
        }
    }

    public String fullName() {
        return firstName + ' ' + lastName;
    }
}
