package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.CustomerRepository;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Customer;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
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

/** CU06 owner persistence: one transaction per mutation with idempotency and audit. */
@Repository
public class JdbcCustomerRepository extends OperationsStore implements CustomerRepository {
    private static final String COLUMNS =
            "id, first_name, last_name, document, phone, email, address, status, version, created_at, updated_at";

    public JdbcCustomerRepository(JdbcClient jdbc, ObjectMapper json) {
        super(jdbc, json);
    }

    private static Customer map(ResultSet rs, int row) throws SQLException {
        return new Customer(
                rs.getObject("id", UUID.class),
                rs.getString("first_name"),
                rs.getString("last_name"),
                rs.getString("document"),
                rs.getString("phone"),
                rs.getString("email"),
                rs.getString("address"),
                rs.getString("status"),
                rs.getInt("version"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    @Override
    public Page<Customer> list(String status, String search, int limit, int offset) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (status != null) {
            where.append(" AND status = ?");
            params.add(status);
        }
        if (search != null) {
            where.append("""
                     AND (strpos(lower(first_name), lower(?)) > 0
                       OR strpos(lower(last_name), lower(?)) > 0
                       OR strpos(lower(first_name || ' ' || last_name), lower(?)) > 0
                       OR strpos(lower(document), lower(?)) > 0)
                    """);
            for (int index = 0; index < 4; index++) params.add(search);
        }
        int total = jdbc.sql("SELECT count(*) FROM operations.customers" + where).params(params).query(Integer.class).single();
        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(limit);
        pageParams.add(offset);
        var items = jdbc.sql("SELECT " + COLUMNS + " FROM operations.customers" + where
                        + " ORDER BY created_at, id LIMIT ? OFFSET ?")
                .params(pageParams)
                .query(JdbcCustomerRepository::map)
                .list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public Customer get(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM operations.customers WHERE id = ?")
                .param(id)
                .query(JdbcCustomerRepository::map)
                .optional()
                .orElseThrow(() -> OperationsError.notFound("CUSTOMER_NOT_FOUND"));
    }

    @Override
    @Transactional
    public Mutation<Customer> create(Customer.Draft draft, String actor, UUID operationId) {
        String print = fingerprint(actor, "create-customer", draft.document(), draft.firstName(), draft.lastName(),
                draft.phone(), draft.email(), draft.address());
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        int rows = jdbc.sql("""
                        INSERT INTO operations.customers(id, first_name, last_name, document, phone, email, address,
                            status, version, created_at, updated_at, created_by, updated_by)
                        VALUES(?,?,?,?,?,?,?,'active',1,?,?,?,?)
                        ON CONFLICT (document) DO NOTHING
                        """)
                .params(id, draft.firstName(), draft.lastName(), draft.document(), draft.phone(), draft.email(),
                        draft.address(), java.sql.Timestamp.from(now), java.sql.Timestamp.from(now), actor, actor)
                .update();
        if (rows == 0) throw OperationsError.conflict("DUPLICATE_DOCUMENT");
        Customer created = get(id);
        if (!remember(operationId, print, id)) return new Mutation<>(get(id), true);
        audit("customer", id, "created", actor, 1, created);
        return new Mutation<>(created, false);
    }

    @Override
    @Transactional
    public Mutation<Customer> update(UUID id, Customer.Draft draft, int expectedVersion, String actor, UUID operationId) {
        String print = fingerprint(actor, "update-customer", id, draft.document(), draft.firstName(), draft.lastName(),
                draft.phone(), draft.email(), draft.address(), expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        Customer current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        if (!current.document().equals(draft.document())) {
            int clash = jdbc.sql("SELECT count(*) FROM operations.customers WHERE document = ? AND id <> ?")
                    .params(draft.document(), id).query(Integer.class).single();
            if (clash > 0) throw OperationsError.conflict("DUPLICATE_DOCUMENT");
        }
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.customers
                           SET first_name = ?, last_name = ?, document = ?, phone = ?, email = ?, address = ?,
                               version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(draft.firstName(), draft.lastName(), draft.document(), draft.phone(), draft.email(),
                        draft.address(), version, java.sql.Timestamp.from(Instant.now()), actor, id, expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        Customer updated = get(id);
        if (!remember(operationId, print, id)) return new Mutation<>(get(id), true);
        audit("customer", id, "updated", actor, version, updated);
        return new Mutation<>(updated, false);
    }

    private void requireNoScheduledAppointments(UUID customerId) {
        int scheduled = jdbc.sql("""
                        SELECT count(*) FROM operations.appointments
                         WHERE customer_id = ? AND status = 'scheduled'
                        """)
                .param(customerId).query(Integer.class).single();
        if (scheduled > 0) throw OperationsError.conflict("CUSTOMER_HAS_SCHEDULED_APPOINTMENTS");
    }

    @Override
    @Transactional
    public Mutation<Customer> deactivate(UUID id, int expectedVersion, String actor, UUID operationId) {
        String print = fingerprint(actor, "deactivate-customer", id, expectedVersion);
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        Customer current = get(id);
        if (current.version() != expectedVersion) throw OperationsError.conflict("VERSION_CONFLICT");
        if ("inactive".equals(current.status())) {
            if (!remember(operationId, print, id)) return new Mutation<>(get(id), true);
            return new Mutation<>(current, false);
        }
        requireNoScheduledAppointments(id);
        int version = expectedVersion + 1;
        int rows = jdbc.sql("""
                        UPDATE operations.customers SET status = 'inactive', version = ?, updated_at = ?, updated_by = ?
                         WHERE id = ? AND version = ?
                        """)
                .params(version, java.sql.Timestamp.from(Instant.now()), actor, id, expectedVersion)
                .update();
        if (rows == 0) throw OperationsError.conflict("VERSION_CONFLICT");
        Customer updated = get(id);
        if (!remember(operationId, print, id)) return new Mutation<>(get(id), true);
        audit("customer", id, "deactivated", actor, version, updated);
        return new Mutation<>(updated, false);
    }
}
