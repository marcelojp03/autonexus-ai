package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ManageVerification;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import bo.edu.uagrm.autonexus.operations.domain.Verification;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/**
 * CU17 REST surface. The mechanic asks for a review and ticks mandatory activities; the workshop
 * head approves or returns. Approval is the only path that completes the order.
 */
@RestController
@RequestMapping("/executions")
public class VerificationController {
    private final ManageVerification verification;

    public VerificationController(ManageVerification verification) {
        this.verification = verification;
    }

    @GetMapping("/verify/{assignmentId}")
    public Verification.View read(JwtAuthenticationToken authentication, @PathVariable String assignmentId) {
        return verification.read(token(authentication), "verify", Validation.uuid(assignmentId));
    }

    @GetMapping("/review-self/{assignmentId}")
    public Verification.View readOwn(JwtAuthenticationToken authentication, @PathVariable String assignmentId) {
        return verification.read(token(authentication), "read-self", Validation.uuid(assignmentId));
    }

    @PostMapping("/{assignmentId}/checklist/{itemId}/complete")
    public Verification.View complete(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
            @PathVariable String itemId, @RequestBody Map<String, Object> body) {
        return verification.item(token(authentication), Validation.uuid(assignmentId), Validation.uuid(itemId), body, true);
    }

    @PostMapping("/{assignmentId}/checklist/{itemId}/reopen")
    public Verification.View reopen(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
            @PathVariable String itemId, @RequestBody Map<String, Object> body) {
        return verification.item(token(authentication), Validation.uuid(assignmentId), Validation.uuid(itemId), body, false);
    }

    @PostMapping("/{assignmentId}/request-review")
    public Verification.View request(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
            @RequestBody Map<String, Object> body) {
        return verification.requestReview(token(authentication), Validation.uuid(assignmentId), body);
    }

    @PostMapping("/{assignmentId}/approve")
    public Verification.View approve(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
            @RequestBody Map<String, Object> body) {
        return verification.approve(token(authentication), Validation.uuid(assignmentId), body);
    }

    @PostMapping("/{assignmentId}/return")
    public Verification.View reject(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
            @RequestBody Map<String, Object> body) {
        return verification.reject(token(authentication), Validation.uuid(assignmentId), body);
    }

    private static String token(JwtAuthenticationToken authentication) {
        return authentication.getToken().getTokenValue();
    }
}
