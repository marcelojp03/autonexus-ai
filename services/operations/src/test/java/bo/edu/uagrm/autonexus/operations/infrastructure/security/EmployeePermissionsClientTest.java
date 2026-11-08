package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class EmployeePermissionsClientTest {
    @Test
    void boundPaymentAuthorizationIsFreshAndAcceptsEitherPermission() throws IOException {
        for (String permission : List.of("payments:read", "payments:write")) {
            AtomicInteger calls = new AtomicInteger();
            String employee = java.util.UUID.randomUUID().toString();
            HttpServer server = server(200, "{\"effective\":[\""+permission+"\"],\"employeeId\":\""+employee+"\",\"employeeStatus\":\"active\"}", calls);
            try {
                var client = new EmployeePermissionsClient("http://127.0.0.1:"+server.getAddress().getPort(), 30);
                var required = java.util.Set.of("payments:read","payments:write");
                assertThat(client.requireBoundAnyPermission("token", required).toString()).isEqualTo(employee);
                client.requireBoundAnyPermission("token", required);
                assertThat(calls.get()).isEqualTo(2);
            } finally { server.stop(0); }
        }
    }

    @Test
    void paymentAuthorizationRejectsUnboundInactiveAndMissingPermission() throws IOException {
        for (String body : List.of(
                "{\"effective\":[\"payments:read\"]}",
                "{\"effective\":[\"payments:read\"],\"employeeId\":\""+java.util.UUID.randomUUID()+"\",\"employeeStatus\":\"inactive\"}",
                "{\"effective\":[\"orders:read\"],\"employeeId\":\""+java.util.UUID.randomUUID()+"\",\"employeeStatus\":\"active\"}")) {
            HttpServer server = server(200,body,new AtomicInteger());
            try {
                var client = new EmployeePermissionsClient("http://127.0.0.1:"+server.getAddress().getPort(),30);
                var error = org.junit.jupiter.api.Assertions.assertThrows(bo.edu.uagrm.autonexus.operations.domain.OperationsError.class,
                    () -> client.requireBoundAnyPermission("token",java.util.Set.of("payments:read","payments:write")));
                assertThat(error.statusCode()).isEqualTo(403);
            } finally { server.stop(0); }
        }
    }
    private HttpServer server(int status, String body, AtomicInteger counter) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/security/permissions", exchange -> {
            counter.incrementAndGet();
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, payload.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(payload);
            }
        });
        server.start();
        return server;
    }

    @Test
    void cachesResolvedPermissionsPerSubjectAndRoles() throws IOException {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = server(200, "{\"effective\":[\"customers:read\",\"customers:write\"],\"roles\":[\"administrador\"],\"catalog\":[]}", calls);
        try {
            var client = new EmployeePermissionsClient("http://127.0.0.1:" + server.getAddress().getPort(), 30);
            assertThat(client.permissions("token", "subject-1", List.of("administrador")))
                    .containsExactlyInAnyOrder("customers:read", "customers:write");
            assertThat(client.permissions("token", "subject-1", List.of("administrador"))).hasSize(2);
            assertThat(calls.get()).isEqualTo(1);
            client.permissions("token", "subject-1", List.of("recepcionista"));
            assertThat(calls.get()).isEqualTo(2);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void failsClosedWhenTheOwnerIsUnavailable() {
        var client = new EmployeePermissionsClient("http://127.0.0.1:1", 30);
        assertThat(client.permissions("token", "subject-2", List.of("administrador"))).isEmpty();
    }

    @Test
    void failsClosedOnAnErrorResponse() throws IOException {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = server(401, "{\"statusCode\":401}", calls);
        try {
            var client = new EmployeePermissionsClient("http://127.0.0.1:" + server.getAddress().getPort(), 30);
            assertThat(client.permissions("token", "subject-3", List.of("administrador"))).isEmpty();
        } finally {
            server.stop(0);
        }
    }
}
