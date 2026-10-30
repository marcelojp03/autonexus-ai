package bo.edu.uagrm.autonexus.operations.infrastructure.evidence;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.EvidenceStorage;
import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.Upload;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.StoredObject;
import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.model.*;

/**
 * CU16 private object storage. Only the service holds credentials: the browser receives a bounded
 * authorization and the download link is generated here, never in the web or the BFF.
 */
public final class S3EvidenceStorage implements EvidenceStorage {
    private final String bucket;
    private final Duration uploadTtl;
    private final S3Client client;
    private final S3Presigner presigner;

    public S3EvidenceStorage(String bucket, Duration uploadTtl, S3Client client,
            S3Presigner presigner) {
        this.bucket = bucket;
        this.uploadTtl = uploadTtl;
        this.client = client;
        this.presigner = presigner;
    }

    public static S3EvidenceStorage create(EvidenceStorageSettings settings) {
        if (!settings.configured()) return null;
        S3Client client = settings.client();
        return new S3EvidenceStorage(settings.bucket(), settings.uploadTtl(), client, settings.presigner());
    }

    private static OperationsError unavailable() {
        return new OperationsError(503, "EVIDENCE_STORAGE_UNAVAILABLE");
    }

    @Override
    public boolean configured() { return true; }

    /**
     * The authorization signs the content type and the declared checksum, asks for a conditional
     * write so the attempt key can be written only once, and is bounded in time. It is reusable
     * until it expires, which is exactly why the object key is per attempt and immutable.
     */
    @Override
    public Upload authorise(String objectKey, long sizeBytes, String contentType, String checksumSha256) {
        try {
            PutObjectRequest request = PutObjectRequest.builder()
                    .bucket(bucket)
                    .key(objectKey)
                    .contentType(contentType)
                    .contentLength(sizeBytes)
                    .checksumSHA256(checksumSha256)
                    // The conditional write must be part of the request being signed. Returning
                    // this header separately would let a holder omit it and overwrite the key.
                    .overrideConfiguration(override -> override.putHeader("If-None-Match", "*"))
                    .build();
            var presigned = presigner.presignPutObject(builder -> builder
                    .signatureDuration(uploadTtl)
                    .putObjectRequest(request));
            var length = presigned.signedHeaders().get("content-length");
            if (length == null || !length.contains(Long.toString(sizeBytes))) throw unavailable();
            var condition = presigned.signedHeaders().get("if-none-match");
            if (condition == null || !condition.contains("*")) throw unavailable();
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Content-Type", contentType);
            headers.put("x-amz-checksum-sha256", checksumSha256);
            headers.put("If-None-Match", "*");
            return new Upload(presigned.url().toString(), "PUT", Map.copyOf(headers),
                    Clock.systemUTC().instant().plus(uploadTtl));
        } catch (RuntimeException failure) {
            throw unavailable();
        }
    }

    @Override
    public Optional<StoredObject> stat(String objectKey) {
        try {
            HeadObjectResponse head = client.headObject(builder -> builder
                    .bucket(bucket).key(objectKey).checksumMode(ChecksumMode.ENABLED));
            return Optional.of(new StoredObject(head.contentLength(), head.contentType(),
                    head.eTag(), head.versionId(), head.checksumSHA256()));
        } catch (NoSuchKeyException missing) {
            return Optional.empty();
        } catch (S3Exception missing) {
            if (missing.statusCode() == 404) return Optional.empty();
            throw unavailable();
        } catch (RuntimeException failure) {
            throw unavailable();
        }
    }

    @Override
    public byte[] prefix(String objectKey, int maxBytes) {
        try {
            GetObjectRequest request = GetObjectRequest.builder()
                    .bucket(bucket).key(objectKey).range("bytes=0-" + (maxBytes - 1)).build();
            return client.getObjectAsBytes(request).asByteArray();
        } catch (RuntimeException failure) {
            throw unavailable();
        }
    }

    @Override
    public void delete(String objectKey) {
        try {
            client.deleteObject(builder -> builder.bucket(bucket).key(objectKey));
        } catch (RuntimeException failure) {
            throw unavailable();
        }
    }

    @Override
    public String download(String objectKey, String versionId, Duration ttl) {
        try {
            GetObjectRequest request = GetObjectRequest.builder()
                    .bucket(bucket).key(objectKey).versionId(versionId == null ? null : versionId).build();
            return presigner.presignGetObject(builder -> builder
                    .signatureDuration(ttl).getObjectRequest(request)).url().toString();
        } catch (RuntimeException failure) {
            throw unavailable();
        }
    }
}
