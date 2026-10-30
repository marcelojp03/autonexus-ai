package bo.edu.uagrm.autonexus.operations.infrastructure.executions;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.*;
import bo.edu.uagrm.autonexus.operations.application.ManageExecutions;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import tools.jackson.databind.ObjectMapper;

/** CU16 identity resolution. Operations never derives a human identity from its own tables. */
public final class HttpEmpleadoExecutionGateway implements IdentityGateway {
    private final String base;
    private final HttpClient http;
    private final ObjectMapper json;

    public HttpEmpleadoExecutionGateway(String base, HttpClient http, ObjectMapper json) {
        this.base = base;
        this.http = http;
        this.json = json;
    }

    private static OperationsError dependency() {
        return new OperationsError(503, "EXECUTION_DEPENDENCY_UNAVAILABLE");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> post(String token, String path, Map<String, Object> body) {
        var builder = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(5))
                .header("Authorization", "Bearer " + token)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        HttpResponse<String> response;
        try {
            response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw dependency();
        } catch (java.io.IOException error) {
            throw dependency();
        }
        int status = response.statusCode();
        if (status == 401) throw new OperationsError(401, "UNAUTHORIZED");
        if (status == 403) throw ManageExecutions.denied();
        if (status == 404) throw ManageExecutions.missing();
        if (status != 200) throw dependency();
        if (response.body() == null || response.body().length() > 1048576) throw ManageExecutions.state();
        try {
            return json.readValue(response.body(), Map.class);
        } catch (RuntimeException error) {
            throw ManageExecutions.state();
        }
    }

    private static String text(Object value) {
        if (!(value instanceof String result) || result.isBlank()) throw ManageExecutions.state();
        return result;
    }

    private static UUID id(Object value) {
        if (!(value instanceof String result)) throw ManageExecutions.state();
        try {
            return UUID.fromString(result);
        } catch (IllegalArgumentException invalid) {
            throw ManageExecutions.state();
        }
    }

    private static Instant instant(Object value) {
        try {
            return Instant.parse(text(value));
        } catch (RuntimeException invalid) {
            throw ManageExecutions.state();
        }
    }

    private static long version(Object value) {
        if (!(value instanceof Number number) || number.longValue() < 1) throw ManageExecutions.state();
        return number.longValue();
    }

    @Override
    public Authorized authorize(String token, String scope, List<UUID> assignmentIds) {
        Map<String, Object> result = post(token, "/executions/authorize",
                Map.of("scope", scope, "assignmentIds", assignmentIds));
        try {
            if (!(result.get("actor") instanceof Map<?, ?> actor)
                    || !(result.get("items") instanceof List<?> rows)) throw ManageExecutions.state();
            List<Assignment> items = new ArrayList<>();
            for (Object value : rows) {
                if (!(value instanceof Map<?, ?> item)
                        || !(item.get("orderConfirmedObserved") instanceof Boolean observed)) {
                    throw ManageExecutions.state();
                }
                items.add(new Assignment(id(item.get("assignmentId")), id(item.get("sagaId")), id(item.get("orderId")),
                        id(item.get("employeeId")), text(item.get("fullName")), text(item.get("employeeStatus")),
                        instant(item.get("startsAt")), instant(item.get("endsAt")), text(item.get("status")),
                        version(item.get("version")), observed));
            }
            Actor resolved = new Actor(id(actor.get("employeeId")), text(actor.get("fullName")), text(actor.get("status")));
            return new Authorized(resolved, List.copyOf(items), instant(result.get("observedAt")));
        } catch (OperationsError failure) {
            throw failure;
        } catch (RuntimeException invalid) {
            throw ManageExecutions.state();
        }
    }
}
