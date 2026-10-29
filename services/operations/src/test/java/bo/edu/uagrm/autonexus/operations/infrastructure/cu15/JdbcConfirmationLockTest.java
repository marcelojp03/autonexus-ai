package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import java.sql.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class JdbcConfirmationLockTest {
    @Test void jdbcClientConsumesTheAdvisoryLockResultWithoutANullExtractor() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet result = mock(ResultSet.class);
        ResultSetMetaData metadata = mock(ResultSetMetaData.class);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(result);
        when(result.getMetaData()).thenReturn(metadata);
        when(metadata.getColumnCount()).thenReturn(1);
        when(result.next()).thenReturn(true, false);
        when(result.getBoolean(1)).thenReturn(true);
        var repository = new JdbcConfirmationRepository(JdbcClient.create(new SingleConnectionDataSource(connection, true)), mock(TransactionTemplate.class), mock(CanonicalJson.class));
        var method = JdbcConfirmationRepository.class.getDeclaredMethod("lockOperation", UUID.class);
        method.setAccessible(true);
        var operation = UUID.randomUUID();
        assertThatCode(() -> method.invoke(repository, operation)).doesNotThrowAnyException();
        verify(statement).setString(1, operation.toString());
    }
}
