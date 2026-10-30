package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.Download;
import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.EvidenceUpload;
import bo.edu.uagrm.autonexus.operations.application.ManageExecutions;
import bo.edu.uagrm.autonexus.operations.application.Mutation;
import bo.edu.uagrm.autonexus.operations.domain.Execution;
import bo.edu.uagrm.autonexus.operations.domain.Validation;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

/**
 * CU16 REST surface. Reading is split by scope exactly like the agenda; writing stays restricted to
 * the assigned mechanic by the owner's record check. There is no finalisation endpoint: that is CU17.
 */
@RestController
@RequestMapping("/executions")
public class ExecutionController {
    public record ExecutionResult(Execution execution, boolean replayed) {
        static ExecutionResult from(Mutation<Execution> mutation) {
            return new ExecutionResult(mutation.value(), mutation.replayed());
        }
    }

    public record AdvanceResult(Execution execution, Execution.Advance advance, boolean replayed) {
        static AdvanceResult from(Mutation<Execution> mutation) {
            Execution execution = mutation.value();
            return new AdvanceResult(execution, execution.advances().getLast(), mutation.replayed());
        }
    }

    public record EvidenceResult(Execution.Evidence evidence, boolean replayed) {
        static EvidenceResult from(Mutation<Execution.Evidence> mutation) {
            return new EvidenceResult(mutation.value(), mutation.replayed());
        }
    }

    public record EvidenceRequestResult(Execution.Evidence evidence, EvidenceUploadResult upload, boolean replayed) {}

    public record EvidenceUploadResult(String url, String method, String headersJson, String expiresAt) {
        static EvidenceUploadResult from(EvidenceUpload upload, tools.jackson.databind.ObjectMapper json) {
            return new EvidenceUploadResult(upload.upload().url(), upload.upload().method(),
                    json.writeValueAsString(upload.upload().headers()), upload.upload().expiresAt().toString());
        }
    }

    private final ManageExecutions executions;
    private final tools.jackson.databind.ObjectMapper json;

    public ExecutionController(ManageExecutions executions, tools.jackson.databind.ObjectMapper json) {
        this.executions = executions;
        this.json = json;
    }

    @GetMapping("/{kind:me|team}/{assignmentId}")
    public Execution read(JwtAuthenticationToken authentication, @PathVariable String kind,
                          @PathVariable String assignmentId) {
        String scope = "team".equals(kind) ? "read-team" : "read-self";
        return executions.read(token(authentication), scope, Validation.uuid(assignmentId));
    }

    @PostMapping("/{assignmentId}/start")
    @ResponseStatus(HttpStatus.CREATED)
    public ExecutionResult start(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
                                 @RequestBody Map<String, Object> body) {
        return ExecutionResult.from(executions.start(token(authentication), Validation.uuid(assignmentId), body));
    }

    @PostMapping("/{assignmentId}/advances")
    @ResponseStatus(HttpStatus.CREATED)
    public AdvanceResult advance(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
                                   @RequestBody Map<String, Object> body) {
        return AdvanceResult.from(executions.advance(token(authentication), Validation.uuid(assignmentId), body));
    }

    @PostMapping("/{assignmentId}/advances/{advanceId}/evidences")
    @ResponseStatus(HttpStatus.CREATED)
    public EvidenceRequestResult requestEvidence(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
                                                 @PathVariable String advanceId, @RequestBody Map<String, Object> body) {
        EvidenceUpload upload = executions.requestEvidence(token(authentication), Validation.uuid(assignmentId),
                Validation.uuid(advanceId), body);
        return new EvidenceRequestResult(upload.evidence(), EvidenceUploadResult.from(upload, json), upload.replayed());
    }

    @PostMapping("/{assignmentId}/evidences/{evidenceId}/confirm")
    public EvidenceResult confirm(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
                                  @PathVariable String evidenceId, @RequestBody Map<String, Object> body) {
        return EvidenceResult.from(executions.confirmEvidence(token(authentication),
                Validation.uuid(assignmentId), Validation.uuid(evidenceId), body));
    }

    @PostMapping("/{assignmentId}/evidences/{evidenceId}/retry")
    public EvidenceRequestResult retry(JwtAuthenticationToken authentication, @PathVariable String assignmentId,
                                       @PathVariable String evidenceId, @RequestBody Map<String, Object> body) {
        EvidenceUpload upload = executions.retryEvidence(token(authentication), Validation.uuid(assignmentId),
                Validation.uuid(evidenceId), body);
        return new EvidenceRequestResult(upload.evidence(), EvidenceUploadResult.from(upload, json), upload.replayed());
    }

    @GetMapping("/{kind:me|team}/{assignmentId}/evidences/{evidenceId}/download")
    public Download download(JwtAuthenticationToken authentication, @PathVariable String kind,
                             @PathVariable String assignmentId, @PathVariable String evidenceId) {
        String scope = "team".equals(kind) ? "read-team" : "read-self";
        return executions.download(token(authentication), scope, Validation.uuid(assignmentId),
                Validation.uuid(evidenceId));
    }

    private static String token(JwtAuthenticationToken authentication) {
        return authentication.getToken().getTokenValue();
    }
}
