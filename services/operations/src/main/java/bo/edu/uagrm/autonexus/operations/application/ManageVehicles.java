package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import bo.edu.uagrm.autonexus.operations.domain.Vehicle;
import bo.edu.uagrm.autonexus.operations.domain.VehicleServiceHistory;
import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.EvidenceStorage;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** CU07 use cases: reception links vehicles to an existing customer. */
@Service
public class ManageVehicles {
    private static final int MAX_PAGE = 100;

    private final VehicleRepository repository;
    private final VehicleServiceHistoryRepository history;
    private final EvidenceStorage evidenceStorage;

    public ManageVehicles(VehicleRepository repository, VehicleServiceHistoryRepository history, EvidenceStorage evidenceStorage) {
        this.repository = repository;
        this.history = history;
        this.evidenceStorage = evidenceStorage;
    }

    public Page<VehicleServiceHistory.Entry> history(String id, String limit, String offset) {
        UUID vehicleId = Validation.uuid(id);
        int size = queryInt(limit, 20, 1, MAX_PAGE);
        int from = queryInt(offset, 0, 0, Integer.MAX_VALUE);
        return history.list(vehicleId, size, from);
    }

    public Page<VehicleServiceHistory.VehicleReference> historyVehicles(String search, String limit, String offset) {
        String term = search == null ? "" : search.trim();
        if (term.length() < 2 || term.length() > 100) throw OperationsError.invalid();
        return history.findVehicles(term, queryInt(limit, 20, 1, MAX_PAGE),
                queryInt(offset, 0, 0, Integer.MAX_VALUE));
    }

    public VehicleServiceHistory.Entry historyEntry(String id, String orderId) {
        return history.get(Validation.uuid(id), Validation.uuid(orderId));
    }

    public VehicleServiceHistory.EvidenceContent historyEvidence(String vehicleId, String orderId, String evidenceId) {
        var evidence = history.evidence(Validation.uuid(vehicleId), Validation.uuid(orderId), Validation.uuid(evidenceId))
                .orElseThrow(() -> OperationsError.notFound("SERVICE_HISTORY_EVIDENCE_NOT_FOUND"));
        if (!evidenceStorage.configured()) throw new OperationsError(503, "EVIDENCE_STORAGE_UNAVAILABLE");
        byte[] bytes = evidenceStorage.read(evidence.objectKey(), evidence.versionId());
        if (bytes.length != evidence.sizeBytes()) throw new OperationsError(503, "EVIDENCE_STORAGE_UNAVAILABLE");
        return new VehicleServiceHistory.EvidenceContent(evidence.fileName(), evidence.contentType(),
                bytes);
    }

    public Page<Vehicle> list(String limit, String offset, String status, String customerId, String search) {
        int size = queryInt(limit, 20, 1, MAX_PAGE);
        int from = queryInt(offset, 0, 0, Integer.MAX_VALUE);
        String normalizedStatus = status == null || status.isBlank() ? null : status.trim();
        if (normalizedStatus != null && !normalizedStatus.equals("active") && !normalizedStatus.equals("inactive")) {
            throw OperationsError.invalid();
        }
        UUID owner = customerId == null || customerId.isBlank() ? null : Validation.uuid(customerId);
        String term = search == null ? null : search.trim();
        if (term != null && term.length() > 100) throw OperationsError.invalid();
        return repository.list(normalizedStatus, owner, term == null || term.isEmpty() ? null : term, size, from);
    }

    public Vehicle get(String id) {
        return repository.get(Validation.uuid(id));
    }

    public Mutation<Vehicle> create(Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Vehicle.CREATE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        return repository.create(Vehicle.Draft.from(body), actor, operationId);
    }

    public Mutation<Vehicle> update(String id, Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, Vehicle.UPDATE_KEYS);
        UUID vehicleId = Validation.uuid(id);
        UUID operationId = Validation.uuid(body.get("operationId"));
        int expectedVersion = Validation.expectedVersion(body.get("expectedVersion"));
        return repository.update(vehicleId, Vehicle.Draft.from(body), expectedVersion, actor, operationId);
    }

    public Mutation<Vehicle> deactivate(String id, Map<String, Object> body, String actor) {
        UpdateCommand command = UpdateCommand.from(body);
        return repository.deactivate(Validation.uuid(id), command.expectedVersion(), actor, command.operationId());
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
