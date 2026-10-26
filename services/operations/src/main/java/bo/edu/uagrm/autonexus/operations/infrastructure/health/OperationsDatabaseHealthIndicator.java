package bo.edu.uagrm.autonexus.operations.infrastructure.health;

import bo.edu.uagrm.autonexus.operations.application.CheckReadiness;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;

public final class OperationsDatabaseHealthIndicator implements HealthIndicator {
    private final CheckReadiness checkReadiness;

    public OperationsDatabaseHealthIndicator(CheckReadiness checkReadiness) {
        this.checkReadiness = checkReadiness;
    }

    @Override
    public Health health() {
        return (checkReadiness.execute() ? Health.up() : Health.down()).build();
    }
}
