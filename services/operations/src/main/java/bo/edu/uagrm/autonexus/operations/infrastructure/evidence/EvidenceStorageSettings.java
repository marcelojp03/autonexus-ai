package bo.edu.uagrm.autonexus.operations.infrastructure.evidence;

import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import java.util.regex.Pattern;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * CU16 storage settings. Private by construction: the bucket, region and credentials come from the
 * environment of this service and never reach an image, Git, the BFF or the browser. A missing
 * bucket or region leaves the evidence flow honestly unavailable instead of pretending to work.
 */
public record EvidenceStorageSettings(
        String bucket,
        String region,
        URI endpoint,
        boolean pathStyle,
        Duration uploadTtl) {

    private static final Pattern BUCKET = Pattern.compile("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$");

    public static EvidenceStorageSettings fromEnvironment() {
        String bucket = trim(System.getenv("S3_EVIDENCE_BUCKET"));
        String region = trim(System.getenv("S3_EVIDENCE_REGION"));
        String rawEndpoint = trim(System.getenv("S3_EVIDENCE_ENDPOINT"));
        boolean pathStyle = "true".equalsIgnoreCase(trim(System.getenv("S3_EVIDENCE_PATH_STYLE")));
        long seconds = parseTtl(System.getenv("S3_EVIDENCE_UPLOAD_TTL_SECONDS"), 300);
        if (bucket == null || region == null) return new EvidenceStorageSettings(null, null, null, false, Duration.ofSeconds(seconds));
        if (!BUCKET.matcher(bucket).matches()) throw new IllegalArgumentException("Invalid S3_EVIDENCE_BUCKET");
        if (!Pattern.compile("^[a-z0-9-]{2,32}$").matcher(region.toLowerCase(Locale.ROOT)).matches()) {
            throw new IllegalArgumentException("Invalid S3_EVIDENCE_REGION");
        }
        URI endpoint = rawEndpoint == null ? null : URI.create(rawEndpoint);
        if (endpoint != null && (!"https".equals(endpoint.getScheme()) || endpoint.getHost() == null || endpoint.getUserInfo() != null)) {
            throw new IllegalArgumentException("S3_EVIDENCE_ENDPOINT must be an https URI without credentials");
        }
        return new EvidenceStorageSettings(bucket, region.toLowerCase(Locale.ROOT), endpoint, pathStyle, Duration.ofSeconds(seconds));
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static long parseTtl(String value, long fallback) {
        if (value == null || value.isBlank()) return fallback;
        long seconds = Long.parseLong(value.trim());
        if (seconds < 30 || seconds > 3600) throw new IllegalArgumentException("Invalid upload TTL");
        return seconds;
    }

    public boolean configured() { return bucket != null && region != null; }

    S3Client client() {
        var builder = S3Client.builder()
                .region(Region.of(region))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(pathStyle).build());
        if (endpoint != null) builder.endpointOverride(endpoint);
        return builder.build();
    }

    S3Presigner presigner() {
        var builder = S3Presigner.builder()
                .region(Region.of(region))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(pathStyle).build());
        if (endpoint != null) builder.endpointOverride(endpoint);
        return builder.build();
    }
}
