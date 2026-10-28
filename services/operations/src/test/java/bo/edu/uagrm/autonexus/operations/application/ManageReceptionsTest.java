package bo.edu.uagrm.autonexus.operations.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Reception;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ManageReceptionsTest {
    private final ReceptionRepository repository = new StubReceptions();
    private final ManageReceptions receptions = new ManageReceptions(repository);

    private static Map<String, Object> body() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationId", UUID.randomUUID().toString());
        body.put("vehicleId", UUID.randomUUID().toString());
        body.put("mileage", 84000);
        body.put("reason", "Ruido en la suspensión delantera");
        body.put("symptoms", "Vibración al frenar");
        return body;
    }

    @Test
    void receivesAVehicleWithInspectionData() {
        Reception created = receptions.create(body(), "actor").value();
        assertThat(created.mileage()).isEqualTo(84000);
        assertThat(created.hasOrder()).isFalse();
    }

    @Test
    void rejectsShortReasonAndInvalidMileage() {
        Map<String, Object> shortReason = body();
        shortReason.put("reason", "ok");
        assertThatThrownBy(() -> receptions.create(shortReason, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> negative = body();
        negative.put("mileage", -1);
        assertThatThrownBy(() -> receptions.create(negative, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> huge = body();
        huge.put("mileage", 3000000);
        assertThatThrownBy(() -> receptions.create(huge, "actor")).isInstanceOf(OperationsError.class);
    }

    @Test
    void rejectsUnknownPropertiesAndMissingVehicle() {
        Map<String, Object> unknown = body();
        unknown.put("customerId", UUID.randomUUID().toString());
        assertThatThrownBy(() -> receptions.create(unknown, "actor"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("VALIDATION_ERROR");

        Map<String, Object> missing = body();
        missing.remove("vehicleId");
        assertThatThrownBy(() -> receptions.create(missing, "actor")).isInstanceOf(OperationsError.class);
    }

    @Test
    void validatesTheOpenFilter() {
        assertThatThrownBy(() -> receptions.list(null, null, null, "maybe")).isInstanceOf(OperationsError.class);
        assertThat(receptions.list("5", null, null, "true").limit()).isEqualTo(5);
    }

    private static final class StubReceptions implements ReceptionRepository {
        @Override
        public Page<Reception> list(UUID vehicleId, Boolean open, int limit, int offset) {
            return new Page<>(java.util.List.of(), 0, limit, offset);
        }

        @Override
        public Reception get(UUID id) {
            throw OperationsError.notFound("RECEPTION_NOT_FOUND");
        }

        @Override
        public Mutation<Reception> create(Reception.Draft draft, String actor, UUID operationId) {
            return new Mutation<>(new Reception(UUID.randomUUID(), draft.vehicleId(), "ABC123", UUID.randomUUID(),
                    "Cliente", draft.appointmentId(), draft.mileage(), draft.reason(), draft.symptoms(),
                    draft.visibleConditions(), false, Instant.now(), 1), false);
        }
    }
}
