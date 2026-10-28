package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Reception;
import java.util.UUID;

/** Port to the owner database for CU11. */
public interface ReceptionRepository {
    Page<Reception> list(UUID vehicleId, Boolean open, int limit, int offset);

    Reception get(UUID id);

    Mutation<Reception> create(Reception.Draft draft, String actor, UUID operationId);
}
