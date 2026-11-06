package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.Verification;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * CU28 envelope for a CU17 review request. The body is closed: identifiers, the resulting state and
 * the version only. No name, plate, note, reason, token or signed URL travels in the event, and a
 * consumer never derives authority from any text inside it.
 */
public final class ReviewRequestedEvent {
    public static final String TYPE = "operations.execution.review.requested.v1";
    public static final String PRODUCER = "operations";
    public static final String AGGREGATE_TYPE = "execution";
    public static final int SCHEMA_VERSION = 1;
    private static final String EXECUTED_BY = "autonexus-operations-cu17";

    private ReviewRequestedEvent() {}

    /**
     * Deterministic id: the same execution version always yields the same id, so a replay or a
     * publisher redelivery reuses it, while a later transition on another version gets a new one.
     */
    public static UUID id(UUID executionId, int version) {
        return UUID.nameUUIDFromBytes((TYPE + '|' + executionId + '|' + version).getBytes(StandardCharsets.UTF_8));
    }

    public static Map<String, Object> envelope(Execution execution, int version, Instant occurredAt, UUID operationId) {
        if (execution == null || operationId == null) throw new IllegalStateException("CU28 event without origin");
        if (version < 1) throw new IllegalStateException("CU28 event without a positive version");
        String at = utc(occurredAt);
        Map<String, Object> data = new TreeMap<>();
        data.put("executionId", execution.id().toString());
        data.put("orderId", execution.orderId().toString());
        data.put("assignmentId", execution.assignmentId().toString());
        data.put("employeeId", execution.employeeId().toString());
        data.put("status", Verification.PENDING_VERIFICATION);
        data.put("version", version);
        data.put("requestedAt", at);

        Map<String, Object> envelope = new TreeMap<>();
        envelope.put("eventId", id(execution.id(), version).toString());
        envelope.put("schemaVersion", SCHEMA_VERSION);
        envelope.put("eventType", TYPE);
        envelope.put("producer", PRODUCER);
        envelope.put("aggregateType", AGGREGATE_TYPE);
        envelope.put("aggregateId", execution.id().toString());
        envelope.put("aggregateVersion", version);
        // The request that produced the transition identifies the command; the execution correlates it.
        envelope.put("correlationId", execution.id().toString());
        envelope.put("causationId", operationId.toString());
        envelope.put("occurredAt", at);
        envelope.put("initiatedBy", execution.employeeId().toString());
        envelope.put("executedBy", EXECUTED_BY);
        envelope.put("data", data);
        return envelope;
    }

    static String utc(Instant moment) {
        return DateTimeFormatter.ISO_INSTANT.format(moment.truncatedTo(ChronoUnit.MILLIS));
    }
}
