package bo.edu.uagrm.autonexus.operations.infrastructure.config;

import bo.edu.uagrm.autonexus.operations.application.CheckReadiness;
import bo.edu.uagrm.autonexus.operations.application.DatabaseAvailability;
import bo.edu.uagrm.autonexus.operations.infrastructure.health.OperationsDatabaseHealthIndicator;
import bo.edu.uagrm.autonexus.operations.infrastructure.jdbc.JdbcDatabaseAvailability;
import javax.sql.DataSource;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
public class AvailabilityConfiguration {
    @Bean
    static BeanFactoryPostProcessor validateDatabaseEnvironment(Environment environment) {
        return beanFactory -> {
            var password = environment.getProperty("DB_PASSWORD");
            if (password == null || password.isBlank()) {
                throw new IllegalStateException("Missing configuration: DB_PASSWORD");
            }
        };
    }

    @Bean
    DatabaseAvailability databaseAvailability(DataSource dataSource) {
        return new JdbcDatabaseAvailability(dataSource);
    }

    @Bean
    CheckReadiness checkReadiness(DatabaseAvailability database) {
        return new CheckReadiness(database);
    }

    @Bean
    OperationsDatabaseHealthIndicator operationsDatabaseHealthIndicator(CheckReadiness checkReadiness) {
        return new OperationsDatabaseHealthIndicator(checkReadiness);
    }
}
