package bo.edu.uagrm.autonexus.operations.infrastructure.agenda;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.io.IOException;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class HttpEmpleadoAgendaGatewayTest {
    HttpClient http=mock(HttpClient.class);
    ObjectMapper json=new ObjectMapper();
    HttpEmpleadoAgendaGateway gateway=new HttpEmpleadoAgendaGateway("http://127.0.0.1:3002",http,json);
    UUID employee=UUID.randomUUID(),assignment=UUID.randomUUID();
    Map<String,Object> actor=Map.of("employeeId",employee.toString(),"fullName","M","status","active","scopes",List.of("self","team"));
    @SuppressWarnings("unchecked") void respond(int status,Object body) throws Exception {
        HttpResponse<String> response=mock(HttpResponse.class); when(response.statusCode()).thenReturn(status);
        when(response.body()).thenReturn(body instanceof String s ? s : json.writeValueAsString(body));
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenReturn(response);
    }
    @Test void contextForwardsHumanBearerAndExactScopeOnEveryCall() throws Exception {
        respond(200,Map.of("actor",actor,"observedAt","2026-11-01T12:00:00.000Z"));
        assertEquals(employee,gateway.context("human-fixture","self").actor().employeeId()); gateway.context("second-human","team");
        var requests=org.mockito.ArgumentCaptor.forClass(HttpRequest.class); verify(http,times(2)).send(requests.capture(),any());
        assertEquals("/agenda/context?scope=self",requests.getAllValues().getFirst().uri().getRawPath()+"?"+requests.getAllValues().getFirst().uri().getRawQuery());
        assertEquals("Bearer second-human",requests.getValue().headers().firstValue("Authorization").orElseThrow());
        assertEquals("GET",requests.getValue().method());
    }
    @Test void checkUsesExactPostAndParsesCanonicalInstantsWithoutTechnicalScope() throws Exception {
        Map<String,Object> item=new HashMap<>(Map.of("assignmentId",assignment.toString(),"sagaId",UUID.randomUUID().toString(),"orderId",UUID.randomUUID().toString(),
            "employeeId",employee.toString(),"fullName","M","employeeStatus","active","startsAt","2026-11-01T08:00:00-04:00","endsAt","2026-11-01T13:00:00Z","status","confirmed","version",2));
        item.put("orderConfirmedObserved",false);
        respond(200,Map.of("actor",actor,"items",List.of(item),"observedAt","2026-11-01T12:00:00Z"));
        var result=gateway.check("human","self",List.of(assignment));
        assertEquals(Instant.parse("2026-11-01T12:00:00Z"),result.items().getFirst().startsAt());
        assertFalse(result.items().getFirst().orderConfirmedObserved());
        var req=org.mockito.ArgumentCaptor.forClass(HttpRequest.class); verify(http).send(req.capture(),any());
        assertEquals("POST",req.getValue().method()); assertEquals("/agenda/assignments/check",req.getValue().uri().getPath());
        assertEquals("Bearer human",req.getValue().headers().firstValue("Authorization").orElseThrow());
        var body=new java.io.ByteArrayOutputStream();
        var done=new java.util.concurrent.CompletableFuture<String>();
        req.getValue().bodyPublisher().orElseThrow().subscribe(new java.util.concurrent.Flow.Subscriber<java.nio.ByteBuffer>() {
            public void onSubscribe(java.util.concurrent.Flow.Subscription subscription) { subscription.request(Long.MAX_VALUE); }
            public void onNext(java.nio.ByteBuffer buffer) { byte[] bytes=new byte[buffer.remaining()]; buffer.get(bytes); body.writeBytes(bytes); }
            public void onError(Throwable error) { done.completeExceptionally(error); }
            public void onComplete() { done.complete(body.toString(java.nio.charset.StandardCharsets.UTF_8)); }
        });
        assertEquals(Map.of("scope","self","assignmentIds",List.of(assignment.toString())),json.readValue(done.join(),Map.class));
    }
    @Test void downstreamStatusMappingIsSafeAndNeverAnEmptySuccess() throws Exception {
        for(int status:List.of(500,503,302,429)) {
            respond(status,"private upstream");
            assertEquals("AGENDA_DEPENDENCY_UNAVAILABLE",assertThrows(OperationsError.class,()->gateway.context("human","self")).code());
        }
        respond(403,"private"); assertEquals("AGENDA_ACCESS_DENIED",assertThrows(OperationsError.class,()->gateway.context("human","self")).code());
        respond(404,"private"); assertEquals("AGENDA_WORK_NOT_FOUND",assertThrows(OperationsError.class,()->gateway.check("human","self",List.of(assignment))).code());
        respond(401,"private"); assertEquals(401,assertThrows(OperationsError.class,()->gateway.context("human","self")).statusCode());
    }
    @Test void malformedOwnerShapeIsExplicitStateError() throws Exception {
        for(Object body:List.of("not-json",Map.of("actor",actor),Map.of("actor",Map.of("employeeId","bad"),"observedAt","today"))) {
            respond(200,body); assertEquals("AGENDA_STATE_UNAVAILABLE",assertThrows(OperationsError.class,()->gateway.context("human","self")).code());
        }
    }
    @Test @SuppressWarnings("unchecked") void transportFailureIsDependencyUnavailable() throws Exception {
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenThrow(new IOException("private host"));
        assertEquals("AGENDA_DEPENDENCY_UNAVAILABLE",assertThrows(OperationsError.class,()->gateway.context("human","self")).code());
    }
}
