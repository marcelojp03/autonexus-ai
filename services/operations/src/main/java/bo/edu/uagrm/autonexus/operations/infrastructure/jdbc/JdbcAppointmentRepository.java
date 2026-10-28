package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.AppointmentRepository;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Appointment;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * CU10 owner persistence. Capacity and overlap are evaluated under a transaction-scoped advisory
 * lock, so two concurrent requests cannot overbook the same slot.
 */
@Repository
public class JdbcAppointmentRepository extends OperationsStore implements AppointmentRepository {
    private static final String SLOT_LOCK = "SELECT pg_advisory_xact_lock(hashtext('operations:appointments'))";

    private static final String SELECT = """
            SELECT a.id, a.customer_id, c.first_name || ' ' || c.last_name AS customer_name, a.vehicle_id,
                   v.plate AS vehicle_plate, a.service_id, s.name AS service_name, a.starts_at, a.ends_at,
                   a.status, a.notes, a.cancel_reason, a.version, a.created_at, a.updated_at
              FROM operations.appointments a
              JOIN operations.customers c ON c.id = a.customer_id
              JOIN operations.vehicles v ON v.id = a.vehicle_id
              JOIN operations.service_catalog s ON s.id = a.service_id
            """;

    private final int capacity;

    public JdbcAppointmentRepository(JdbcClient jdbc, ObjectMapper json,
                                     @Value("${operations.appointments.capacity:2}") int capacity) {
        super(jdbc, json);
        this.capacity = Math.max(1, capacity);
    }

    private static Appointment map(ResultSet rs, int row) throws SQLException {
        return new Appointment(
                rs.getObject("id", UUID.class),
                rs.getObject("customer_id", UUID.class),
                rs.getString("customer_name"),
                rs.getObject("vehicle_id", UUID.class),
                rs.getString("vehicle_plate"),
                rs.getObject("service_id", UUID.class),
                rs.getString("service_name"),
                rs.getTimestamp("starts_at").toInstant(),
                rs.getTimestamp("ends_at").toInstant(),
                rs.getString("status"),
                rs.getString("notes"),
                rs.getString("cancel_reason"),
                rs.getInt("version"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    @Override
    public Page<Appointment> list(Instant from, Instant to, String status, UUID customerId, UUID vehicleId,
                                  int limit, int offset) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (from != null) {
            where.append(" AND a.ends_at > ?");
            params.add(Timestamp.from(from));
        }
        if (to != null) {
            where.append(" AND a.starts_at < ?");
            params.add(Timestamp.from(to));
        }
        if (status != null) {
            where.append(" AND a.status = ?");
            params.add(status);
        }
        if (customerId != null) {
            where.append(" AND a.customer_id = ?");
            params.add(customerId);
        }
        if (vehicleId != null) {
            where.append(" AND a.vehicle_id = ?");
            params.add(vehicleId);
        }
        int total = jdbc.sql("""
                        SELECT count(*) FROM operations.appointments a
                          JOIN operations.vehicles v ON v.id = a.vehicle_id
                        """ + where)
                .params(params).query(Integer.class).single();
        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(limit);
        pageParams.add(offset);
        var items = jdbc.sql(SELECT + where + " ORDER BY a.starts_at, a.id LIMIT ? OFFSET ?")
                .params(pageParams)
                .query(JdbcAppointmentRepository::map)
                .list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public Appointment get(UUID id) {
        return jdbc.sql(SELECT + " WHERE a.id = ?")
                .param(id)
                .query(JdbcAppointmentRepository::map)
                .optional()
                .orElseThrow(() -> OperationsError.notFound("APPOINTMENT_NOT_FOUND"));
    }

    private record VehicleOwner(UUID customerId, String vehicleStatus, String customerStatus) {}

    private VehicleOwner requireAssignable(UUID customerId, UUID vehicleId) {
        var rows = jdbc.sql("""
                        SELECT v.customer_id, v.status AS vehicle_status, c.status AS customer_status
                          FROM operations.vehicles v JOIN operations.customers c ON c.id = v.customer_id
                         WHERE v.id = ?
                        """)
                .param(vehicleId)
                .query((rs, index) -> new VehicleOwner(rs.getObject("customer_id", UUID.class),
                        rs.getString("vehicle_status"), rs.getString("customer_status")))
                .list();
        if (rows.isEmpty()) throw OperationsError.notFound("VEHICLE_NOT_FOUND");
        VehicleOwner owner = rows.get(0);
        if (!owner.customerId().equals(customerId)) throw OperationsError.conflict("VEHICLE_OWNERSHIP_MISMATCH");
        if (!"active".equals(owner.vehicleStatus())) throw OperationsError.conflict("VEHICLE_INACTIVE");
        if (!"active".equals(owner.customerStatus())) throw OperationsError.conflict("CUSTOMER_INACTIVE");
        return owner;
    }

    private Duration serviceDuration(UUID serviceId) {
        var rows = jdbc.sql("SELECT estimated_minutes, active FROM operations.service_catalog WHERE id = ?")
                .param(serviceId)
                .query((rs, index) -> new int[] {rs.getInt("estimated_minutes"), rs.getBoolean("active") ? 1 : 0})
                .list();
        if (rows.isEmpty()) throw OperationsError.notFound("SERVICE_NOT_FOUND");
        if (rows.get(0)[1] == 0) throw OperationsError.conflict("SERVICE_INACTIVE");
        return Duration.ofMinutes(rows.get(0)[0]);
    }

    private void requireSlot(UUID vehicleId, UUID serviceId, Instant startsAt, Instant endsAt, UUID excludeId) {
        int duplicate = jdbc.sql("""
                        SELECT count(*) FROM operations.appointments
                         WHERE vehicle_id = ? AND service_id = ? AND starts_at = ? AND status = 'scheduled'
                           AND (?::uuid IS NULL OR id <> ?::uuid)
                        """)
                .params(vehicleId, serviceId, Timestamp.from(startsAt), excludeId, excludeId)
                .query(Integer.class).single();
        if (duplicate > 0) throw OperationsError.conflict("APPOINTMENT_DUPLICATE");
        int overlapping = jdbc.sql("""
                        SELECT count(*) FROM operations.appointments
                         WHERE vehicle_id = ? AND status = 'scheduled' AND starts_at < ? AND ends_at > ?
                           AND (?::uuid IS NULL OR id <> ?::uuid)
                        """)
                .params(vehicleId, Timestamp.from(endsAt), Timestamp.from(startsAt),
                        excludeId, excludeId)
                .query(Integer.class).single();
        if (overlapping > 0) throw OperationsError.conflict("APPOINTMENT_OVERLAP");
        int booked = jdbc.sql("""
                        SELECT count(*) FROM operations.appointments
                         WHERE status = 'scheduled' AND starts_at < ? AND ends_at > ?
                           AND (?::uuid IS NULL OR id <> ?::uuid)
                        """)
                .params(Timestamp.from(endsAt), Timestamp.from(startsAt), excludeId, excludeId)
                .query(Integer.class).single();
        if (booked >= capacity) throw OperationsError.conflict("WORKSHOP_CAPACITY_EXCEEDED");
    }

    @Override
    @Transactional
    public Mutation<Appointment> create(Appointment.Draft draft, String actor, UUID operationId) {
        String print = fingerprint(actor, "create-appointment", draft.customerId(), draft.vehicleId(),
                draft.serviceId(), draft.startsAt(), draft.notes());
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        jdbc.sql(SLOT_LOCK).query((rs, index) -> null).list();
        requireAssignable(draft.customerId(), draft.vehicleId());
        Instant endsAt = draft.startsAt().plus(serviceDuration(draft.serviceId()));
        requireSlot(draft.vehicleId(), draft.serviceId(), draft.startsAt(), endsAt, null);
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        int rows = jdbc.sql("""
                        INSERT INTO operations.appointments(id, customer_id, vehicle_id, service_id, starts_at, ends_at,
                            status, notes, version, created_at, updated_at, created_by, updated_by)
                        VALUES(?,?,?,?,?,?,'scheduled',?,1,?,?,?,?)
                        ON CONFLICT (vehicle_id, service_id, starts_at) WHERE status = 'scheduled' DO NOTHING
                        """)
                .params(id, draft.customerId(), draft.vehicleId(), draft.serviceId(), Timestamp.from(draft.startsAt()),
                        Timestamp.from(endsAt), draft.notes(), Timestamp.from(now), Timestamp.from(now), actor, actor)
                .update();
        if (rows == 0) throw OperationsError.conflict("APPOINTMENT_DUPLICATE");
        Appointment created = get(id);
        remember(operationId, print, id);
        audit("appointment", id, "scheduled", actor, 1, created);
        return new Mutation<>(created, false);
    }

    @Override
    @Transactional
    public Mutation<Appointment> reschedule(UUID id, Instant startsAt, String notes, int expectedVersion,
                                            String actor, UUID operationId) {
        String print = fingerprint(actor, "reschedule-appointment", id, startsAt, notes, expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        Appointment current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        if (!"scheduled".equals(current.status())) throw OperationsError.conflict("APPOINTMENT_NOT_SCHEDULED");
        jdbc.sql(SLOT_LOCK).query((rs, index) -> null).list();
        requireAssignable(current.customerId(), current.vehicleId());
        Instant endsAt = startsAt.plus(serviceDuration(current.serviceId()));
        requireSlot(current.vehicleId(), current.serviceId(), startsAt, endsAt, id);
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.appointments
                           SET starts_at = ?, ends_at = ?, notes = ?, version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(Timestamp.from(startsAt), Timestamp.from(endsAt), notes, version,
                        Timestamp.from(Instant.now()), actor, id, expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        Appointment updated = get(id);
        remember(operationId, print, id);
        audit("appointment", id, "rescheduled", actor, version, updated);
        return new Mutation<>(updated, false);
    }

    @Override
    @Transactional
    public Mutation<Appointment> cancel(UUID id, String reason, int expectedVersion, String actor, UUID operationId) {
        String print = fingerprint(actor, "cancel-appointment", id, reason, expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        Appointment current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        if ("cancelled".equals(current.status())) {
            remember(operationId, print, id);
            return new Mutation<>(current, false);
        }
        jdbc.sql(SLOT_LOCK).query((rs, index) -> null).list();
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.appointments
                           SET status = 'cancelled', cancel_reason = ?, version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(reason, version, Timestamp.from(Instant.now()), actor, id, expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        Appointment updated = get(id);
        remember(operationId, print, id);
        audit("appointment", id, "cancelled", actor, version, updated);
        return new Mutation<>(updated, false);
    }
}
