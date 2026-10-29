package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.*;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

/** Synthetic RSA/JWKS unit tests; not an IdP/SSO integration. */
class AccessTokenDecoderTest {
    static final String ISSUER = "http://127.0.0.1:8180/realms/autonexus";
    static final String AUDIENCE = "autonexus-operations-api";
    RSAKey key;
    JwtDecoder decoder;
    @BeforeEach void setup() throws Exception {
        key = new RSAKeyGenerator(2048).keyID("synthetic-unit-key").generate();
        var rest = new RestTemplate();
        var server = MockRestServiceServer.bindTo(rest).build();
        server.expect(org.springframework.test.web.client.ExpectedCount.manyTimes(), requestTo(ISSUER + "/protocol/openid-connect/certs"))
            .andExpect(method(HttpMethod.GET)).andRespond(withSuccess(new JWKSet(key.toPublicJWK()).toString(), MediaType.APPLICATION_JSON));
        decoder = AccessTokenDecoder.create(ISSUER, AUDIENCE, ISSUER + "/protocol/openid-connect/certs", rest);
    }
    JWTClaimsSet.Builder claims() {
        return new JWTClaimsSet.Builder().issuer(ISSUER).audience(AUDIENCE).subject("synthetic-subject")
            .claim("typ", "Bearer").expirationTime(Date.from(Instant.now().plusSeconds(60)));
    }
    String sign(JWTClaimsSet claims, RSAKey signingKey) throws Exception {
        var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).type(JOSEObjectType.JWT).build(), claims);
        jwt.sign(new RSASSASigner(signingKey));
        return jwt.serialize();
    }
    void rejected(JWTClaimsSet claims) throws Exception {
        String fixture = sign(claims, key);
        assertThrows(JwtException.class, () -> decoder.decode(fixture), "Synthetic token must be rejected");
    }
    @Test void separatesPublicIssuerFromTrustedInternalJwks() throws Exception {
        String publicIssuer = "https://workshop.test/identity/realms/autonexus";
        String internalJwks = "http://keycloak:8080/identity/realms/autonexus/protocol/openid-connect/certs";
        var rest = new RestTemplate();
        var server = MockRestServiceServer.bindTo(rest).build();
        server.expect(requestTo(internalJwks)).andRespond(withSuccess(new JWKSet(key.toPublicJWK()).toString(), MediaType.APPLICATION_JSON));
        var portable = AccessTokenDecoder.create(publicIssuer, AUDIENCE, internalJwks, rest);
        assertNotNull(portable.decode(sign(claims().issuer(publicIssuer).build(), key)));
        assertThrows(JwtException.class, () -> portable.decode(sign(claims().build(), key)));
        server.verify();
    }
    @Test void acceptsRealRsaSignature() throws Exception {
        assertEquals("synthetic-subject", decoder.decode(sign(claims().build(), key)).getSubject());
    }
    @Test void rejectsWrongIssuer() throws Exception { rejected(claims().issuer("https://untrusted.invalid").build()); }
    @Test void rejectsWrongAudience() throws Exception { rejected(claims().audience("autonexus-shell").build()); }
    @Test void rejectsMissingExpiration() throws Exception { rejected(claims().expirationTime(null).build()); }
    @Test void rejectsExpired() throws Exception { rejected(claims().expirationTime(Date.from(Instant.now().minusSeconds(10))).build()); }
    @Test void rejectsFutureNotBefore() throws Exception { rejected(claims().notBeforeTime(Date.from(Instant.now().plusSeconds(30))).build()); }
    @Test void permitsFiveSecondSkew() throws Exception {
        assertNotNull(decoder.decode(sign(claims().expirationTime(Date.from(Instant.now().minusSeconds(2))).build(), key)));
    }
    @Test void rejectsMissingSubject() throws Exception { rejected(claims().subject(null).build()); }
    @Test void rejectsMissingIssuer() throws Exception { rejected(claims().issuer(null).build()); }
    @Test void rejectsMissingAudience() throws Exception { rejected(claims().audience((String)null).build()); }
    @Test void rejectsIdToken() throws Exception { rejected(claims().claim("typ", "ID").build()); }
    @Test void rejectsMissingTokenType() throws Exception { rejected(claims().claim("typ", null).build()); }
    @Test void rejectsMalformedTokenType() throws Exception { rejected(claims().claim("typ", 123).build()); }
    @Test void rejectsAlteredSignature() throws Exception {
        String fixture = sign(claims().build(), new RSAKeyGenerator(2048).generate());
        assertThrows(JwtException.class, () -> decoder.decode(fixture));
    }
    @Test void rejectsMalformed() { assertThrows(JwtException.class, () -> decoder.decode("synthetic-malformed")); }
    @Test void rejectsUnsigned() {
        String fixture = new PlainJWT(claims().build()).serialize();
        assertThrows(JwtException.class, () -> decoder.decode(fixture));
    }
    @Test void rejectsHmac() throws Exception {
        var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims().build());
        jwt.sign(new MACSigner(new byte[32]));
        String fixture = jwt.serialize();
        assertThrows(JwtException.class, () -> decoder.decode(fixture));
    }
    @Test void ignoresUntrustedJkuHeader() throws Exception {
        var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID())
            .jwkURL(java.net.URI.create("https://untrusted.invalid/keys")).build(), claims().build());
        jwt.sign(new RSASSASigner(key));
        assertEquals("synthetic-subject", decoder.decode(jwt.serialize()).getSubject());
    }
    @Test void cachesKnownKeyAndRefreshesOnRotation() throws Exception {
        var rest = new RestTemplate();
        var server = MockRestServiceServer.bindTo(rest).build();
        server.expect(requestTo(ISSUER + "/protocol/openid-connect/certs"))
            .andRespond(withSuccess(new JWKSet(key.toPublicJWK()).toString(), MediaType.APPLICATION_JSON));
        var rotated = new RSAKeyGenerator(2048).keyID("synthetic-rotated-key").generate();
        server.expect(requestTo(ISSUER + "/protocol/openid-connect/certs"))
            .andRespond(withSuccess(new JWKSet(rotated.toPublicJWK()).toString(), MediaType.APPLICATION_JSON));
        var cached = AccessTokenDecoder.create(ISSUER, AUDIENCE, ISSUER + "/protocol/openid-connect/certs", rest);
        String original = sign(claims().build(), key);
        assertNotNull(cached.decode(original));
        assertNotNull(cached.decode(original));
        key = rotated;
        assertNotNull(cached.decode(sign(claims().build(), rotated)));
        server.verify();
    }
    @Test void unavailableJwksFailsClosed() throws Exception {
        var rest = new RestTemplate();
        MockRestServiceServer.bindTo(rest).build().expect(requestTo(ISSUER + "/protocol/openid-connect/certs"))
            .andRespond(withServerError());
        var unavailable = AccessTokenDecoder.create(ISSUER, AUDIENCE, ISSUER + "/protocol/openid-connect/certs", rest);
        String fixture = sign(claims().build(), key);
        assertThrows(JwtException.class, () -> unavailable.decode(fixture));
    }
}
