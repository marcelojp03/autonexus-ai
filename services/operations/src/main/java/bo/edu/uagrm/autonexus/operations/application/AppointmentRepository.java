package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Appointment;
import java.time.Instant;
import java.util.UUID;

/** Port to the owner database for CU10. */
public interface AppointmentRepository {
    Page<Appointment> list(Instant from, Instant to, String status, UUID customerId, UUID vehicleId, int limit, int offset);

    Appointment get(UUID id);

    Mutation<Appointment> create(Appointment.Draft draft, String actor, UUID operationId);

    Mutation<Appointment> reschedule(UUID id, Instant startsAt, String notes, int expectedVersion, String actor, UUID operationId);

    Mutation<Appointment> cancel(UUID id, String reason, int expectedVersion, String actor, UUID operationId);
}
