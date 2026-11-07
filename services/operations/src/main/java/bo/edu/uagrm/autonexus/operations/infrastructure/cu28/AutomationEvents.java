package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public final class AutomationEvents {
    public static final String ASSIGNMENT = "operations.assignment.confirmed.v1";
    public static final String REMINDER = "operations.appointment.reminder.due.v1";

    private AutomationEvents() {}

    public static UUID id(String type, UUID aggregateId, long version) {
        return UUID.nameUUIDFromBytes((type + '|' + aggregateId + '|' + version).getBytes(StandardCharsets.UTF_8));
    }

    public static Map<String, Object> envelope(String type, String aggregateType, UUID aggregateId,
            long version, UUID correlationId, UUID cause, Instant now, String actor, Map<String, Object> data) {
        var event = new TreeMap<String, Object>();
        event.put("eventId", id(type, aggregateId, version).toString());
        event.put("schemaVersion", 1);
        event.put("eventType", type);
        event.put("producer", "operations");
        event.put("aggregateType", aggregateType);
        event.put("aggregateId", aggregateId.toString());
        event.put("aggregateVersion", version);
        event.put("correlationId", correlationId.toString());
        event.put("causationId", cause.toString());
        event.put("occurredAt", ReviewRequestedEvent.utc(now));
        event.put("initiatedBy", actor);
        event.put("executedBy", "autonexus-operations-cu28");
        event.put("data", data);
        return event;
    }

    public static void insert(JdbcClient db, Map<String, Object> event, String payload, Instant now) {
        db.sql("""
                INSERT INTO operations.cu28_outbox(event_id,event_type,aggregate_type,aggregate_id,
                    aggregate_version,correlation_id,causation_id,payload,occurred_at,next_attempt_at)
                VALUES(?,?,?,?,?,?,?,?::jsonb,?,?) ON CONFLICT (event_id) DO NOTHING
                """).params(UUID.fromString(event.get("eventId").toString()), event.get("eventType"),
                event.get("aggregateType"), UUID.fromString(event.get("aggregateId").toString()),
                event.get("aggregateVersion"), UUID.fromString(event.get("correlationId").toString()),
                UUID.fromString(event.get("causationId").toString()), payload,
                Timestamp.from(now), Timestamp.from(now)).update();
    }
}
