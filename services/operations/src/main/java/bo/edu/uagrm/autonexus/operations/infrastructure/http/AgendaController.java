package bo.edu.uagrm.autonexus.operations.infrastructure.http;
import bo.edu.uagrm.autonexus.operations.application.*;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.Clock;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/agenda")
public class AgendaController {
    private final ReadAgenda agenda;
    public AgendaController(ReadAgenda agenda) { this.agenda=agenda; }
    @ExceptionHandler({org.springframework.dao.DataAccessException.class, org.springframework.transaction.TransactionException.class})
    public org.springframework.http.ResponseEntity<java.util.Map<String,Object>> persistenceUnavailable() {
        return org.springframework.http.ResponseEntity.status(503).body(java.util.Map.of(
            "statusCode",503,"message","Service unavailable","code","PERSISTENCE_UNAVAILABLE"));
    }
    @GetMapping("/{kind:me|team}")
    public Result list(JwtAuthenticationToken auth, @RequestParam MultiValueMap<String,String> query,
            @PathVariable String kind) {
        String scope=kind.equals("team") ? "team" : "self";
        return agenda.list(auth.getToken().getTokenValue(),scope,AgendaFilter.parse(query,scope,Clock.systemUTC()));
    }
    @GetMapping("/history/{kind:me|team}")
    public Result history(JwtAuthenticationToken auth, @RequestParam MultiValueMap<String,String> query,
            @PathVariable String kind) {
        String scope=kind.equals("team") ? "team" : "self";
        return agenda.history(auth.getToken().getTokenValue(),scope,AgendaFilter.parse(query,scope,Clock.systemUTC()));
    }
    @GetMapping("/{kind:me|team}/{assignmentId}")
    public Work detail(JwtAuthenticationToken auth, @PathVariable String assignmentId,
            @RequestParam MultiValueMap<String,String> query, @PathVariable String kind) {
        if(!query.isEmpty()) throw OperationsError.invalid();
        String scope=kind.equals("team") ? "team" : "self";
        return agenda.detail(auth.getToken().getTokenValue(),scope,AgendaFilter.id(assignmentId));
    }
}
