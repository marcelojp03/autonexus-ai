package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.Verification;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** CU17 ports. The identity owner resolves the verifying actor; the client never supplies it. */
public final class VerificationPorts {
    private VerificationPorts() {}

    /** Scope used to authorize a workshop head as verifier. */
    public static final String VERIFY = "verify";

    public interface Repository {
        /** Seeds the mandatory checklist once from the order items already copied to the order. */
        void seedChecklist(UUID executionId, UUID orderId, String actor, Instant now);

        List<Verification.ChecklistItem> checklist(UUID executionId);

        List<Verification.Review> reviews(UUID executionId);

        int availableEvidence(UUID orderId);

        int advanceCount(UUID executionId);

        boolean markItem(
                UUID executionId,
                UUID itemId,
                int expectedVersion,
                boolean done,
                String actor,
                Instant now,
                UUID operationId,
                String fingerprint);

        boolean requestReview(
                Execution current,
                int expectedVersion,
                String actor,
                Instant now,
                UUID operationId,
                String fingerprint);

        /** Approves or returns. Approval also completes the order in the same transaction. */
        boolean decide(
                Execution current,
                int expectedVersion,
                boolean approved,
                String reason,
                String actor,
                Instant now,
                UUID operationId,
                String fingerprint);

        Optional<UUID> replayed(UUID operationId, String fingerprint);
    }
}
