package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.AppointmentRequest;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ManageAppointmentRequests {
    private static final Set<String> CREATE_KEYS = Set.of("operationId", "clientId", "customerId", "vehicleId", "serviceId", "startsAt", "timeZone", "notes");
    private static final Set<String> APPROVE_KEYS = Set.of("startsAt");
    private static final Set<String> REJECT_KEYS = Set.of("reason");
    private final AppointmentRequestRepository requests;

    public ManageAppointmentRequests(AppointmentRequestRepository requests) {
        this.requests = requests;
    }

    public Mutation<AppointmentRequest> create(Map<String, Object> body, String requester) {
        Validation.onlyKeys(body, CREATE_KEYS);
        String clientId = Validation.text(body.get("clientId"), 1, 200);
        if (!clientId.matches("[A-Za-z0-9._:-]+")) throw OperationsError.invalid();
        String zone = Validation.text(body.get("timeZone"), 1, 64);
        String requested = Validation.text(body.get("startsAt"), 1, 64);
        Instant startsAt = Validation.instant(requested);
        try {
            var dateTime = OffsetDateTime.parse(requested);
            if (!ZoneId.of(zone).getRules().getValidOffsets(dateTime.toLocalDateTime()).contains(dateTime.getOffset())) {
                throw OperationsError.invalid();
            }
        } catch (RuntimeException error) { throw OperationsError.invalid(); }
        return requests.create(Validation.uuid(body.get("operationId")), clientId, requester,
                Validation.uuid(body.get("customerId")), Validation.uuid(body.get("vehicleId")),
                Validation.uuid(body.get("serviceId")), startsAt,
                zone, Validation.optionalText(body.get("notes"), 500));
    }

    public AppointmentRequest byOperation(String operationId, String clientId, String requester) {
        String validatedClient = Validation.text(clientId, 1, 200);
        if (!validatedClient.matches("[A-Za-z0-9._:-]+")) throw OperationsError.invalid();
        return requests.byOperation(Validation.uuid(operationId), validatedClient, requester);
    }
    public Page<AppointmentRequest> pending(String limit, String offset) {
        return requests.pending(queryInt(limit, 20, 1, 100), queryInt(offset, 0, 0, Integer.MAX_VALUE));
    }

    public Mutation<AppointmentRequest> approve(String operationId, Map<String, Object> body, String reviewer) {
        Validation.onlyKeys(body, APPROVE_KEYS);
        return requests.approve(Validation.uuid(operationId), Validation.instant(body.get("startsAt")), reviewer);
    }

    public Mutation<AppointmentRequest> reject(String operationId, Map<String, Object> body, String reviewer) {
        Validation.onlyKeys(body, REJECT_KEYS);
        return requests.reject(Validation.uuid(operationId), Validation.text(body.get("reason"), 1, 300), reviewer);
    }

    private static int queryInt(String value, int fallback, int min, int max) {
        if (value == null || value.isBlank()) return fallback;
        try { return Validation.pageInt(Integer.valueOf(value.trim()), fallback, min, max); }
        catch (NumberFormatException error) { throw OperationsError.invalid(); }
    }
}
