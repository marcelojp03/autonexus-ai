package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.ServiceOffering;
import java.util.UUID;

/** Port to the owner database for CU09. */
public interface ServiceRepository {
    Page<ServiceOffering> list(Boolean active, String search, int limit, int offset);

    ServiceOffering get(UUID id);

    Mutation<ServiceOffering> create(ServiceOffering.Draft draft, String actor, UUID operationId);

    Mutation<ServiceOffering> update(UUID id, ServiceOffering.Draft draft, int expectedVersion, String actor, UUID operationId);

    Mutation<ServiceOffering> deactivate(UUID id, int expectedVersion, String actor, UUID operationId);
}
