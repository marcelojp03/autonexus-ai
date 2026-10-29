package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Resolves the caller permissions from the Employees owner (CU02 catalog). The service never
 * reads another schema; a resolution failure yields no permissions (fail closed).
 */
@Component
public class EmployeePermissionsClient {
    private record Entry(Set<String> permissions, long expiresAt) {}

    private record PermissionsResponse(List<String> effective, List<String> roles, List<Object> catalog) {}

    private final RestClient client;
    private final long ttlMillis;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    public EmployeePermissionsClient(
            @Value("${EMPLOYEES_API_URL:http://127.0.0.1:3002}") String baseUrl,
            @Value("${operations.permissions.ttl-seconds:30}") long ttlSeconds) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(2000);
        this.client = RestClient.builder().baseUrl(bo.edu.uagrm.autonexus.operations.infrastructure.config.TransportConfiguration.url(baseUrl, "EMPLOYEES_API_URL")).requestFactory(factory).build();
        this.ttlMillis = Math.max(1, ttlSeconds) * 1000L;
    }

    public Set<String> permissions(String token, String subject, Collection<String> roles) {
        String key = subject + '|' + roles.stream().sorted().collect(Collectors.joining(","));
        long now = System.currentTimeMillis();
        Entry cached = cache.get(key);
        if (cached != null && cached.expiresAt() > now) return cached.permissions();
        Set<String> resolved = resolve(token);
        if (cache.size() > 500) cache.clear();
        cache.put(key, new Entry(resolved, now + ttlMillis));
        return resolved;
    }

    private Set<String> resolve(String token) {
        try {
            PermissionsResponse response = client.get()
                    .uri("/security/permissions")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .retrieve()
                    .body(PermissionsResponse.class);
            if (response == null || response.effective() == null) return Set.of();
            return Set.copyOf(response.effective());
        } catch (RuntimeException error) {
            return Set.of();
        }
    }
}
