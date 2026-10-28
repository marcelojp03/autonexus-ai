package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageReceptions;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Reception;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/** CU11 REST surface. */
@RestController
@RequestMapping("/receptions")
public class ReceptionController {
    public record ReceptionResult(Reception reception, boolean replayed) {
        static ReceptionResult from(Mutation<Reception> mutation) {
            return new ReceptionResult(mutation.value(), mutation.replayed());
        }
    }

    private final ManageReceptions receptions;

    public ReceptionController(ManageReceptions receptions) {
        this.receptions = receptions;
    }

    @GetMapping
    public Page<Reception> list(@RequestParam(required = false) String limit,
                                @RequestParam(required = false) String offset,
                                @RequestParam(required = false) String vehicleId,
                                @RequestParam(required = false) String open) {
        return receptions.list(limit, offset, vehicleId, open);
    }

    @GetMapping("/{id}")
    public Reception get(@PathVariable String id) {
        return receptions.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ReceptionResult create(@RequestBody Map<String, Object> body, JwtAuthenticationToken authentication) {
        return ReceptionResult.from(receptions.create(body, authentication.getToken().getSubject()));
    }
}
