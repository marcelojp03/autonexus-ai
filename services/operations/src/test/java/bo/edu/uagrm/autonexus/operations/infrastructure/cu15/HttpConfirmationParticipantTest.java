package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.Time;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

class HttpConfirmationParticipantTest {
    @TempDir Path temporary;
    HttpServer server; HttpConfirmationParticipant participant;
    CanonicalJson json=new CanonicalJson(new ObjectMapper());
    List<String> paths=new ArrayList<>(),bodies=new ArrayList<>(),authorizations=new ArrayList<>();
    String tokenForm; int tokens,status=200; String response="{}";
    Saga saga; Step step;
    @BeforeEach void setup() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{
            String body=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);
            String path=exchange.getRequestURI().getPath(); String output=response; int code=status;
            if(path.equals("/token")) { tokens++; tokenForm=body; code=200; output=json.write(Map.of("access_token","synthetic-service-access","expires_in",60,"token_type","Bearer")); }
            else { paths.add(path);bodies.add(body);authorizations.add(exchange.getRequestHeaders().getFirst("Authorization")); }
            byte[] bytes=output.getBytes(StandardCharsets.UTF_8); exchange.getResponseHeaders().set("Content-Type","application/json");
            exchange.sendResponseHeaders(code,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        }); server.start();
        Path file=temporary.resolve("synthetic-client.json"); Files.writeString(file,json.write(Map.of("clientId","autonexus-cu15-coordinator","clientSecret","synthetic-unit-fixture")));
        String base="http://127.0.0.1:"+server.getAddress().getPort();
        Time clock=new Time() { public Instant now(){return Instant.parse("2026-10-28T12:00:00Z");} public double jitter(){return 0;} };
        participant=new HttpConfirmationParticipant(json,clock,base,base,base+"/token",file.toString());
        saga=new Saga();saga.id=UUID.randomUUID().toString();step=new Step("reserve_assignment");
        step.body=Map.of("operationId",step.operationId,"expectedVersion",0,"initiatedBy","authorized-human","authorizedAt","2026-10-28T12:00:00.000Z");
    }
    @AfterEach void close() { server.stop(0); }
    @Test void usesClientCredentialsSevenScopesAndCachesTokenOnlyInMemory() {
        participant.execute(saga,step);participant.lookup(saga,step);
        assertEquals(1,tokens);assertTrue(tokenForm.contains("grant_type=client_credentials"));
        String decoded=URLDecoder.decode(tokenForm,StandardCharsets.UTF_8);
        for(String scope:List.of("cu15.staffing.read","cu15.staffing.reserve","cu15.staffing.confirm","cu15.staffing.release","cu15.finance.read","cu15.finance.authorize","cu15.finance.cancel")) assertTrue(decoded.contains(scope));
        assertEquals(List.of("Bearer synthetic-service-access","Bearer synthetic-service-access"),authorizations);
        assertEquals(json.write(step.body),bodies.getFirst());assertFalse(bodies.getFirst().contains("synthetic-service-access"));
        assertEquals("/internal/cu15/assignments/"+saga.id+"/reserve",paths.getFirst());
        assertEquals("/internal/cu15/operations/"+step.operationId,paths.getLast());
    }
    @Test void durable409EnvelopeIsReturnedForApplicationValidation() {
        status=409;response=json.write(Map.of("outcome","rejected","errorCode","QUOTE_EXPIRED"));
        assertEquals("rejected",participant.execute(saga,step).get("outcome"));
    }
    @Test void missingLedgerIsUnknownAndServerErrorsAreNeverBusinessRejections() {
        status=404;assertNull(participant.lookup(saga,step));
        status=500;var failure=assertThrows(IllegalStateException.class,()->participant.execute(saga,step));
        assertEquals("CU15_RESULT_UNKNOWN",failure.getMessage());assertFalse(failure.toString().contains("synthetic-unit-fixture"));
    }
    @Test void malformedSuccessfulResponseExposesOnlyASanitizedProtocolCode() {
        response="not-json-synthetic-private-detail";
        var failure=assertThrows(IllegalStateException.class,()->participant.execute(saga,step));
        assertEquals("PARTICIPANT_PROTOCOL_INVALID",failure.getMessage());
        assertFalse(failure.toString().contains(response));
        response="x".repeat(65537);
        assertEquals("PARTICIPANT_PROTOCOL_INVALID",assertThrows(IllegalStateException.class,()->participant.execute(saga,step)).getMessage());
    }
    @Test void exactFinanceAndEmployeeActionPaths() {
        Map<String,String> suffix=Map.of("confirm_assignment","assignments/confirm","release_assignment","assignments/release","authorize_quote","quote-links/authorize","cancel_quote_link","quote-links/cancel");
        suffix.forEach((command,path)->{step.command=command;participant.execute(saga,step);String[] split=path.split("/");assertEquals("/internal/cu15/"+split[0]+"/"+saga.id+"/"+split[1],paths.getLast());});
    }
    @Test void missingCredentialFileYieldsSanitizedFailureWithoutSending() {
        Time clock=new Time(){public Instant now(){return Instant.now();} public double jitter(){return 0;}};
        String base="http://127.0.0.1:"+server.getAddress().getPort();
        var invalid=new HttpConfirmationParticipant(json,clock,base,base,base+"/token",temporary.resolve("absent.json").toString());
        assertEquals("CU15_TECHNICAL_AUTH_UNAVAILABLE",assertThrows(IllegalStateException.class,()->invalid.execute(saga,step)).getMessage());
        assertTrue(paths.isEmpty());assertEquals(0,tokens);
    }
}
