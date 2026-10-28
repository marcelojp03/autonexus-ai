package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.application.ReceptionRepository;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Reception;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** CU11 owner persistence. One reception without work order per vehicle. */
@Repository
public class JdbcReceptionRepository extends OperationsStore implements ReceptionRepository {
    private static final String SELECT = "SELECT r.id, r.vehicle_id, v.plate AS vehicle_plate, r.customer_id, "
            + "c.first_name || ' ' || c.last_name AS customer_name, r.appointment_id, r.mileage, r.reason, r.symptoms, "
            + "r.visible_conditions, r.has_order, r.received_at, r.version "
            + "FROM operations.vehicle_receptions r "
            + "JOIN operations.vehicles v ON v.id = r.vehicle_id "
            + "JOIN operations.customers c ON c.id = r.customer_id";

    public JdbcReceptionRepository(JdbcClient jdbc, ObjectMapper json) {
        super(jdbc, json);
    }

    private static Reception map(ResultSet rs, int row) throws SQLException {
        return new Reception(
                rs.getObject("id", UUID.class),
                rs.getObject("vehicle_id", UUID.class),
                rs.getString("vehicle_plate"),
                rs.getObject("customer_id", UUID.class),
                rs.getString("customer_name"),
                rs.getObject("appointment_id", UUID.class),
                rs.getInt("mileage"),
                rs.getString("reason"),
                rs.getString("symptoms"),
                rs.getString("visible_conditions"),
                rs.getBoolean("has_order"),
                rs.getTimestamp("received_at").toInstant(),
                rs.getInt("version"));
    }

    @Override
    public Page<Reception> list(UUID vehicleId, Boolean open, int limit, int offset) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (vehicleId != null) {
            where.append(" AND r.vehicle_id = ?");
            params.add(vehicleId);
        }
        if (open != null) {
            where.append(open ? " AND NOT r.has_order" : " AND r.has_order");
        }
        int total = jdbc.sql("SELECT count(*) FROM operations.vehicle_receptions r" + where)
                .params(params).query(Integer.class).single();
        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(limit);
        pageParams.add(offset);
        var items = jdbc.sql(SELECT + where + " ORDER BY r.received_at DESC, r.id LIMIT ? OFFSET ?")
                .params(pageParams).query(JdbcReceptionRepository::map).list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public Reception get(UUID id) {
        return jdbc.sql(SELECT + " WHERE r.id = ?")
                .param(id).query(JdbcReceptionRepository::map).optional()
                .orElseThrow(() -> OperationsError.notFound("RECEPTION_NOT_FOUND"));
    }

    private record VehicleStatus(UUID customerId, String vehicleStatus, String customerStatus) {}

    private VehicleStatus requireActiveVehicle(UUID vehicleId) {
        var rows = jdbc.sql("SELECT v.customer_id, v.status AS vehicle_status, c.status AS customer_status "
                        + "FROM operations.vehicles v JOIN operations.customers c ON c.id = v.customer_id WHERE v.id = ?")
                .param(vehicleId)
                .query((rs, index) -> new VehicleStatus(rs.getObject("customer_id", UUID.class),
                        rs.getString("vehicle_status"), rs.getString("customer_status")))
                .list();
        if (rows.isEmpty()) throw OperationsError.notFound("VEHICLE_NOT_FOUND");
        VehicleStatus status = rows.get(0);
        if (!"active".equals(status.vehicleStatus())) throw OperationsError.conflict("VEHICLE_INACTIVE");
        if (!"active".equals(status.customerStatus())) throw OperationsError.conflict("CUSTOMER_INACTIVE");
        return status;
    }

    private void requireAppointment(UUID appointmentId, UUID vehicleId) {
        var rows = jdbc.sql("SELECT vehicle_id, status FROM operations.appointments WHERE id = ?")
                .param(appointmentId)
                .query((rs, index) -> new String[] {rs.getObject("vehicle_id", UUID.class).toString(), rs.getString("status")})
                .list();
        if (rows.isEmpty()) throw OperationsError.notFound("APPOINTMENT_NOT_FOUND");
        if (!rows.get(0)[0].equals(vehicleId.toString())) throw OperationsError.conflict("VEHICLE_OWNERSHIP_MISMATCH");
        if (!"scheduled".equals(rows.get(0)[1])) throw OperationsError.conflict("APPOINTMENT_NOT_SCHEDULED");
    }

    private void requireMileage(UUID vehicleId, int mileage) {
        int last = jdbc.sql("SELECT coalesce(max(mileage), 0) FROM operations.vehicle_receptions WHERE vehicle_id = ?")
                .param(vehicleId).query(Integer.class).single();
        if (mileage < last) throw OperationsError.conflict("MILEAGE_REGRESSION");
    }

    @Override
    @Transactional
    public Mutation<Reception> create(Reception.Draft draft, String actor, UUID operationId) {
        String print = fingerprint(actor, "create-reception", draft.vehicleId(), draft.appointmentId(), draft.mileage(),
                draft.reason(), draft.symptoms(), draft.visibleConditions());
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        VehicleStatus status = requireActiveVehicle(draft.vehicleId());
        if (draft.appointmentId() != null) requireAppointment(draft.appointmentId(), draft.vehicleId());
        requireMileage(draft.vehicleId(), draft.mileage());
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        int rows = jdbc.sql("INSERT INTO operations.vehicle_receptions(id, vehicle_id, customer_id, appointment_id, mileage, "
                        + "reason, symptoms, visible_conditions, has_order, received_at, received_by, version, created_at, updated_at, "
                        + "created_by, updated_by) VALUES(?,?,?,?,?,?,?,?,false,?,?,1,?,?,?,?) "
                        + "ON CONFLICT (vehicle_id) WHERE NOT has_order DO NOTHING")
                .params(id, draft.vehicleId(), status.customerId(), draft.appointmentId(), draft.mileage(), draft.reason(),
                        draft.symptoms(), draft.visibleConditions(), Timestamp.from(now), actor, Timestamp.from(now),
                        Timestamp.from(now), actor, actor)
                .update();
        if (rows == 0) throw OperationsError.conflict("VEHICLE_ALREADY_IN_RECEPTION");
        Reception created = get(id);
        if (!remember(operationId, print, id)) return new Mutation<>(get(id), true);
        audit("reception", id, "received", actor, 1, created);
        return new Mutation<>(created, false);
    }
}
