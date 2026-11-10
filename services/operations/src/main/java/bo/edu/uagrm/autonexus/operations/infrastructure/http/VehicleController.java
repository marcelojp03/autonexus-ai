package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageVehicles;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.Vehicle;
import bo.edu.uagrm.autonexus.operations.domain.VehicleServiceHistory;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

    /** CU08 minimal vehicle picker; intentionally excludes customer and owner details. */
    @GetMapping("/service-history/vehicles")
    public Page<VehicleServiceHistory.VehicleReference> historyVehicles(
            @RequestParam String search,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String offset) {
        return vehicles.historyVehicles(search, limit, offset);
    }

    @GetMapping("/{id}/service-history")
    public Page<VehicleServiceHistory.Entry> history(@PathVariable String id,
            @RequestParam(required = false) String limit, @RequestParam(required = false) String offset) {
        return vehicles.history(id, limit, offset);
    }

    @GetMapping("/{id}/service-history/{orderId}")
    public VehicleServiceHistory.Entry historyEntry(@PathVariable String id, @PathVariable String orderId) {
        return vehicles.historyEntry(id, orderId);
    }

    @GetMapping("/{id}/service-history/{orderId}/evidence/{evidenceId}")
    public ResponseEntity<byte[]> historyEvidence(@PathVariable String id, @PathVariable String orderId,
            @PathVariable String evidenceId) {
        var content = vehicles.historyEvidence(id, orderId, evidenceId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(content.fileName(), java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .contentType(MediaType.parseMediaType(content.contentType()))
                .body(content.bytes());
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
