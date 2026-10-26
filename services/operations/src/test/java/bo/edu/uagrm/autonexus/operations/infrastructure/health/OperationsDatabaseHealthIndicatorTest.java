package bo.edu.uagrm.autonexus.operations.infrastructure.health;

import bo.edu.uagrm.autonexus.operations.application.CheckReadiness;
import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Status;
import static org.junit.jupiter.api.Assertions.*;

class OperationsDatabaseHealthIndicatorTest {
    @Test
    void reportsUpWithoutDetails() {
        var health = new OperationsDatabaseHealthIndicator(new CheckReadiness(() -> true)).health();
        assertEquals(Status.UP, health.getStatus());
        assertTrue(health.getDetails().isEmpty());
    }

    @Test
    void reportsDownWithoutDetails() {
        var health = new OperationsDatabaseHealthIndicator(new CheckReadiness(() -> false)).health();
        assertEquals(Status.DOWN, health.getStatus());
        assertTrue(health.getDetails().isEmpty());
    }
}
