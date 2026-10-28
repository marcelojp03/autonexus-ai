package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Shared command envelope for deactivate-style operations. */
public record UpdateCommand(UUID operationId, int expectedVersion) {
    public static final Set<String> KEYS = Set.of("operationId", "expectedVersion");

    public static UpdateCommand from(Map<String, Object> body) {
        Validation.onlyKeys(body, KEYS);
        return new UpdateCommand(Validation.uuid(body.get("operationId")), Validation.expectedVersion(body.get("expectedVersion")));
    }
}
