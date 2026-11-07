package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import bo.edu.uagrm.autonexus.operations.domain.Execution;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The "orden finalizada" flow is a different event of the same work: its own type, aggregate and id, a
 * closed body, and no text that a consumer could mistake for instructions or authority.
 */
class OrderFinalizedEventTest {
    private static final UUID EXECUTION = UUID.fromString("11111111-2222-4333-8444-555555555555");
    private static final UUID ORDER = UUID.fromString("66666666-7777-4888-8999-aaaaaaaaaaaa");
    private static final UUID ASSIGNMENT = UUID.fromString("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");
    private static final UUID EMPLOYEE = UUID.fromString("12345678-1234-4234-8234-123456789012");
    private static final UUID OPERATION = UUID.fromString("99999999-8888-4777-8666-555555555555");
    private static final Instant AT = Instant.parse("2026-11-07T10:15:30.123456Z");

    private static Execution execution() {
        return new Execution(EXECUTION, ORDER, "OT-2026-0001", ASSIGNMENT, EMPLOYEE, Execution.IN_PROGRESS,
                Instant.parse("2026-11-07T09:00:00Z"), 5, List.of(), new Execution.Summary(0, 0, 0));
    }

    @Test
    void carriesItsOwnTypeAggregateAndClosedBody() {
        Map<String, Object> envelope = OrderFinalizedEvent.envelope(execution(), 6, 6, AT, OPERATION);
        assertEquals(Set.of("eventId", "schemaVersion", "eventType", "producer", "aggregateType", "aggregateId",
                "aggregateVersion", "correlationId", "causationId", "occurredAt", "initiatedBy", "executedBy", "data"),
                envelope.keySet());
        assertEquals("operations.order.finalized.v1", envelope.get("eventType"));
        assertEquals("operations", envelope.get("producer"));
        assertEquals(1, envelope.get("schemaVersion"));
        assertEquals("order", envelope.get("aggregateType"));
        assertEquals(ORDER.toString(), envelope.get("aggregateId"));
        assertEquals(6, envelope.get("aggregateVersion"));
        assertEquals(EXECUTION.toString(), envelope.get("correlationId"));
        assertEquals(OPERATION.toString(), envelope.get("causationId"));
        assertEquals("2026-11-07T10:15:30.123Z", envelope.get("occurredAt"));

        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) envelope.get("data");
        assertEquals(Set.of("orderId", "executionId", "assignmentId", "employeeId", "status", "version", "finalizedAt"),
                data.keySet());
        assertEquals("completed", data.get("status"));
        assertEquals(6, data.get("version"));
        assertFalse(envelope.toString().contains("OT-2026-0001"), "el número de orden no viaja en el evento");
    }

    @Test
    void isNotTheReviewRequestOfTheSameWork() {
        Map<String, Object> finalized = OrderFinalizedEvent.envelope(execution(), 6, 6, AT, OPERATION);
        Map<String, Object> requested = ReviewRequestedEvent.envelope(execution(), 6, AT, OPERATION);
        assertNotEquals(finalized.get("eventId"), requested.get("eventId"),
                "dos transiciones distintas del mismo trabajo no comparten id");
        assertNotEquals(finalized.get("eventType"), requested.get("eventType"));
        // The deterministic id is stable for the same order version and changes with the next one.
        assertEquals(OrderFinalizedEvent.id(ORDER, 6), OrderFinalizedEvent.id(ORDER, 6));
        assertNotEquals(OrderFinalizedEvent.id(ORDER, 6), OrderFinalizedEvent.id(ORDER, 7));
    }

    @Test
    void refusesAnEventWithoutOriginOrVersion() {
        assertThrows(IllegalStateException.class, () -> OrderFinalizedEvent.envelope(null, 6, 6, AT, OPERATION));
        assertThrows(IllegalStateException.class, () -> OrderFinalizedEvent.envelope(execution(), 6, 6, AT, null));
        assertThrows(IllegalStateException.class, () -> OrderFinalizedEvent.envelope(execution(), 0, 6, AT, OPERATION));
        assertThrows(IllegalStateException.class, () -> OrderFinalizedEvent.envelope(execution(), 6, 0, AT, OPERATION));
        assertTrue(OrderFinalizedEvent.TYPE.startsWith("operations."));
    }
}
