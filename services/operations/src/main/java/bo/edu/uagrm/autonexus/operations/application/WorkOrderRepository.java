package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.WorkOrder;
import java.util.UUID;

/** Port to the owner database for CU12. */
public interface WorkOrderRepository {
    Page<WorkOrder> list(String status, UUID customerId, UUID vehicleId, int limit, int offset);

    WorkOrder get(UUID id);

    Mutation<WorkOrder> create(WorkOrder.Draft draft, String actor, UUID operationId);
}
