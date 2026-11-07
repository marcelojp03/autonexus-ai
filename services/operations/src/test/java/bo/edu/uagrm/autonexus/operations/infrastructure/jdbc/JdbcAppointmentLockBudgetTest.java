package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import bo.edu.uagrm.autonexus.operations.domain.Appointment;
import java.sql.Connection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

class JdbcAppointmentLockBudgetTest {
    @ParameterizedTest
    @ValueSource(strings = {"cancel", "reschedule"})
    void rowLockPrecedesSlotLockAndBudgetRestoresOnFailure(String action) throws Exception {
        try (var fixture = new Fixture(15)) {
            var failure = new IllegalStateException("slot failure");
            doReturn(Optional.empty()).when(fixture.repository).replayed(any(), anyString());
            when(fixture.jdbc.sql(contains("pg_advisory_xact_lock"))).thenAnswer(call -> {
                assertEquals(List.of("row"), fixture.locks);
                assertEquals(20000, fixture.budget);
                fixture.locks.add("slot");
                throw failure;
            });
            assertSame(failure, assertThrows(IllegalStateException.class, () -> fixture.mutate(action)));
            assertEquals(List.of("row", "slot"), fixture.locks);
            fixture.assertRestored(20000);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"cancel", "reschedule"})
    void replayAfterRowWaitWinsBeforeVersionCheck(String action) throws Exception {
        try (var fixture = new Fixture(15)) {
            doReturn(Optional.empty(), Optional.of(fixture.id)).when(fixture.repository).replayed(any(), anyString());
            when(fixture.appointment.version()).thenReturn(2);
            fixture.mutate(action);
            assertEquals(List.of("row"), fixture.locks);
            fixture.assertRestored(20000);
            verify(fixture.appointment, never()).version();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"cancel", "reschedule"})
    void staleVersionAfterRowWaitFailsWithoutSlotLock(String action) throws Exception {
        try (var fixture = new Fixture(15)) {
            doReturn(Optional.empty()).when(fixture.repository).replayed(any(), anyString());
            when(fixture.appointment.version()).thenReturn(2);
            assertThrows(OperationsError.class, () -> fixture.mutate(action));
            assertEquals(List.of("row"), fixture.locks);
            fixture.assertRestored(20000);
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {2, 60})
    void configuredBudgetIncludesFiveSecondsAndRestoresOnSuccess(int seconds) throws Exception {
        try (var fixture = new Fixture(seconds)) {
            doReturn(Optional.empty()).when(fixture.repository).replayed(any(), anyString());
            when(fixture.appointment.status()).thenReturn("cancelled");
            doReturn(true).when(fixture.repository).remember(any(), anyString(), any());
            fixture.mutate("cancel");
            fixture.assertRestored((seconds + 5) * 1000);
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 61})
    void rejectsInvalidWebhookBudget(int seconds) {
        assertThrows(IllegalStateException.class, () -> new JdbcAppointmentRepository(
                mock(JdbcClient.class), new ObjectMapper(), mock(DataSource.class), 2, seconds));
    }

    @Test
    void createAndReadDoNotChangeNetworkBudgetAndGlobalHealthConfigurationStaysShort() throws Exception {
        try (var fixture = new Fixture(15)) {
            doReturn(Optional.of(fixture.id)).when(fixture.repository).replayed(any(), anyString());
            var draft = new Appointment.Draft(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), Instant.now(), null);
            fixture.repository.create(draft, "actor", UUID.randomUUID());
            fixture.repository.get(fixture.id);
            verify(fixture.connection, never()).setNetworkTimeout(any(), anyInt());
        }
        var properties = new Properties();
        try (var input = getClass().getResourceAsStream("/application.properties")) {
            properties.load(input);
        }
        assertTrue(properties.getProperty("spring.datasource.url").contains("socketTimeout=2"));
        assertEquals("1000", properties.getProperty("spring.datasource.hikari.connection-timeout"));
        assertEquals("1000", properties.getProperty("spring.datasource.hikari.validation-timeout"));
    }

    @Test
    void unsupportedDriverBudgetFailsAndStillReleasesUnboundConnection() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.getNetworkTimeout()).thenThrow(new java.sql.SQLFeatureNotSupportedException());
        var repository = new JdbcAppointmentRepository(mock(JdbcClient.class), new ObjectMapper(), source, 2, 15);
        assertThrows(org.springframework.dao.DataAccessResourceFailureException.class,
                () -> repository.cancel(UUID.randomUUID(), "reason", 1, "actor", UUID.randomUUID()));
        verify(connection).close();
    }

    private static final class Fixture implements AutoCloseable {
        final DataSource source = mock(DataSource.class);
        final Connection connection = mock(Connection.class);
        final JdbcClient jdbc = mock(JdbcClient.class);
        final UUID id = UUID.randomUUID();
        final Appointment appointment = mock(Appointment.class);
        final List<String> locks = new ArrayList<>();
        final JdbcAppointmentRepository repository;
        int budget = 2000;

        @SuppressWarnings({"unchecked", "rawtypes"})
        Fixture(int seconds) throws Exception {
            when(connection.getNetworkTimeout()).thenAnswer(call -> budget);
            doAnswer(call -> { budget = call.getArgument(1); return null; })
                    .when(connection).setNetworkTimeout(any(), anyInt());
            repository = spy(new JdbcAppointmentRepository(jdbc, new ObjectMapper(), source, 2, seconds));
            doReturn(appointment).when(repository).get(id);
            when(appointment.version()).thenReturn(1);
            when(appointment.status()).thenReturn("scheduled");
            var statement = mock(JdbcClient.StatementSpec.class, RETURNS_SELF);
            var result = mock(JdbcClient.MappedQuerySpec.class);
            when(jdbc.sql(contains("FOR UPDATE"))).thenAnswer(call -> {
                assertEquals((seconds + 5) * 1000, budget);
                locks.add("row");
                return statement;
            });
            when(statement.query(Boolean.class)).thenReturn(result);
            when(result.optional()).thenReturn(Optional.of(true));
            TransactionSynchronizationManager.bindResource(source, new ConnectionHolder(connection));
        }

        void mutate(String action) {
            if (action.equals("cancel")) repository.cancel(id, "reason", 1, "actor", UUID.randomUUID());
            else repository.reschedule(id, Instant.now(), null, 1, "actor", UUID.randomUUID());
        }

        void assertRestored(int expected) throws Exception {
            assertEquals(2000, budget);
            var order = inOrder(connection);
            order.verify(connection).setNetworkTimeout(any(), eq(expected));
            order.verify(connection).setNetworkTimeout(any(), eq(2000));
            verify(connection, never()).close();
            verifyNoInteractions(source);
        }

        public void close() {
            TransactionSynchronizationManager.unbindResource(source);
        }
    }

    @Test
    void restoresBoundConnectionBudgetAfterReplay() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        when(connection.getNetworkTimeout()).thenReturn(2000);
        var jdbc = mock(JdbcClient.class);
        var repository = spy(new JdbcAppointmentRepository(jdbc, new ObjectMapper(), source, 2, 15));
        var id = UUID.randomUUID();
        var appointment = mock(Appointment.class);
        doReturn(Optional.of(id)).when(repository).replayed(any(), anyString());
        doReturn(appointment).when(repository).get(id);
        TransactionSynchronizationManager.bindResource(source, new ConnectionHolder(connection));
        try {
            repository.cancel(id, "reason", 1, "actor", UUID.randomUUID());
            var order = inOrder(connection);
            order.verify(connection).setNetworkTimeout(any(), eq(20000));
            order.verify(connection).setNetworkTimeout(any(), eq(2000));
            verify(connection, never()).close();
            verifyNoInteractions(source);
        } finally {
            TransactionSynchronizationManager.unbindResource(source);
        }
    }
}
