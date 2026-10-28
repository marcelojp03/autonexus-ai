package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Customer;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** CU06 use cases: reception registers, searches and updates customers. */
@Service
public class ManageCustomers {
    private static final int MAX_PAGE = 100;

    private final CustomerRepository repository;

    public ManageCustomers(CustomerRepository repository) {
        this.repository = repository;
    }

    public Page<Customer> list(String limit, String offset, String status, String search) {
        int size = queryInt(limit, 20, 1, MAX_PAGE);
        int from = queryInt(offset, 0, 0, Integer.MAX_VALUE);
        String normalizedStatus = status == null || status.isBlank() ? null : status.trim();
        if (normalizedStatus != null && !normalizedStatus.equals("active") && !normalizedStatus.equals("inactive")) {
            throw OperationsError.invalid();
        }
        String term = search == null ? null : search.trim();
        if (term != null && term.length() > 100) throw OperationsError.invalid();
        return repository.list(normalizedStatus, term == null || term.isEmpty() ? null : term, size, from);
    }

    public Customer get(String id) {
        return repository.get(uuid(id));
    }

    public Mutation<Customer> create(Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Customer.CREATE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        return repository.create(Customer.Draft.from(body), actor, operationId);
    }

    public Mutation<Customer> update(String id, Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Customer.UPDATE_KEYS);
        UUID customerId = uuid(id);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        return repository.update(customerId, Customer.Draft.from(body), expectedVersion, actor, operationId);
    }

    public Mutation<Customer> deactivate(String id, Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, UpdateCommand.KEYS);
        UUID customerId = uuid(id);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        return repository.deactivate(customerId, expectedVersion, actor, operationId);
    }

    private static UUID uuid(String value) {
        return Validation.uuid(value);
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
