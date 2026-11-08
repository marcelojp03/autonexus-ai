package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.CollectionContextRepository;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcCollectionContextRepository implements CollectionContextRepository {
    private final JdbcClient jdbc;

    public JdbcCollectionContextRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    public Context get(UUID orderId) {
        try {
            return jdbc.sql("""
                SELECT o.id, o.number, o.version, o.status, o.confirmation_saga_id,
                       s.status AS saga_status, o.quote_id, o.quote_version, o.quote_link_id,
                       statement_timestamp() AS observed_at
                FROM operations.work_orders o
                LEFT JOIN operations.cu15_sagas s ON s.id=o.confirmation_saga_id AND s.order_id=o.id
                WHERE o.id=:id
                """).param("id", orderId).query((rs, row) -> map(rs)).optional()
                    .orElseThrow(() -> new OperationsError(404, "ORDER_NOT_FOUND"));
        } catch (DataAccessException failure) {
            throw new OperationsError(503, "PERSISTENCE_UNAVAILABLE");
        }
    }

    Context map(java.sql.ResultSet rs) throws java.sql.SQLException {
                    String status = rs.getString("status");
                    UUID saga = rs.getObject("confirmation_saga_id", UUID.class);
                    String sagaStatus = rs.getString("saga_status");
                    UUID quote = rs.getObject("quote_id", UUID.class);
                    Integer version = rs.getObject("quote_version", Integer.class);
                    UUID link = rs.getObject("quote_link_id", UUID.class);
                    String reason = !"completed".equals(status) ? "ORDER_NOT_FINALIZED"
                            : !"confirmed".equals(sagaStatus) ? "GLOBAL_CONFIRMATION_REQUIRED"
                            : saga == null || quote == null || version == null || version < 1 || link == null
                            ? "PINNED_REFERENCES_MISSING" : null;
                    return new Context(rs.getObject("id", UUID.class), rs.getString("number"),
                            rs.getInt("version"), status, saga, sagaStatus, quote, version, link,
                            reason == null, reason, rs.getTimestamp("observed_at").toInstant());
    }
}
