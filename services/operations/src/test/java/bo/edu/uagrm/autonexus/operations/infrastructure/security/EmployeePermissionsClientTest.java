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
