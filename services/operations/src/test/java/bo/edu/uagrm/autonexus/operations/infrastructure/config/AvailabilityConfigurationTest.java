package bo.edu.uagrm.autonexus.operations.infrastructure.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.mock.env.MockEnvironment;

class AvailabilityConfigurationTest {
    @Test
    void rejectsMissingPasswordWithoutConnectionDetails() {
        try (var context = contextWithPassword(null)) {
            var failure = assertThrows(IllegalStateException.class, context::refresh);
            assertEquals("Missing configuration: DB_PASSWORD", failure.getMessage());
        }
    }

    @Test
    void rejectsBlankPasswordWithoutConnectionDetails() {
        try (var context = contextWithPassword("   ")) {
            var failure = assertThrows(IllegalStateException.class, context::refresh);
            assertEquals("Missing configuration: DB_PASSWORD", failure.getMessage());
        }
    }

    @Test
    void acceptsExplicitSyntheticConfigurationWithoutOpeningDatabase() {
        try (var context = contextWithPassword("non-secret-unit-test-value")) {
            assertDoesNotThrow(context::refresh);
        }
    }

    private AnnotationConfigApplicationContext contextWithPassword(String password) {
        var environment = new MockEnvironment();
        if (password != null) environment.setProperty("DB_PASSWORD", password);
        var context = new AnnotationConfigApplicationContext();
        context.setEnvironment(environment);
        context.registerBean(DataSource.class, () -> mock(DataSource.class));
        context.register(AvailabilityConfiguration.class);
        return context;
    }
}
