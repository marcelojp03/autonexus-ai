package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import bo.edu.uagrm.autonexus.operations.domain.WorkOrder;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** CU12 use cases: a reception becomes a work order pending quotation. */
@Service
public class ManageWorkOrders {
    private static final int MAX_PAGE = 100;

    private final WorkOrderRepository repository;

    public ManageWorkOrders(WorkOrderRepository repository) {
        this.repository = repository;
    }

    public Page<WorkOrder> list(String limit, String offset, String status, String customerId, String vehicleId) {
        int size = queryInt(limit, 20, 1, MAX_PAGE);
        int skip = queryInt(offset, 0, 0, Integer.MAX_VALUE);
        String normalizedStatus = status == null || status.isBlank() ? null : status.trim();
        if (normalizedStatus != null && !normalizedStatus.matches("pending_quote|quote_requested|quote_approved|cancelled|confirmation_pending|confirmed")) {
            throw OperationsError.invalid();
        }
        UUID customer = customerId == null || customerId.isBlank() ? null : Validation.uuid(customerId);
        UUID vehicle = vehicleId == null || vehicleId.isBlank() ? null : Validation.uuid(vehicleId);
        return repository.list(normalizedStatus, customer, vehicle, size, skip);
    }

    public WorkOrder get(String id) {
        return repository.get(Validation.uuid(id));
    }

    public Mutation<WorkOrder> create(Map<String, Object> body, String actor) {
        Validation.onlyKeys(body, WorkOrder.CREATE_KEYS);
        UUID operationId = Validation.uuid(body.get("operationId"));
        return repository.create(WorkOrder.Draft.from(body), actor, operationId);
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
