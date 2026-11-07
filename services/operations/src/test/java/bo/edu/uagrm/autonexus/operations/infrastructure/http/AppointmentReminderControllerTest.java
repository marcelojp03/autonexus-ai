package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.infrastructure.cu28.AppointmentReminders;
import bo.edu.uagrm.autonexus.operations.infrastructure.security.EmployeePermissionsClient;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AppointmentReminderControllerTest {
    private final AppointmentReminders reminders = mock(AppointmentReminders.class);
    private final EmployeePermissionsClient permissions = mock(EmployeePermissionsClient.class);
    private final AppointmentReminderController controller = new AppointmentReminderController(reminders, permissions);
    private final JwtAuthenticationToken auth = new JwtAuthenticationToken(new Jwt("delegated-bearer",
            Instant.EPOCH, Instant.now().plusSeconds(60), java.util.Map.of("alg", "RS256"),
            java.util.Map.of("sub", "human-subject")));

    @Test void returnsDeterministicReferencesUsingOwnerBoundEmployee() {
        UUID employeeId = UUID.randomUUID();
        var reference = new AppointmentReminders.EventReference(UUID.randomUUID(), UUID.randomUUID(), 9);
        when(permissions.requireBoundEmployee("delegated-bearer", "appointments:read")).thenReturn(employeeId);
        when(reminders.create(employeeId.toString())).thenReturn(List.of(reference));
        assertEquals(List.of(reference), controller.create(auth).events());
        verify(permissions).requireBoundEmployee("delegated-bearer", "appointments:read");
    }

    @Test void unboundOrTechnicalIdentityCannotCreateEvents() {
        when(permissions.requireBoundEmployee(anyString(), anyString()))
                .thenThrow(new OperationsError(403, "AUTOMATION_ACCESS_DENIED"));
        assertThrows(OperationsError.class, () -> controller.create(auth));
        verifyNoInteractions(reminders);
    }
}
