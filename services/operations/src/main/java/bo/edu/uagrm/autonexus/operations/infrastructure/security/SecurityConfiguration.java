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
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.*;

@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {
    @Bean
    JwtDecoder jwtDecoder(@Value("${OIDC_ISSUER_URI:http://127.0.0.1:8180/realms/autonexus}") String issuer,
                          @Value("${OIDC_AUDIENCE:autonexus-operations-api}") String audience) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(2000);
        return AccessTokenDecoder.create(issuer, audience, new RestTemplate(factory));
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, JwtDecoder decoder,
            @Value("${WEB_ALLOWED_ORIGINS:http://127.0.0.1:4200,http://127.0.0.1:4201,http://127.0.0.1:4202}") String origins) throws Exception {
        var cors = new CorsConfiguration();
        cors.setAllowedOrigins(Arrays.stream(origins.split(",")).map(String::trim).toList());
        if (cors.getAllowedOrigins().stream().anyMatch(origin -> origin.contains("*"))) {
            throw new IllegalArgumentException("Explicit WEB_ALLOWED_ORIGINS required");
        }
        cors.setAllowedMethods(List.of("GET", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        cors.setAllowCredentials(false);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/technical/session", cors);
        source.registerCorsConfiguration("/technical/admin", cors);
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(WorkshopAuthorities::from);
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
