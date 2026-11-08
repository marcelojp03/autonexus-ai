package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class JdbcCollectionContextRepositoryTest {
    JdbcClient jdbc = mock(JdbcClient.class, RETURNS_DEEP_STUBS);
    JdbcCollectionContextRepository repository = new JdbcCollectionContextRepository(jdbc);
    ResultSet rs = mock(ResultSet.class);
    UUID order = UUID.randomUUID(), saga = UUID.randomUUID(), quote = UUID.randomUUID(), link = UUID.randomUUID();
    @BeforeEach void setup() throws Exception {
        when(rs.getObject("id", UUID.class)).thenReturn(order);
        when(rs.getString("number")).thenReturn("OT-2026-001");
        when(rs.getInt("version")).thenReturn(9);
        when(rs.getString("status")).thenReturn("completed");
        when(rs.getObject("confirmation_saga_id", UUID.class)).thenReturn(saga);
        when(rs.getString("saga_status")).thenReturn("confirmed");
        when(rs.getObject("quote_id", UUID.class)).thenReturn(quote);
        when(rs.getObject("quote_version", Integer.class)).thenReturn(2);
        when(rs.getObject("quote_link_id", UUID.class)).thenReturn(link);
        when(rs.getTimestamp("observed_at")).thenReturn(Timestamp.from(Instant.parse("2026-11-07T12:00:00Z")));
    }
    @Test void completedAndGlobalConfirmedReturnsExactPinnedReferencesOnly() throws Exception {
        var dto = repository.map(rs);
        assertTrue(dto.eligibleForCollection()); assertNull(dto.reasonCode());
        assertEquals(order, dto.orderId()); assertEquals(saga, dto.sagaId());
        assertEquals(quote, dto.quoteId()); assertEquals(2, dto.quoteVersion()); assertEquals(link, dto.quoteLinkId());
        assertEquals(9, dto.orderVersion());
        assertEquals(Set.of("orderId","orderNumber","orderVersion","orderStatus","sagaId","sagaStatus","quoteId","quoteVersion","quoteLinkId","eligibleForCollection","reasonCode","observedAt"),
            Arrays.stream(dto.getClass().getRecordComponents()).map(java.lang.reflect.RecordComponent::getName).collect(java.util.stream.Collectors.toSet()));
    }
    @Test void quoteApprovalAndUnfinishedOrdersAreNotCollectible() throws Exception {
        for (String status : List.of("quote_approved","confirmed","confirmation_pending","cancelled")) {
            when(rs.getString("status")).thenReturn(status);
            assertFalse(repository.map(rs).eligibleForCollection());
            assertEquals("ORDER_NOT_FINALIZED",repository.map(rs).reasonCode());
        }
    }
    @Test void missingOrNonGlobalConfirmationNeverCreatesAnObligation() throws Exception {
        for (String status : Arrays.asList(null,"running","recovery_pending","compensating","rejected")) {
            when(rs.getString("saga_status")).thenReturn(status);
            assertFalse(repository.map(rs).eligibleForCollection());
            assertEquals("GLOBAL_CONFIRMATION_REQUIRED",repository.map(rs).reasonCode());
        }
    }
    @Test void missingPinnedReferenceFailsClosedButPreservesContext() throws Exception {
        when(rs.getObject("quote_link_id",UUID.class)).thenReturn(null);
        assertFalse(repository.map(rs).eligibleForCollection());
        assertNull(repository.map(rs).quoteLinkId());
        assertEquals("PINNED_REFERENCES_MISSING",repository.map(rs).reasonCode());
    }
    @Test @SuppressWarnings("unchecked") void unknownOrderAndSingleSnapshotQuery() {
        when(jdbc.sql(anyString()).param(eq("id"),eq(order)).query(any(RowMapper.class)).optional()).thenReturn(Optional.empty());
        clearInvocations(jdbc);
        assertEquals(404,assertThrows(OperationsError.class,()->repository.get(order)).statusCode());
        var sql=org.mockito.ArgumentCaptor.forClass(String.class); verify(jdbc).sql(sql.capture());
        assertTrue(sql.getValue().contains("LEFT JOIN operations.cu15_sagas"));
        assertTrue(sql.getValue().contains("s.order_id=o.id"));
        for(String forbidden:List.of("finance.","employees.","customer","reference_rate","assignment_id","employee_id")) assertFalse(sql.getValue().contains(forbidden));
    }
}
