package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.Verification;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * CU28 envelope for the "orden finalizada" flow of the automation catalogue: when the workshop head
 * approves the verification (CU17), the order is technically completed and a delivery notice belongs to
 * the closed list of automations.
 *
 * <p>It is a different event from {@link ReviewRequestedEvent}: another type, another transition and
 * therefore another deterministic id, so the receiver sees two distinct events of the same aggregate
 * rather than one renamed into the other. The body stays closed — identifiers, state and version only.
 */
public final class OrderFinalizedEvent {
    public static final String TYPE = "operations.order.finalized.v1";
    public static final String PRODUCER = "operations";
    public static final String AGGREGATE_TYPE = "order";
    public static final int SCHEMA_VERSION = 1;
    private static final String EXECUTED_BY = "autonexus-operations-cu17";

    private OrderFinalizedEvent() {}

    /** Same execution version, different type: the id cannot collide with the review request. */
    public static UUID id(UUID orderId, int version) {
        return UUID.nameUUIDFromBytes((TYPE + '|' + orderId + '|' + version).getBytes(StandardCharsets.UTF_8));
    }

    public static Map<String, Object> envelope(Execution execution, int orderVersion, int executionVersion,
            Instant occurredAt, UUID operationId) {
        if (execution == null || operationId == null) throw new IllegalStateException("CU28 event without origin");
        if (orderVersion < 1 || executionVersion < 1) throw new IllegalStateException("CU28 event without a positive version");
        String at = ReviewRequestedEvent.utc(occurredAt);
        Map<String, Object> data = new TreeMap<>();
        data.put("orderId", execution.orderId().toString());
        data.put("executionId", execution.id().toString());
        data.put("assignmentId", execution.assignmentId().toString());
        data.put("employeeId", execution.employeeId().toString());
        data.put("status", Verification.COMPLETED);
        data.put("version", executionVersion);
        data.put("finalizedAt", at);

        Map<String, Object> envelope = new TreeMap<>();
        envelope.put("eventId", id(execution.orderId(), orderVersion).toString());
        envelope.put("schemaVersion", SCHEMA_VERSION);
        envelope.put("eventType", TYPE);
        envelope.put("producer", PRODUCER);
        envelope.put("aggregateType", AGGREGATE_TYPE);
        envelope.put("aggregateId", execution.orderId().toString());
        envelope.put("aggregateVersion", orderVersion);
        envelope.put("correlationId", execution.id().toString());
        envelope.put("causationId", operationId.toString());
        envelope.put("occurredAt", at);
        envelope.put("initiatedBy", execution.employeeId().toString());
        envelope.put("executedBy", EXECUTED_BY);
        envelope.put("data", data);
        return envelope;
    }
}
