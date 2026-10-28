package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Vehicle;
import java.util.UUID;

/** Port to the owner database for CU07. */
public interface VehicleRepository {
    Page<Vehicle> list(String status, UUID customerId, String search, int limit, int offset);

    Vehicle get(UUID id);

    Mutation<Vehicle> create(Vehicle.Draft draft, String actor, UUID operationId);

    Mutation<Vehicle> update(UUID id, Vehicle.Draft draft, int expectedVersion, String actor, UUID operationId);

    Mutation<Vehicle> deactivate(UUID id, int expectedVersion, String actor, UUID operationId);
}
