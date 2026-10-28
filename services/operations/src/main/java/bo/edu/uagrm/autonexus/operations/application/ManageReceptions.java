package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Reception;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** CU11 use cases: reception and visual inspection before any work starts. */
@Service
public class ManageReceptions {
    private static final int MAX_PAGE = 100;

    private final ReceptionRepository repository;

    public ManageReceptions(ReceptionRepository repository) {
        this.repository = repository;
    }

    public Page<Reception> list(String limit, String offset, String vehicleId, String open) {
        int size = queryInt(limit, 20, 1, MAX_PAGE);
        int skip = queryInt(offset, 0, 0, Integer.MAX_VALUE);
        UUID vehicle = vehicleId == null || vehicleId.isBlank() ? null : Validation.uuid(vehicleId);
        Boolean onlyOpen = null;
        if (open != null && !open.isBlank()) {
            if (!open.equals("true") && !open.equals("false")) throw OperationsError.invalid();
            onlyOpen = Boolean.valueOf(open);
        }
        return repository.list(vehicle, onlyOpen, size, skip);
    }

    public Reception get(String id) {
        return repository.get(Validation.uuid(id));
    }

    public Mutation<Reception> create(Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Reception.CREATE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        return repository.create(Reception.Draft.from(body), actor, operationId);
    }

    private static int queryInt(String value, int fallback, int min, int max) {
        if (value == null || value.isBlank()) return fallback;
        try {
            return Validation.pageInt(Integer.valueOf(value.trim()), fallback, min, max);
        } catch (NumberFormatException error) {
            throw OperationsError.invalid();
        }
    }
}
