package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import java.sql.Connection;
import java.sql.Statement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class JdbcDatabaseAvailabilityTest {
    @Test
    void queriesAndClosesOwnedResources() throws Exception {
        var dataSource = mock(DataSource.class);
        var connection = mock(Connection.class);
        var statement = mock(Statement.class);
        var result = mock(ResultSet.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery("SELECT 1")).thenReturn(result);
        when(result.next()).thenReturn(true);
        when(result.getInt(1)).thenReturn(1);
        assertTrue(new JdbcDatabaseAvailability(dataSource).isAvailable());
        verify(statement).setQueryTimeout(1);
        verify(result).close();
        verify(statement).close();
        verify(connection).close();
    }

    @Test
    void failedConnectionIsSanitizedAndRecoveryIsRetried() throws Exception {
        var dataSource = mock(DataSource.class);
        var connection = mock(Connection.class);
        var statement = mock(Statement.class);
        var result = mock(ResultSet.class);
        when(dataSource.getConnection()).thenThrow(new SQLException("private-connection-details"))
                .thenReturn(connection);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery("SELECT 1")).thenReturn(result);
        when(result.next()).thenReturn(true);
        when(result.getInt(1)).thenReturn(1);
        var database = new JdbcDatabaseAvailability(dataSource);
        assertFalse(database.isAvailable());
        assertTrue(database.isAvailable());
    }

    @Test
    void failedQueryClosesResourcesAndReturnsUnavailable() throws Exception {
        var dataSource = mock(DataSource.class);
        var connection = mock(Connection.class);
        var statement = mock(Statement.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery("SELECT 1")).thenThrow(new SQLException("private-query-details"));
        assertFalse(new JdbcDatabaseAvailability(dataSource).isAvailable());
        verify(statement).close();
        verify(connection).close();
    }

    @Test
    void emptyResultIsNotReady() throws Exception {
        var dataSource = mock(DataSource.class);
        var connection = mock(Connection.class);
        var statement = mock(Statement.class);
        var result = mock(ResultSet.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery("SELECT 1")).thenReturn(result);
        assertFalse(new JdbcDatabaseAvailability(dataSource).isAvailable());
        verify(result).close();
    }
}
