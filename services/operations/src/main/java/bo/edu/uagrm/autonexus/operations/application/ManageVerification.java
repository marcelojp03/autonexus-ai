package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.Assignment;
import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.Authorized;
import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.Confirmed;
import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import bo.edu.uagrm.autonexus.operations.domain.Verification;
import java.time.Clock;
import java.time.Instant;
import java.util.*;

/**
 * CU17 use cases. The assigned mechanic asks for a review and ticks the mandatory activities; the
 * workshop head approves or returns. A reviewer can never approve their own work, even with
 * several roles. Approval completes the order; the CU15 saga is never reopened.
 */
public final class ManageVerification {
    private final ExecutionPorts.Repository executions;
    private final VerificationPorts.Repository verifications;
    private final ExecutionPorts.IdentityGateway employees;
    private final Clock clock;

    public ManageVerification(ExecutionPorts.Repository executions, VerificationPorts.Repository verifications,
            ExecutionPorts.IdentityGateway employees, Clock clock) {
        this.executions = executions;
        this.verifications = verifications;
        this.employees = employees;
        this.clock = clock;
    }

    static OperationsError denied() { return new OperationsError(403, "EXECUTION_ACCESS_DENIED"); }
    static OperationsError missing() { return OperationsError.notFound("EXECUTION_WORK_NOT_FOUND"); }
    static OperationsError state() { return OperationsError.conflict("EXECUTION_STATE_CONFLICT"); }
    static OperationsError dependency() { return new OperationsError(503, "EXECUTION_DEPENDENCY_UNAVAILABLE"); }

    private Authorized authorize(String token, String scope, UUID assignmentId) {
        if (token == null || token.isBlank() || assignmentId == null) throw denied();
        Authorized authorized = employees.authorize(token, scope, List.of(assignmentId));
        if (authorized == null || authorized.actor() == null) throw dependency();
        if (!"active".equals(authorized.actor().status()) || authorized.actor().employeeId() == null) throw denied();
        if (authorized.items() == null || authorized.items().size() != 1) throw missing();
        Assignment assignment = authorized.items().get(0);
        if (assignment == null || !assignmentId.equals(assignment.assignmentId())) throw missing();
        if (!"confirmed".equals(assignment.status())) throw missing();
        boolean team = "read-team".equals(scope) || VerificationPorts.VERIFY.equals(scope);
        if (!team && !authorized.actor().employeeId().equals(assignment.employeeId())) throw missing();
        return authorized;
    }

    /** The order must be the same work the identity owner reported; a mismatch is a state problem. */
    private Confirmed confirmed(Assignment assignment) {
        Confirmed work = executions.confirmed(assignment.assignmentId()).orElseThrow(ManageVerification::missing);
        if (!Objects.equals(work.orderId(), assignment.orderId())
                || !Objects.equals(work.employeeId(), assignment.employeeId())
                || !Objects.equals(work.sagaId(), assignment.sagaId())
                || !Objects.equals(work.startsAt(), assignment.startsAt())
                || !Objects.equals(work.endsAt(), assignment.endsAt())) throw state();
        return work;
    }

    private Execution executionOf(Assignment assignment, Confirmed work) {
        Execution execution = executions.load(assignment.assignmentId()).orElseThrow(ManageVerification::missing);
        verifications.seedChecklist(execution.id(), work.orderId(), assignment.employeeId().toString(), clock.instant());
        if (!Verification.EXECUTION_STATUSES.contains(execution.status())) throw state();
        return execution;
    }

    public Verification.View read(String token, String scope, UUID assignmentId) {
        Authorized authorized = authorize(token, scope, assignmentId);
        Assignment assignment = authorized.items().get(0);
        Confirmed work = confirmed(assignment);
        Execution execution = executionOf(assignment, work);
        return view(execution, work);
    }

    private Verification.View view(Execution execution, Confirmed work) {
        List<Verification.ChecklistItem> checklist = verifications.checklist(execution.id());
        int pending = (int) checklist.stream().filter(item -> Verification.PENDING.equals(item.state())).count();
        return new Verification.View(execution, checklist, verifications.reviews(execution.id()), pending,
                verifications.availableEvidence(work.orderId()));
    }

    /** The mechanic ticks an activity. A textual advance or a percentage never does this. */
    public Verification.View item(String token, UUID assignmentId, UUID itemId, Map<String, Object> body, boolean done) {
        Validation.onlyKeys(body, Verification.ITEM_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        Authorized authorized = authorize(token, "write", assignmentId);
        Assignment assignment = authorized.items().get(0);
        Confirmed work = confirmed(assignment);
        Execution execution = executionOf(assignment, work);
        requireStatus(execution, Execution.IN_PROGRESS);
        String fingerprint = fingerprint("checklist", operationId, work, itemId + ":" + done + ":" + expectedVersion);
        if (verifications.replayed(operationId, fingerprint).isEmpty()
                && !verifications.markItem(execution.id(), itemId, expectedVersion, done,
                        assignment.employeeId().toString(), clock.instant(), operationId, fingerprint)) {
            throw OperationsError.conflict("VERSION_CONFLICT");
        }
        return view(reload(assignment), work);
    }

    public Verification.View requestReview(String token, UUID assignmentId, Map<String, Object> body) {
        Validation.onlyKeys(body, Verification.REVIEW_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        Authorized authorized = authorize(token, "write", assignmentId);
        Assignment assignment = authorized.items().get(0);
        Confirmed work = confirmed(assignment);
        // Idempotency is decided before the transition rules: a replay must not fail because the
        // first call already moved the execution out of in_progress.
        String fingerprint = fingerprint("request-review", operationId, work, Integer.toString(expectedVersion));
        if (verifications.replayed(operationId, fingerprint).isEmpty()) {
            Execution execution = executionOf(assignment, work);
            requireStatus(execution, Execution.IN_PROGRESS);
            if (verifications.advanceCount(execution.id()) < 1) throw OperationsError.conflict("EVIDENCE_REQUIRED");
            if (verifications.availableEvidence(work.orderId()) < 1) throw OperationsError.conflict("EVIDENCE_REQUIRED");
            if (verifications.checklist(execution.id()).stream()
                    .anyMatch(item -> Verification.PENDING.equals(item.state()))) {
                throw OperationsError.conflict("CHECKLIST_INCOMPLETE");
            }
            if (!verifications.requestReview(execution, expectedVersion,
                    assignment.employeeId().toString(), clock.instant(), operationId, fingerprint)) {
                throw OperationsError.conflict("VERSION_CONFLICT");
            }
        }
        return view(reload(assignment), work);
    }

    public Verification.View approve(String token, UUID assignmentId, Map<String, Object> body) {
        return decide(token, assignmentId, body, true);
    }

    public Verification.View reject(String token, UUID assignmentId, Map<String, Object> body) {
        return decide(token, assignmentId, body, false);
    }

    private Verification.View decide(String token, UUID assignmentId, Map<String, Object> body, boolean approved) {
        Validation.onlyKeys(body, approved ? Verification.REVIEW_KEYS : Verification.RETURN_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        String reason = approved ? null : Validation.text(body.get("reason"), 3, 500);
        Authorized authorized = authorize(token, VerificationPorts.VERIFY, assignmentId);
        Assignment assignment = authorized.items().get(0);
        // Self-approval is forbidden by identity, never by role names.
        if (Objects.equals(authorized.actor().employeeId(), assignment.employeeId())) {
            throw new OperationsError(403, "SELF_VERIFICATION_FORBIDDEN");
        }
        Confirmed work = confirmed(assignment);
        String fingerprint = fingerprint(approved ? "approve" : "return", operationId, work,
                expectedVersion + ":" + (reason == null ? "" : reason));
        if (verifications.replayed(operationId, fingerprint).isEmpty()) {
            Execution execution = executionOf(assignment, work);
            requireStatus(execution, Verification.PENDING_VERIFICATION);
            if (!verifications.decide(execution, expectedVersion, approved, reason,
                    authorized.actor().employeeId().toString(), clock.instant(), operationId, fingerprint)) {
                throw OperationsError.conflict("VERSION_CONFLICT");
            }
        }
        return view(reload(assignment), work);
    }

    private Execution reload(Assignment assignment) {
        return executions.load(assignment.assignmentId()).orElseThrow(ManageVerification::missing);
    }

    private static void requireStatus(Execution execution, String expected) {
        if (!expected.equals(execution.status())) throw state();
    }

    private static String fingerprint(String action, UUID operationId, Confirmed work, String content) {
        return String.join("\u001F", action, operationId.toString(), work.orderId().toString(),
                work.assignmentId().toString(), work.employeeId().toString(), content);
    }
}
