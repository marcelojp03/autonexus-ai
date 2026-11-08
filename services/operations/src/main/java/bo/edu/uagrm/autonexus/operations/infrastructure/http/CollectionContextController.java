package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.CollectionContextRepository;
import bo.edu.uagrm.autonexus.operations.infrastructure.security.EmployeePermissionsClient;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

@RestController
public class CollectionContextController {
    private final CollectionContextRepository repository;
    private final EmployeePermissionsClient permissions;

    public CollectionContextController(CollectionContextRepository repository, EmployeePermissionsClient permissions) {
        this.repository = repository;
        this.permissions = permissions;
    }

    @GetMapping("/orders/{orderId}/collection-context")
    public CollectionContextRepository.Context get(@PathVariable UUID orderId, JwtAuthenticationToken actor) {
        permissions.requireBoundAnyPermission(actor.getToken().getTokenValue(), Set.of("payments:read", "payments:write"));
        return repository.get(orderId);
    }
}
