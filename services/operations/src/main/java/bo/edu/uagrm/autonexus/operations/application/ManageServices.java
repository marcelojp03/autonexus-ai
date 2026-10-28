package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.ServiceOffering;
import org.springframework.stereotype.Service;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.util.Map;
import java.util.UUID;

/** CU09 use cases: the workshop defines the services it offers. */
@Service
public class ManageServices {
    private static final int MAX_PAGE = 100;

    private final ServiceRepository repository;

    public ManageServices(ServiceRepository repository) {
        this.repository = repository;
    }

    public Page<ServiceOffering> list(String limit, String offset, String active, String search) {
        int size = queryInt(limit, 20, 1, MAX_PAGE);
        int from = queryInt(offset, 0, 0, Integer.MAX_VALUE);
        Boolean filter = null;
        if (active != null && !active.isBlank()) {
            if (!active.equals("true") && !active.equals("false")) throw OperationsError.invalid();
            filter = Boolean.valueOf(active);
        }
        String term = search == null ? null : search.trim();
        if (term != null && term.length() > 100) throw OperationsError.invalid();
        return repository.list(filter, term == null || term.isEmpty() ? null : term, size, from);
    }

    public ServiceOffering get(String id) {
        return repository.get(Validation.uuid(id));
    }

    public Mutation<ServiceOffering> create(Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, ServiceOffering.CREATE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        return repository.create(ServiceOffering.Draft.from(body), actor, operationId);
    }

    public Mutation<ServiceOffering> update(String id, Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, ServiceOffering.UPDATE_KEYS);
        UUID serviceId = Validation.uuid(id);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        return repository.update(serviceId, ServiceOffering.Draft.from(body), expectedVersion, actor, operationId);
    }

    public Mutation<ServiceOffering> deactivate(String id, Map<String, Object> body, String actor) {
        UpdateCommand command = UpdateCommand.from(body);
        return repository.deactivate(Validation.uuid(id), command.expectedVersion(), actor, command.operationId());
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
