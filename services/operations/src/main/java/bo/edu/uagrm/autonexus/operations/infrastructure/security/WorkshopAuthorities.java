package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import java.util.*;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

public final class WorkshopAuthorities {
    public static final List<String> ROLES = List.of("administrador", "recepcionista", "mecanico", "jefe_taller", "responsable_financiero");

    private WorkshopAuthorities() {}

    public static Collection<GrantedAuthority> from(Jwt jwt) {
        Object realm = jwt.getClaims().get("realm_access");
        if (!(realm instanceof Map<?, ?> access) || !(access.get("roles") instanceof Collection<?> roles)) {
            return List.of();
        }
        return ROLES.stream().filter(roles::contains)
            .<GrantedAuthority>map(SimpleGrantedAuthority::new).toList();
    }
}
