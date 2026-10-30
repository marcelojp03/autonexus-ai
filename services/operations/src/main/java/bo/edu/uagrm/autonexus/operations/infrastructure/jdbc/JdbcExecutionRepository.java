package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts;
import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.StoredObject;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** CU16 persistence. The order row is only read: confirmation belongs to CU15. */
@Repository
public class JdbcExecutionRepository extends OperationsStore implements ExecutionPorts.Repository {
    private static final String WORK = """
            SELECT o.id AS order_id,o.number AS order_number,o.assignment_id,o.employee_id,o.confirmation_saga_id,
                o.starts_at,o.ends_at,o.version AS order_version
            FROM operations.work_orders o
            JOIN operations.cu15_sagas s ON s.id=o.confirmation_saga_id AND s.status='confirmed' AND s.order_id=o.id
            WHERE o.assignment_id=? AND o.status='confirmed'
              AND o.assignment_id IS NOT NULL AND o.employee_id IS NOT NULL
              AND o.confirmation_saga_id IS NOT NULL AND o.starts_at IS NOT NULL AND o.ends_at IS NOT NULL
              AND o.starts_at < o.ends_at
              AND s.document->>'status'='confirmed'
              AND s.document->>'orderId'=o.id::text
              AND s.document->'input'->>'employeeId'=o.employee_id::text
              AND (s.document->'input'->>'startsAt')::timestamptz=o.starts_at
              AND (s.document->'input'->>'endsAt')::timestamptz=o.ends_at
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.document->'steps') step
                          WHERE step->>'command'='confirm_assignment' AND step->>'status'='applied'
                            AND step->'result'->'resource'->>'id'=o.assignment_id::text
                            AND step->'result'->'resource'->>'employeeId'=o.employee_id::text
                            AND step->'result'->'resource'->>'orderId'=o.id::text
                            AND step->'result'->'resource'->>'status'='confirmed')
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.document->'steps') step
                          WHERE step->>'command'='authorize_quote' AND step->>'status'='applied')
            """;
    private static final String EXECUTION = """
            SELECT e.id,e.order_id,e.assignment_id,e.employee_id,e.status,e.started_at,e.version,o.number AS order_number
            FROM operations.work_executions e JOIN operations.work_orders o ON o.id=e.order_id
            """;
    private static final String ADVANCE = """
            SELECT a.id,a.execution_id,a.sequence,a.description,a.minutes_worked,a.occurred_at,a.recorded_at,a.version
            FROM operations.work_advances a
            """;
    private static final String EVIDENCE = """
            SELECT v.id,v.advance_id,v.order_id,v.file_name,v.content_type,v.size_bytes,v.checksum_sha256,
                v.state,v.attempt,v.failure_code,v.created_at,v.confirmed_at,v.version_id,v.version,v.object_key
            FROM operations.work_evidence v
            """;

    private final ObjectMapper json;

    public JdbcExecutionRepository(JdbcClient jdbc, ObjectMapper json) {
        super(jdbc, json);
        this.json = json;
    }

    private static OperationsError persistence() { return new OperationsError(503, "PERSISTENCE_UNAVAILABLE"); }

    @Override
    @Transactional(readOnly = true)
    public Optional<Confirmed> confirmed(UUID assignmentId) {
        try {
            return jdbc.sql(WORK).param(assignmentId).query((rs, index) -> new Confirmed(
                    rs.getObject("order_id", UUID.class),
                    rs.getString("order_number"),
                    rs.getObject("assignment_id", UUID.class),
                    rs.getObject("employee_id", UUID.class),
                    rs.getObject("confirmation_saga_id", UUID.class),
                    rs.getTimestamp("starts_at").toInstant(),
                    rs.getTimestamp("ends_at").toInstant(),
                    rs.getInt("order_version"))).optional();
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Execution> load(UUID assignmentId) {
        try {
            return jdbc.sql(EXECUTION + " WHERE e.assignment_id=?").param(assignmentId)
                    .query((rs, index) -> map(rs)).optional().map(this::withAdvances);
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Execution> executionById(UUID executionId) {
        try {
            return jdbc.sql(EXECUTION + " WHERE e.id=?").param(executionId)
                    .query((rs, index) -> map(rs)).optional().map(this::withAdvances);
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional
    public Execution insertExecution(Confirmed work, Instant now, String actor, UUID operationId, String fingerprint) {
        UUID id = UUID.randomUUID();
        try {
            jdbc.sql("""
                            INSERT INTO operations.work_executions(id,order_id,assignment_id,employee_id,status,
                                started_at,started_by,version,created_at,updated_at)
                            VALUES(?,?,?,?,'in_progress',?,?,1,?,?)
                            """)
                    .params(id, work.orderId(), work.assignmentId(), work.employeeId(),
                            java.sql.Timestamp.from(now), actor, java.sql.Timestamp.from(now), java.sql.Timestamp.from(now))
                    .update();
        } catch (DuplicateKeyException duplicate) {
            // A concurrent start won: the work was already in execution.
            throw OperationsError.conflict("EXECUTION_ALREADY_STARTED");
        } catch (DataAccessException failure) {
            throw persistence();
        }
        audit("work-execution", id, "started", actor, 1, Map.of(
                "executionId", id.toString(), "orderId", work.orderId().toString(),
                "assignmentId", work.assignmentId().toString(), "status", Execution.IN_PROGRESS));
        super.remember(operationId, fingerprint, id);
        return executionById(id).orElseThrow(JdbcExecutionRepository::persistence);
    }

    @Override
    @Transactional
    public Execution appendAdvance(Execution current, int expectedVersion, AdvanceDraft draft, Instant now, String actor,
            UUID operationId, String fingerprint) {
        try {
            int advanced = jdbc.sql("""
                            UPDATE operations.work_executions SET version=version+1,updated_at=?
                            WHERE id=? AND version=? AND status='in_progress'
                            """)
                    .params(java.sql.Timestamp.from(now), current.id(), expectedVersion).update();
            if (advanced != 1) throw OperationsError.conflict("VERSION_CONFLICT");
            UUID id = UUID.randomUUID();
            int inserted = jdbc.sql("""
                            INSERT INTO operations.work_advances(id,execution_id,sequence,description,minutes_worked,
                                occurred_at,recorded_at,recorded_by,version)
                            SELECT ?,?,COALESCE(MAX(a.sequence),0)+1,?,?,?,?,?,1
                            FROM operations.work_advances a WHERE a.execution_id=?
                            """)
                    .params(id, current.id(), draft.description(), draft.minutesWorked(),
                            java.sql.Timestamp.from(draft.occurredAt()), java.sql.Timestamp.from(now), actor, current.id())
                    .update();
            if (inserted != 1) throw OperationsError.conflict("VERSION_CONFLICT");
            audit("work-advance", id, "recorded", actor, 1, Map.of(
                    "advanceId", id.toString(), "executionId", current.id().toString(),
                    "minutesWorked", draft.minutesWorked()));
            super.remember(operationId, fingerprint, current.id());
        } catch (DataAccessException failure) {
            throw persistence();
        }
        return executionById(current.id()).orElseThrow(JdbcExecutionRepository::persistence);
    }

    @Override
    @Transactional
    public EvidenceRecord insertEvidence(Execution execution, UUID evidenceId, UUID advanceId, EvidenceDraft draft,
            String objectKey, String actor, Instant now, UUID operationId, String fingerprint) {
        UUID id = evidenceId;
        try {
            int inserted = jdbc.sql("""
                            INSERT INTO operations.work_evidence(id,advance_id,order_id,file_name,content_type,
                                size_bytes,checksum_sha256,state,attempt,object_key,requested_by,created_at,updated_at,version)
                            SELECT ?,a.id,e.order_id,?,?,?,?,'pending',1,?,?,?,?,1
                            FROM operations.work_advances a JOIN operations.work_executions e ON e.id=a.execution_id
                            WHERE a.id=? AND e.id=?
                            """)
                    .params(id, draft.fileName(), draft.contentType(), draft.sizeBytes(), draft.checksumSha256(),
                            objectKey, actor, java.sql.Timestamp.from(now), java.sql.Timestamp.from(now),
                            advanceId, execution.id())
                    .update();
            if (inserted != 1) throw OperationsError.notFound("EXECUTION_WORK_NOT_FOUND");
        } catch (DataAccessException failure) {
            throw persistence();
        }
        audit("work-evidence", id, "requested", actor, 1, Map.of(
                "evidenceId", id.toString(), "advanceId", advanceId.toString(), "state", "pending", "attempt", 1));
        super.remember(operationId, fingerprint, id);
        return evidence(execution.orderId(), id).orElseThrow(JdbcExecutionRepository::persistence);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<EvidenceRecord> evidence(UUID orderId, UUID evidenceId) {
        try {
            return jdbc.sql(EVIDENCE + " WHERE v.id=? AND v.order_id=?").params(evidenceId, orderId)
                    .query((rs, index) -> new EvidenceRecord(mapEvidence(rs),
                            rs.getObject("order_id", UUID.class), rs.getString("object_key"),
                            rs.getString("checksum_sha256"), rs.getString("version_id")))
                    .optional();
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    @Override
    @Transactional
    public boolean markVerified(Execution.Evidence evidence, int expectedVersion, StoredObject stored, Instant now,
            UUID operationId, String fingerprint, String actor) {
        try {
            int updated = jdbc.sql("""
                            UPDATE operations.work_evidence
                            SET state='available',etag=?,version_id=?,verified_size_bytes=?,verified_content_type=?,
                                confirmed_at=?,failure_code=NULL,updated_at=?,version=version+1
                            WHERE id=? AND version=? AND state='pending'
                            """)
                    .params(stored.etag(), stored.versionId(), stored.size(), stored.contentType(),
                            java.sql.Timestamp.from(now), java.sql.Timestamp.from(now),
                            evidence.id(), expectedVersion)
                    .update();
            if (updated != 1) return false;
        } catch (DataAccessException failure) {
            throw persistence();
        }
        audit("work-evidence", evidence.id(), "confirmed", actor, expectedVersion + 1, Map.of(
                "evidenceId", evidence.id().toString(), "state", "available", "attempt", evidence.attempt()));
        super.remember(operationId, fingerprint, evidence.id());
        return true;
    }

    @Override
    @Transactional
    public boolean markFailed(Execution.Evidence evidence, int expectedVersion, String failureCode, Instant now,
            UUID operationId, String fingerprint, String actor) {
        try {
            int updated = jdbc.sql("""
                            UPDATE operations.work_evidence
                            SET state='failed',failure_code=?,updated_at=?,version=version+1
                            WHERE id=? AND version=? AND state='pending'
                            """)
                    .params(failureCode, java.sql.Timestamp.from(now), evidence.id(), expectedVersion)
                    .update();
            if (updated != 1) return false;
        } catch (DataAccessException failure) {
            throw persistence();
        }
        audit("work-evidence", evidence.id(), "failed", actor, expectedVersion + 1, Map.of(
                "evidenceId", evidence.id().toString(), "state", "failed", "failureCode", failureCode));
        super.remember(operationId, fingerprint, evidence.id());
        return true;
    }

    @Override
    @Transactional
    public boolean markPending(Execution.Evidence evidence, int expectedVersion, EvidenceDraft draft,
            String objectKey, String actor, Instant now, UUID operationId, String fingerprint) {
        try {
            int updated = jdbc.sql("""
                            UPDATE operations.work_evidence
                            SET state='pending',attempt=attempt+1,object_key=?,file_name=?,content_type=?,size_bytes=?,checksum_sha256=?,failure_code=NULL,
                                etag=NULL,version_id=NULL,verified_size_bytes=NULL,verified_content_type=NULL,
                                confirmed_at=NULL,requested_by=?,updated_at=?,version=version+1
                            WHERE id=? AND version=? AND state<>'available' AND attempt<5
                            """)
                    .params(objectKey, draft.fileName(), draft.contentType(), draft.sizeBytes(), draft.checksumSha256(),
                            actor, java.sql.Timestamp.from(now), evidence.id(), expectedVersion)
                    .update();
            if (updated != 1) return false;
        } catch (DataAccessException failure) {
            throw persistence();
        }
        audit("work-evidence", evidence.id(), "retried", actor, expectedVersion + 1, Map.of(
                "evidenceId", evidence.id().toString(), "state", "pending", "attempt", evidence.attempt() + 1));
        super.remember(operationId, fingerprint, evidence.id());
        return true;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UUID> replayed(UUID operationId, String fingerprint) {
        try {
            return super.replayed(operationId, fingerprint);
        } catch (DataAccessException failure) {
            throw persistence();
        }
    }

    private Execution withAdvances(Execution execution) {
        List<Execution.Advance> advances = jdbc.sql(ADVANCE + " WHERE a.execution_id=? ORDER BY a.sequence")
                .param(execution.id()).query((rs, index) -> mapAdvance(rs)).list();
        List<Execution.Advance> complete = new ArrayList<>();
        for (Execution.Advance advance : advances) {
            List<Execution.Evidence> evidences = jdbc.sql(EVIDENCE + " WHERE v.advance_id=? ORDER BY v.created_at,v.id")
                    .param(advance.id()).query((rs, index) -> mapEvidence(rs)).list();
            complete.add(new Execution.Advance(advance.id(), advance.sequence(), advance.description(),
                    advance.minutesWorked(), advance.occurredAt(), advance.recordedAt(), advance.version(),
                    List.copyOf(evidences)));
        }
        return new Execution(execution.id(), execution.orderId(), execution.orderNumber(), execution.assignmentId(),
                execution.employeeId(), execution.status(), execution.startedAt(), execution.version(),
                List.copyOf(complete), Execution.Summary.of(complete));
    }

    private Execution map(ResultSet rs) throws SQLException {
        String status = rs.getString("status");
        if (!Execution.STATUSES.contains(status)) throw new IllegalStateException("Unsupported execution state");
        return new Execution(rs.getObject("id", UUID.class), rs.getObject("order_id", UUID.class),
                rs.getString("order_number"), rs.getObject("assignment_id", UUID.class),
                rs.getObject("employee_id", UUID.class), status,
                rs.getTimestamp("started_at").toInstant(), rs.getInt("version"), List.of(), new Execution.Summary(0, 0, 0));
    }

    private Execution.Advance mapAdvance(ResultSet rs) throws SQLException {
        return new Execution.Advance(rs.getObject("id", UUID.class), rs.getInt("sequence"), rs.getString("description"),
                rs.getInt("minutes_worked"), rs.getTimestamp("occurred_at").toInstant(),
                rs.getTimestamp("recorded_at").toInstant(), rs.getInt("version"), List.of());
    }

    private static Execution.Evidence mapEvidence(ResultSet rs) throws SQLException {
        java.sql.Timestamp confirmed = rs.getTimestamp("confirmed_at");
        return new Execution.Evidence(rs.getObject("id", UUID.class), rs.getObject("advance_id", UUID.class),
                rs.getString("file_name"), rs.getString("content_type"), rs.getLong("size_bytes"),
                rs.getString("state"), rs.getInt("attempt"), rs.getString("failure_code"),
                rs.getTimestamp("created_at").toInstant(), confirmed == null ? null : confirmed.toInstant(),
                rs.getInt("version"));
    }
}
