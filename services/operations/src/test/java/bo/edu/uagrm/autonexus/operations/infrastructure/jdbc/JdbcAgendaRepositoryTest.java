package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;
import bo.edu.uagrm.autonexus.operations.application.*;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.Service;
import bo.edu.uagrm.autonexus.operations.domain.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class JdbcAgendaRepositoryTest {
    JdbcClient jdbc=mock(JdbcClient.class,RETURNS_DEEP_STUBS);
    ObjectMapper json=new ObjectMapper();
    JdbcAgendaRepository repository=new JdbcAgendaRepository(jdbc,json);
    ResultSet rs=mock(ResultSet.class);
    UUID order=UUID.randomUUID(),sagaId=UUID.randomUUID(),assignment=UUID.randomUUID(),employee=UUID.randomUUID(),quote=UUID.randomUUID(),link=UUID.randomUUID();
    Instant start=Instant.parse("2026-11-01T12:00:00Z"),end=start.plusSeconds(3600);
    Confirmation.Saga saga=new Confirmation.Saga();
    @BeforeEach void setup() throws Exception {
        saga.id=sagaId.toString(); saga.orderId=order.toString(); saga.status="confirmed"; saga.orderVersion=3; saga.version=8;
        saga.input=Map.of("employeeId",employee.toString(),"startsAt","2026-11-01T08:00:00-04:00","endsAt",end.toString(),"quoteId",quote.toString(),"quoteVersion",1);
        Confirmation.COMMANDS.forEach(c->saga.steps.add(new Confirmation.Step(c)));
        var resource=Map.of("id",assignment.toString(),"sagaId",saga.id,"orderId",saga.orderId,"employeeId",employee.toString(),
            "startsAt",start.toString(),"endsAt",end.toString(),"version",2,"status","confirmed");
        saga.step("confirm_assignment").status="applied"; saga.step("confirm_assignment").result=Map.of("resource",resource);
        saga.step("authorize_quote").status="applied"; saga.step("authorize_quote").result=Map.of("resource",Map.of("id",link.toString(),
            "sagaId",saga.id,"orderId",saga.orderId,"quoteId",quote.toString(),"quoteVersion",1,"version",1,"status","active"));
        when(rs.getObject("id",UUID.class)).thenReturn(order); when(rs.getObject("confirmation_saga_id",UUID.class)).thenReturn(sagaId);
        when(rs.getObject("assignment_id",UUID.class)).thenReturn(assignment); when(rs.getObject("employee_id",UUID.class)).thenReturn(employee);
        when(rs.getObject("quote_id",UUID.class)).thenReturn(quote); when(rs.getObject("quote_link_id",UUID.class)).thenReturn(link);
        when(rs.getObject("saga_order_id",UUID.class)).thenReturn(order); when(rs.getLong("version")).thenReturn(3L);
        when(rs.getLong("quote_version")).thenReturn(1L); when(rs.getLong("saga_version")).thenReturn(8L);
        when(rs.getTimestamp("starts_at")).thenReturn(Timestamp.from(start)); when(rs.getTimestamp("ends_at")).thenReturn(Timestamp.from(end));
        when(rs.getString("saga_status")).thenReturn("confirmed"); when(rs.getString("plate")).thenReturn("ORDER-SNAPSHOT");
        // CU16 progress columns travel with the same row; the agenda publishes them additively.
        when(rs.getString("execution_status")).thenReturn("in_progress");
        when(rs.getInt("advance_count")).thenReturn(2); when(rs.getInt("available_evidence")).thenReturn(1);
        when(rs.getTimestamp("last_advance_at")).thenReturn(Timestamp.from(start));
        when(rs.getString("make")).thenReturn("Toyota"); when(rs.getString("model")).thenReturn("Corolla");
        when(rs.getString("services")).thenReturn(json.writeValueAsString(List.of(new Service(UUID.randomUUID(),"Frenos",1,60))));
        document();
    }
    void document() throws Exception { when(rs.getString("document")).thenReturn(json.writeValueAsString(saga)); }
    @Test void readsGlobalProofAndSnapshotsWithCanonicalInstantEquality() throws Exception {
        var row=repository.map(rs); assertEquals(2,row.assignmentVersion()); assertEquals(start,row.startsAt());
        assertEquals("ORDER-SNAPSHOT",row.vehicle().plate());
    }
    @Test void nonConfirmedOrCompensatedSagaIsNotAJob() throws Exception {
        for(String state:List.of("running","recovery_pending","compensating","compensation_pending","rejected")) {
            saga.status=state; document();
            assertEquals("AGENDA_STATE_UNAVAILABLE",assertThrows(OperationsError.class,()->repository.map(rs)).code());
        }
        saga.status="confirmed"; saga.step("release_assignment").status="applied"; document();
        assertThrows(OperationsError.class,()->repository.map(rs));
    }
    @Test void missingOrInconsistentReferencesFailNotPrune() throws Exception {
        when(rs.getObject("quote_link_id",UUID.class)).thenReturn(UUID.randomUUID());
        assertThrows(OperationsError.class,()->repository.map(rs));
        when(rs.getObject("quote_link_id",UUID.class)).thenReturn(link); when(rs.getLong("version")).thenReturn(4L);
        assertThrows(OperationsError.class,()->repository.map(rs));
    }
    @Test void missingSnapshotAndNonPositiveIntervalAreStateErrors() throws Exception {
        when(rs.getTimestamp("ends_at")).thenReturn(Timestamp.from(start));
        assertThrows(OperationsError.class,()->repository.map(rs));
        when(rs.getTimestamp("ends_at")).thenReturn(Timestamp.from(end)); when(rs.getString("plate")).thenReturn(null);
        assertThrows(OperationsError.class,()->repository.map(rs));
    }
    @Test @SuppressWarnings("unchecked") void ownedSqlHasBoundedStablePageAndScopeAndNoCrossDatabase() {
        when(jdbc.sql(anyString()).params(anyList()).query(Long.class).single()).thenReturn(0L);
        when(jdbc.sql(anyString()).params(anyList()).query(any(RowMapper.class)).list()).thenReturn(List.of());
        var f=AgendaFilter.parse(Map.of("from",List.of("2026-11-01"),"priority",List.of("alta")),"team",Clock.systemUTC());
        assertEquals(0,repository.list(f,employee).total());
        var sql=org.mockito.ArgumentCaptor.forClass(String.class); verify(jdbc,atLeastOnce()).sql(sql.capture());
        String selected=sql.getAllValues().getLast();
        assertTrue(selected.contains("o.status='confirmed'")); assertTrue(selected.contains("o.employee_id=?"));
        assertTrue(selected.contains("o.starts_at < ? AND o.ends_at > ?"));
        assertTrue(selected.contains("ORDER BY o.starts_at,o.id,o.assignment_id LIMIT ? OFFSET ?"));
        assertFalse(selected.contains("employees.")); assertFalse(selected.contains("customers")); assertFalse(selected.contains("reference_rate"));
        assertTrue(selected.contains("snapshot->>'vehiclePlate'"));
    }
    @Test void sqlFailureIsSanitized503() {
        when(jdbc.sql(anyString())).thenThrow(new DataAccessResourceFailureException("private SQL"));
        assertEquals("PERSISTENCE_UNAVAILABLE",assertThrows(OperationsError.class,()->repository.detail(assignment,employee)).code());
    }
}
