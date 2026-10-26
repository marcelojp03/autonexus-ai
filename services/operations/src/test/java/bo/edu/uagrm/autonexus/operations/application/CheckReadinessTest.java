package bo.edu.uagrm.autonexus.operations.application;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CheckReadinessTest {
    @Test
    void reflectsAvailableDatabase() {
        assertTrue(new CheckReadiness(() -> true).execute());
    }

    @Test
    void reflectsUnavailableDatabase() {
        assertFalse(new CheckReadiness(() -> false).execute());
    }

    @Test
    void checksAgainAfterRecovery() {
        var available = new java.util.concurrent.atomic.AtomicBoolean(false);
        var readiness = new CheckReadiness(available::get);
        assertFalse(readiness.execute());
        available.set(true);
        assertTrue(readiness.execute());
    }
}
