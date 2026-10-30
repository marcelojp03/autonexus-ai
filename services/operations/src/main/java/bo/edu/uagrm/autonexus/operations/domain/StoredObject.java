package bo.edu.uagrm.autonexus.operations.domain;

/** What the private storage reports about a stored object, plus the version it belongs to. */
public record StoredObject(
        Long size,
        String contentType,
        String etag,
        String versionId,
        String checksumSha256) {}
