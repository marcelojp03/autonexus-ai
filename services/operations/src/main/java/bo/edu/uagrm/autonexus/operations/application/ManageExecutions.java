package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.EvidenceRules;
import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.StoredObject;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;

/**
 * CU16 use cases. The mechanic records execution, advances and evidence for the work that the
 * CU15 saga already confirmed and assigned to them. This class never changes the order status:
 * closing and verifying belongs to CU17.
 */
@Service
public class ManageExecutions {
    private static final String EVIDENCE_PREFIX = "evidence";
    private static final int MAX_EVIDENCE_PER_ADVANCE = 10;

    private final ExecutionPorts.Repository repository;
    private final IdentityGateway employees;
    private final EvidenceStorage storage;
    private final Clock clock;
    private final Duration downloadTtl;

    public ManageExecutions(ExecutionPorts.Repository repository, IdentityGateway employees, EvidenceStorage storage,
            Clock clock, Duration downloadTtl) {
        this.repository = repository;
        this.employees = employees;
        this.storage = storage;
        this.clock = clock;
        this.downloadTtl = downloadTtl;
    }

    public static OperationsError denied() { return new OperationsError(403, "EXECUTION_ACCESS_DENIED"); }
    public static OperationsError missing() { return OperationsError.notFound("EXECUTION_WORK_NOT_FOUND"); }
    public static OperationsError state() { return new OperationsError(503, "EXECUTION_STATE_UNAVAILABLE"); }
    public static OperationsError dependency() { return new OperationsError(503, "EXECUTION_DEPENDENCY_UNAVAILABLE"); }
    private static OperationsError storageMissing() { return new OperationsError(503, "EVIDENCE_STORAGE_UNAVAILABLE"); }
    private static OperationsError evidenceState() { return OperationsError.conflict("EVIDENCE_STATE_CONFLICT"); }

    /** One assignment per request: the identity owner revalidates identity, activity and record. */
    private Authorized authorize(String token, String scope, UUID assignmentId) {
        if (token == null || token.isBlank() || !ExecutionPorts.SCOPES.contains(scope)) throw denied();
        Authorized authorized = employees.authorize(token, scope, List.of(assignmentId));
        if (authorized == null || authorized.actor() == null || authorized.observedAt() == null) throw dependency();
        if (!"active".equals(authorized.actor().status()) || authorized.actor().employeeId() == null) throw denied();
        if (authorized.items() == null || authorized.items().size() != 1) throw missing();
        Assignment assignment = authorized.items().get(0);
        if (assignment == null || !assignmentId.equals(assignment.assignmentId())) throw missing();
        if (!List.of("active", "inactive").contains(assignment.employeeStatus())) throw state();
        if (!"read-team".equals(scope) && !authorized.actor().employeeId().equals(assignment.employeeId())) throw missing();
        return authorized;
    }

    /**
     * The owner's own proof: order confirmed with a confirmed saga and the same references the
     * identity owner reported. A mismatch is a state problem, never an empty result.
     */
    private Confirmed confirmed(UUID assignmentId, Assignment assignment, boolean ownRecord) {
        if (!"confirmed".equals(assignment.status())) throw missing();
        Confirmed work = repository.confirmed(assignmentId).orElseThrow(ManageExecutions::missing);
        if (!Objects.equals(work.orderId(), assignment.orderId())
                || !Objects.equals(work.employeeId(), assignment.employeeId())
                || !Objects.equals(work.sagaId(), assignment.sagaId())
                || !Objects.equals(work.startsAt(), assignment.startsAt())
                || !Objects.equals(work.endsAt(), assignment.endsAt())
                || assignment.version() < 1
                || assignment.orderConfirmedObserved() == null) throw state();
        if (ownRecord && !"active".equals(assignment.employeeStatus())) throw denied();
        return work;
    }

    private Execution readExecution(Confirmed work) {
        return repository.load(work.assignmentId()).orElseThrow(ManageExecutions::missing);
    }

    public Execution read(String token, String scope, UUID assignmentId) {
        Authorized authorized = authorize(token, scope, assignmentId);
        Confirmed work = confirmed(assignmentId, authorized.items().get(0), false);
        return readExecution(work);
    }

    public Mutation<Execution> start(String token, UUID assignmentId, Map<String, Object> body) {
        Validation.onlyKeys(body, Execution.START_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        Authorized authorized = authorize(token, "write", assignmentId);
        Confirmed work = confirmed(assignmentId, authorized.items().get(0), true);
        String fingerprint = fingerprint("execution-start", operationId, work, "none");
        Optional<UUID> replay = repository.replayed(operationId, fingerprint);
        if (replay.isPresent()) {
            return new Mutation<>(repository.executionById(replay.get()).orElseThrow(ManageExecutions::state), true);
        }
        Execution created;
        try {
            created = repository.insertExecution(work, clock.instant(), authorized.actor().employeeId().toString(), operationId, fingerprint);
        } catch (OperationsError conflict) {
            if (!"EXECUTION_ALREADY_STARTED".equals(conflict.code())) throw conflict;
            Optional<UUID> concurrentReplay = repository.replayed(operationId, fingerprint);
            if (concurrentReplay.isPresent()) {
                return new Mutation<>(repository.executionById(concurrentReplay.get()).orElseThrow(ManageExecutions::state), true);
            }
            throw conflict;
        }
        return new Mutation<>(created, false);
    }

    public Mutation<Execution> advance(String token, UUID assignmentId, Map<String, Object> body) {
        Validation.onlyKeys(body, Execution.ADVANCE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        String description = Validation.text(body.get("description"), 3, 2000);
        int minutes = minutes(body.get("minutesWorked"));
        Instant requested = body.get("occurredAt") == null ? null : Validation.instant(body.get("occurredAt"));
        Authorized authorized = authorize(token, "write", assignmentId);
        Confirmed work = confirmed(assignmentId, authorized.items().get(0), true);
        Execution current = readExecution(work);
        Instant now = clock.instant();
        Instant occurredAt = requested == null ? now : requested;
        if (occurredAt.isAfter(now) || occurredAt.isBefore(current.startedAt())) throw OperationsError.invalid();
        String fingerprint = fingerprint("execution-advance", operationId, work,
                expectedVersion + "\u001F" + description + "\u001F" + minutes + "\u001F"
                        + (requested == null ? "server-time" : requested.toString()));
        if (repository.replayed(operationId, fingerprint).isPresent()) {
            return new Mutation<>(repository.executionById(current.id()).orElseThrow(ManageExecutions::state), true);
        }
        Execution updated = repository.appendAdvance(current, expectedVersion,
                new AdvanceDraft(description, minutes, occurredAt), now,
                authorized.actor().employeeId().toString(), operationId, fingerprint);
        return new Mutation<>(updated, false);
    }

    public EvidenceUpload requestEvidence(String token, UUID assignmentId, UUID advanceId, Map<String, Object> body) {
        Validation.onlyKeys(body, Execution.EVIDENCE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        String contentType = EvidenceRules.contentType(body.get("contentType"));
        EvidenceDraft draft = new EvidenceDraft(
                EvidenceRules.fileName(body.get("fileName")),
                contentType,
                EvidenceRules.size(body.get("sizeBytes"), contentType),
                EvidenceRules.checksum(body.get("checksumSha256")));
        Authorized authorized = authorize(token, "write", assignmentId);
        Confirmed work = confirmed(assignmentId, authorized.items().get(0), true);
        Execution execution = readExecution(work);
        requireAdvance(execution, advanceId, true);
        requireStorage();
        String fingerprint = fingerprint("evidence-request", operationId, work,
                advanceId + "\u001F" + draft.fileName() + "\u001F" + draft.contentType() + "\u001F"
                        + draft.sizeBytes() + "\u001F" + draft.checksumSha256());
        Optional<UUID> replay = repository.replayed(operationId, fingerprint);
        if (replay.isPresent()) {
            EvidenceRecord stored = repository.evidence(work.orderId(), replay.get()).orElseThrow(ManageExecutions::state);
            return new EvidenceUpload(stored.evidence(), authorise(stored), true);
        }
        UUID evidenceId = UUID.randomUUID();
        String objectKey = objectKey(work.orderId(), evidenceId, 1, contentType);
        EvidenceRecord created = repository.insertEvidence(execution, evidenceId, advanceId, draft, objectKey,
                authorized.actor().employeeId().toString(), clock.instant(), operationId, fingerprint);
        return new EvidenceUpload(created.evidence(), authorise(created), false);
    }

    public Mutation<Execution.Evidence> confirmEvidence(String token, UUID assignmentId, UUID evidenceId,
            Map<String, Object> body) {
        Validation.onlyKeys(body, Execution.CONFIRM_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        Authorized authorized = authorize(token, "write", assignmentId);
        Confirmed work = confirmed(assignmentId, authorized.items().get(0), true);
        Execution execution = readExecution(work);
        EvidenceRecord record = repository.evidence(work.orderId(), evidenceId).orElseThrow(ManageExecutions::missing);
        requireOwned(execution, record.evidence());
        String fingerprint = fingerprint("evidence-confirm", operationId, work, evidenceId + "\u001F" + expectedVersion);
        Optional<UUID> replay = repository.replayed(operationId, fingerprint);
        if (replay.isPresent()) {
            return new Mutation<>(repository.evidence(work.orderId(), replay.get())
                    .orElseThrow(ManageExecutions::state).evidence(), true);
        }
        requireStorage();
        Execution.Evidence evidence = record.evidence();
        if (!"pending".equals(evidence.state())) throw evidenceState();
        Instant now = clock.instant();
        StoredObject stored = storage.stat(record.objectKey()).orElse(null);
        if (stored == null) {
            if (!repository.markFailed(evidence, expectedVersion, "EVIDENCE_OBJECT_MISSING", now,
                    operationId, fingerprint, authorized.actor().employeeId().toString())) throw OperationsError.conflict("VERSION_CONFLICT");
            return new Mutation<>(repository.evidence(work.orderId(), evidence.id()).orElseThrow(ManageExecutions::state).evidence(), false);
        }
        String failure = EvidenceRules.verify(evidence.contentType(), evidence.sizeBytes(),
                record.checksumSha256(), stored, storage.prefix(record.objectKey(), 32));
        if (failure != null) {
            if (!repository.markFailed(evidence, expectedVersion, failure, now,
                    operationId, fingerprint, authorized.actor().employeeId().toString())) throw OperationsError.conflict("VERSION_CONFLICT");
            storage.delete(record.objectKey());
            return new Mutation<>(repository.evidence(work.orderId(), evidence.id()).orElseThrow(ManageExecutions::state).evidence(), false);
        }
        if (!repository.markVerified(evidence, expectedVersion, stored, now, operationId, fingerprint,
                authorized.actor().employeeId().toString())) throw OperationsError.conflict("VERSION_CONFLICT");
        return new Mutation<>(repository.evidence(work.orderId(), evidence.id())
                .orElseThrow(ManageExecutions::state).evidence(), false);
    }

    public EvidenceUpload retryEvidence(String token, UUID assignmentId, UUID evidenceId, Map<String, Object> body) {
        Validation.onlyKeys(body, Execution.RETRY_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        String contentType = EvidenceRules.contentType(body.get("contentType"));
        EvidenceDraft draft = new EvidenceDraft(EvidenceRules.fileName(body.get("fileName")), contentType,
                EvidenceRules.size(body.get("sizeBytes"), contentType), EvidenceRules.checksum(body.get("checksumSha256")));
        Authorized authorized = authorize(token, "write", assignmentId);
        Confirmed work = confirmed(assignmentId, authorized.items().get(0), true);
        Execution execution = readExecution(work);
        EvidenceRecord record = repository.evidence(work.orderId(), evidenceId).orElseThrow(ManageExecutions::missing);
        requireOwned(execution, record.evidence());
        requireStorage();
        String fingerprint = fingerprint("evidence-retry", operationId, work, evidenceId + "\u001F"
                + draft.fileName() + "\u001F" + draft.contentType() + "\u001F" + draft.sizeBytes() + "\u001F" + draft.checksumSha256());
        Optional<UUID> replay = repository.replayed(operationId, fingerprint);
        if (replay.isPresent()) {
            EvidenceRecord stored = repository.evidence(work.orderId(), replay.get()).orElseThrow(ManageExecutions::state);
            return new EvidenceUpload(stored.evidence(), authorise(stored), true);
        }
        if ("available".equals(record.evidence().state())) throw evidenceState();
        if (record.evidence().attempt() >= Execution.MAX_ATTEMPTS) {
            throw OperationsError.conflict("EVIDENCE_ATTEMPTS_EXHAUSTED");
        }
        int attempt = record.evidence().attempt() + 1;
        String objectKey = objectKey(work.orderId(), evidenceId, attempt, draft.contentType());
        if (!repository.markPending(record.evidence(), expectedVersion, draft, objectKey,
                authorized.actor().employeeId().toString(), clock.instant(), operationId, fingerprint)) {
            throw OperationsError.conflict("VERSION_CONFLICT");
        }
        EvidenceRecord updated = repository.evidence(work.orderId(), evidenceId).orElseThrow(ManageExecutions::state);
        return new EvidenceUpload(updated.evidence(), authorise(updated), false);
    }

    public Download download(String token, String scope, UUID assignmentId, UUID evidenceId) {
        Authorized authorized = authorize(token, scope, assignmentId);
        Confirmed work = confirmed(assignmentId, authorized.items().get(0), false);
        Execution execution = readExecution(work);
        EvidenceRecord record = repository.evidence(work.orderId(), evidenceId).orElseThrow(ManageExecutions::missing);
        requireOwned(execution, record.evidence());
        requireStorage();
        if (!"available".equals(record.evidence().state())) throw evidenceState();
        return new Download(storage.download(record.objectKey(), record.versionId(), downloadTtl),
                clock.instant().plus(downloadTtl));
    }

    private void requireAdvance(Execution execution, UUID advanceId, boolean enforceLimit) {
        Execution.Advance advance = execution.advances().stream()
                .filter(candidate -> candidate.id().equals(advanceId)).findFirst()
                .orElseThrow(ManageExecutions::missing);
        if (enforceLimit && advance.evidences().size() >= MAX_EVIDENCE_PER_ADVANCE) {
            throw OperationsError.conflict("EVIDENCE_STATE_CONFLICT");
        }
    }

    private void requireOwned(Execution execution, Execution.Evidence evidence) {
        if (evidence == null
                || execution.advances().stream().noneMatch(a -> a.id().equals(evidence.advanceId()))) {
            throw missing();
        }
    }

    private void requireStorage() {
        if (!storage.configured()) throw storageMissing();
    }

    private Upload authorise(EvidenceRecord record) {
        return storage.authorise(record.objectKey(), record.evidence().sizeBytes(),
                record.evidence().contentType(), record.checksumSha256());
    }

    /** The key is generated only here, with the order, the evidence and the attempt discriminator. */
    private static String objectKey(UUID orderId, UUID evidenceId, int attempt, String contentType) {
        String extension = switch (contentType) {
            case "image/jpeg" -> "jpg";
            case "image/png" -> "png";
            case "image/webp" -> "webp";
            case "video/mp4" -> "mp4";
            default -> throw OperationsError.invalid();
        };
        return EVIDENCE_PREFIX + "/" + orderId + "/" + evidenceId + "/a" + attempt + "-"
                + UUID.randomUUID().toString().replace("-", "").substring(0, 12) + "." + extension;
    }

    private static int minutes(Object value) {
        if (!(value instanceof Number number) || number.doubleValue() != number.longValue()) {
            throw OperationsError.invalid();
        }
        long minutes = number.longValue();
        if (minutes < 1 || minutes > 1440) throw OperationsError.invalid();
        return (int) minutes;
    }

    private static String fingerprint(String action, UUID operationId, Confirmed work, String content) {
        return String.join("\u001F", action, operationId.toString(), work.orderId().toString(),
                work.assignmentId().toString(), work.employeeId().toString(),
                String.valueOf(work.orderVersion()), content);
    }
}
