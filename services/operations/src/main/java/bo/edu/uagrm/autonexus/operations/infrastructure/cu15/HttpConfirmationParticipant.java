package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="CU15_ENABLED",havingValue="true")
public class HttpConfirmationParticipant implements Participant {
    private final CanonicalJson json;
    private final Time clock;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final String employees, finance, tokenEndpoint, credentialFile;
    private String token;
    private Instant tokenUntil=Instant.MIN;
    private static final String CLIENT="autonexus-cu15-coordinator";
    private static final String SCOPES="cu15.staffing.read cu15.staffing.reserve cu15.staffing.confirm cu15.staffing.release cu15.finance.read cu15.finance.authorize cu15.finance.cancel";
    public HttpConfirmationParticipant(CanonicalJson json, Time clock,
            @Value("${EMPLOYEES_API_URL:http://127.0.0.1:3002}") String employees,
            @Value("${FINANCE_API_URL:http://127.0.0.1:8000}") String finance,
            @Value("${CU15_IDP_TOKEN_ENDPOINT:http://127.0.0.1:8180/realms/autonexus/protocol/openid-connect/token}") String endpoint,
            @Value("${CU15_IDP_CLIENT_FILE:}") String file) {
        this.json=json; this.clock=clock; this.employees=employees; this.finance=finance; this.tokenEndpoint=endpoint; this.credentialFile=file;
    }
    @Override public String clientId() { return CLIENT; }
    private synchronized String accessToken() {
        if(token!=null && clock.now().isBefore(tokenUntil)) return token;
        try {
            Map<?,?> credentials=json.read(Files.readString(Path.of(credentialFile)),Map.class);
            if(!credentials.keySet().equals(Set.of("clientId","clientSecret")) || !CLIENT.equals(credentials.get("clientId")) || !(credentials.get("clientSecret") instanceof String secret) || secret.isBlank()) throw new IllegalStateException();
            String body="grant_type=client_credentials&client_id="+encode(CLIENT)+"&client_secret="+encode(secret)+"&scope="+encode(SCOPES);
            HttpResponse<String> response=send(HttpRequest.newBuilder(URI.create(tokenEndpoint)).timeout(Duration.ofSeconds(5))
                .header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body)).build());
            if(response.statusCode()!=200) throw new IllegalStateException();
            Map<?,?> result=json.read(response.body(),Map.class);
            if(!(result.get("access_token") instanceof String value) || value.isBlank() || !(result.get("expires_in") instanceof Number seconds)
                    || seconds.longValue()<10 || !"Bearer".equalsIgnoreCase(String.valueOf(result.get("token_type")))) throw new IllegalStateException();
            token=value; tokenUntil=clock.now().plusSeconds(seconds.longValue()-5); return token;
        } catch(Exception failure) { throw new IllegalStateException("CU15_TECHNICAL_AUTH_UNAVAILABLE"); }
    }
    private static String encode(String s) { return URLEncoder.encode(s,StandardCharsets.UTF_8); }
    private HttpResponse<String> send(HttpRequest request) {
        try { return http.send(request,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)); }
        catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException("CU15_TRANSPORT_UNKNOWN"); }
        catch(java.io.IOException e) { throw new IllegalStateException("CU15_TRANSPORT_UNKNOWN"); }
    }
    private String base(Step step) { return step.command.contains("assignment")?employees:finance; }
    @SuppressWarnings("unchecked")
    private Map<String,Object> request(String url, Map<String,Object> body, boolean ledger) {
        var builder=HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(5)).header("Authorization","Bearer "+accessToken()).header("Accept","application/json");
        if(body!=null) builder.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.write(body))); else builder.GET();
        var response=send(builder.build());
        if(response.statusCode()==401) { synchronized(this) { token=null; } }
        if(ledger && response.statusCode()==404) return null;
        if(response.statusCode()!=200 && response.statusCode()!=201 && response.statusCode()!=409) throw new IllegalStateException("CU15_RESULT_UNKNOWN");
        if(response.body().length()>65536) throw new ProtocolFailure(ProtocolProblem.PARTICIPANT_PROTOCOL_INVALID);
        try { return (Map<String,Object>)json.read(response.body(),Map.class); }
        catch(RuntimeException malformed) { throw new ProtocolFailure(ProtocolProblem.PARTICIPANT_PROTOCOL_INVALID); }
    }
    @Override public Map<String,Object> lookup(Saga saga, Step step) {
        return request(base(step)+"/internal/cu15/operations/"+step.operationId,null,true);
    }
    @Override public Map<String,Object> execute(Saga saga, Step step) {
        String resource=step.command.contains("assignment")?"assignments":"quote-links";
        String action=switch(step.command) {
            case "reserve_assignment"->"reserve"; case "confirm_assignment"->"confirm"; case "release_assignment"->"release";
            case "authorize_quote"->"authorize"; default->"cancel";
        };
        return request(base(step)+"/internal/cu15/"+resource+"/"+saga.id+"/"+action,step.body,false);
    }
}
