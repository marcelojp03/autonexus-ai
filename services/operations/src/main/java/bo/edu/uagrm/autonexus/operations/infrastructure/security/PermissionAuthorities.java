package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

/** Adds the CU02 permission catalog identifiers as authorities for the request. */
public final class PermissionAuthorities {
    private PermissionAuthorities() {}

    public static Collection<GrantedAuthority> from(Jwt jwt, EmployeePermissionsClient client) {
        Object realm = jwt.getClaims().get("realm_access");
        List<String> roles = realm instanceof java.util.Map<?, ?> access && access.get("roles") instanceof Collection<?> values
                ? values.stream().filter(String.class::isInstance).map(String.class::cast).toList()
                : List.of();
        var authorities = new ArrayList<GrantedAuthority>();
        for (String permission : client.permissions(jwt.getTokenValue(), jwt.getSubject(), roles)) {
            authorities.add(new SimpleGrantedAuthority(permission));
        }
        return authorities;
    }
}
