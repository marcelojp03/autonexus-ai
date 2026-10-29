package bo.edu.uagrm.autonexus.operations.infrastructure.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class PostgresTransportConfiguration {
    public PostgresTransportConfiguration(@Value("${DB_SSLMODE:disable}") String mode, @Value("${DB_CA_FILE:}") String ca) {
        if (!mode.equals("disable") && !mode.equals("verify-full")) throw new IllegalArgumentException("Invalid configuration: DB_SSLMODE");
        if (!ca.isEmpty() && (!mode.equals("verify-full") || !java.nio.file.Files.isRegularFile(java.nio.file.Path.of(ca)) || !java.nio.file.Files.isReadable(java.nio.file.Path.of(ca)))) throw new IllegalArgumentException("Invalid configuration: DB_CA_FILE");
    }
}
