package bo.edu.uagrm.autonexus.operations.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.ServiceOffering;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ManageServicesTest {
    private final ServiceRepository repository = new StubServices();
    private final ManageServices services = new ManageServices(repository);

    private static Map<String, Object> body() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationId", UUID.randomUUID().toString());
        body.put("name", "Cambio de aceite");
        body.put("description", "Cambio de aceite y filtro");
        body.put("category", "mantenimiento");
        body.put("estimatedMinutes", 60);
        body.put("referenceRate", new BigDecimal("150.00"));
        return body;
    }

    @Test
    void createsAServiceWithValidatedInput() {
        ServiceOffering created = services.create(body(), "actor").value();
        assertThat(created.name()).isEqualTo("Cambio de aceite");
        assertThat(created.estimatedMinutes()).isEqualTo(60);
        assertThat(created.active()).isTrue();
    }

    @Test
    void rejectsInvalidDurationRateAndCategory() {
        Map<String, Object> shortDuration = body();
        shortDuration.put("estimatedMinutes", 5);
        assertThatThrownBy(() -> services.create(shortDuration, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> badRate = body();
        badRate.put("referenceRate", new BigDecimal("1.234"));
        assertThatThrownBy(() -> services.create(badRate, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> badCategory = body();
        badCategory.put("category", "pintura");
        assertThatThrownBy(() -> services.create(badCategory, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> unknown = body();
        unknown.put("active", false);
        assertThatThrownBy(() -> services.create(unknown, "actor"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("VALIDATION_ERROR");
    }

    @Test
    void validatesTheActiveFilterAndPagination() {
        assertThatThrownBy(() -> services.list(null, null, "yes", null)).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> services.list("0", null, null, null)).isInstanceOf(OperationsError.class);
        assertThat(services.list("10", "5", "false", "aceite").limit()).isEqualTo(10);
    }

    private static final class StubServices implements ServiceRepository {
        @Override
        public Page<ServiceOffering> list(Boolean active, String search, int limit, int offset) {
            return new Page<>(java.util.List.of(), 0, limit, offset);
        }

        @Override
        public ServiceOffering get(UUID id) {
            throw OperationsError.notFound("SERVICE_NOT_FOUND");
        }

        @Override
        public Mutation<ServiceOffering> create(ServiceOffering.Draft draft, String actor, UUID operationId) {
            return new Mutation<>(new ServiceOffering(UUID.randomUUID(), draft.name(), draft.description(),
                    draft.category(), draft.estimatedMinutes(), draft.referenceRate(), true, 1, Instant.now(), Instant.now()), false);
        }

        @Override
        public Mutation<ServiceOffering> update(UUID id, ServiceOffering.Draft draft, int expectedVersion, String actor, UUID operationId) {
            throw OperationsError.conflict("VERSION_CONFLICT");
        }

        @Override
        public Mutation<ServiceOffering> deactivate(UUID id, int expectedVersion, String actor, UUID operationId) {
            throw OperationsError.notFound("SERVICE_NOT_FOUND");
        }
    }
}
