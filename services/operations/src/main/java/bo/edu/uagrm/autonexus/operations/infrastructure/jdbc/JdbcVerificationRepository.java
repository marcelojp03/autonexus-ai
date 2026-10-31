package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.VerificationPorts;
import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Verification;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** CU17 persistence: mandatory checklist, review trail and the technical completion of the order. */
@Repository
public class JdbcVerificationRepository extends OperationsStore implements VerificationPorts.Repository {

    public JdbcVerificationRepository(JdbcClient jdbc, ObjectMapper json) {
        super(jdbc, json);
    }

    private static OperationsError persistence() { return new OperationsError(503, "PERSISTENCE_UNAVAILABLE"); }

    /** Widens the protected store helper to the port contract. */
    @Override
    public Optional<UUID> replayed(UUID operationId, String fingerprint) {
        return super.replayed(operationId, fingerprint);
    }

    @Override
    @Transactional
    public void seedChecklist(UUID executionId, UUID orderId, String actor, Instant now) {
        try {
            jdbc.sql("""
                    INSERT INTO operations.work_execution_checklist(id,execution_id,order_item_id,position,
                        description,quantity,state,version)
                    SELECT gen_random_uuid(),?,i.id,row_number() OVER (ORDER BY i.position,i.id),
                        s.name,i.quantity,'pending',1
                    FROM operations.work_order_items i
                    JOIN operations.service_catalog s ON s.id=i.service_id
                    WHERE i.order_id=?
                    ON CONFLICT (execution_id,order_item_id) DO NOTHING
                    """).params(executionId, orderId).update();
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<Verification.ChecklistItem> checklist(UUID executionId) {
        try {
            return jdbc.sql("""
                    SELECT id,order_item_id,position,description,quantity,state,done_at,done_by,version
                    FROM operations.work_execution_checklist WHERE execution_id=? ORDER BY position,id
                    """).param(executionId).query((rs, index) -> new Verification.ChecklistItem(
                    rs.getObject("id", UUID.class), rs.getObject("order_item_id", UUID.class),
                    rs.getInt("position"), rs.getString("description"), rs.getInt("quantity"),
                    rs.getString("state"),
                    rs.getTimestamp("done_at") == null ? null : rs.getTimestamp("done_at").toInstant(),
                    rs.getString("done_by"), rs.getInt("version"))).list();
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<Verification.Review> reviews(UUID executionId) {
        try {
            return jdbc.sql("""
                    SELECT id,action,actor,reason,execution_version,occurred_at
                    FROM operations.work_execution_reviews WHERE execution_id=? ORDER BY occurred_at,id
                    """).param(executionId).query((rs, index) -> new Verification.Review(
                    rs.getObject("id", UUID.class), rs.getString("action"), rs.getString("actor"),
                    rs.getString("reason"), rs.getInt("execution_version"),
                    rs.getTimestamp("occurred_at").toInstant())).list();
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public int availableEvidence(UUID orderId) {
        try {
            return jdbc.sql("SELECT count(*)::int FROM operations.work_evidence WHERE order_id=? AND state='available'")
                    .param(orderId).query(Integer.class).single();
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public int advanceCount(UUID executionId) {
        try {
            return jdbc.sql("SELECT count(*)::int FROM operations.work_advances WHERE execution_id=?")
                    .param(executionId).query(Integer.class).single();
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional
    public boolean markItem(UUID executionId, UUID itemId, int expectedVersion, boolean done, String actor,
            Instant now, UUID operationId, String fingerprint) {
        try {
            Timestamp moment = done ? Timestamp.from(now) : null;
            int updated = jdbc.sql("""
                    UPDATE operations.work_execution_checklist
                    SET state=?,done_at=?,done_by=?,version=version+1
                    WHERE id=? AND execution_id=? AND version=?
                    """).params(done ? Verification.DONE : Verification.PENDING, moment, done ? actor : null,
                    itemId, executionId, expectedVersion).update();
            if (updated != 1) return false;
            audit("work-execution", executionId, done ? "checklist-done" : "checklist-reopened", actor,
                    expectedVersion + 1, Map.of("itemId", itemId.toString(), "state",
                            done ? Verification.DONE : Verification.PENDING));
            remember(operationId, fingerprint, executionId);
            return true;
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional
    public boolean requestReview(Execution current, int expectedVersion, String actor, Instant now,
            UUID operationId, String fingerprint) {
        try {
            int updated = jdbc.sql("""
                    UPDATE operations.work_executions
                    SET status='pending_verification',review_requested_at=?,review_requested_by=?,
                        version=version+1,updated_at=?
                    WHERE id=? AND version=? AND status='in_progress'
                    """).params(Timestamp.from(now), actor, Timestamp.from(now), current.id(), expectedVersion).update();
            if (updated != 1) return false;
            review(current, "requested", actor, null, expectedVersion + 1, now);
            audit("work-execution", current.id(), "review-requested", actor, expectedVersion + 1,
                    Map.of("status", Verification.PENDING_VERIFICATION));
            remember(operationId, fingerprint, current.id());
            return true;
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional
    public boolean decide(Execution current, int expectedVersion, boolean approved, String reason, String actor,
            Instant now, UUID operationId, String fingerprint) {
        try {
            int updated;
            if (approved) {
                updated = jdbc.sql("""
                        UPDATE operations.work_executions
                        SET status='completed',verified_at=?,verified_by=?,version=version+1,updated_at=?
                        WHERE id=? AND version=? AND status='pending_verification'
                        """).params(Timestamp.from(now), actor, Timestamp.from(now), current.id(), expectedVersion).update();
            } else {
                updated = jdbc.sql("""
                        UPDATE operations.work_executions
                        SET status='in_progress',returned_at=?,return_reason=?,version=version+1,updated_at=?
                        WHERE id=? AND version=? AND status='pending_verification'
                        """).params(Timestamp.from(now), reason, Timestamp.from(now), current.id(), expectedVersion).update();
            }
            if (updated != 1) return false;
            if (approved) {
                // The order keeps its CU15 saga; only its own status advances to technical completion.
                int order = jdbc.sql("""
                        UPDATE operations.work_orders SET status='completed',version=version+1,updated_at=?
                        WHERE id=? AND status='confirmed'
                        """).params(Timestamp.from(now), current.orderId()).update();
                if (order != 1) throw persistence();
                audit("work-order", current.orderId(), "completed", actor, current.version() + 1,
                        Map.of("status", Verification.COMPLETED, "executionId", current.id().toString()));
            }
            review(current, approved ? "approved" : "returned", actor, reason, expectedVersion + 1, now);
            audit("work-execution", current.id(), approved ? "approved" : "returned", actor, expectedVersion + 1,
                    Map.of("status", approved ? Verification.COMPLETED : Execution.IN_PROGRESS));
            remember(operationId, fingerprint, current.id());
            return true;
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    private void review(Execution execution, String action, String actor, String reason, int version, Instant now) {
        jdbc.sql("""
                INSERT INTO operations.work_execution_reviews(id,execution_id,order_id,action,actor,reason,
                    execution_version,occurred_at) VALUES(?,?,?,?,?,?,?,?)
                """).params(UUID.randomUUID(), execution.id(), execution.orderId(), action, actor, reason, version,
                Timestamp.from(now)).update();
    }
}
