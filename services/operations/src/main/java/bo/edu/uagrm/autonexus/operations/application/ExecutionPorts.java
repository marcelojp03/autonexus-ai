package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.StoredObject;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** CU16 ports. Record authorization is resolved by the identity owner, never by the client. */
public final class ExecutionPorts {
    private ExecutionPorts() {}

    /** The three scopes of the closed catalog; the identity owner maps each to its permission. */
    public static final List<String> SCOPES = List.of("write", "read-self", "read-team");

    public record Actor(UUID employeeId, String fullName, String status) {}

    public record Assignment(
            UUID assignmentId,
            UUID sagaId,
            UUID orderId,
            UUID employeeId,
            String fullName,
            String employeeStatus,
            Instant startsAt,
            Instant endsAt,
            String status,
            long version,
            Boolean orderConfirmedObserved) {}

    public record Authorized(Actor actor, List<Assignment> items, Instant observedAt) {}

    /** The owner's own proof that the work is globally confirmed and assigned to someone. */
    public record Confirmed(
            UUID orderId,
            String orderNumber,
            UUID assignmentId,
            UUID employeeId,
            UUID sagaId,
            Instant startsAt,
            Instant endsAt,
            int orderVersion) {}

    public record AdvanceDraft(String description, int minutesWorked, Instant occurredAt) {}

    public record EvidenceDraft(
            String fileName, String contentType, long sizeBytes, String checksumSha256) {}

    public record Upload(String url, String method, Map<String, String> headers, Instant expiresAt) {}

    /** Internal row: the public DTO never carries keys, checksums or versions. */
    public record EvidenceRecord(
            Execution.Evidence evidence, UUID orderId, String objectKey, String checksumSha256, String versionId) {}

    public record EvidenceUpload(Execution.Evidence evidence, Upload upload) {}

    public record Download(String url, Instant expiresAt) {}

    public interface Repository {
        Optional<Confirmed> confirmed(UUID assignmentId);

        Optional<Execution> load(UUID assignmentId);

        Optional<Execution> executionById(UUID executionId);

        Execution insertExecution(Confirmed work, Instant now, String actor);

        Execution appendAdvance(
                Execution current, int expectedVersion, AdvanceDraft draft, Instant now, String actor);

        EvidenceRecord insertEvidence(
                Execution execution,
                UUID advanceId,
                EvidenceDraft draft,
                String objectKey,
                String actor,
                Instant now);

        Optional<EvidenceRecord> evidence(UUID orderId, UUID evidenceId);

        boolean markVerified(
                Execution.Evidence evidence, int expectedVersion, StoredObject stored, Instant now);

        boolean markFailed(
                Execution.Evidence evidence, int expectedVersion, String failureCode, Instant now);

        boolean markPending(
                Execution.Evidence evidence,
                int expectedVersion,
                String objectKey,
                String checksum,
                String actor,
                Instant now);

        /** Operation replay bookkeeping: entity id already produced by this operation, if any. */
        Optional<UUID> replayed(UUID operationId, String fingerprint);

        void remember(UUID operationId, String fingerprint, UUID entityId, String actor, String action);
    }

    public interface IdentityGateway {
        Authorized authorize(String token, String scope, List<UUID> assignmentIds);
    }

    /** Private object storage. Unconfigured means the evidence flow is honestly unavailable. */
    public interface EvidenceStorage {
        boolean configured();

        Upload authorise(String objectKey, long sizeBytes, String contentType, String checksumSha256);

        Optional<StoredObject> stat(String objectKey);

        byte[] prefix(String objectKey, int maxBytes);

        void delete(String objectKey);

        String download(String objectKey, String versionId, Duration ttl);
    }
}
