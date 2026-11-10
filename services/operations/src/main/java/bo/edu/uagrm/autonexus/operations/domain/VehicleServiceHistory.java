package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Read-only historical facts projected from Operations-owned records. */
public final class VehicleServiceHistory {
    private VehicleServiceHistory() {}

    public record VehicleReference(UUID id, String plate, String make, String model, int year) {}
    public record Service(UUID id, String recordedName, int quantity, int minutes) {}
    public record StorageEvidence(UUID id, String fileName, String contentType, long sizeBytes,
                                  String objectKey, String versionId) {}
    public record EvidenceContent(String fileName, String contentType, byte[] bytes) {}
    public record Entry(UUID orderId, String orderNumber, Instant servicedAt, String type, String status,
                        String description, String observations, String receptionReason, String symptoms,
                        List<Service> services, List<Evidence> evidences) {}
    public record Evidence(UUID id, String fileName, String contentType, long sizeBytes, Instant createdAt) {}
}
