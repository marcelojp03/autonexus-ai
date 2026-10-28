package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageVehicles;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Vehicle;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/** CU07 REST surface. */
@RestController
@RequestMapping("/vehicles")
public class VehicleController {
    public record VehicleResult(Vehicle vehicle, boolean replayed) {
        static VehicleResult from(Mutation<Vehicle> mutation) {
            return new VehicleResult(mutation.value(), mutation.replayed());
        }
    }

    private final ManageVehicles vehicles;

    public VehicleController(ManageVehicles vehicles) {
        this.vehicles = vehicles;
    }

    @GetMapping
    public Page<Vehicle> list(@RequestParam(required = false) String limit,
                              @RequestParam(required = false) String offset,
                              @RequestParam(required = false) String status,
                              @RequestParam(required = false) String customerId,
                              @RequestParam(required = false) String search) {
        return vehicles.list(limit, offset, status, customerId, search);
    }

    @GetMapping("/{id}")
    public Vehicle get(@PathVariable String id) {
        return vehicles.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public VehicleResult create(@RequestBody Map<String, Object> body, JwtAuthenticationToken authentication) {
        return VehicleResult.from(vehicles.create(body, authentication.getToken().getSubject()));
    }

    @PutMapping("/{id}")
    public VehicleResult update(@PathVariable String id, @RequestBody Map<String, Object> body,
                                JwtAuthenticationToken authentication) {
        return VehicleResult.from(vehicles.update(id, body, authentication.getToken().getSubject()));
    }

    @PostMapping("/{id}/deactivate")
    public VehicleResult deactivate(@PathVariable String id, @RequestBody Map<String, Object> body,
                                    JwtAuthenticationToken authentication) {
        return VehicleResult.from(vehicles.deactivate(id, body, authentication.getToken().getSubject()));
    }
}
