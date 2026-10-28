package bo.edu.uagrm.autonexus.operations.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import bo.edu.uagrm.autonexus.operations.domain.Appointment;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ManageAppointmentsTest {
    private static final UUID CUSTOMER = UUID.randomUUID();
    private static final UUID VEHICLE = UUID.randomUUID();
    private static final UUID SERVICE = UUID.randomUUID();

    private final ManageAppointments appointments = new ManageAppointments(new StubAppointments());

    private static Map<String, Object> body() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationId", UUID.randomUUID().toString());
        body.put("customerId", CUSTOMER.toString());
        body.put("vehicleId", VEHICLE.toString());
        body.put("serviceId", SERVICE.toString());
        body.put("startsAt", "2026-11-10T09:00:00-04:00");
        return body;
    }

    @Test
    void schedulesAnAppointmentWithAnExplicitOffset() {
        Appointment created = appointments.create(body(), "actor").value();
        assertThat(created.startsAt()).isEqualTo(Instant.parse("2026-11-10T13:00:00Z"));
        assertThat(created.status()).isEqualTo("scheduled");
    }

    @Test
    void rejectsTimestampsWithoutOffsetAndUnknownProperties() {
        Map<String, Object> local = body();
        local.put("startsAt", "2026-11-10T09:00:00");
        assertThatThrownBy(() -> appointments.create(local, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> unknown = body();
        unknown.put("status", "confirmed");
        assertThatThrownBy(() -> appointments.create(unknown, "actor"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("VALIDATION_ERROR");
    }

    @Test
    void requiresAVersionAndAMotiveToCancel() {
        Map<String, Object> withoutReason = Map.of("operationId", UUID.randomUUID().toString(), "expectedVersion", 1);
        assertThatThrownBy(() -> appointments.cancel(VEHICLE.toString(), withoutReason, "actor"))
                .isInstanceOf(OperationsError.class);

        Map<String, Object> withoutVersion = Map.of("operationId", UUID.randomUUID().toString(), "reason", "Cliente canceló");
        assertThatThrownBy(() -> appointments.cancel(VEHICLE.toString(), withoutVersion, "actor"))
                .isInstanceOf(OperationsError.class);
    }

    @Test
    void validatesTheListWindowAndStatus() {
        assertThatThrownBy(() -> appointments.list(null, null, null, null, "confirmed", null, null))
                .isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> appointments.list(null, null, "2026-11-10T10:00:00-04:00", "2026-11-10T09:00:00-04:00", null, null, null))
                .isInstanceOf(OperationsError.class);
        assertThat(appointments.list("5", null, null, null, "scheduled", null, null).limit()).isEqualTo(5);
    }

    private static final class StubAppointments implements AppointmentRepository {
        @Override
        public Page<Appointment> list(Instant from, Instant to, String status, UUID customerId, UUID vehicleId, int limit, int offset) {
            return new Page<>(java.util.List.of(), 0, limit, offset);
        }

        @Override
        public Appointment get(UUID id) {
            throw OperationsError.notFound("APPOINTMENT_NOT_FOUND");
        }

        @Override
        public Mutation<Appointment> create(Appointment.Draft draft, String actor, UUID operationId) {
            return new Mutation<>(new Appointment(UUID.randomUUID(), draft.customerId(), "Cliente", draft.vehicleId(),
                    "ABC123", draft.serviceId(), "Servicio", draft.startsAt(), draft.startsAt().plusSeconds(3600),
                    "scheduled", draft.notes(), null, 1, Instant.now(), Instant.now()), false);
        }

        @Override
        public Mutation<Appointment> reschedule(UUID id, Instant startsAt, String notes, int expectedVersion, String actor, UUID operationId) {
            throw OperationsError.conflict("VERSION_CONFLICT");
        }

        @Override
        public Mutation<Appointment> cancel(UUID id, String reason, int expectedVersion, String actor, UUID operationId) {
            throw OperationsError.notFound("APPOINTMENT_NOT_FOUND");
        }
    }
}
