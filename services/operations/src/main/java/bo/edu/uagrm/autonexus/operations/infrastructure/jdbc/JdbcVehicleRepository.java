package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.application.VehicleRepository;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Vehicle;
import tools.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** CU07 owner persistence, including the append-only owner history. */
@Repository
public class JdbcVehicleRepository extends OperationsStore implements VehicleRepository {
    private static final String SELECT = """
            SELECT v.id, v.customer_id, v.plate, v.make, v.model, v.year, v.fuel_type, v.color, v.status, v.version,
                   v.created_at, v.updated_at, c.first_name || ' ' || c.last_name AS customer_name
              FROM operations.vehicles v
              JOIN operations.customers c ON c.id = v.customer_id
            """;

    public JdbcVehicleRepository(JdbcClient jdbc, ObjectMapper json) {
        super(jdbc, json);
    }

    private static Vehicle map(ResultSet rs, int row) throws SQLException {
        return new Vehicle(
                rs.getObject("id", UUID.class),
                rs.getObject("customer_id", UUID.class),
                rs.getString("customer_name"),
                rs.getString("plate"),
                rs.getString("make"),
                rs.getString("model"),
                rs.getInt("year"),
                rs.getString("fuel_type"),
                rs.getString("color"),
                rs.getString("status"),
                rs.getInt("version"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    @Override
    public Page<Vehicle> list(String status, UUID customerId, String search, int limit, int offset) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (status != null) {
            where.append(" AND v.status = ?");
            params.add(status);
        }
        if (customerId != null) {
            where.append(" AND v.customer_id = ?");
            params.add(customerId);
        }
        if (search != null) {
            where.append("""
                     AND (strpos(lower(v.plate), lower(?)) > 0
                       OR strpos(lower(v.make), lower(?)) > 0
                       OR strpos(lower(v.model), lower(?)) > 0
                       OR strpos(lower(c.first_name || ' ' || c.last_name), lower(?)) > 0)
                    """);
            for (int index = 0; index < 4; index++) params.add(search);
        }
        int total = jdbc.sql("""
                        SELECT count(*) FROM operations.vehicles v
                          JOIN operations.customers c ON c.id = v.customer_id
                        """ + where)
                .params(params).query(Integer.class).single();
        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(limit);
        pageParams.add(offset);
        var items = jdbc.sql(SELECT + where + " ORDER BY v.created_at, v.id LIMIT ? OFFSET ?")
                .params(pageParams)
                .query(JdbcVehicleRepository::map)
                .list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public Vehicle get(UUID id) {
        return jdbc.sql(SELECT + " WHERE v.id = ?")
                .param(id)
                .query(JdbcVehicleRepository::map)
                .optional()
                .orElseThrow(() -> OperationsError.notFound("VEHICLE_NOT_FOUND"));
    }

    private record Owner(UUID id, String status) {}

    private Owner activeCustomer(UUID customerId) {
        var rows = jdbc.sql("SELECT id, status FROM operations.customers WHERE id = ?")
                .param(customerId)
                .query((rs, index) -> new Owner(rs.getObject("id", UUID.class), rs.getString("status")))
                .list();
        if (rows.isEmpty()) throw OperationsError.notFound("CUSTOMER_NOT_FOUND");
        if (!"active".equals(rows.get(0).status())) throw OperationsError.conflict("CUSTOMER_INACTIVE");
        return rows.get(0);
    }

    private void openOwner(UUID vehicleId, UUID customerId, String actor) {
        jdbc.sql("""
                        INSERT INTO operations.vehicle_owners(id, vehicle_id, customer_id, from_at, to_at, changed_by)
                        VALUES(?,?,?,?,NULL,?)
                        """)
                .params(UUID.randomUUID(), vehicleId, customerId, java.sql.Timestamp.from(Instant.now()), actor)
                .update();
    }

    @Override
    @Transactional
    public Mutation<Vehicle> create(Vehicle.Draft draft, String actor, UUID operationId) {
        String print = fingerprint(actor, "create-vehicle", draft.customerId(), draft.plate(), draft.make(),
                draft.model(), draft.year(), draft.fuelType(), draft.color());
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        activeCustomer(draft.customerId());
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        int rows = jdbc.sql("""
                        INSERT INTO operations.vehicles(id, customer_id, plate, make, model, year, fuel_type, color,
                            status, version, created_at, updated_at, created_by, updated_by)
                        VALUES(?,?,?,?,?,?,?,?,'active',1,?,?,?,?)
                        ON CONFLICT (plate) DO NOTHING
                        """)
                .params(id, draft.customerId(), draft.plate(), draft.make(), draft.model(), draft.year(),
                        draft.fuelType(), draft.color(), java.sql.Timestamp.from(now), java.sql.Timestamp.from(now),
                        actor, actor)
                .update();
        if (rows == 0) throw OperationsError.conflict("DUPLICATE_PLATE");
        openOwner(id, draft.customerId(), actor);
        Vehicle created = get(id);
        remember(operationId, print, id);
        audit("vehicle", id, "created", actor, 1, created);
        return new Mutation<>(created, false);
    }

    @Override
    @Transactional
    public Mutation<Vehicle> update(UUID id, Vehicle.Draft draft, int expectedVersion, String actor, UUID operationId) {
        String print = fingerprint(actor, "update-vehicle", id, draft.customerId(), draft.plate(), draft.make(),
                draft.model(), draft.year(), draft.fuelType(), draft.color(), expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        Vehicle current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        activeCustomer(draft.customerId());
        if (!current.plate().equals(draft.plate())) {
            int clash = jdbc.sql("SELECT count(*) FROM operations.vehicles WHERE plate = ? AND id <> ?")
                    .params(draft.plate(), id).query(Integer.class).single();
            if (clash > 0) throw OperationsError.conflict("DUPLICATE_PLATE");
        }
        boolean ownerChanged = !current.customerId().equals(draft.customerId());
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.vehicles
                           SET customer_id = ?, plate = ?, make = ?, model = ?, year = ?, fuel_type = ?, color = ?,
                               version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(draft.customerId(), draft.plate(), draft.make(), draft.model(), draft.year(),
                        draft.fuelType(), draft.color(), version, java.sql.Timestamp.from(Instant.now()), actor, id,
                        expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        if (ownerChanged) {
            jdbc.sql("UPDATE operations.vehicle_owners SET to_at = ? WHERE vehicle_id = ? AND to_at IS NULL")
                    .params(java.sql.Timestamp.from(Instant.now()), id)
                    .update();
            openOwner(id, draft.customerId(), actor);
        }
        Vehicle updated = get(id);
        remember(operationId, print, id);
        audit("vehicle", id, ownerChanged ? "owner-changed" : "updated", actor, version, updated);
        return new Mutation<>(updated, false);
    }

    @Override
    @Transactional
    public Mutation<Vehicle> deactivate(UUID id, int expectedVersion, String actor, UUID operationId) {
        String print = fingerprint(actor, "deactivate-vehicle", id, expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        Vehicle current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        if ("inactive".equals(current.status())) {
            remember(operationId, print, id);
            return new Mutation<>(current, false);
        }
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.vehicles SET status = 'inactive', version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(version, java.sql.Timestamp.from(Instant.now()), actor, id, expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        Vehicle updated = get(id);
        remember(operationId, print, id);
        audit("vehicle", id, "deactivated", actor, version, updated);
        return new Mutation<>(updated, false);
    }
}
