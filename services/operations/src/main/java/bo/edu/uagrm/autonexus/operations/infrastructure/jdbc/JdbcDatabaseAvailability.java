package bo.edu.uagrm.autonexus.operations.infrastructure.jdbc;

import bo.edu.uagrm.autonexus.operations.application.DatabaseAvailability;
import java.sql.SQLException;
import javax.sql.DataSource;

public final class JdbcDatabaseAvailability implements DatabaseAvailability {
    private final DataSource dataSource;

    public JdbcDatabaseAvailability(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public boolean isAvailable() {
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement()) {
            statement.setQueryTimeout(1);
            try (var result = statement.executeQuery("SELECT 1")) {
                return result.next() && result.getInt(1) == 1;
            }
        } catch (SQLException exception) {
            return false;
        }
    }
}
