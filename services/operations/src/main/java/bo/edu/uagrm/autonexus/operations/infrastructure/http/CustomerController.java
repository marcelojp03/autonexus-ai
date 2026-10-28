package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageCustomers;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Customer;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/** CU06 REST surface. Authorization is enforced by the security chain per method. */
@RestController
@RequestMapping("/customers")
public class CustomerController {
    public record CustomerResult(Customer customer, boolean replayed) {
        static CustomerResult from(Mutation<Customer> mutation) {
            return new CustomerResult(mutation.value(), mutation.replayed());
        }
    }

    private final ManageCustomers customers;

    public CustomerController(ManageCustomers customers) {
        this.customers = customers;
    }

    @GetMapping
    public Page<Customer> list(@RequestParam(required = false) String limit,
                               @RequestParam(required = false) String offset,
                               @RequestParam(required = false) String status,
                               @RequestParam(required = false) String search) {
        return customers.list(limit, offset, status, search);
    }

    @GetMapping("/{id}")
    public Customer get(@PathVariable String id) {
        return customers.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CustomerResult create(@RequestBody Map<String, Object> body, JwtAuthenticationToken authentication) {
        return CustomerResult.from(customers.create(body, authentication.getToken().getSubject()));
    }

    @PutMapping("/{id}")
    public CustomerResult update(@PathVariable String id, @RequestBody Map<String, Object> body,
                                 JwtAuthenticationToken authentication) {
        return CustomerResult.from(customers.update(id, body, authentication.getToken().getSubject()));
    }

    @PostMapping("/{id}/deactivate")
    public CustomerResult deactivate(@PathVariable String id, @RequestBody Map<String, Object> body,
                                     JwtAuthenticationToken authentication) {
        return CustomerResult.from(customers.deactivate(id, body, authentication.getToken().getSubject()));
    }
}
