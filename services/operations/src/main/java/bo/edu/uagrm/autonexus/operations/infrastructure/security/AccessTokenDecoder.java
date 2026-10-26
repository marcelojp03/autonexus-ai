package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import java.time.Duration;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.web.client.RestOperations;

public final class AccessTokenDecoder {
    private AccessTokenDecoder() {}

    public static JwtDecoder create(String issuer, String audience, RestOperations rest) {
        var decoder = NimbusJwtDecoder.withJwkSetUri(issuer + "/protocol/openid-connect/certs")
            .jwsAlgorithm(SignatureAlgorithm.RS256).restOperations(rest).build();
        var required = new JwtClaimValidator<Object>("exp", value -> value != null);
        var subject = new JwtClaimValidator<Object>("sub", value -> value instanceof String text && !text.isBlank());
        var accessToken = new JwtClaimValidator<Object>("typ", "Bearer"::equals);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            new JwtTimestampValidator(Duration.ofSeconds(5)), new JwtIssuerValidator(issuer),
            new JwtAudienceValidator(audience), required, subject, accessToken));
        return decoder;
    }
}
