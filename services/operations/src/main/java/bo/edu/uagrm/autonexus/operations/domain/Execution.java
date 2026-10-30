package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * CU16 execution of a confirmed, assigned work. It never changes the order status: confirmation
 * belongs to CU15 and progress belongs here. Closing and verifying is CU17 and is not reachable
 * from this aggregate.
 */
public record Execution(
        UUID id,
        UUID orderId,
        String orderNumber,
        UUID assignmentId,
        UUID employeeId,
        String status,
        Instant startedAt,
        int version,
        List<Advance> advances) {

    public static final String IN_PROGRESS = "in_progress";
    /** CU17 owns any terminal state; CU16 must reject anything else instead of inventing it. */
    public static final Set<String> STATUSES = Set.of(IN_PROGRESS);

    public record Advance(
            UUID id,
            int sequence,
            String description,
            int minutesWorked,
            Instant occurredAt,
            Instant recordedAt,
            int version,
            List<Evidence> evidences) {}

    public record Evidence(
            UUID id,
            UUID advanceId,
            String fileName,
            String contentType,
            long sizeBytes,
            String state,
            int attempt,
            String failureCode,
            Instant createdAt,
            Instant confirmedAt) {}

    public record Summary(int pending, int available, int failed) {
        public static Summary of(List<Advance> advances) {
            int pending = 0, available = 0, failed = 0;
            for (Advance advance : advances) {
                for (Evidence evidence : advance.evidences()) {
                    switch (evidence.state()) {
                        case "pending" -> pending++;
                        case "available" -> available++;
                        case "failed" -> failed++;
                        default -> throw new IllegalStateException("Unknown evidence state");
                    }
                }
            }
            return new Summary(pending, available, failed);
        }
    }

    public static final Set<String> START_KEYS = Set.of("operationId", "expectedVersion");
    public static final Set<String> ADVANCE_KEYS =
            Set.of("operationId", "expectedVersion", "description", "minutesWorked", "occurredAt");
    public static final Set<String> EVIDENCE_KEYS =
            Set.of("operationId", "fileName", "contentType", "sizeBytes", "checksumSha256");
    public static final Set<String> CONFIRM_KEYS = Set.of("operationId", "expectedVersion");
    public static final Set<String> RETRY_KEYS =
            Set.of("operationId", "expectedVersion", "checksumSha256");

    /** Closed content types with their hard ceiling. Anything else is not acceptable evidence. */
    public static final Map<String, Long> LIMITS = Map.of(
            "image/jpeg", 5L * 1024 * 1024,
            "image/png", 5L * 1024 * 1024,
            "image/webp", 5L * 1024 * 1024,
            "video/mp4", 20L * 1024 * 1024);

    public static final int MAX_ATTEMPTS = 5;
    public static final int MAX_FILE_NAME = 120;
}
