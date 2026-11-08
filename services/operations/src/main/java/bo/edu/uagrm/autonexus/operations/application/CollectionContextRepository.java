package bo.edu.uagrm.autonexus.operations.application;

import java.time.Instant;
import java.util.UUID;

public interface CollectionContextRepository {
    record Context(UUID orderId, String orderNumber, int orderVersion, String orderStatus,
            UUID sagaId, String sagaStatus, UUID quoteId, Integer quoteVersion, UUID quoteLinkId,
            boolean eligibleForCollection, String reasonCode, Instant observedAt) {}

    Context get(UUID orderId);
}
