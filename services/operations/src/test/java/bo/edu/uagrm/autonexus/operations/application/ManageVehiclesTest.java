package bo.edu.uagrm.autonexus.operations.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Vehicle;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ManageVehiclesTest {
    private static final UUID CUSTOMER = UUID.randomUUID();
    private static final UUID OTHER = UUID.randomUUID();

    private InMemoryVehicles repository;
    private ManageVehicles vehicles;

    @BeforeEach
    void setUp() {
        repository = new InMemoryVehicles();
        vehicles = new ManageVehicles(repository);
    }

    private static Map<String, Object> body(String plate, UUID customerId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationId", UUID.randomUUID().toString());
        body.put("customerId", customerId.toString());
        body.put("plate", plate);
        body.put("make", "Toyota");
        body.put("model", "Corolla");
        body.put("year", 2020);
        body.put("fuelType", "gasolina");
        return body;
    }

    @Test
    void createsAVehicleLinkedToItsOwner() {
        Vehicle created = vehicles.create(body("abc-123", CUSTOMER), "actor-1").value();
        assertThat(created.plate()).isEqualTo("ABC123");
        assertThat(created.customerId()).isEqualTo(CUSTOMER);
        assertThat(created.status()).isEqualTo("active");
    }

    @Test
    void rejectsDuplicatePlateAndUnknownCustomer() {
        vehicles.create(body("ABC123", CUSTOMER), "actor-1");
        assertThatThrownBy(() -> vehicles.create(body("abc123", CUSTOMER), "actor-1"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("DUPLICATE_PLATE");
        assertThatThrownBy(() -> vehicles.create(body("XYZ999", UUID.randomUUID()), "actor-1"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("CUSTOMER_NOT_FOUND");
    }

    @Test
    void rejectsInactiveCustomers() {
        repository.inactive.add(OTHER);
        assertThatThrownBy(() -> vehicles.create(body("XYZ999", OTHER), "actor-1"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("CUSTOMER_INACTIVE");
    }

    @Test
    void recordsAnOwnerChange() {
        Vehicle created = vehicles.create(body("ABC123", CUSTOMER), "actor-1").value();
        Map<String, Object> update = body("ABC123", OTHER);
        update.put("expectedVersion", 1);
        Vehicle changed = vehicles.update(created.id().toString(), update, "actor-1").value();
        assertThat(changed.customerId()).isEqualTo(OTHER);
        assertThat(changed.version()).isEqualTo(2);
        assertThat(repository.ownerEvents).containsExactly("ABC123:" + CUSTOMER, "ABC123:" + OTHER);
    }

    @Test
    void rejectsStaleVersionsAndInvalidPlates() {
        Vehicle created = vehicles.create(body("ABC123", CUSTOMER), "actor-1").value();
        Map<String, Object> update = body("ABC123", CUSTOMER);
        update.put("expectedVersion", 5);
        assertThatThrownBy(() -> vehicles.update(created.id().toString(), update, "actor-1"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("VERSION_CONFLICT");
        assertThatThrownBy(() -> vehicles.create(body("AB1", CUSTOMER), "actor-1"))
                .isInstanceOf(OperationsError.class);
    }

    private static final class InMemoryVehicles implements VehicleRepository {
        private final Map<UUID, Vehicle> records = new LinkedHashMap<>();
        private final List<UUID> inactive = new ArrayList<>();
        private final List<String> ownerEvents = new ArrayList<>();

        @Override
        public Page<Vehicle> list(String status, UUID customerId, String search, int limit, int offset) {
            var items = records.values().stream()
                    .filter(item -> status == null || item.status().equals(status))
                    .filter(item -> customerId == null || item.customerId().equals(customerId))
                    .filter(item -> search == null || item.plate().contains(search.toUpperCase()))
                    .toList();
            return new Page<>(items, items.size(), limit, offset);
        }

        @Override
        public Vehicle get(UUID id) {
            Vehicle found = records.get(id);
            if (found == null) throw OperationsError.notFound("VEHICLE_NOT_FOUND");
            return found;
        }

        private void requireOwner(UUID customerId) {
            if (inactive.contains(customerId)) throw OperationsError.conflict("CUSTOMER_INACTIVE");
            if (!customerId.equals(CUSTOMER) && !customerId.equals(OTHER)) {
                throw OperationsError.notFound("CUSTOMER_NOT_FOUND");
            }
        }

        @Override
        public Mutation<Vehicle> create(Vehicle.Draft draft, String actor, UUID operationId) {
            requireOwner(draft.customerId());
            if (records.values().stream().anyMatch(item -> item.plate().equals(draft.plate()))) {
                throw OperationsError.conflict("DUPLICATE_PLATE");
            }
            Vehicle created = new Vehicle(UUID.randomUUID(), draft.customerId(), "Owner", draft.plate(), draft.make(),
                    draft.model(), draft.year(), draft.fuelType(), draft.color(), "active", 1, Instant.now(), Instant.now());
            records.put(created.id(), created);
            ownerEvents.add(created.plate() + ':' + draft.customerId());
            return new Mutation<>(created, false);
        }

        @Override
        public Mutation<Vehicle> update(UUID id, Vehicle.Draft draft, int expectedVersion, String actor, UUID operationId) {
            Vehicle current = get(id);
            if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
            requireOwner(draft.customerId());
            Vehicle updated = new Vehicle(id, draft.customerId(), "Owner", draft.plate(), draft.make(), draft.model(),
                    draft.year(), draft.fuelType(), draft.color(), current.status(), expectedVersion + 1,
                    current.createdAt(), Instant.now());
            records.put(id, updated);
            if (!current.customerId().equals(draft.customerId())) {
                ownerEvents.add(updated.plate() + ':' + draft.customerId());
            }
            return new Mutation<>(updated, false);
        }

        @Override
        public Mutation<Vehicle> deactivate(UUID id, int expectedVersion, String actor, UUID operationId) {
            Vehicle current = get(id);
            if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
            Vehicle updated = new Vehicle(id, current.customerId(), "Owner", current.plate(), current.make(),
                    current.model(), current.year(), current.fuelType(), current.color(), "inactive",
                    expectedVersion + 1, current.createdAt(), Instant.now());
            records.put(id, updated);
            return new Mutation<>(updated, false);
        }
    }
}
