package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.application.VehicleServiceHistoryRepository;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.VehicleServiceHistory;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Read-only CU08 projection. All rows are sourced from Operations-owned persistence. */
@Repository
public class JdbcVehicleServiceHistoryRepository extends OperationsStore implements VehicleServiceHistoryRepository {
    private static final String BASE = " FROM operations.work_orders o "
            + "JOIN operations.vehicle_receptions r ON r.id=o.reception_id "
            + "JOIN operations.work_executions e ON e.order_id=o.id "
            + "WHERE o.vehicle_id=? AND o.status='completed' AND e.status='completed' ";
    private final JdbcClient jdbc;

    public JdbcVehicleServiceHistoryRepository(JdbcClient jdbc, tools.jackson.databind.ObjectMapper json) {
        super(jdbc, json);
        this.jdbc = jdbc;
    }

    @Override
    public Page<VehicleServiceHistory.VehicleReference> findVehicles(String search, int limit, int offset) {
        String filter = " WHERE (strpos(lower(v.plate),lower(?))>0 "
                + "OR strpos(lower(v.make),lower(?))>0 OR strpos(lower(v.model),lower(?))>0)";
        int total = jdbc.sql("SELECT count(*) FROM operations.vehicles v" + filter)
                .params(search, search, search).query(Integer.class).single();
        List<VehicleServiceHistory.VehicleReference> items = jdbc.sql("SELECT v.id,v.plate,v.make,v.model,v.year "
                        + "FROM operations.vehicles v" + filter + " ORDER BY v.plate,v.id LIMIT ? OFFSET ?")
                .params(search, search, search, limit, offset)
                .query((rs, row) -> new VehicleServiceHistory.VehicleReference(rs.getObject("id", UUID.class),
                        rs.getString("plate"), rs.getString("make"), rs.getString("model"), rs.getInt("year"))).list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public Page<VehicleServiceHistory.Entry> list(UUID vehicleId, int limit, int offset) {
        requireVehicle(vehicleId);
        int total = jdbc.sql("SELECT count(*)" + BASE).param(vehicleId).query(Integer.class).single();
        List<VehicleServiceHistory.Entry> items = jdbc.sql("SELECT o.id,o.number,o.description,o.notes,o.status,"
                        + "e.verified_at,r.reason,r.symptoms, (SELECT i.service_category FROM operations.work_order_items i "
                        + "WHERE i.order_id=o.id ORDER BY i.position LIMIT 1) AS service_type " + BASE
                        + "ORDER BY e.verified_at DESC,o.id DESC LIMIT ? OFFSET ?")
                .params(vehicleId, limit, offset).query((rs, row) -> map(rs)).list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public VehicleServiceHistory.Entry get(UUID vehicleId, UUID orderId) {
        requireVehicle(vehicleId);
        return jdbc.sql("SELECT o.id,o.number,o.description,o.notes,o.status,e.verified_at,r.reason,r.symptoms, "
                        + "(SELECT i.service_category FROM operations.work_order_items i WHERE i.order_id=o.id ORDER BY i.position LIMIT 1) AS service_type " + BASE
                        + "AND o.id=?")
                .params(vehicleId, orderId).query((rs, row) -> map(rs)).optional()
                .orElseThrow(() -> OperationsError.notFound("SERVICE_HISTORY_NOT_FOUND"));
    }

    @Override
    public Optional<VehicleServiceHistory.StorageEvidence> evidence(UUID vehicleId, UUID orderId, UUID evidenceId) {
        return jdbc.sql("SELECT v.id,v.file_name,v.verified_content_type,v.verified_size_bytes,v.object_key,v.version_id "
                        + "FROM operations.work_evidence v JOIN operations.work_orders o ON o.id=v.order_id "
                        + "JOIN operations.work_executions e ON e.order_id=o.id "
                        + "JOIN operations.work_advances a ON a.id=v.advance_id AND a.execution_id=e.id "
                        + "WHERE o.vehicle_id=? AND o.id=? AND v.id=? AND o.status='completed' "
                        + "AND e.status='completed' AND v.state='available'")
                .params(vehicleId, orderId, evidenceId)
                .query((rs, row) -> new VehicleServiceHistory.StorageEvidence(
                        rs.getObject("id", UUID.class), rs.getString("file_name"),
                        rs.getString("verified_content_type"), rs.getLong("verified_size_bytes"),
                        rs.getString("object_key"), rs.getString("version_id"))).optional();
    }

    private void requireVehicle(UUID vehicleId) {
        boolean exists = jdbc.sql("SELECT EXISTS(SELECT 1 FROM operations.vehicles WHERE id=?)")
                .param(vehicleId).query(Boolean.class).single();
        if (!exists) throw OperationsError.notFound("VEHICLE_NOT_FOUND");
    }

    private VehicleServiceHistory.Entry map(ResultSet rs) throws SQLException {
        UUID id = rs.getObject("id", UUID.class);
        List<VehicleServiceHistory.Service> services = jdbc.sql("SELECT service_id,service_name,quantity,estimated_minutes "
                        + "FROM operations.work_order_items WHERE order_id=? ORDER BY position")
                .param(id).query((item, row) -> new VehicleServiceHistory.Service(
                        item.getObject("service_id", UUID.class), item.getString("service_name"), item.getInt("quantity"),
                        item.getInt("estimated_minutes"))).list();
        List<VehicleServiceHistory.Evidence> evidences = jdbc.sql("SELECT v.id,v.file_name,v.verified_content_type,"
                        + "v.verified_size_bytes,v.created_at FROM operations.work_evidence v "
                        + "JOIN operations.work_advances a ON a.id=v.advance_id JOIN operations.work_executions e ON e.id=a.execution_id "
                        + "WHERE v.order_id=? AND e.status='completed' AND v.state='available' ORDER BY v.created_at,v.id")
                .param(id).query((item, row) -> new VehicleServiceHistory.Evidence(item.getObject("id", UUID.class),
                        item.getString("file_name"), item.getString("verified_content_type"),
                        item.getLong("verified_size_bytes"), item.getTimestamp("created_at").toInstant())).list();
        return new VehicleServiceHistory.Entry(id, rs.getString("number"), rs.getTimestamp("verified_at").toInstant(),
                rs.getString("service_type"), rs.getString("status"), rs.getString("description"),
                rs.getString("notes") == null ? "" : rs.getString("notes"),
                rs.getString("reason"), rs.getString("symptoms"), services, evidences);
    }
}
