package bo.edu.uagrm.autonexus.operations.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.WorkOrder;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ManageWorkOrdersTest {
    private final WorkOrderRepository repository = new StubOrders();
    private final ManageWorkOrders orders = new ManageWorkOrders(repository);

    private static Map<String, Object> body() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("operationId", UUID.randomUUID().toString());
        body.put("receptionId", UUID.randomUUID().toString());
        body.put("description", "Cambio de pastillas y discos delanteros");
        body.put("priority", "alta");
        body.put("services", List.of(Map.of("serviceId", UUID.randomUUID().toString(), "quantity", 1)));
        return body;
    }

    @Test
    void createsAnOrderPendingQuoteWithItsItems() {
        WorkOrder created = orders.create(body(), "actor").value();
        assertThat(created.status()).isEqualTo("pending_quote");
        assertThat(created.items()).hasSize(1);
        assertThat(created.number()).startsWith("WO-");
    }

    @Test
    void rejectsEmptyOrOversizedServiceLists() {
        Map<String, Object> empty = body();
        empty.put("services", List.of());
        assertThatThrownBy(() -> orders.create(empty, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> tooMany = body();
        List<Map<String, Object>> services = new ArrayList<>();
        for (int index = 0; index < 21; index++) {
            services.add(Map.of("serviceId", UUID.randomUUID().toString()));
        }
        tooMany.put("services", services);
        assertThatThrownBy(() -> orders.create(tooMany, "actor")).isInstanceOf(OperationsError.class);
    }

    @Test
    void rejectsUnknownPriorityDescriptionAndServiceFields() {
        Map<String, Object> priority = body();
        priority.put("priority", "critica");
        assertThatThrownBy(() -> orders.create(priority, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> description = body();
        description.put("description", "ab");
        assertThatThrownBy(() -> orders.create(description, "actor")).isInstanceOf(OperationsError.class);

        Map<String, Object> extra = body();
        extra.put("services", List.of(Map.of("serviceId", UUID.randomUUID().toString(), "price", 10)));
        assertThatThrownBy(() -> orders.create(extra, "actor"))
                .isInstanceOf(OperationsError.class)
                .extracting(error -> ((OperationsError) error).code())
                .isEqualTo("VALIDATION_ERROR");

        Map<String, Object> quantity = body();
        quantity.put("services", List.of(Map.of("serviceId", UUID.randomUUID().toString(), "quantity", 0)));
        assertThatThrownBy(() -> orders.create(quantity, "actor")).isInstanceOf(OperationsError.class);
    }

    @Test
    void validatesTheStatusFilter() {
        assertThatThrownBy(() -> orders.list(null, null, "invented", null, null)).isInstanceOf(OperationsError.class);
        assertThat(orders.list(null, null, "confirmed", null, null).limit()).isEqualTo(20);
        assertThat(orders.list(null, null, "confirmation_pending", null, null).limit()).isEqualTo(20);
        assertThat(orders.list(null, null, "pending_quote", null, null).limit()).isEqualTo(20);
    }

    private static final class StubOrders implements WorkOrderRepository {
        @Override
        public Page<WorkOrder> list(String status, UUID customerId, UUID vehicleId, int limit, int offset) {
            return new Page<>(List.of(), 0, limit, offset);
        }

        @Override
        public WorkOrder get(UUID id) {
            throw OperationsError.notFound("ORDER_NOT_FOUND");
        }

        @Override
        public Mutation<WorkOrder> create(WorkOrder.Draft draft, String actor, UUID operationId) {
            List<WorkOrder.Item> items = draft.services().stream()
                    .map(service -> new WorkOrder.Item(service.serviceId(), "Servicio", service.quantity(), 60,
                            new java.math.BigDecimal("100.00")))
                    .toList();
            return new Mutation<>(new WorkOrder(UUID.randomUUID(), "WO-2026-000001", draft.receptionId(), UUID.randomUUID(),
                    "ABC123", UUID.randomUUID(), "Cliente", draft.description(), draft.priority(), draft.notes(),
                    "pending_quote", 1, Instant.now(), Instant.now(), items), false);
        }
    }
}
