package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.application.ServiceRepository;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.ServiceOffering;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** CU09 owner persistence. Services are never deleted, only deactivated. */
@Repository
public class JdbcServiceRepository extends OperationsStore implements ServiceRepository {
    private static final String COLUMNS =
            "id, name, description, category, estimated_minutes, reference_rate, active, version, created_at, updated_at";

    public JdbcServiceRepository(JdbcClient jdbc, ObjectMapper json) {
        super(jdbc, json);
    }

    private static ServiceOffering map(ResultSet rs, int row) throws SQLException {
        return new ServiceOffering(
                rs.getObject("id", UUID.class),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("category"),
                rs.getInt("estimated_minutes"),
                rs.getBigDecimal("reference_rate"),
                rs.getBoolean("active"),
                rs.getInt("version"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    @Override
    public Page<ServiceOffering> list(Boolean active, String search, int limit, int offset) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (active != null) {
            where.append(" AND active = ?");
            params.add(active);
        }
        if (search != null) {
            where.append(" AND (strpos(lower(name), lower(?)) > 0 OR strpos(lower(category), lower(?)) > 0)");
            params.add(search);
            params.add(search);
        }
        int total = jdbc.sql("SELECT count(*) FROM operations.service_catalog" + where)
                .params(params).query(Integer.class).single();
        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(limit);
        pageParams.add(offset);
        var items = jdbc.sql("SELECT " + COLUMNS + " FROM operations.service_catalog" + where
                        + " ORDER BY name_key, id LIMIT ? OFFSET ?")
                .params(pageParams)
                .query(JdbcServiceRepository::map)
                .list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public ServiceOffering get(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM operations.service_catalog WHERE id = ?")
                .param(id)
                .query(JdbcServiceRepository::map)
                .optional()
                .orElseThrow(() -> OperationsError.notFound("SERVICE_NOT_FOUND"));
    }

    @Override
    @Transactional
    public Mutation<ServiceOffering> create(ServiceOffering.Draft draft, String actor, UUID operationId) {
        String print = fingerprint(actor, "create-service", draft.nameKey(), draft.description(), draft.category(),
                draft.estimatedMinutes(), draft.referenceRate().stripTrailingZeros().toPlainString());
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        int rows = jdbc.sql("""
                        INSERT INTO operations.service_catalog(id, name, name_key, description, category,
                            estimated_minutes, reference_rate, active, version, created_at, updated_at, created_by, updated_by)
                        VALUES(?,?,?,?,?,?,?,true,1,?,?,?,?)
                        ON CONFLICT (name_key) DO NOTHING
                        """)
                .params(id, draft.name(), draft.nameKey(), draft.description(), draft.category(),
                        draft.estimatedMinutes(), draft.referenceRate(), java.sql.Timestamp.from(now),
                        java.sql.Timestamp.from(now), actor, actor)
                .update();
        if (rows == 0) throw OperationsError.conflict("DUPLICATE_SERVICE");
        ServiceOffering created = get(id);
        remember(operationId, print, id);
        audit("service", id, "created", actor, 1, created);
        return new Mutation<>(created, false);
    }

    @Override
    @Transactional
    public Mutation<ServiceOffering> update(UUID id, ServiceOffering.Draft draft, int expectedVersion, String actor, UUID operationId) {
        String print = fingerprint(actor, "update-service", id, draft.nameKey(), draft.description(), draft.category(),
                draft.estimatedMinutes(), draft.referenceRate().stripTrailingZeros().toPlainString(), expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        ServiceOffering current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        int clash = jdbc.sql("SELECT count(*) FROM operations.service_catalog WHERE name_key = ? AND id <> ?")
                .params(draft.nameKey(), id).query(Integer.class).single();
        if (clash > 0) throw OperationsError.conflict("DUPLICATE_SERVICE");
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.service_catalog
                           SET name = ?, name_key = ?, description = ?, category = ?, estimated_minutes = ?,
                               reference_rate = ?, version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(draft.name(), draft.nameKey(), draft.description(), draft.category(), draft.estimatedMinutes(),
                        draft.referenceRate(), version, java.sql.Timestamp.from(Instant.now()), actor, id, expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        ServiceOffering updated = get(id);
        remember(operationId, print, id);
        audit("service", id, "updated", actor, version, updated);
        return new Mutation<>(updated, false);
    }

    @Override
    @Transactional
    public Mutation<ServiceOffering> deactivate(UUID id, int expectedVersion, String actor, UUID operationId) {
        String print = fingerprint(actor, "deactivate-service", id, expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        ServiceOffering current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        if (!current.active()) {
            remember(operationId, print, id);
            return new Mutation<>(current, false);
        }
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.service_catalog SET active = false, version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(version, java.sql.Timestamp.from(Instant.now()), actor, id, expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        ServiceOffering updated = get(id);
        remember(operationId, print, id);
        audit("service", id, "deactivated", actor, version, updated);
        return new Mutation<>(updated, false);
    }
}
