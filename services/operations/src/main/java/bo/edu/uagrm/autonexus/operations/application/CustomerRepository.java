package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Customer;
import java.util.UUID;

/** Port to the owner database. Nothing here crosses into another service's schema. */
public interface CustomerRepository {
    Page<Customer> list(String status, String search, int limit, int offset);

    Customer get(UUID id);

    Mutation<Customer> create(Customer.Draft draft, String actor, UUID operationId);

    Mutation<Customer> update(UUID id, Customer.Draft draft, int expectedVersion, String actor, UUID operationId);

    Mutation<Customer> deactivate(UUID id, int expectedVersion, String actor, UUID operationId);
}
