package bo.edu.uagrm.autonexus.operations.infrastructure.http;

import bo.edu.uagrm.autonexus.operations.infrastructure.security.WorkshopAuthorities;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/technical")
public class TechnicalController {
    public record Session(String resource, String service, String subject, List<String> roles) {}
    public record Admin(String resource, String service, boolean authorized) {}

    @GetMapping("/session")
    public Session session(JwtAuthenticationToken authentication) {
        return new Session("session", "operations", authentication.getToken().getSubject(),
            authentication.getAuthorities().stream().map(GrantedAuthority::getAuthority)
                .filter(WorkshopAuthorities.ROLES::contains).toList());
    }

    @GetMapping("/admin")
    public Admin admin() {
        return new Admin("admin", "operations", true);
    }
}
