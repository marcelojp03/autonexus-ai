package bo.edu.uagrm.autonexus.operations.application;

import static org.junit.jupiter.api.Assertions.*;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.StoredObject;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ManageExecutionsTest {
    private static final String SHA256 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
    private static final byte[] PNG = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};

    private final Instant now = Instant.parse("2026-11-02T12:00:00Z");
    private final UUID employee = UUID.randomUUID();
    private final UUID assignment = UUID.randomUUID();
    private final UUID order = UUID.randomUUID();
    private final UUID saga = UUID.randomUUID();
    private final FakeRepository repository = new FakeRepository();
    private final FakeStorage storage = new FakeStorage();
    private final FakeIdentity identity = new FakeIdentity();
    private final ManageExecutions useCase = new ManageExecutions(repository, identity, storage,
            Clock.fixed(now, ZoneOffset.UTC), Duration.ofSeconds(120));

    private Assignment assignment(String status, String employeeStatus, UUID owner) {
        return new Assignment(assignment, saga, order, owner, "Ana Mecánica", employeeStatus,
                now.minusSeconds(3600), now.plusSeconds(3600), status, 3, true);
    }

    private static Map<String, Object> startBody(UUID operationId) {
        return new HashMap<>(Map.of("operationId", operationId.toString()));
    }

    private static Map<String, Object> advanceBody(UUID operationId, int version, String text) {
        Map<String, Object> body = new HashMap<>();
        body.put("operationId", operationId.toString());
        body.put("expectedVersion", version);
        body.put("description", text);
        body.put("minutesWorked", 45);
        return body;
    }

    private static Map<String, Object> evidenceBody(UUID operationId) {
        return new HashMap<>(Map.of("operationId", operationId.toString(), "fileName", "foto.png",
                "contentType", "image/png", "sizeBytes", 1024, "checksumSha256", SHA256));
    }

    private static Map<String, Object> confirmBody(UUID operationId, int version) {
        Map<String, Object> body = new HashMap<>();
        body.put("operationId", operationId.toString());
        body.put("expectedVersion", version);
        return body;
    }

    @org.junit.jupiter.api.BeforeEach
    void wire() {
        repository.sagaId = saga;
        repository.orderId = order;
        repository.employeeId = employee;
    }

    private static String key(EvidenceUpload upload) {
        return upload.upload().url().substring("https://storage.test/".length());
    }

    private void authorizedOwn() {
        identity.own = assignment("confirmed", "active", employee);
    }

    @Test
    void startsOnceAndReplaysTheSameOperationWithoutDuplicating() {
        authorizedOwn();
        UUID operation = UUID.randomUUID();
        Mutation<Execution> first = useCase.start("human", assignment, startBody(operation));
        assertFalse(first.replayed());
        assertEquals(Execution.IN_PROGRESS, first.value().status());
        Mutation<Execution> replay = useCase.start("human", assignment, startBody(operation));
        assertTrue(replay.replayed());
        assertEquals(first.value().id(), replay.value().id());
        assertEquals(1, repository.executions.size());
    }

    @Test
    void refusesASecondStartWithADifferentOperation() {
        authorizedOwn();
        useCase.start("human", assignment, startBody(UUID.randomUUID()));
        OperationsError failure = assertThrows(OperationsError.class,
                () -> useCase.start("human", assignment, startBody(UUID.randomUUID())));
        assertEquals(409, failure.statusCode());
        assertEquals("EXECUTION_ALREADY_STARTED", failure.code());
    }

    @Test
    void refusesWritingOnSomeoneElsesAssignment() {
        identity.own = null;
        OperationsError failure = assertThrows(OperationsError.class,
                () -> useCase.start("human", assignment, startBody(UUID.randomUUID())));
        assertEquals(404, failure.statusCode());
        assertEquals("EXECUTION_WORK_NOT_FOUND", failure.code());
    }

    @Test
    void deniesAnInactiveEmployeeEvenWithAValidAssignment() {
        identity.own = assignment("confirmed", "inactive", employee);
        OperationsError failure = assertThrows(OperationsError.class,
                () -> useCase.start("human", assignment, startBody(UUID.randomUUID())));
        assertEquals(403, failure.statusCode());
        assertEquals("EXECUTION_ACCESS_DENIED", failure.code());
    }

    @Test
    void rejectsAnAssignmentThatIsNotConfirmed() {
        identity.own = assignment("reserved", "active", employee);
        OperationsError failure = assertThrows(OperationsError.class,
                () -> useCase.start("human", assignment, startBody(UUID.randomUUID())));
        assertEquals(503, failure.statusCode());
        assertEquals("EXECUTION_STATE_UNAVAILABLE", failure.code());
    }

    @Test
    void advancesWithVersionAndRejectsStaleOnes() {
        authorizedOwn();
        useCase.start("human", assignment, startBody(UUID.randomUUID()));
        Mutation<Execution> updated = useCase.advance("human", assignment, advanceBody(UUID.randomUUID(), 1, "Cambio de aceite"));
        assertEquals(1, updated.value().advances().size());
        assertEquals(2, updated.value().version());
        OperationsError conflict = assertThrows(OperationsError.class,
                () -> useCase.advance("human", assignment, advanceBody(UUID.randomUUID(), 1, "Otra cosa")));
        assertEquals("VERSION_CONFLICT", conflict.code());
    }

    @Test
    void consecutiveAdvancesKeepAMonotonicSequence() {
        authorizedOwn();
        useCase.start("human", assignment, startBody(UUID.randomUUID()));
        useCase.advance("human", assignment, advanceBody(UUID.randomUUID(), 1, "Primer avance"));
        Mutation<Execution> second = useCase.advance("human", assignment, advanceBody(UUID.randomUUID(), 2, "Segundo avance"));
        assertEquals(List.of(1, 2), second.value().advances().stream().map(Execution.Advance::sequence).toList());
    }

    @Test
    void rejectsAnOccurrenceBeforeTheStart() {
        authorizedOwn();
        useCase.start("human", assignment, startBody(UUID.randomUUID()));
        Map<String, Object> body = advanceBody(UUID.randomUUID(), 1, "Retroactivo");
        body.put("occurredAt", now.minusSeconds(7200).toString());
        OperationsError failure = assertThrows(OperationsError.class, () -> useCase.advance("human", assignment, body));
        assertEquals(400, failure.statusCode());
    }

    @Test
    void requestsEvidenceWithASignedConditionalWriteAndConfirmsIt() {
        authorizedOwn();
        useCase.start("human", assignment, startBody(UUID.randomUUID()));
        Execution execution = useCase.advance("human", assignment, advanceBody(UUID.randomUUID(), 1, "Avance")).value();
        UUID advanceId = execution.advances().getFirst().id();
        EvidenceUpload request = useCase.requestEvidence("human", assignment, advanceId, evidenceBody(UUID.randomUUID()));
        assertEquals("pending", request.evidence().state());
        assertEquals("PUT", request.upload().method());
        assertEquals("*", request.upload().headers().get("If-None-Match"));
        assertEquals(SHA256, request.upload().headers().get("x-amz-checksum-sha256"));
        assertTrue(request.upload().url().startsWith("https://storage.test/"));
        assertEquals(1, request.evidence().attempt());

        storage.put(key(request), PNG);
        Mutation<Execution.Evidence> confirmed = useCase.confirmEvidence("human", assignment,
                request.evidence().id(), confirmBody(UUID.randomUUID(), 1));
        assertEquals("available", confirmed.value().state());
        assertNotNull(confirmed.value().confirmedAt());
    }

    @Test
    void aConfirmedEvidenceCannotBeConfirmedAgainWithANewOperation() {
        authorizedOwn();
        Execution execution = startedWithAdvance();
        UUID advanceId = execution.advances().getFirst().id();
        EvidenceUpload request = useCase.requestEvidence("human", assignment, advanceId, evidenceBody(UUID.randomUUID()));
        storage.put(key(request), PNG);
        useCase.confirmEvidence("human", assignment, request.evidence().id(), confirmBody(UUID.randomUUID(), 1));
        OperationsError failure = assertThrows(OperationsError.class, () -> useCase.confirmEvidence("human",
                assignment, request.evidence().id(), confirmBody(UUID.randomUUID(), 2)));
        assertEquals("EVIDENCE_STATE_CONFLICT", failure.code());
    }

    @Test
    void aRewrittenObjectFailsTheFormatCheckAndIsDeleted() {
        authorizedOwn();
        Execution execution = startedWithAdvance();
        UUID advanceId = execution.advances().getFirst().id();
        EvidenceUpload request = useCase.requestEvidence("human", assignment, advanceId, evidenceBody(UUID.randomUUID()));
        storage.put(key(request), "%PDF-1.7".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        OperationsError failure = assertThrows(OperationsError.class, () -> useCase.confirmEvidence("human",
                assignment, request.evidence().id(), confirmBody(UUID.randomUUID(), 1)));
        assertEquals("EVIDENCE_STATE_CONFLICT", failure.code());
        assertEquals(1, storage.deleted.size());
        assertEquals("failed", repository.evidences.get(request.evidence().id()).state());
        assertEquals("EVIDENCE_CONTENT_MISMATCH", repository.evidences.get(request.evidence().id()).failureCode());
    }

    @Test
    void aMissingObjectLeavesTheEvidenceFailed() {
        authorizedOwn();
        Execution execution = startedWithAdvance();
        EvidenceUpload request = useCase.requestEvidence("human", assignment,
                execution.advances().getFirst().id(), evidenceBody(UUID.randomUUID()));
        assertThrows(OperationsError.class, () -> useCase.confirmEvidence("human", assignment,
                request.evidence().id(), confirmBody(UUID.randomUUID(), 1)));
        assertEquals("failed", repository.evidences.get(request.evidence().id()).state());
        assertEquals("EVIDENCE_OBJECT_MISSING", repository.evidences.get(request.evidence().id()).failureCode());
    }

    @Test
    void retryOpensANewAttemptWithANewObjectKey() {
        authorizedOwn();
        Execution execution = startedWithAdvance();
        EvidenceUpload request = useCase.requestEvidence("human", assignment,
                execution.advances().getFirst().id(), evidenceBody(UUID.randomUUID()));
        assertThrows(OperationsError.class, () -> useCase.confirmEvidence("human", assignment,
                request.evidence().id(), confirmBody(UUID.randomUUID(), 1)));
        Map<String, Object> body = confirmBody(UUID.randomUUID(), 2);
        body.put("checksumSha256", SHA256);
        EvidenceUpload retry = useCase.retryEvidence("human", assignment, request.evidence().id(), body);
        assertEquals(2, retry.evidence().attempt());
        assertEquals("pending", retry.evidence().state());
        assertNotEquals(key(request), key(retry));
    }

    @Test
    void evidenceThatDoesNotBelongToThisExecutionIsNotFound() {
        authorizedOwn();
        Execution execution = startedWithAdvance();
        UUID foreignAdvance = UUID.randomUUID();
        Execution.Evidence stranger = new Execution.Evidence(UUID.randomUUID(), foreignAdvance, "ajena.png",
                "image/png", 1024L, "pending", 1, null, now, null);
        repository.evidences.put(stranger.id(), stranger);
        repository.evidenceRecords.put(stranger.id(), new EvidenceRecord(stranger, order,
                "evidence/" + order + "/" + stranger.id() + "/a1-aaaa.png", SHA256, null));
        OperationsError failure = assertThrows(OperationsError.class, () -> useCase.confirmEvidence("human",
                assignment, stranger.id(), confirmBody(UUID.randomUUID(), 1)));
        assertEquals(404, failure.statusCode());
        assertEquals("EXECUTION_WORK_NOT_FOUND", failure.code());
    }

    @Test
    void withoutStorageConfigurationTheEvidenceFlowReports503() {
        authorizedOwn();
        storage.configured = false;
        Execution execution = startedWithAdvance();
        OperationsError failure = assertThrows(OperationsError.class, () -> useCase.requestEvidence("human",
                assignment, execution.advances().getFirst().id(), evidenceBody(UUID.randomUUID())));
        assertEquals(503, failure.statusCode());
        assertEquals("EVIDENCE_STORAGE_UNAVAILABLE", failure.code());
    }

    @Test
    void teamScopeReadsAnotherEmployeesExecution() {
        authorizedOwn();
        useCase.start("human", assignment, startBody(UUID.randomUUID()));
        // The chief is not the assignee: the read scope is what authorises the record.
        identity.own = null;
        identity.team = assignment("confirmed", "active", employee);
        Execution read = useCase.read("chief", "read-team", assignment);
        assertEquals(assignment, read.assignmentId());
        assertThrows(OperationsError.class, () -> useCase.read("chief", "read-self", assignment));
    }

    private Execution startedWithAdvance() {
        useCase.start("human", assignment, startBody(UUID.randomUUID()));
        return useCase.advance("human", assignment, advanceBody(UUID.randomUUID(), 1, "Avance")).value();
    }

    /** In-memory port double: the real behaviour lives in SQL, so this only proves the decisions. */
    static final class FakeRepository implements ExecutionPorts.Repository {
        UUID sagaId; UUID orderId; UUID employeeId;
        final Map<UUID, Execution> executions = new HashMap<>();
        final Map<UUID, Execution.Evidence> evidences = new HashMap<>();
        final Map<UUID, EvidenceRecord> evidenceRecords = new HashMap<>();
        final Map<UUID, UUID> operations = new HashMap<>();
        final Map<String, UUID> fingerprints = new HashMap<>();
        private int sequence;

        @Override public Optional<Confirmed> confirmed(UUID assignmentId) {
            if (sagaId == null) return Optional.empty();
            return Optional.of(new Confirmed(orderId, "WO-2026-1", assignmentId, employeeId, sagaId,
                    Instant.parse("2026-11-02T11:00:00Z"), Instant.parse("2026-11-02T13:00:00Z"), 4));
        }

        private Optional<Execution> executionOrEmpty() {
            return executions.values().stream().findFirst();
        }

        @Override public Optional<Execution> load(UUID assignmentId) { return executionOrEmpty(); }

        @Override public Optional<Execution> executionById(UUID executionId) {
            return executions.values().stream().filter(execution -> execution.id().equals(executionId)).findFirst();
        }

        @Override public Execution insertExecution(Confirmed work, Instant now, String actor) {
            if (!executions.isEmpty()) throw OperationsError.conflict("EXECUTION_ALREADY_STARTED");
            Execution execution = new Execution(UUID.randomUUID(), work.orderId(), work.orderNumber(),
                    work.assignmentId(), work.employeeId(), Execution.IN_PROGRESS, now, 1, List.of());
            executions.put(execution.id(), execution);
            return execution;
        }

        @Override public Execution appendAdvance(Execution current, int expectedVersion, AdvanceDraft draft,
                Instant now, String actor) {
            if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
            List<Execution.Advance> advances = new ArrayList<>(current.advances());
            advances.add(new Execution.Advance(UUID.randomUUID(), ++sequence, draft.description(),
                    draft.minutesWorked(), draft.occurredAt(), now, 1, List.of()));
            Execution updated = new Execution(current.id(), current.orderId(), current.orderNumber(),
                    current.assignmentId(), current.employeeId(), current.status(), current.startedAt(),
                    current.version() + 1, List.copyOf(advances));
            executions.put(updated.id(), updated);
            return updated;
        }

        @Override public EvidenceRecord insertEvidence(Execution execution, UUID advanceId, EvidenceDraft draft,
                String objectKey, String actor, Instant now) {
            Execution.Evidence evidence = new Execution.Evidence(UUID.randomUUID(), advanceId, draft.fileName(),
                    draft.contentType(), draft.sizeBytes(), "pending", 1, null, now, null);
            evidences.put(evidence.id(), evidence);
            EvidenceRecord record = new EvidenceRecord(evidence, execution.orderId(), objectKey, draft.checksumSha256(), null);
            evidenceRecords.put(evidence.id(), record);
            return record;
        }

        @Override public Optional<EvidenceRecord> evidence(UUID orderId, UUID evidenceId) {
            return Optional.ofNullable(evidenceRecords.get(evidenceId));
        }

        @Override public boolean markVerified(Execution.Evidence evidence, int expectedVersion, StoredObject stored, Instant now) {
            if (!"pending".equals(evidence.state())) return false;
            Execution.Evidence updated = new Execution.Evidence(evidence.id(), evidence.advanceId(), evidence.fileName(),
                    evidence.contentType(), evidence.sizeBytes(), "available", evidence.attempt(), null,
                    evidence.createdAt(), now);
            evidences.put(updated.id(), updated);
            evidenceRecords.put(updated.id(), new EvidenceRecord(updated, orderIdOf(updated),
                    evidenceRecords.get(updated.id()).objectKey(), evidenceRecords.get(updated.id()).checksumSha256(),
                    stored.versionId()));
            return true;
        }

        @Override public boolean markFailed(Execution.Evidence evidence, int expectedVersion, String failureCode, Instant now) {
            if (!"pending".equals(evidence.state())) return false;
            Execution.Evidence updated = new Execution.Evidence(evidence.id(), evidence.advanceId(), evidence.fileName(),
                    evidence.contentType(), evidence.sizeBytes(), "failed", evidence.attempt(), failureCode,
                    evidence.createdAt(), null);
            evidences.put(updated.id(), updated);
            EvidenceRecord previous = evidenceRecords.get(updated.id());
            evidenceRecords.put(updated.id(), new EvidenceRecord(updated, previous.orderId(), previous.objectKey(),
                    previous.checksumSha256(), null));
            return true;
        }

        @Override public boolean markPending(Execution.Evidence evidence, int expectedVersion, String objectKey,
                String checksum, String actor, Instant now) {
            Execution.Evidence updated = new Execution.Evidence(evidence.id(), evidence.advanceId(), evidence.fileName(),
                    evidence.contentType(), evidence.sizeBytes(), "pending", evidence.attempt() + 1, null,
                    evidence.createdAt(), null);
            evidences.put(updated.id(), updated);
            evidenceRecords.put(updated.id(), new EvidenceRecord(updated, orderIdOf(updated), objectKey, checksum, null));
            return true;
        }

        UUID foreignAdvanceId() { return UUID.randomUUID(); }

        private UUID orderIdOf(Execution.Evidence evidence) {
            return evidenceRecords.get(evidence.id()).orderId();
        }

        @Override public Optional<UUID> replayed(UUID operationId, String fingerprint) {
            UUID stored = fingerprints.get(operationId + fingerprint);
            return Optional.ofNullable(stored == null ? null : operations.get(stored));
        }

        @Override public void remember(UUID operationId, String fingerprint, UUID entityId, String actor, String action) {
            operations.put(operationId, entityId);
            fingerprints.put(operationId + fingerprint, operationId);
        }
    }

    static final class FakeIdentity implements IdentityGateway {
        Assignment own;
        Assignment team;

        @Override public Authorized authorize(String token, String scope, List<UUID> assignmentIds) {
            Assignment selected = "write".equals(scope) || "read-self".equals(scope) ? own : team;
            if (selected == null) throw ManageExecutions.missing();
            return new Authorized(new Actor(selected.employeeId(), selected.fullName(), selected.employeeStatus()),
                    List.of(selected), Instant.parse("2026-11-02T12:00:00Z"));
        }
    }

    static final class FakeStorage implements EvidenceStorage {
        boolean configured = true;
        final Map<String, byte[]> objects = new HashMap<>();
        final List<String> deleted = new ArrayList<>();
        String lastObjectKey;

        void put(String objectKey, byte[] prefix) {
            objects.put(objectKey, prefix);
            lastObjectKey = objectKey;
        }

        @Override public boolean configured() { return configured; }

        @Override public Upload authorise(String objectKey, long sizeBytes, String contentType, String checksumSha256) {
            lastObjectKey = objectKey;
            return new Upload("https://storage.test/" + objectKey, "PUT",
                    Map.of("Content-Type", contentType, "x-amz-checksum-sha256", checksumSha256, "If-None-Match", "*"),
                    Instant.parse("2026-11-02T12:05:00Z"));
        }

        @Override public Optional<StoredObject> stat(String objectKey) {
            return objects.containsKey(objectKey)
                    ? Optional.of(new StoredObject(1024L, "image/png", "\"etag\"", null, SHA256))
                    : Optional.empty();
        }

        @Override public byte[] prefix(String objectKey, int maxBytes) { return objects.get(objectKey); }

        @Override public void delete(String objectKey) { deleted.add(objectKey); objects.remove(objectKey); }

        @Override public String download(String objectKey, String versionId, Duration ttl) {
            return "https://storage.test/signed/" + objectKey;
        }
    }
}
