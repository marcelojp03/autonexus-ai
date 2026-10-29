package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import java.util.Arrays;
import java.util.List;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.*;

@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {
    private static final List<String> BUSINESS_PATHS = List.of(
            "/customers/**", "/vehicles/**", "/services/**", "/appointments/**", "/receptions/**", "/orders/**", "/confirmations/**");

    @Bean
    JwtDecoder jwtDecoder(@Value("${OIDC_ISSUER_URI:http://127.0.0.1:8180/realms/autonexus}") String issuer,
                          @Value("${OIDC_AUDIENCE:autonexus-operations-api}") String audience) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(2000);
        return AccessTokenDecoder.create(issuer, audience, new RestTemplate(factory));
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, JwtDecoder decoder, EmployeePermissionsClient permissions,
            @Value("${WEB_ALLOWED_ORIGINS:http://127.0.0.1:4200,http://127.0.0.1:4201,http://127.0.0.1:4202}") String origins) throws Exception {
        var cors = new CorsConfiguration();
        cors.setAllowedOrigins(Arrays.stream(origins.split(",")).map(String::trim).toList());
        if (cors.getAllowedOrigins().stream().anyMatch(origin -> origin.contains("*"))) {
            throw new IllegalArgumentException("Explicit WEB_ALLOWED_ORIGINS required");
        }
        var technicalCors = new CorsConfiguration(cors);
        technicalCors.setAllowedMethods(List.of("GET", "OPTIONS"));
        var businessCors = new CorsConfiguration(cors);
        businessCors.setAllowedMethods(List.of("GET", "POST", "PUT", "OPTIONS"));
        businessCors.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        businessCors.setAllowCredentials(false);
        var source = new UrlBasedCorsConfigurationSource();
        technicalCors.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        technicalCors.setAllowCredentials(false);
        source.registerCorsConfiguration("/technical/session", technicalCors);
        source.registerCorsConfiguration("/technical/admin", technicalCors);
        for (String path : BUSINESS_PATHS) source.registerCorsConfiguration(path, businessCors);
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            var authorities = new java.util.ArrayList<GrantedAuthority>(WorkshopAuthorities.from(jwt));
            authorities.addAll(PermissionAuthorities.from(jwt, permissions));
            return authorities;
        });
        var resolver = new DefaultBearerTokenResolver();
        resolver.setAllowUriQueryParameter(false);
        resolver.setAllowFormEncodedBodyParameter(false);
        // Bearer-only API: browsers cannot supply authentication through ambient cookies.
        http.csrf(AbstractHttpConfigurer::disable)
            .cors(config -> config.configurationSource(source))
            .sessionManagement(config -> config.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .requestCache(AbstractHttpConfigurer::disable)
            .formLogin(AbstractHttpConfigurer::disable).httpBasic(AbstractHttpConfigurer::disable)
            .logout(AbstractHttpConfigurer::disable)
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
                .requestMatchers(HttpMethod.GET, "/technical/session").hasAnyAuthority(WorkshopAuthorities.ROLES.toArray(String[]::new))
                .requestMatchers(HttpMethod.GET, "/technical/admin").hasAuthority("administrador")
                // CU06 customers
                .requestMatchers(HttpMethod.GET, "/customers", "/customers/*").hasAuthority("customers:read")
                .requestMatchers(HttpMethod.POST, "/customers").hasAuthority("customers:write")
                .requestMatchers(HttpMethod.PUT, "/customers/*").hasAuthority("customers:write")
                .requestMatchers(HttpMethod.POST, "/customers/*/deactivate").hasAuthority("customers:write")
                // CU07 vehicles
                .requestMatchers(HttpMethod.GET, "/vehicles", "/vehicles/*").hasAuthority("vehicles:read")
                .requestMatchers(HttpMethod.POST, "/vehicles").hasAuthority("vehicles:write")
                .requestMatchers(HttpMethod.PUT, "/vehicles/*").hasAuthority("vehicles:write")
                .requestMatchers(HttpMethod.POST, "/vehicles/*/deactivate").hasAuthority("vehicles:write")
                // CU09 service catalog
                .requestMatchers(HttpMethod.GET, "/services", "/services/*").hasAuthority("catalog:read")
                .requestMatchers(HttpMethod.POST, "/services").hasAuthority("catalog:write")
                .requestMatchers(HttpMethod.PUT, "/services/*").hasAuthority("catalog:write")
                .requestMatchers(HttpMethod.POST, "/services/*/deactivate").hasAuthority("catalog:write")
                // CU10 appointments
                .requestMatchers(HttpMethod.GET, "/appointments", "/appointments/*").hasAuthority("appointments:read")
                .requestMatchers(HttpMethod.POST, "/appointments").hasAuthority("appointments:write")
                .requestMatchers(HttpMethod.PUT, "/appointments/*").hasAuthority("appointments:write")
                .requestMatchers(HttpMethod.POST, "/appointments/*/cancel").hasAuthority("appointments:write")
                // CU11 receptions
                .requestMatchers(HttpMethod.GET, "/receptions", "/receptions/*").hasAuthority("receptions:read")
                .requestMatchers(HttpMethod.POST, "/receptions").hasAuthority("receptions:write")
                // CU12 work orders
                .requestMatchers(HttpMethod.GET, "/confirmations/**", "/orders/*/confirmations").hasAuthority("confirmations:read")
                .requestMatchers(HttpMethod.POST, "/orders/*/confirmations", "/confirmations/*/retry").hasAuthority("confirmations:write")
                .requestMatchers(HttpMethod.GET, "/orders", "/orders/*").hasAuthority("orders:read")
                .requestMatchers(HttpMethod.POST, "/orders").hasAuthority("orders:write")
                .anyRequest().denyAll())
            .exceptionHandling(config -> config
                .authenticationEntryPoint((request, response, error) -> unauthorized(response))
                .accessDeniedHandler((request, response, error) -> genericError(response, 403, "forbidden")))
            .oauth2ResourceServer(config -> config.bearerTokenResolver(resolver)
                .authenticationEntryPoint((request, response, error) -> unauthorized(response))
                .accessDeniedHandler((request, response, error) -> genericError(response, 403, "forbidden"))
                .jwt(jwt -> jwt.decoder(decoder).jwtAuthenticationConverter(converter)));
        return http.build();
    }

    private static void unauthorized(HttpServletResponse response) throws IOException {
        response.setHeader("WWW-Authenticate", "Bearer");
        genericError(response, 401, "unauthorized");
    }

    private static void genericError(HttpServletResponse response, int status, String error) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + error + "\"}");
    }
}
