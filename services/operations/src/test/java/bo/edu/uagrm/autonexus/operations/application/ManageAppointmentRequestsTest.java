package bo.edu.uagrm.autonexus.operations.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import bo.edu.uagrm.autonexus.operations.domain.AppointmentRequest;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ManageAppointmentRequestsTest {
    private final StubRequests repository = new StubRequests();
    private final ManageAppointmentRequests useCase = new ManageAppointmentRequests(repository);

    private static Map<String, Object> body() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationId", "33333333-3333-4333-8333-333333333333");
        body.put("clientId", "chatgpt-static-client");
        body.put("customerId", "11111111-1111-4111-8111-111111111111");
        body.put("vehicleId", "22222222-2222-4222-8222-222222222222");
        body.put("serviceId", "44444444-4444-4444-8444-444444444444");
        body.put("startsAt", "2026-11-12T09:00:00-04:00");
        body.put("timeZone", "America/La_Paz");
        body.put("notes", "Preferred morning visit");
        return body;
    }

    @Test
    void acceptsAProposalWithExplicitMatchingTimeZoneAndNeverCreatesAnAppointment() {
        var result = useCase.create(body(), "delegated-employee-subject");
        assertThat(result.value().status()).isEqualTo("PENDING_REVIEW");
        assertThat(repository.createCalls).isEqualTo(1);
        assertThat(repository.clientId).isEqualTo("chatgpt-static-client");
        assertThat(repository.requester).isEqualTo("delegated-employee-subject");
        assertThat(repository.startsAt).isEqualTo(Instant.parse("2026-11-12T13:00:00Z"));
    }

    @Test
    void rejectsUnknownKeysInvalidReferencesAndOffsetThatDisagreesWithTheNamedZone() {
        Map<String, Object> unknown = body(); unknown.put("confirmed", true);
        assertThatThrownBy(() -> useCase.create(unknown, "actor"))
                .isInstanceOf(OperationsError.class).extracting(error -> ((OperationsError) error).code()).isEqualTo("VALIDATION_ERROR");

        Map<String, Object> wrongZone = body(); wrongZone.put("startsAt", "2026-11-12T09:00:00-05:00");
        assertThatThrownBy(() -> useCase.create(wrongZone, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> badClient = body(); badClient.put("clientId", "bad client");
        assertThatThrownBy(() -> useCase.create(badClient, "actor")).isInstanceOf(OperationsError.class);
        assertThat(repository.createCalls).isZero();
    }

    private static final class StubRequests implements AppointmentRequestRepository {
        private int createCalls;
        private String clientId;
        private String requester;
        private Instant startsAt;

        @Override public Mutation<AppointmentRequest> create(UUID operationId, String clientId, String requester,
                UUID customerId, UUID vehicleId, UUID serviceId, Instant startsAt, String timeZone, String notes) {
            this.createCalls++; this.clientId = clientId; this.requester = requester; this.startsAt = startsAt;
            return new Mutation<>(new AppointmentRequest(UUID.randomUUID(), operationId, clientId, requester, customerId,
                    vehicleId, serviceId, startsAt, timeZone, notes, "PENDING_REVIEW", Instant.now(), null, null, null, null, 1), false);
        }
        @Override public AppointmentRequest byOperation(UUID operationId, String clientId, String requester) { throw new UnsupportedOperationException(); }
        @Override public Page<AppointmentRequest> pending(int limit, int offset) { return new Page<>(java.util.List.of(), 0, limit, offset); }
        @Override public Mutation<AppointmentRequest> approve(UUID operationId, Instant startsAt, String reviewer) { throw new UnsupportedOperationException(); }
        @Override public Mutation<AppointmentRequest> reject(UUID operationId, String reason, String reviewer) { throw new UnsupportedOperationException(); }
    }
}
