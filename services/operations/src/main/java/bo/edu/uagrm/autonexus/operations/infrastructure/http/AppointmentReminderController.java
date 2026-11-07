package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.infrastructure.cu28.AppointmentReminders;
import java.util.List;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AppointmentReminderController {
    private final AppointmentReminders reminders;
    private final bo.edu.uagrm.autonexus.operations.infrastructure.security.EmployeePermissionsClient permissions;

    public AppointmentReminderController(AppointmentReminders reminders,
            bo.edu.uagrm.autonexus.operations.infrastructure.security.EmployeePermissionsClient permissions) {
        this.reminders = reminders;
        this.permissions = permissions;
    }

    public record Result(List<AppointmentReminders.EventReference> events) {}

    @PostMapping("/automations/appointments/reminders")
    public Result create(JwtAuthenticationToken authentication) {
        var employeeId = permissions.requireBoundEmployee(authentication.getToken().getTokenValue(), "appointments:read");
        return new Result(reminders.create(employeeId.toString()));
    }
}
