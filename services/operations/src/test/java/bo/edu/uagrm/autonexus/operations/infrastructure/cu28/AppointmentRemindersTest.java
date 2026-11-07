package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AppointmentRemindersTest {
    @Test void nextDayUsesLaPazInsteadOfUtcDate() {
        var window = AppointmentReminders.window(Instant.parse("2026-11-08T02:00:00Z"), 48);
        assertEquals(Instant.parse("2026-11-08T04:00:00Z"), window.from());
        assertEquals(Instant.parse("2026-11-09T04:00:00Z"), window.to());
    }

    @Test void horizonIsComputedFromServerInstant() {
        var now = Instant.parse("2026-11-08T02:00:00Z");
        assertEquals(now.plusSeconds(12 * 3600), AppointmentReminders.window(now, 12).horizon());
    }

    @Test void configurationRejectsUnboundedOrNonpositiveHorizon() {
        assertThrows(IllegalArgumentException.class, () -> new AppointmentReminders(null, null, null, 0));
        assertThrows(IllegalArgumentException.class, () -> new AppointmentReminders(null, null, null, 169));
    }

    @Test void eventIdentityIncludesTypeOwnerAndActualVersion() {
        UUID owner = UUID.randomUUID();
        UUID id = AutomationEvents.id(AutomationEvents.REMINDER, owner, 7);
        assertEquals(id, AutomationEvents.id(AutomationEvents.REMINDER, owner, 7));
        assertNotEquals(id, AutomationEvents.id(AutomationEvents.REMINDER, owner, 8));
        assertNotEquals(id, AutomationEvents.id(AutomationEvents.ASSIGNMENT, owner, 7));
    }

    @Test void envelopeSeparatesSchemaAndAggregateVersions() {
        UUID owner = UUID.randomUUID();
        var data = Map.<String, Object>of("status", "scheduled", "version", 7);
        var event = AutomationEvents.envelope(AutomationEvents.REMINDER, "appointment", owner, 7,
                owner, owner, Instant.parse("2026-11-08T02:00:00Z"), owner.toString(), data);
        assertEquals(1, event.get("schemaVersion"));
        assertEquals(7L, event.get("aggregateVersion"));
        assertEquals(owner.toString(), event.get("aggregateId"));
        assertEquals(data, event.get("data"));
    }
}
