package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.application.WorkOrderRepository;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.WorkOrder;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.Year;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** CU12 owner persistence. The order copies the catalog rate so later price changes do not alter it. */
@Repository
public class JdbcWorkOrderRepository extends OperationsStore implements WorkOrderRepository {
    private static final String SELECT = "SELECT o.id, o.number, o.reception_id, o.vehicle_id, v.plate AS vehicle_plate, "
            + "o.customer_id, c.first_name || ' ' || c.last_name AS customer_name, o.description, o.priority, o.notes, "
            + "o.status, o.version, o.created_at, o.updated_at "
            + "FROM operations.work_orders o "
            + "JOIN operations.vehicles v ON v.id = o.vehicle_id "
            + "JOIN operations.customers c ON c.id = o.customer_id";

    public JdbcWorkOrderRepository(JdbcClient jdbc, ObjectMapper json) {
        super(jdbc, json);
    }

    private List<WorkOrder.Item> items(JdbcClient client, UUID orderId) {
        return client.sql("SELECT i.service_id, s.name AS service_name, i.quantity, i.estimated_minutes, i.reference_rate "
                        + "FROM operations.work_order_items i JOIN operations.service_catalog s ON s.id = i.service_id "
                        + "WHERE i.order_id = ? ORDER BY i.position")
                .param(orderId)
                .query((rs, index) -> new WorkOrder.Item(rs.getObject("service_id", UUID.class), rs.getString("service_name"),
                        rs.getInt("quantity"), rs.getInt("estimated_minutes"), rs.getBigDecimal("reference_rate")))
                .list();
    }

    private WorkOrder map(ResultSet rs, JdbcClient client) throws SQLException {
        UUID id = rs.getObject("id", UUID.class);
        return new WorkOrder(
                id,
                rs.getString("number"),
                rs.getObject("reception_id", UUID.class),
                rs.getObject("vehicle_id", UUID.class),
                rs.getString("vehicle_plate"),
                rs.getObject("customer_id", UUID.class),
                rs.getString("customer_name"),
                rs.getString("description"),
                rs.getString("priority"),
                rs.getString("notes"),
                rs.getString("status"),
                rs.getInt("version"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant(),
                items(client, id));
    }

    @Override
    public Page<WorkOrder> list(String status, UUID customerId, UUID vehicleId, int limit, int offset) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (status != null) {
            where.append(" AND o.status = ?");
            params.add(status);
        }
        if (customerId != null) {
            where.append(" AND o.customer_id = ?");
            params.add(customerId);
        }
        if (vehicleId != null) {
            where.append(" AND o.vehicle_id = ?");
            params.add(vehicleId);
        }
        int total = jdbc.sql("SELECT count(*) FROM operations.work_orders o" + where)
                .params(params).query(Integer.class).single();
        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(limit);
        pageParams.add(offset);
        var items = jdbc.sql(SELECT + where + " ORDER BY o.created_at DESC, o.id LIMIT ? OFFSET ?")
                .params(pageParams)
                .query((rs, index) -> {
                    try {
                        return map(rs, jdbc);
                    } catch (SQLException error) {
                        throw new IllegalStateException(error);
                    }
                })
                .list();
        return new Page<>(items, total, limit, offset);
    }

    @Override
    public WorkOrder get(UUID id) {
        return jdbc.sql(SELECT + " WHERE o.id = ?")
                .param(id)
                .query((rs, index) -> {
                    try {
                        return map(rs, jdbc);
                    } catch (SQLException error) {
                        throw new IllegalStateException(error);
                    }
                })
                .optional()
                .orElseThrow(() -> OperationsError.notFound("ORDER_NOT_FOUND"));
    }

    private record ReceptionContext(UUID vehicleId, UUID customerId, boolean hasOrder) {}

    private ReceptionContext requireReception(UUID receptionId) {
        var rows = jdbc.sql("SELECT vehicle_id, customer_id, has_order FROM operations.vehicle_receptions WHERE id = ?")
                .param(receptionId)
                .query((rs, index) -> new ReceptionContext(rs.getObject("vehicle_id", UUID.class),
                        rs.getObject("customer_id", UUID.class), rs.getBoolean("has_order")))
                .list();
        if (rows.isEmpty()) throw OperationsError.notFound("RECEPTION_NOT_FOUND");
        if (rows.get(0).hasOrder()) throw OperationsError.conflict("ORDER_ALREADY_EXISTS");
        return rows.get(0);
    }

    private Map<UUID, int[]> rates(List<UUID> serviceIds) {
        var rows = jdbc.sql("SELECT id, estimated_minutes, reference_rate, active FROM operations.service_catalog WHERE id = ANY(?)")
                .param(serviceIds.toArray(UUID[]::new))
                .query((rs, index) -> new Object[] {rs.getObject("id", UUID.class), rs.getInt("estimated_minutes"),
                        rs.getBigDecimal("reference_rate"), rs.getBoolean("active")})
                .list();
        Map<UUID, int[]> prices = new LinkedHashMap<>();
        for (Object[] row : rows) {
            if (!Boolean.TRUE.equals(row[3])) throw OperationsError.conflict("SERVICE_INACTIVE");
            prices.put((UUID) row[0], new int[] {((Integer) row[1]), ((BigDecimal) row[2]).movePointRight(2).intValue()});
        }
        return prices;
    }

    private String nextNumber() {
        int year = Year.now().getValue();
        jdbc.sql("INSERT INTO operations.order_numbers(year, value) VALUES(?, 0) ON CONFLICT (year) DO NOTHING")
                .param(year).update();
        int next = jdbc.sql("UPDATE operations.order_numbers SET value = value + 1 WHERE year = ? RETURNING value")
                .param(year).query(Integer.class).single();
        return String.format("WO-%d-%06d", year, next);
    }

    @Override
    @Transactional
    public Mutation<WorkOrder> create(WorkOrder.Draft draft, String actor, UUID operationId) {
        List<UUID> serviceIds = draft.services().stream().map(WorkOrder.RequestedService::serviceId).toList();
        String print = fingerprint(actor, "create-order", draft.receptionId(), draft.description(), draft.priority(),
                draft.notes(), serviceIds.toString(),
                draft.services().stream().map(WorkOrder.RequestedService::quantity).toList().toString());
        var replay = replayed(operationId, print);
        if (replay.isPresent()) return new Mutation<>(get(replay.get()), true);
        if (serviceIds.stream().distinct().count() != serviceIds.size()) throw OperationsError.conflict("DUPLICATE_SERVICE");
        ReceptionContext reception = requireReception(draft.receptionId());
        Map<UUID, int[]> prices = rates(serviceIds);
        for (UUID serviceId : serviceIds) {
            if (!prices.containsKey(serviceId)) throw OperationsError.notFound("SERVICE_NOT_FOUND");
        }
        UUID id = UUID.randomUUID();
        String number = nextNumber();
        Instant now = Instant.now();
        jdbc.sql("INSERT INTO operations.work_orders(id, number, reception_id, vehicle_id, customer_id, description, priority, "
                        + "notes, status, version, created_at, updated_at, created_by, updated_by) "
                        + "VALUES(?,?,?,?,?,?,?,?, 'pending_quote', 1, ?,?,?,?)")
                .params(id, number, draft.receptionId(), reception.vehicleId(), reception.customerId(), draft.description(),
                        draft.priority(), draft.notes(), Timestamp.from(now), Timestamp.from(now), actor, actor)
                .update();
        int position = 1;
        for (WorkOrder.RequestedService requested : draft.services()) {
            int[] price = prices.get(requested.serviceId());
            BigDecimal reference = new BigDecimal(price[1]).movePointLeft(2);
            jdbc.sql("INSERT INTO operations.work_order_items(id, order_id, service_id, quantity, estimated_minutes, "
                            + "reference_rate, position) VALUES(?,?,?,?,?,?,?)")
                    .params(UUID.randomUUID(), id, requested.serviceId(), requested.quantity(), price[0], reference, position++)
                    .update();
        }
        jdbc.sql("UPDATE operations.vehicle_receptions SET has_order = true, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?")
                .params(Timestamp.from(now), actor, draft.receptionId())
                .update();
        WorkOrder created = get(id);
        if (!remember(operationId, print, id)) return new Mutation<>(get(id), true);
        audit("work-order", id, "created", actor, 1, created);
        return new Mutation<>(created, false);
    }
}
