package bo.edu.uagrm.autonexus.operations.application;

import static org.junit.jupiter.api.Assertions.*;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.StoredObject;
import bo.edu.uagrm.autonexus.operations.domain.Verification;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ManageVerificationTest {
    private static final UUID ASSIGNMENT = UUID.randomUUID();
    private static final UUID ORDER = UUID.randomUUID();
    private static final UUID MECHANIC = UUID.randomUUID();
    private static final UUID HEAD = UUID.randomUUID();
    private static final UUID SAGA = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-30T12:00:00Z");

    /** Mutable in-memory stand-in: the test drives state, not the implementation. */
    static final class Fake implements ExecutionPorts.Repository, VerificationPorts.Repository {
        String status = Execution.IN_PROGRESS;
        int version = 2;
        int advances = 2;
        int available = 1;
        List<Verification.ChecklistItem> items = new ArrayList<>();
        List<Verification.Review> reviews = new ArrayList<>();
        Execution lastPersisted;

        Fake withItem(String state) {
            items.add(new Verification.ChecklistItem(UUID.randomUUID(), UUID.randomUUID(), 1, "Cambio de aceite",
                    1, state, Verification.DONE.equals(state) ? NOW : null, Verification.DONE.equals(state) ? "m" : null, 1));
            return this;
        }

        private Execution execution() {
            return new Execution(UUID.randomUUID(), ORDER, "WO-1", ASSIGNMENT, MECHANIC, status, NOW, version,
                    List.of(), new Execution.Summary(0, available, 0));
        }

        @Override public Optional<Confirmed> confirmed(UUID assignmentId) {
            return assignmentId.equals(ASSIGNMENT)
                    ? Optional.of(new Confirmed(ORDER, "WO-1", ASSIGNMENT, MECHANIC, SAGA,
                            NOW.minusSeconds(3600), NOW.plusSeconds(3600), 4))
                    : Optional.empty();
        }

        @Override public Optional<Execution> load(UUID assignmentId) { return Optional.of(execution()); }
        @Override public Optional<Execution> executionById(UUID id) { return Optional.of(execution()); }
        @Override public Execution insertExecution(Confirmed work, Instant now, String actor, UUID op, String fp) {
            throw new UnsupportedOperationException();
        }
        @Override public Execution appendAdvance(Execution current, int expected, AdvanceDraft draft, Instant now,
                String actor, UUID op, String fp) { throw new UnsupportedOperationException(); }
        @Override public EvidenceRecord insertEvidence(Execution execution, UUID evidenceId, UUID advanceId,
                EvidenceDraft draft, String objectKey, String actor, Instant now, UUID op, String fp) {
            throw new UnsupportedOperationException();
        }
        @Override public Optional<EvidenceRecord> evidence(UUID orderId, UUID evidenceId) { return Optional.empty(); }
        @Override public boolean markVerified(Execution.Evidence evidence, int expected, StoredObject stored, Instant now,
                UUID op, String fp, String actor) { return false; }
        @Override public boolean markFailed(Execution.Evidence evidence, int expected, String code, Instant now,
                UUID op, String fp, String actor) { return false; }
        @Override public boolean markPending(Execution.Evidence evidence, int expected, EvidenceDraft draft,
                String objectKey, String actor, Instant now, UUID op, String fp) { return false; }

        @Override public void seedChecklist(UUID executionId, UUID orderId, String actor, Instant now) {}
        @Override public List<Verification.ChecklistItem> checklist(UUID executionId) { return items; }
        @Override public List<Verification.Review> reviews(UUID executionId) { return reviews; }
        @Override public int availableEvidence(UUID orderId) { return available; }
        @Override public int advanceCount(UUID executionId) { return advances; }

        @Override public boolean markItem(UUID executionId, UUID itemId, int expected, boolean done, String actor,
                Instant now, UUID op, String fp) {
            if (expected != items.get(0).version()) return false;
            items.set(0, new Verification.ChecklistItem(items.get(0).id(), items.get(0).orderItemId(), 1, "Cambio de aceite",
                    1, done ? Verification.DONE : Verification.PENDING, done ? now : null, done ? actor : null,
                    items.get(0).version() + 1));
            return true;
        }

        @Override public boolean requestReview(Execution current, int expected, String actor, Instant now, UUID op, String fp) {
            if (expected != version || !Execution.IN_PROGRESS.equals(status)) return false;
            status = Verification.PENDING_VERIFICATION;
            version++;
            reviews.add(new Verification.Review(UUID.randomUUID(), "requested", actor, null, version, now));
            return true;
        }

        @Override public boolean decide(Execution current, int expected, boolean approved, String reason, String actor,
                Instant now, UUID op, String fp) {
            if (expected != version || !Verification.PENDING_VERIFICATION.equals(status)) return false;
            status = approved ? Verification.COMPLETED : Execution.IN_PROGRESS;
            version++;
            reviews.add(new Verification.Review(UUID.randomUUID(), approved ? "approved" : "returned", actor, reason,
                    version, now));
            return true;
        }

        @Override public Optional<UUID> replayed(UUID operationId, String fingerprint) { return Optional.empty(); }
    }

    static final class Identity implements ExecutionPorts.IdentityGateway {
        UUID actor = MECHANIC;
        String scope;
        @Override public Authorized authorize(String token, String scope, List<UUID> ids) {
            this.scope = scope;
            return new Authorized(new Actor(actor, "Actor", "active"),
                    List.of(new Assignment(ASSIGNMENT, SAGA, ORDER, MECHANIC, "Mecánico", "active",
                            NOW.minusSeconds(3600), NOW.plusSeconds(3600), "confirmed", 2, true)), NOW);
        }
    }

    private ManageVerification useCase(Fake fake, Identity identity) {
        return new ManageVerification(fake, fake, identity, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static Map<String, Object> body() {
        Map<String, Object> body = new HashMap<>();
        body.put("operationId", UUID.randomUUID().toString());
        body.put("expectedVersion", 2);
        return body;
    }

    @Test
    void mechanicRequestsReviewWhenChecklistAndEvidenceAreComplete() {
        Fake fake = new Fake().withItem(Verification.DONE);
        Identity identity = new Identity();
        var view = useCase(fake, identity).requestReview("t", ASSIGNMENT, body());
        assertEquals(Verification.PENDING_VERIFICATION, view.execution().status());
        assertEquals("write", identity.scope);
        assertEquals("requested", fake.reviews.get(0).action());
    }

    @Test
    void requestIsRejectedWhileAMandatoryActivityIsPending() {
        Fake fake = new Fake().withItem(Verification.PENDING);
        OperationsError error = assertThrows(OperationsError.class,
                () -> useCase(fake, new Identity()).requestReview("t", ASSIGNMENT, body()));
        assertEquals("CHECKLIST_INCOMPLETE", error.code());
        assertEquals(409, error.statusCode());
    }

    @Test
    void requestIsRejectedWithoutAnAvailableEvidence() {
        Fake fake = new Fake().withItem(Verification.DONE);
        fake.available = 0;
        OperationsError error = assertThrows(OperationsError.class,
                () -> useCase(fake, new Identity()).requestReview("t", ASSIGNMENT, body()));
        assertEquals("EVIDENCE_REQUIRED", error.code());
    }

    @Test
    void mechanicCannotApproveTheirOwnWork() {
        Fake fake = new Fake().withItem(Verification.DONE);
        fake.status = Verification.PENDING_VERIFICATION;
        OperationsError error = assertThrows(OperationsError.class,
                () -> useCase(fake, new Identity()).approve("t", ASSIGNMENT, body()));
        assertEquals("SELF_VERIFICATION_FORBIDDEN", error.code());
        assertEquals(403, error.statusCode());
    }

    @Test
    void headApprovesAndTheExecutionCompletes() {
        Fake fake = new Fake().withItem(Verification.DONE);
        fake.status = Verification.PENDING_VERIFICATION;
        Identity identity = new Identity();
        identity.actor = HEAD;
        var view = useCase(fake, identity).approve("t", ASSIGNMENT, body());
        assertEquals(Verification.COMPLETED, view.execution().status());
        assertEquals("verify", identity.scope);
        assertEquals("approved", fake.reviews.get(0).action());
    }

    @Test
    void headReturnsWithReasonAndTheExecutionResumes() {
        Fake fake = new Fake().withItem(Verification.DONE);
        fake.status = Verification.PENDING_VERIFICATION;
        Identity identity = new Identity();
        identity.actor = HEAD;
        Map<String, Object> body = body();
        body.put("reason", "Falta revisar la presión de neumáticos");
        var view = useCase(fake, identity).reject("t", ASSIGNMENT, body);
        assertEquals(Execution.IN_PROGRESS, view.execution().status());
        assertEquals("returned", fake.reviews.get(0).action());
        assertEquals("Falta revisar la presión de neumáticos", fake.reviews.get(0).reason());
    }

    @Test
    void returnWithoutReasonIsAValidationError() {
        Fake fake = new Fake().withItem(Verification.DONE);
        fake.status = Verification.PENDING_VERIFICATION;
        Identity identity = new Identity();
        identity.actor = HEAD;
        OperationsError error = assertThrows(OperationsError.class,
                () -> useCase(fake, identity).reject("t", ASSIGNMENT, body()));
        assertEquals("VALIDATION_ERROR", error.code());
    }

    @Test
    void mechanicCannotApproveBeforeRequestingReview() {
        Fake fake = new Fake().withItem(Verification.DONE);
        Identity identity = new Identity();
        identity.actor = HEAD;
        OperationsError error = assertThrows(OperationsError.class,
                () -> useCase(fake, identity).approve("t", ASSIGNMENT, body()));
        assertEquals("EXECUTION_STATE_CONFLICT", error.code());
    }
}
