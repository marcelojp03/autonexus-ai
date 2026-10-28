package bo.edu.uagrm.autonexus.operations.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import bo.edu.uagrm.autonexus.operations.domain.Customer;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ManageCustomersTest {
    private InMemoryCustomers repository;
    private ManageCustomers customers;

    @BeforeEach
    void setUp() {
        repository = new InMemoryCustomers();
        customers = new ManageCustomers(repository);
    }

    private static Map<String, Object> body(String document) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationId", UUID.randomUUID().toString());
        body.put("firstName", "Ana");
        body.put("lastName", "Quispe");
        body.put("document", document);
        body.put("phone", "+591 700 00000");
        return body;
    }

    @Test
    void createsAndReadsACustomer() {
        Mutation<Customer> created = customers.create(body("12-345-678"), "actor-1");
        assertThat(created.replayed()).isFalse();
        assertThat(created.value().document()).isEqualTo("12345678");
        assertThat(created.value().status()).isEqualTo("active");
        assertThat(customers.get(created.value().id().toString()).fullName()).isEqualTo("Ana Quispe");
    }

    @Test
    void rejectsUnknownPropertiesAndMissingDocument() {
        Map<String, Object> unknown = body("12345678");
        unknown.put("status", "inactive");
        assertThatThrownBy(() -> customers.create(unknown, "actor-1"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("VALIDATION_ERROR");
        Map<String, Object> missing = body("12345678");
        missing.remove("document");
        assertThatThrownBy(() -> customers.create(missing, "actor-1")).isInstanceOf(OperationsError.class);
    }

    @Test
    void reportsDuplicateDocumentAndVersionConflicts() {
        Mutation<Customer> created = customers.create(body("22334455"), "actor-1");
        assertThatThrownBy(() -> customers.create(body("22334455"), "actor-1"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("DUPLICATE_DOCUMENT");

        Map<String, Object> update = body("22334455");
        update.put("expectedVersion", 99);
        assertThatThrownBy(() -> customers.update(created.value().id().toString(), update, "actor-1"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("VERSION_CONFLICT");
    }

    @Test
    void deactivationKeepsHistoryAndIsIdempotent() {
        Customer created = customers.create(body("33445566"), "actor-1").value();
        Map<String, Object> command = Map.of("operationId", UUID.randomUUID().toString(), "expectedVersion", 1);
        Customer inactive = customers.deactivate(created.id().toString(), command, "actor-1").value();
        assertThat(inactive.status()).isEqualTo("inactive");
        assertThat(inactive.version()).isEqualTo(2);
        Customer again = customers.deactivate(created.id().toString(),
                Map.of("operationId", UUID.randomUUID().toString(), "expectedVersion", 2), "actor-1").value();
        assertThat(again.status()).isEqualTo("inactive");
        assertThat(repository.history).hasSize(2);
    }

    @Test
    void rejectsInvalidPaginationAndUnknownStatus() {
        assertThatThrownBy(() -> customers.list("0", null, null, null)).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> customers.list("abc", null, null, null)).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> customers.list(null, null, "deleted", null)).isInstanceOf(OperationsError.class);
    }

    /** Minimal in-memory owner used to exercise the use cases without a database. */
    private static final class InMemoryCustomers implements CustomerRepository {
        private final Map<UUID, Customer> records = new LinkedHashMap<>();
        private final List<String> history = new ArrayList<>();

        @Override
        public Page<Customer> list(String status, String search, int limit, int offset) {
            var items = records.values().stream()
                    .filter(item -> status == null || item.status().equals(status))
                    .filter(item -> search == null || item.document().contains(search.toUpperCase())
                            || item.fullName().toLowerCase().contains(search.toLowerCase()))
                    .toList();
            return new Page<>(items, items.size(), limit, offset);
        }

        @Override
        public Customer get(UUID id) {
            Customer found = records.get(id);
            if (found == null) throw OperationsError.notFound("CUSTOMER_NOT_FOUND");
            return found;
        }

        @Override
        public Mutation<Customer> create(Customer.Draft draft, String actor, UUID operationId) {
            if (records.values().stream().anyMatch(item -> item.document().equals(draft.document()))) {
                throw OperationsError.conflict("DUPLICATE_DOCUMENT");
            }
            Customer created = new Customer(UUID.randomUUID(), draft.firstName(), draft.lastName(), draft.document(),
                    draft.phone(), draft.email(), draft.address(), "active", 1, Instant.now(), Instant.now());
            records.put(created.id(), created);
            history.add("created");
            return new Mutation<>(created, false);
        }

        @Override
        public Mutation<Customer> update(UUID id, Customer.Draft draft, int expectedVersion, String actor, UUID operationId) {
            Customer current = get(id);
            if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
            Customer updated = new Customer(id, draft.firstName(), draft.lastName(), draft.document(), draft.phone(),
                    draft.email(), draft.address(), current.status(), expectedVersion + 1, current.createdAt(), Instant.now());
            records.put(id, updated);
            history.add("updated");
            return new Mutation<>(updated, false);
        }

        @Override
        public Mutation<Customer> deactivate(UUID id, int expectedVersion, String actor, UUID operationId) {
            Customer current = get(id);
            if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
            if ("inactive".equals(current.status())) return new Mutation<>(current, false);
            Customer updated = new Customer(id, current.firstName(), current.lastName(), current.document(),
                    current.phone(), current.email(), current.address(), "inactive", expectedVersion + 1,
                    current.createdAt(), Instant.now());
            records.put(id, updated);
            history.add("deactivated");
            return new Mutation<>(updated, false);
        }
    }
}
