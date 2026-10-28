package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageWorkOrders;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.WorkOrder;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/** CU12 REST surface. */
@RestController
@RequestMapping("/orders")
public class WorkOrderController {
    public record WorkOrderResult(WorkOrder order, boolean replayed) {
        static WorkOrderResult from(Mutation<WorkOrder> mutation) {
            return new WorkOrderResult(mutation.value(), mutation.replayed());
        }
    }

    private final ManageWorkOrders orders;

    public WorkOrderController(ManageWorkOrders orders) {
        this.orders = orders;
    }

    @GetMapping
    public Page<WorkOrder> list(@RequestParam(required = false) String limit,
                                @RequestParam(required = false) String offset,
                                @RequestParam(required = false) String status,
                                @RequestParam(required = false) String customerId,
                                @RequestParam(required = false) String vehicleId) {
        return orders.list(limit, offset, status, customerId, vehicleId);
    }

    @GetMapping("/{id}")
    public WorkOrder get(@PathVariable String id) {
        return orders.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WorkOrderResult create(@RequestBody Map<String, Object> body, JwtAuthenticationToken authentication) {
        return WorkOrderResult.from(orders.create(body, authentication.getToken().getSubject()));
    }
}
