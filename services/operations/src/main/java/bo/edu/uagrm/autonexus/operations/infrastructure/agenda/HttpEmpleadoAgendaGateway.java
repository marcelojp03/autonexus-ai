package bo.edu.uagrm.autonexus.operations.infrastructure.agenda;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import bo.edu.uagrm.autonexus.operations.application.ReadAgenda;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import tools.jackson.databind.ObjectMapper;

public final class HttpEmpleadoAgendaGateway implements EmpleadoAgendaGateway {
    private final String base;
    private final HttpClient http;
    private final ObjectMapper json;
    public HttpEmpleadoAgendaGateway(String base, HttpClient http, ObjectMapper json) {
        this.base=base; this.http=http; this.json=json;
    }
    private static OperationsError dependency() { return new OperationsError(503,"AGENDA_DEPENDENCY_UNAVAILABLE"); }
    @SuppressWarnings("unchecked")
    private Map<String,Object> request(String token, String path, Map<String,Object> body) {
        var builder=HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(5))
            .header("Authorization","Bearer "+token).header("Accept","application/json");
        if(body==null) builder.GET();
        else builder.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        HttpResponse<String> response;
        try { response=http.send(builder.build(),HttpResponse.BodyHandlers.ofString()); }
        catch(InterruptedException error) { Thread.currentThread().interrupt(); throw dependency(); }
        catch(java.io.IOException error) { throw dependency(); }
        int status=response.statusCode();
        if(status==401) throw new OperationsError(401,"UNAUTHORIZED");
        if(status==403) throw ReadAgenda.denied();
        if(status==404 && body!=null) throw ReadAgenda.missing();
        if(status>=500 || status==429 || status<200 || status>=300) throw dependency();
        if(status!=200 || response.body().length()>1048576) throw ReadAgenda.state();
        try { return json.readValue(response.body(),Map.class); }
        catch(RuntimeException error) { throw ReadAgenda.state(); }
    }
    private static UUID id(Object value) {
        if(!(value instanceof String s) || !s.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) throw ReadAgenda.state();
        return UUID.fromString(s);
    }
    private static String text(Object value) { if(!(value instanceof String s)) throw ReadAgenda.state(); return s; }
    private static Instant instant(Object value) { return Instant.parse(text(value)); }
    private static long version(Object value) {
        if(!(value instanceof Integer || value instanceof Long) || ((Number)value).longValue()<1) throw ReadAgenda.state();
        return ((Number)value).longValue();
    }
    private static Actor actor(Object value) {
        if(!(value instanceof Map<?,?> a) || !(a.get("scopes") instanceof List<?> scopes) || scopes.stream().anyMatch(s->!(s instanceof String))) throw ReadAgenda.state();
        return new Actor(id(a.get("employeeId")),text(a.get("fullName")),text(a.get("status")),scopes.stream().map(String.class::cast).toList());
    }
    @Override public Context context(String token,String scope) {
        Map<String,Object> result=request(token,"/agenda/context?scope="+scope,null);
        try { return new Context(actor(result.get("actor")),instant(result.get("observedAt"))); }
        catch(RuntimeException invalid) { throw ReadAgenda.state(); }
    }
    @Override public Checked check(String token,String scope,List<UUID> ids) {
        Map<String,Object> result=request(token,"/agenda/assignments/check",Map.of("scope",scope,"assignmentIds",ids));
        try {
            if(!(result.get("items") instanceof List<?> rows)) throw ReadAgenda.state();
            List<AssignmentCheck> items=new ArrayList<>();
            for(Object value:rows) {
                if(!(value instanceof Map<?,?> a) || !(a.get("orderConfirmedObserved") instanceof Boolean observed)) throw ReadAgenda.state();
                items.add(new AssignmentCheck(id(a.get("assignmentId")),id(a.get("sagaId")),id(a.get("orderId")),id(a.get("employeeId")),
                    text(a.get("fullName")),text(a.get("employeeStatus")),instant(a.get("startsAt")),instant(a.get("endsAt")),
                    text(a.get("status")),version(a.get("version")),observed));
            }
            return new Checked(actor(result.get("actor")),List.copyOf(items),instant(result.get("observedAt")));
        } catch(RuntimeException invalid) { throw ReadAgenda.state(); }
    }
}
