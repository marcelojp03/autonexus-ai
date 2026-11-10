package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.VehicleServiceHistory;
import java.util.UUID;
import java.util.Optional;

/** Read port for the Operations-owned vehicle service history. */
public interface VehicleServiceHistoryRepository {
    Page<VehicleServiceHistory.VehicleReference> findVehicles(String search, int limit, int offset);
    Page<VehicleServiceHistory.Entry> list(UUID vehicleId, int limit, int offset);
    VehicleServiceHistory.Entry get(UUID vehicleId, UUID orderId);
    Optional<VehicleServiceHistory.StorageEvidence> evidence(UUID vehicleId, UUID orderId, UUID evidenceId);
}
