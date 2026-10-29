package bo.edu.uagrm.autonexus.operations.infrastructure.config;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TransportConfigurationTest {
    @Test void acceptsTrustedDnsAndExactOrigins() {
        assertEquals("http://employees:3002", TransportConfiguration.url("http://employees:3002", "EMPLOYEES_API_URL"));
        assertEquals("https://workshop.test", TransportConfiguration.origin("https://workshop.test"));
    }
    @Test void rejectsUnsafeTransport() {
        for (String value : new String[]{"http://u:p@employees", "http://employees?x=1", "http://employees#x", "http://employees?", "http://employees#", "file:///employees"}) {
            assertThrows(IllegalArgumentException.class, () -> TransportConfiguration.url(value, "DEPENDENCY"));
        }
        for (String value : new String[]{"*", "https://workshop.test/path", "https://workshop.test/", ""}) {
            assertThrows(IllegalArgumentException.class, () -> TransportConfiguration.origin(value));
        }
    }
    @Test void resolvesBindAndNativeJdbcTlsProperties() throws Exception {
        var properties = new java.util.Properties();
        try (var stream = getClass().getResourceAsStream("/application.properties")) { properties.load(stream); }
        var env = new org.springframework.mock.env.MockEnvironment().withProperty("user.home", "/home/synthetic");
        assertEquals("127.0.0.1", env.resolveRequiredPlaceholders(properties.getProperty("server.address")));
        assertEquals("disable", env.resolveRequiredPlaceholders(properties.getProperty("spring.datasource.hikari.data-source-properties.sslmode")));
        env.withProperty("HTTP_HOST", "0.0.0.0").withProperty("DB_SSLMODE", "verify-full").withProperty("DB_CA_FILE", "/run/certs/postgres.crt");
        assertEquals("0.0.0.0", env.resolveRequiredPlaceholders(properties.getProperty("server.address")));
        assertEquals("verify-full", env.resolveRequiredPlaceholders(properties.getProperty("spring.datasource.hikari.data-source-properties.sslmode")));
        assertEquals("/run/certs/postgres.crt", env.resolveRequiredPlaceholders(properties.getProperty("spring.datasource.hikari.data-source-properties.sslrootcert")));
    }
    @Test void acceptsOnlyVerifiedTlsOrExplicitDisable() {
        assertDoesNotThrow(() -> new PostgresTransportConfiguration("disable", ""));
        assertDoesNotThrow(() -> new PostgresTransportConfiguration("verify-full", ""));
        for (String value : new String[]{"prefer", "require", "verify-ca"}) {
            assertThrows(IllegalArgumentException.class, () -> new PostgresTransportConfiguration(value, ""));
        }
        assertThrows(IllegalArgumentException.class, () -> new PostgresTransportConfiguration("disable", "unused.crt"));
    }
}
