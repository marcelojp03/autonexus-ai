package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.AppointmentRequestRepository;
import bo.edu.uagrm.autonexus.operations.application.ManageAppointments;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Appointment;
import bo.edu.uagrm.autonexus.operations.domain.AppointmentRequest;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Repository
public class JdbcAppointmentRequestRepository extends OperationsStore implements AppointmentRequestRepository {
    private static final String SELECT = """
            SELECT id, operation_id, client_id, requester_subject, customer_id, vehicle_id, service_id,
                   requested_starts_at, time_zone, notes, status, created_at, reviewed_at, reviewer_subject,
                   review_reason, appointment_id, version
              FROM operations.appointment_requests
            """;
    private final ManageAppointments appointments;

    public JdbcAppointmentRequestRepository(JdbcClient jdbc, ObjectMapper json, ManageAppointments appointments) {
        super(jdbc, json);
        this.appointments = appointments;
    }

    private static AppointmentRequest map(ResultSet rs, int row) throws SQLException {
        Timestamp reviewed = rs.getTimestamp("reviewed_at");
        return new AppointmentRequest(rs.getObject("id", UUID.class), rs.getObject("operation_id", UUID.class),
                rs.getString("client_id"), rs.getString("requester_subject"), rs.getObject("customer_id", UUID.class),
                rs.getObject("vehicle_id", UUID.class), rs.getObject("service_id", UUID.class),
                rs.getTimestamp("requested_starts_at").toInstant(), rs.getString("time_zone"), rs.getString("notes"),
                rs.getString("status"), rs.getTimestamp("created_at").toInstant(), reviewed == null ? null : reviewed.toInstant(),
                rs.getString("reviewer_subject"), rs.getString("review_reason"), rs.getObject("appointment_id", UUID.class), rs.getInt("version"));
    }

    @Override @Transactional
    public Mutation<AppointmentRequest> create(UUID operationId, String clientId, String requester, UUID customerId,
            UUID vehicleId, UUID serviceId, Instant startsAt, String timeZone, String notes) {
        String hash = fingerprint("appointment-request", clientId, requester, customerId, vehicleId, serviceId, startsAt, timeZone, notes);
        AppointmentRequest previous = jdbc.sql(SELECT + " WHERE operation_id=? FOR UPDATE").param(operationId).query(JdbcAppointmentRequestRepository::map).optional().orElse(null);
        if (previous != null) {
            if (!hash.equals(previousPayloadHash(operationId))) throw OperationsError.conflict("IDEMPOTENCY_CONFLICT");
            return new Mutation<>(previous, true);
        }
        validateReferences(customerId, vehicleId, serviceId);
        UUID id = UUID.randomUUID();
        int inserted = jdbc.sql("""
                INSERT INTO operations.appointment_requests(id, operation_id, payload_hash, client_id, requester_subject,
                    customer_id, vehicle_id, service_id, requested_starts_at, time_zone, notes, status, version)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,'PENDING_REVIEW',1) ON CONFLICT (operation_id) DO NOTHING
                """).params(id, operationId, hash, clientId, requester, customerId, vehicleId, serviceId,
                Timestamp.from(startsAt), timeZone, notes).update();
        if (inserted == 0) {
            AppointmentRequest raced = jdbc.sql(SELECT + " WHERE operation_id=? FOR UPDATE").param(operationId)
                    .query(JdbcAppointmentRequestRepository::map).single();
            if (!hash.equals(previousPayloadHash(operationId))) throw OperationsError.conflict("IDEMPOTENCY_CONFLICT");
            return new Mutation<>(raced, true);
        }
        AppointmentRequest request = get(id);
        audit("appointment_request", id, "requested", requester, 1, auditSnapshot(request));
        return new Mutation<>(request, false);
    }

    private String previousPayloadHash(UUID operationId) {
        return jdbc.sql("SELECT payload_hash FROM operations.appointment_requests WHERE operation_id=?")
                .param(operationId).query(String.class).single();
    }

    private void validateReferences(UUID customerId, UUID vehicleId, UUID serviceId) {
        var relation = jdbc.sql("""
                SELECT c.status AS customer_status, v.status AS vehicle_status, v.customer_id,
                       s.active AS service_active
                  FROM operations.customers c, operations.vehicles v, operations.service_catalog s
                 WHERE c.id=? AND v.id=? AND s.id=?
                """).params(customerId, vehicleId, serviceId)
                .query((rs, row) -> new Object[] { rs.getString("customer_status"), rs.getString("vehicle_status"),
                        rs.getObject("customer_id", UUID.class), rs.getBoolean("service_active") }).optional().orElse(null);
        if (relation == null) throw OperationsError.notFound("APPOINTMENT_REFERENCE_NOT_FOUND");
        if (!customerId.equals(relation[2])) throw OperationsError.conflict("VEHICLE_OWNERSHIP_MISMATCH");
        if (!"active".equals(relation[0])) throw OperationsError.conflict("CUSTOMER_INACTIVE");
        if (!"active".equals(relation[1])) throw OperationsError.conflict("VEHICLE_INACTIVE");
        if (!Boolean.TRUE.equals(relation[3])) throw OperationsError.conflict("SERVICE_INACTIVE");
    }

    private AppointmentRequest get(UUID id) {
        return jdbc.sql(SELECT + " WHERE id=?").param(id).query(JdbcAppointmentRequestRepository::map).single();
    }

    @Override public AppointmentRequest byOperation(UUID operationId, String clientId, String requester) {
        return jdbc.sql(SELECT + " WHERE operation_id=? AND client_id=? AND requester_subject=?")
                .params(operationId, clientId, requester).query(JdbcAppointmentRequestRepository::map)
                .optional().orElseThrow(() -> OperationsError.notFound("APPOINTMENT_REQUEST_NOT_FOUND"));
    }

    @Override public Page<AppointmentRequest> pending(int limit, int offset) {
        int total = jdbc.sql("SELECT count(*) FROM operations.appointment_requests WHERE status='PENDING_REVIEW'").query(Integer.class).single();
        List<AppointmentRequest> items = jdbc.sql(SELECT + " WHERE status='PENDING_REVIEW' ORDER BY created_at,id LIMIT ? OFFSET ?")
                .params(limit, offset).query(JdbcAppointmentRequestRepository::map).list();
        return new Page<>(items, total, limit, offset);
    }

    @Override @Transactional
    public Mutation<AppointmentRequest> approve(UUID operationId, Instant startsAt, String reviewer) {
        AppointmentRequest request = lock(operationId);
        if ("APPROVED".equals(request.status())) return new Mutation<>(request, true);
        if (!"PENDING_REVIEW".equals(request.status())) throw OperationsError.conflict("APPOINTMENT_REQUEST_NOT_PENDING");
        validateReferences(request.customerId(), request.vehicleId(), request.serviceId());
        UUID appointmentOperation = UUID.nameUUIDFromBytes(("autonexus:appointment-request:" + operationId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var created = appointments.create(new Appointment.Draft(request.customerId(), request.vehicleId(), request.serviceId(), startsAt, request.notes()), reviewer, appointmentOperation);
        int changed = jdbc.sql("""
                UPDATE operations.appointment_requests SET status='APPROVED', reviewed_at=now(), reviewer_subject=?,
                    review_reason=NULL, appointment_id=?, version=version+1 WHERE id=? AND status='PENDING_REVIEW'
                """).params(reviewer, created.value().id(), request.id()).update();
        if (changed != 1) throw OperationsError.conflict("APPOINTMENT_REQUEST_NOT_PENDING");
        AppointmentRequest approved = get(request.id());
        audit("appointment_request", approved.id(), "approved", reviewer, approved.version(), auditSnapshot(approved));
        return new Mutation<>(approved, false);
    }

    @Override @Transactional
    public Mutation<AppointmentRequest> reject(UUID operationId, String reason, String reviewer) {
        AppointmentRequest request = lock(operationId);
        if ("REJECTED".equals(request.status())) {
            if (!reason.equals(request.reviewReason())) throw OperationsError.conflict("IDEMPOTENCY_CONFLICT");
            return new Mutation<>(request, true);
        }
        if (!"PENDING_REVIEW".equals(request.status())) throw OperationsError.conflict("APPOINTMENT_REQUEST_NOT_PENDING");
        jdbc.sql("""
                UPDATE operations.appointment_requests SET status='REJECTED', reviewed_at=now(), reviewer_subject=?,
                    review_reason=?, version=version+1 WHERE id=? AND status='PENDING_REVIEW'
                """).params(reviewer, reason, request.id()).update();
        AppointmentRequest rejected = get(request.id());
        audit("appointment_request", rejected.id(), "rejected", reviewer, rejected.version(), auditSnapshot(rejected));
        return new Mutation<>(rejected, false);
    }

    private AppointmentRequest lock(UUID operationId) {
        return jdbc.sql(SELECT + " WHERE operation_id=? FOR UPDATE").param(operationId).query(JdbcAppointmentRequestRepository::map)
                .optional().orElseThrow(() -> OperationsError.notFound("APPOINTMENT_REQUEST_NOT_FOUND"));
    }

    private static Object auditSnapshot(AppointmentRequest request) {
        return java.util.Map.of("operationId", request.operationId(), "clientId", request.clientId(),
                "status", request.status(), "appointmentId", request.appointmentId() == null ? "" : request.appointmentId());
    }
}
