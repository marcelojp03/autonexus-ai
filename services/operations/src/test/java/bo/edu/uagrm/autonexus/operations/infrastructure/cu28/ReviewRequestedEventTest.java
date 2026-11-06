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

class ReviewRequestedEventTest {
    private static final UUID EXECUTION = UUID.fromString("11111111-2222-4333-8444-555555555555");
    private static final UUID ORDER = UUID.fromString("66666666-7777-4888-8999-aaaaaaaaaaaa");
    private static final UUID ASSIGNMENT = UUID.fromString("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");
    private static final UUID EMPLOYEE = UUID.fromString("12345678-1234-4234-8234-123456789012");
    private static final Instant AT = Instant.parse("2026-11-07T10:15:30.123456Z");

    private static Execution execution() {
        return new Execution(EXECUTION, ORDER, "OT-2026-0001", ASSIGNMENT, EMPLOYEE, Execution.IN_PROGRESS,
                Instant.parse("2026-11-07T09:00:00Z"), 4, List.of(), new Execution.Summary(0, 0, 0));
    }

    @Test
    void idIsStableForTheSameTransitionAndDifferentForAnotherVersion() {
        assertEquals(ReviewRequestedEvent.id(EXECUTION, 5), ReviewRequestedEvent.id(EXECUTION, 5));
        assertNotEquals(ReviewRequestedEvent.id(EXECUTION, 5), ReviewRequestedEvent.id(EXECUTION, 6));
    }

    @Test
    void envelopeIsClosedAndCarriesNoBusinessText() {
        UUID operationId = UUID.randomUUID();
        Map<String, Object> envelope = ReviewRequestedEvent.envelope(execution(), 5, AT, operationId);
        assertEquals(Set.of("eventId", "schemaVersion", "eventType", "producer", "aggregateType", "aggregateId",
                "aggregateVersion", "correlationId", "causationId", "occurredAt", "initiatedBy", "executedBy", "data"),
                envelope.keySet());
        assertEquals("operations.execution.review.requested.v1", envelope.get("eventType"));
        assertEquals("operations", envelope.get("producer"));
        assertEquals(1, envelope.get("schemaVersion"));
        assertEquals("execution", envelope.get("aggregateType"));
        assertEquals(EXECUTION.toString(), envelope.get("aggregateId"));
        assertEquals(5, envelope.get("aggregateVersion"));
        assertEquals(ReviewRequestedEvent.id(EXECUTION, 5).toString(), envelope.get("eventId"));
        assertEquals(operationId.toString(), envelope.get("causationId"));
        assertEquals(EXECUTION.toString(), envelope.get("correlationId"));
        assertEquals("2026-11-07T10:15:30.123Z", envelope.get("occurredAt"));

        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) envelope.get("data");
        assertEquals(Set.of("executionId", "orderId", "assignmentId", "employeeId", "status", "version", "requestedAt"),
                data.keySet());
        assertEquals("pending_verification", data.get("status"));
        assertEquals(5, data.get("version"));
        assertFalse(envelope.toString().contains("OT-2026-0001"), "the order number is not part of the envelope");
    }

    @Test
    void refusesAnEventWithoutOriginOrVersion() {
        UUID operationId = UUID.randomUUID();
        assertThrows(IllegalStateException.class, () -> ReviewRequestedEvent.envelope(null, 1, AT, operationId));
        assertThrows(IllegalStateException.class, () -> ReviewRequestedEvent.envelope(execution(), 1, AT, null));
        assertThrows(IllegalStateException.class, () -> ReviewRequestedEvent.envelope(execution(), 0, AT, operationId));
    }

    @Test
    void backoffGrowsUpToTheCap() {
        assertEquals(1000, ReviewEventPublisher.delayMillis(1));
        assertEquals(2000, ReviewEventPublisher.delayMillis(2));
        assertEquals(4000, ReviewEventPublisher.delayMillis(3));
        assertEquals(8000, ReviewEventPublisher.delayMillis(4));
        assertEquals(10000, ReviewEventPublisher.delayMillis(5));
        assertEquals(10000, ReviewEventPublisher.delayMillis(10));
        assertTrue(ReviewEventPublisher.MAX_ATTEMPTS > ReviewEventPublisher.delayMillis(0) / 1000);
    }
}
