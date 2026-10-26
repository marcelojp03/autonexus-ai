package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import bo.edu.uagrm.autonexus.operations.infrastructure.http.TechnicalController;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** HTTP/security tests with a fake decoder and fake health; not SSO or database integration. */
class TechnicalSecurityTest {
    AnnotationConfigWebApplicationContext context;
    MockMvc mvc;
    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc @EnableWebSecurity
    @Import({SecurityConfiguration.class, TechnicalController.class, FakeHealth.class})
    static class TestConfig {
        @Bean @Primary JwtDecoder fakeDecoder() {
            return fixture -> {
                if (fixture.equals("invalid")) throw new BadJwtException("Invalid synthetic fixture");
                var roles = switch (fixture) {
                    case "admin" -> List.of("administrador");
                    case "mechanic" -> List.of("mecanico", "offline_access", "unrecognized", "mecanico");
                    case "all" -> List.of("administrador", "recepcionista", "mecanico", "jefe_taller", "responsable_financiero");
                    default -> List.of("offline_access", "admin");
                };
                return Jwt.withTokenValue("synthetic-not-a-jwt").header("alg", "RS256").subject("synthetic-subject")
                    .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60))
                    .claim("realm_access", fixture.equals("badroles") ? "invalid-shape" : Map.of("roles", roles)).build();
            };
        }
    }
    @RestController static class FakeHealth {
        @GetMapping({"/actuator/health/liveness", "/actuator/health/readiness"})
        Map<String, String> health() { return Map.of("status", "UP"); }
    }
    @BeforeEach void setup() {
        context = new AnnotationConfigWebApplicationContext();
        context.setEnvironment(new MockEnvironment().withProperty("WEB_ALLOWED_ORIGINS",
            "http://127.0.0.1:4200,http://127.0.0.1:4201,http://127.0.0.1:4202"));
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    @AfterEach void close() { context.close(); }
    MockHttpServletRequestBuilder bearer(String path, String fixture) { return get(path).header("Authorization", "Bearer " + fixture); }
    void status(MockHttpServletRequestBuilder request, int expected) throws Exception {
        var response = mvc.perform(request).andReturn().getResponse();
        assertEquals(expected, response.getStatus(), "Unexpected synthetic HTTP status");
        assertNull(response.getHeader("Set-Cookie"));
    }
    @Test void absentTokenIsGeneric401() throws Exception {
        var response = mvc.perform(get("/technical/session")).andReturn().getResponse();
        assertEquals(401, response.getStatus());
        assertEquals("{\"error\":\"unauthorized\"}", response.getContentAsString());
    }
    @Test void invalidTokenIs401() throws Exception { status(bearer("/technical/session", "invalid"), 401); }
    @Test void malformedHeaderIs401() throws Exception { status(get("/technical/session").header("Authorization", "Bearer"), 401); }
    @Test void noWorkshopRolesIs403() throws Exception { status(bearer("/technical/session", "none"), 403); }
    @Test void malformedRolesIs403() throws Exception { status(bearer("/technical/session", "badroles"), 403); }
    @Test void mechanicCanReadMinimalSession() throws Exception {
        String body = mvc.perform(bearer("/technical/session", "mechanic")).andReturn().getResponse().getContentAsString();
        assertEquals("{\"resource\":\"session\",\"service\":\"operations\",\"subject\":\"synthetic-subject\",\"roles\":[\"mecanico\"]}", body);
    }
    @Test void allFiveRolesRecognized() throws Exception { status(bearer("/technical/session", "all"), 200); }
    @Test void mechanicCannotReadAdmin() throws Exception {
        var response = mvc.perform(bearer("/technical/admin", "mechanic")).andReturn().getResponse();
        assertEquals(403, response.getStatus());
        assertEquals("{\"error\":\"forbidden\"}", response.getContentAsString());
    }
    @Test void administratorCanReadAdmin() throws Exception {
        var response = mvc.perform(bearer("/technical/admin", "admin")).andReturn().getResponse();
        assertEquals(200, response.getStatus());
        assertEquals("{\"resource\":\"admin\",\"service\":\"operations\",\"authorized\":true}", response.getContentAsString());
    }
    @Test void healthPathsPublicWithoutIdp() throws Exception {
        status(get("/actuator/health/liveness"), 200); status(get("/actuator/health/readiness"), 200);
    }
    @Test void otherPathsAndMethodsDenied() throws Exception {
        status(bearer("/actuator/health", "admin"), 403);
        status(bearer("/not-exposed", "admin"), 403);
        status(post("/technical/admin").header("Authorization", "Bearer admin"), 403);
    }
    @Test void queryAndCookieNeverAuthenticate() throws Exception {
        status(get("/technical/session").param("access_token", "admin"), 401);
        status(get("/technical/session").cookie(new jakarta.servlet.http.Cookie("access_token", "admin")), 401);
    }
    @Test void exactOriginsCanPreflightWithoutCredentials() throws Exception {
        for (int port : List.of(4200, 4201, 4202)) {
            String origin = "http://127.0.0.1:" + port;
            var response = mvc.perform(options("/technical/session").header("Origin", origin)
                .header("Access-Control-Request-Method", "GET").header("Access-Control-Request-Headers", "Authorization"))
                .andReturn().getResponse();
            assertEquals(200, response.getStatus()); assertEquals(origin, response.getHeader("Access-Control-Allow-Origin"));
            assertNull(response.getHeader("Access-Control-Allow-Credentials"));
        }
    }
    @Test void untrustedOriginAndMethodRejected() throws Exception {
        status(options("/technical/session").header("Origin", "http://localhost:4200").header("Access-Control-Request-Method", "GET"), 403);
        status(options("/technical/session").header("Origin", "http://127.0.0.1:4200").header("Access-Control-Request-Method", "POST"), 403);
    }
}
