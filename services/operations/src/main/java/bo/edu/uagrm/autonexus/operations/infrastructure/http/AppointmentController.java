package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageAppointments;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Appointment;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/** CU10 REST surface. An appointment is not a work order nor a mechanic assignment. */
@RestController
@RequestMapping("/appointments")
public class AppointmentController {
    public record AppointmentResult(Appointment appointment, boolean replayed) {
        static AppointmentResult from(Mutation<Appointment> mutation) {
            return new AppointmentResult(mutation.value(), mutation.replayed());
        }
    }

    private final ManageAppointments appointments;

    public AppointmentController(ManageAppointments appointments) {
        this.appointments = appointments;
    }

    @GetMapping
    public Page<Appointment> list(@RequestParam(required = false) String limit,
                                  @RequestParam(required = false) String offset,
                                  @RequestParam(required = false) String from,
                                  @RequestParam(required = false) String to,
                                  @RequestParam(required = false) String status,
                                  @RequestParam(required = false) String customerId,
                                  @RequestParam(required = false) String vehicleId) {
        return appointments.list(limit, offset, from, to, status, customerId, vehicleId);
    }

    @GetMapping("/{id}")
    public Appointment get(@PathVariable String id) {
        return appointments.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AppointmentResult create(@RequestBody Map<String, Object> body, JwtAuthenticationToken authentication) {
        return AppointmentResult.from(appointments.create(body, authentication.getToken().getSubject()));
    }

    @PutMapping("/{id}")
    public AppointmentResult reschedule(@PathVariable String id, @RequestBody Map<String, Object> body,
                                        JwtAuthenticationToken authentication) {
        return AppointmentResult.from(appointments.reschedule(id, body, authentication.getToken().getSubject()));
    }

    @PostMapping("/{id}/cancel")
    public AppointmentResult cancel(@PathVariable String id, @RequestBody Map<String, Object> body,
                                    JwtAuthenticationToken authentication) {
        return AppointmentResult.from(appointments.cancel(id, body, authentication.getToken().getSubject()));
    }
}
