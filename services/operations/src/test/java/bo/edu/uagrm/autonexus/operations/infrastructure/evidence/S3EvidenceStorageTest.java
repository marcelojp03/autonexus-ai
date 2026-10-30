package bo.edu.uagrm.autonexus.operations.infrastructure.evidence;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class S3EvidenceStorageTest {
    @Test
    void presignsExactSizeChecksumAndConditionalKeyWithoutNetworkOrRealCredentials() {
        var credentials = StaticCredentialsProvider.create(AwsBasicCredentials.create("unit-only", "unit-only"));
        try (S3Client client = S3Client.builder().region(Region.US_EAST_1).credentialsProvider(credentials).build();
             S3Presigner presigner = S3Presigner.builder().region(Region.US_EAST_1).credentialsProvider(credentials).build()) {
            var storage = new S3EvidenceStorage("private-bucket-example", Duration.ofMinutes(5), client, presigner);
            String checksum = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
            var upload = storage.authorise("evidence/order/id/a1-nonce.png", 1024, "image/png", checksum);
            assertEquals("PUT", upload.method());
            assertTrue(upload.url().startsWith("https://"));
            assertEquals("*", upload.headers().get("If-None-Match"));
            String signedHeaders = Arrays.stream(URI.create(upload.url()).getRawQuery().split("&"))
                    .filter(parameter -> parameter.startsWith("X-Amz-SignedHeaders="))
                    .map(parameter -> URLDecoder.decode(parameter.substring("X-Amz-SignedHeaders=".length()), StandardCharsets.UTF_8))
                    .findFirst().orElseThrow();
            assertTrue(Arrays.asList(signedHeaders.split(";")).contains("if-none-match"),
                    () -> "conditional-write header must be covered by the presigned signature: " + signedHeaders);
            assertEquals("image/png", upload.headers().get("Content-Type"));
            assertEquals(checksum, upload.headers().get("x-amz-checksum-sha256"));
            assertTrue(upload.expiresAt().isAfter(java.time.Instant.now()));
        }
    }
}
