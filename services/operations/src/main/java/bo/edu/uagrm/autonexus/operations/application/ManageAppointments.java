package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Appointment;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** CU10 use cases: reception schedules, reschedules and cancels appointments. */
@Service
public class ManageAppointments {
    private static final int MAX_PAGE = 100;

    private final AppointmentRepository repository;

    public ManageAppointments(AppointmentRepository repository) {
        this.repository = repository;
    }

    public Page<Appointment> list(String limit, String offset, String from, String to, String status,
                                  String customerId, String vehicleId) {
        int size = queryInt(limit, 20, 1, MAX_PAGE);
        int skip = queryInt(offset, 0, 0, Integer.MAX_VALUE);
        String normalizedStatus = status == null || status.isBlank() ? null : status.trim();
        if (normalizedStatus != null && !normalizedStatus.equals("scheduled") && !normalizedStatus.equals("cancelled")) {
            throw OperationsError.invalid();
        }
        Instant fromInstant = from == null || from.isBlank() ? null : Validation.instant(from);
        Instant toInstant = to == null || to.isBlank() ? null : Validation.instant(to);
        if (fromInstant != null && toInstant != null && !fromInstant.isBefore(toInstant)) throw OperationsError.invalid();
        UUID customer = customerId == null || customerId.isBlank() ? null : Validation.uuid(customerId);
        UUID vehicle = vehicleId == null || vehicleId.isBlank() ? null : Validation.uuid(vehicleId);
        return repository.list(fromInstant, toInstant, normalizedStatus, customer, vehicle, size, skip);
    }

    public Appointment get(String id) {
        return repository.get(Validation.uuid(id));
    }

    public Mutation<Appointment> create(Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Appointment.CREATE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        return repository.create(Appointment.Draft.from(body), actor, operationId);
    }

    public Mutation<Appointment> reschedule(String id, Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Appointment.RESCHEDULE_KEYS);
        UUID appointmentId = Validation.uuid(id);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        Instant startsAt = Validation.instant(body.get("startsAt"));
        String notes = Validation.optionalText(body.get("notes"), 500);
        return repository.reschedule(appointmentId, startsAt, notes, expectedVersion, actor, operationId);
    }

    public Mutation<Appointment> cancel(String id, Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Appointment.CANCEL_KEYS);
        UUID appointmentId = Validation.uuid(id);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        String reason = Validation.text(body.get("reason"), 1, 200);
        return repository.cancel(appointmentId, reason, expectedVersion, actor, operationId);
    }

    private static int queryInt(String value, int fallback, int min, int max) {
        if (value == null || value.isBlank()) return fallback;
        try {
            return Validation.pageInt(Integer.valueOf(value.trim()), fallback, min, max);
        } catch (NumberFormatException error) {
            throw OperationsError.invalid();
        }
    }
}
