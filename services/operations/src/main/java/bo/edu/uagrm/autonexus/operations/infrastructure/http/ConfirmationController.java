package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.*;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

@RestController
public class ConfirmationController {
    private final Repository store;
    private final Time clock;
    private final boolean enabled;
    public ConfirmationController(Repository store,Time clock,@Value("${CU15_ENABLED:false}") boolean enabled) { this.store=store; this.clock=clock; this.enabled=enabled; }
    private void enabled() { if(!enabled) throw new OperationsError(503,"CU15_DISABLED"); }
    @PostMapping("/orders/{orderId}/confirmations") @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String,Object> start(@PathVariable String orderId,@RequestBody Map<String,Object> body,JwtAuthenticationToken auth) {
        enabled(); return progress(store.start(Validation.uuid(orderId),Confirmation.start(body),auth.getToken().getSubject(),clock.now()));
    }
    @GetMapping("/confirmations/{sagaId}")
    public Map<String,Object> get(@PathVariable String sagaId) { enabled(); return progress(store.get(Validation.uuid(sagaId))); }
    @GetMapping("/confirmations/operations/{operationId}")
    public Map<String,Object> operation(@PathVariable String operationId) { enabled(); return progress(store.operation(Validation.uuid(operationId))); }
    @GetMapping("/orders/{orderId}/confirmations")
    public List<Map<String,Object>> order(@PathVariable String orderId) { enabled(); return store.order(Validation.uuid(orderId)).stream().map(ConfirmationController::progress).toList(); }
    @PostMapping("/confirmations/{sagaId}/retry") @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String,Object> retry(@PathVariable String sagaId,@RequestBody Map<String,Object> body,JwtAuthenticationToken auth) {
        enabled(); if(!body.keySet().equals(Set.of("operationId","expectedVersion"))) throw OperationsError.invalid();
        return progress(store.retry(Validation.uuid(sagaId),Validation.uuid(body.get("operationId")),Confirmation.number(body.get("expectedVersion"),1),auth.getToken().getSubject(),clock.now()));
    }
    public static Map<String,Object> progress(Saga saga) {
        Map<String,Object> dto=new LinkedHashMap<>();
        dto.put("sagaId",saga.id); dto.put("orderId",saga.orderId); dto.put("status",saga.status); dto.put("phase",saga.phase);
        dto.put("version",saga.version); dto.put("orderVersion",saga.orderVersion); dto.put("nextAttemptAt",saga.terminal()?null:saga.nextAttemptAt);
        String activeError=saga.steps.stream().filter(step->step.command.equals(saga.phase)).map(step->step.errorCode).filter(Objects::nonNull).findFirst().orElse(null);
        dto.put("errorCode",saga.errorCode!=null?saga.errorCode:activeError);
        dto.put("operationId",saga.input.get("operationId"));
        for(String k:List.of("quoteId","quoteVersion","employeeId","employeeVersion","requiredSpecialty","startsAt","endsAt")) dto.put(k,saga.input.get(k));
        dto.put("assignmentId",saga.step("reserve_assignment").resource()==null?null:saga.step("reserve_assignment").resource().get("id"));
        dto.put("quoteLinkId",saga.step("authorize_quote").resource()==null?null:saga.step("authorize_quote").resource().get("id"));
        Step assignment=saga.step("release_assignment").applied()?saga.step("release_assignment"):
                saga.step("confirm_assignment").applied()?saga.step("confirm_assignment"):saga.step("reserve_assignment");
        Step link=saga.step("cancel_quote_link").applied()?saga.step("cancel_quote_link"):saga.step("authorize_quote");
        dto.put("assignmentVersion",assignment.resource()==null?null:assignment.resource().get("version"));
        dto.put("quoteLinkVersion",link.resource()==null?null:link.resource().get("version"));
        dto.put("steps",saga.steps.stream().map(step->{
            Map<String,Object> item=new LinkedHashMap<>(); item.put("operationId",step.operationId); item.put("command",step.command); item.put("direction",step.direction);
            item.put("status",step.status); item.put("attempts",step.attempts); item.put("errorCode",step.errorCode);
            item.put("resourceVersion",step.resource()==null?null:step.resource().get("version"));
            item.put("outcome",step.result==null?null:step.result.get("outcome"));
            item.put("committedAt",step.result==null?null:step.result.get("committedAt"));
            item.put("resourceStatus",step.resource()==null?null:step.resource().get("status")); return item;
        }).toList()); return dto;
    }
}
