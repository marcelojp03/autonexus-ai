package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * CU17 technical verification. The order keeps its CU15 confirmation while the work runs and is
 * reviewed; only an approval by the workshop head makes it completed. Delivery and payment are
 * separate facts and are never derived from this state.
 */
public record Verification(Execution execution, List<ChecklistItem> checklist, List<Review> reviews) {

    public static final String PENDING_VERIFICATION = "pending_verification";
    public static final String COMPLETED = "completed";
    public static final Set<String> EXECUTION_STATUSES =
            Set.of(Execution.IN_PROGRESS, PENDING_VERIFICATION, COMPLETED);

    public static final String PENDING = "pending";
    public static final String DONE = "done";

    public static final Set<String> REVIEW_KEYS = Set.of("operationId", "expectedVersion");
    public static final Set<String> RETURN_KEYS = Set.of("operationId", "expectedVersion", "reason");
    public static final Set<String> ITEM_KEYS = Set.of("operationId", "expectedVersion");

    /** One mandatory activity derived from an order item. A textual advance never flips it. */
    public record ChecklistItem(
            UUID id,
            UUID orderItemId,
            int position,
            String description,
            int quantity,
            String state,
            Instant doneAt,
            String doneBy,
            int version) {}

    /** Append-only review trail entry. */
    public record Review(
            UUID id, String action, String actor, String reason, int executionVersion, Instant occurredAt) {}

    /** Public projection returned to consumers: no object keys, checksums or signed URLs. */
    public record View(
            Execution execution,
            List<ChecklistItem> checklist,
            List<Review> reviews,
            int mandatoryPending,
            int availableEvidence) {}
}
