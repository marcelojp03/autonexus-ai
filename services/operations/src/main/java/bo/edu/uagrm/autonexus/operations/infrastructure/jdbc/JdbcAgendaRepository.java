package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;
import bo.edu.uagrm.autonexus.operations.application.*;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.Saga;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.ObjectMapper;

@Repository
public class JdbcAgendaRepository implements AgendaPorts.Repository {
    static final String FROM = """
        FROM operations.work_orders o
        LEFT JOIN operations.cu15_sagas s ON s.id=o.confirmation_saga_id
        LEFT JOIN operations.vehicles v ON v.id=o.vehicle_id
        LEFT JOIN LATERAL (
            SELECT snapshot FROM operations.operations_history
            WHERE entity='work-order' AND entity_id=o.id AND action='created' AND version=1
            ORDER BY occurred_at,id LIMIT 1
        ) h ON true
        """;
    static final String SELECT = """
        SELECT o.id,o.number,o.confirmation_saga_id,o.assignment_id,o.employee_id,o.starts_at,o.ends_at,
            o.quote_id,o.quote_version,o.quote_link_id,o.version,o.priority,o.description,o.notes,o.vehicle_id,
            v.make,v.model,h.snapshot->>'vehiclePlate' AS plate,
            (SELECT jsonb_agg(jsonb_build_object('serviceId',item->>'serviceId','serviceName',item->>'serviceName',
                'quantity',item->'quantity','estimatedMinutes',item->'estimatedMinutes'))
                FROM jsonb_array_elements(h.snapshot->'items') item) AS services,
            s.document,s.status AS saga_status,s.order_id AS saga_order_id,s.version AS saga_version,
            COALESCE((SELECT 'in_progress' FROM operations.work_executions x WHERE x.order_id=o.id),'not_started') AS execution_status,
            (SELECT count(*)::int FROM operations.work_advances ad
                JOIN operations.work_executions x2 ON x2.id=ad.execution_id WHERE x2.order_id=o.id) AS advance_count,
            (SELECT max(ad2.recorded_at) FROM operations.work_advances ad2
                JOIN operations.work_executions x3 ON x3.id=ad2.execution_id WHERE x3.order_id=o.id) AS last_advance_at,
            (SELECT count(*)::int FROM operations.work_evidence v WHERE v.order_id=o.id AND v.state='available') AS available_evidence
        """;
    static final String CONFIRMED = " WHERE o.status='confirmed' AND o.confirmation_saga_id IS NOT NULL";
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    public JdbcAgendaRepository(JdbcClient jdbc, ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
    private static OperationsError persistence() { return new OperationsError(503,"PERSISTENCE_UNAVAILABLE"); }
    @Override
    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    public Selection list(AgendaFilter filter, UUID employeeId) {
        String where=CONFIRMED+" AND o.starts_at < ? AND o.ends_at > ?";
        List<Object> params=new ArrayList<>(List.of(Timestamp.from(filter.end()),Timestamp.from(filter.start())));
        if(employeeId!=null) { where+=" AND o.employee_id=?"; params.add(employeeId); }
        if(filter.priority()!=null) { where+=" AND o.priority=?"; params.add(filter.priority()); }
        try {
            long total=jdbc.sql("SELECT count(*) "+FROM+where).params(params).query(Long.class).single();
            params.add(filter.limit()); params.add(filter.offset());
            var rows=jdbc.sql(SELECT+FROM+where+" ORDER BY o.starts_at,o.id,o.assignment_id LIMIT ? OFFSET ?")
                .params(params).query((rs,n)->map(rs)).list();
            return new Selection(rows,total);
        } catch(DataAccessException failure) { throw persistence(); }
    }
    @Override
    @Transactional(readOnly=true)
    public Optional<Candidate> detail(UUID assignmentId, UUID employeeId) {
        String where=CONFIRMED+" AND o.assignment_id=?";
        List<Object> params=new ArrayList<>(List.of(assignmentId));
        if(employeeId!=null) { where+=" AND o.employee_id=?"; params.add(employeeId); }
        try { return jdbc.sql(SELECT+FROM+where).params(params).query((rs,n)->map(rs)).optional(); }
        catch(DataAccessException failure) { throw persistence(); }
    }
    private static UUID id(Object value) { return UUID.fromString(Objects.requireNonNull(value).toString()); }
    private static Instant instant(Object value) { return Instant.parse(Objects.requireNonNull(value).toString()); }
    private static long positive(Object value) {
        if (!(value instanceof Number n) || n.longValue()<1 || n.doubleValue()!=n.longValue()) throw ReadAgenda.state();
        return n.longValue();
    }
    Candidate map(ResultSet rs) throws SQLException {
        try {
            UUID order=rs.getObject("id",UUID.class), sagaId=rs.getObject("confirmation_saga_id",UUID.class);
            UUID assignment=rs.getObject("assignment_id",UUID.class), employee=rs.getObject("employee_id",UUID.class);
            Instant start=rs.getTimestamp("starts_at").toInstant(), end=rs.getTimestamp("ends_at").toInstant();
            Saga saga=json.readValue(rs.getString("document"),Saga.class);
            var confirmed=saga.step("confirm_assignment"); var quote=saga.step("authorize_quote");
            var resource=confirmed.resource(); var link=quote.resource();
            if (!"confirmed".equals(rs.getString("saga_status")) || !"confirmed".equals(saga.status)
                    || !sagaId.equals(id(saga.id)) || !order.equals(id(saga.orderId))
                    || !order.equals(rs.getObject("saga_order_id",UUID.class)) || saga.version<1 || saga.version!=rs.getLong("saga_version")
                    || saga.orderVersion!=rs.getLong("version") || saga.orderVersion<1 || !start.isBefore(end)
                    || !employee.equals(id(saga.input.get("employeeId")))
                    || !start.equals(instant(saga.input.get("startsAt"))) || !end.equals(instant(saga.input.get("endsAt")))
                    || !confirmed.applied() || !quote.applied() || !"confirmed".equals(resource.get("status"))
                    || !assignment.equals(id(resource.get("id"))) || !sagaId.equals(id(resource.get("sagaId")))
                    || !order.equals(id(resource.get("orderId"))) || !employee.equals(id(resource.get("employeeId")))
                    || !start.equals(instant(resource.get("startsAt"))) || !end.equals(instant(resource.get("endsAt")))
                    || !rs.getObject("quote_id",UUID.class).equals(id(saga.input.get("quoteId")))
                    || rs.getLong("quote_version")!=positive(saga.input.get("quoteVersion"))
                    || !rs.getObject("quote_link_id",UUID.class).equals(id(link.get("id")))
                    || !sagaId.equals(id(link.get("sagaId"))) || !order.equals(id(link.get("orderId")))
                    || !"active".equals(link.get("status")) || positive(link.get("version"))<1
                    || !rs.getObject("quote_id",UUID.class).equals(id(link.get("quoteId")))
                    || rs.getLong("quote_version")!=positive(link.get("quoteVersion"))
                    || saga.step("release_assignment").applied() || saga.step("cancel_quote_link").applied()) throw ReadAgenda.state();
            String plate=rs.getString("plate"),make=rs.getString("make"),model=rs.getString("model");
            if(plate==null || plate.isBlank() || make==null || model==null) throw ReadAgenda.state();
            Service[] services=json.readValue(rs.getString("services"),Service[].class);
            if(services==null || services.length==0 || Arrays.stream(services).anyMatch(s->s.serviceId()==null || s.serviceName()==null || s.quantity()<1 || s.estimatedMinutes()<1)) throw ReadAgenda.state();
            String executionStatus=rs.getString("execution_status");
            int advanceCount=rs.getInt("advance_count"),availableEvidence=rs.getInt("available_evidence");
            java.sql.Timestamp lastAdvance=rs.getTimestamp("last_advance_at");
            if(executionStatus==null || !Set.of("not_started","in_progress").contains(executionStatus)
                    || advanceCount<0 || availableEvidence<0
                    || (lastAdvance==null && advanceCount>0) || (lastAdvance!=null && advanceCount==0)) throw ReadAgenda.state();
            return new Candidate(assignment,sagaId,order,rs.getString("number"),employee,
                new Vehicle(rs.getObject("vehicle_id",UUID.class),plate,make,model),start,end,
                rs.getString("priority"),rs.getString("description"),rs.getString("notes"),List.of(services),saga.orderVersion,positive(resource.get("version")),
                executionStatus,advanceCount,lastAdvance==null?null:lastAdvance.toInstant(),availableEvidence);
        } catch(RuntimeException invalid) { throw ReadAgenda.state(); }
    }
}
