package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageAppointmentRequests;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.application.Page;
import bo.edu.uagrm.autonexus.operations.domain.AppointmentRequest;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/appointment-requests")
public class AppointmentRequestController {
    public record Result(AppointmentRequest request, boolean replayed) {
        static Result from(Mutation<AppointmentRequest> value) { return new Result(value.value(), value.replayed()); }
    }
    private final ManageAppointmentRequests requests;
    private final String mcpAssertionSecret;
    public AppointmentRequestController(ManageAppointmentRequests requests,
            @Value("${MCP_CLIENT_ASSERTION_SECRET:}") String mcpAssertionSecret) {
        this.requests = requests; this.mcpAssertionSecret = mcpAssertionSecret;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Result create(@RequestBody Map<String, Object> body, JwtAuthenticationToken actor,
            @RequestHeader(name = "X-AutoNexus-MCP-Assertion", required = false) String assertion) {
        verifyMcpAssertion(body, actor.getToken().getSubject(), assertion);
        return Result.from(requests.create(body, actor.getToken().getSubject()));
    }

    private void verifyMcpAssertion(Map<String, Object> body, String subject, String assertion) {
        if (mcpAssertionSecret == null || mcpAssertionSecret.length() < 32) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
        }
        Object rawClientId = body == null ? null : body.get("clientId");
        Object rawOperationId = body == null ? null : body.get("operationId");
        if (!(rawClientId instanceof String clientId) || !(rawOperationId instanceof String operationId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        verifyMcpAssertion(operationId, clientId, subject, assertion);
    }

    private void verifyMcpAssertion(String operationId, String clientId, String subject, String assertion) {
        if (mcpAssertionSecret == null || mcpAssertionSecret.length() < 32 || clientId == null ||
                !clientId.matches("^[A-Za-z0-9._:-]{1,200}$") || assertion == null || !assertion.matches("^[a-f0-9]{64}$")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(mcpAssertionSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expected = mac.doFinal((operationId + "\n" + clientId + "\n" + subject).getBytes(StandardCharsets.UTF_8));
            if (!MessageDigest.isEqual(expected, HexFormat.of().parseHex(assertion))) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        } catch (ResponseStatusException error) { throw error; }
        catch (Exception error) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE); }
    }

    @GetMapping("/operations/{operationId}")
    public AppointmentRequest getByOperation(@PathVariable String operationId, JwtAuthenticationToken actor,
            @RequestHeader(name = "X-AutoNexus-MCP-Client", required = false) String clientId,
            @RequestHeader(name = "X-AutoNexus-MCP-Assertion", required = false) String assertion) {
        verifyMcpAssertion(operationId, clientId, actor.getToken().getSubject(), assertion);
        return requests.byOperation(operationId, clientId, actor.getToken().getSubject());
    }

    @GetMapping("/pending")
    public Page<AppointmentRequest> pending(@RequestParam(required = false) String limit,
            @RequestParam(required = false) String offset) { return requests.pending(limit, offset); }

    @PostMapping("/operations/{operationId}/approve")
    public Result approve(@PathVariable String operationId, @RequestBody Map<String, Object> body, JwtAuthenticationToken actor) {
        return Result.from(requests.approve(operationId, body, actor.getToken().getSubject()));
    }

    @PostMapping("/operations/{operationId}/reject")
    public Result reject(@PathVariable String operationId, @RequestBody Map<String, Object> body, JwtAuthenticationToken actor) {
        return Result.from(requests.reject(operationId, body, actor.getToken().getSubject()));
    }
}
