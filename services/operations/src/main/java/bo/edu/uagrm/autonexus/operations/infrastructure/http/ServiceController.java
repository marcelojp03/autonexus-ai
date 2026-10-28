package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageServices;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.ServiceOffering;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/** CU09 REST surface. */
@RestController
@RequestMapping("/services")
public class ServiceController {
    public record ServiceResult(ServiceOffering service, boolean replayed) {
        static ServiceResult from(Mutation<ServiceOffering> mutation) {
            return new ServiceResult(mutation.value(), mutation.replayed());
        }
    }

    private final ManageServices services;

    public ServiceController(ManageServices services) {
        this.services = services;
    }

    @GetMapping
    public Page<ServiceOffering> list(@RequestParam(required = false) String limit,
                              @RequestParam(required = false) String offset,
                              @RequestParam(required = false) String active,
                              @RequestParam(required = false) String search) {
        return services.list(limit, offset, active, search);
    }

    @GetMapping("/{id}")
    public ServiceOffering get(@PathVariable String id) {
        return services.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceResult create(@RequestBody Map<String, Object> body, JwtAuthenticationToken authentication) {
        return ServiceResult.from(services.create(body, authentication.getToken().getSubject()));
    }

    @PutMapping("/{id}")
    public ServiceResult update(@PathVariable String id, @RequestBody Map<String, Object> body,
                                JwtAuthenticationToken authentication) {
        return ServiceResult.from(services.update(id, body, authentication.getToken().getSubject()));
    }

    @PostMapping("/{id}/deactivate")
    public ServiceResult deactivate(@PathVariable String id, @RequestBody Map<String, Object> body,
                                    JwtAuthenticationToken authentication) {
        return ServiceResult.from(services.deactivate(id, body, authentication.getToken().getSubject()));
    }
}
