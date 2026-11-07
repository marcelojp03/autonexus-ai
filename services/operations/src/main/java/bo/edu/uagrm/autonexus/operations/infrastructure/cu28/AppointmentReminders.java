package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Component
public class AppointmentReminders {
    static final ZoneId ZONE = ZoneId.of("America/La_Paz");
    private final JdbcClient db;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final Clock clock;
    private final int leadHours;

    @org.springframework.beans.factory.annotation.Autowired
    public AppointmentReminders(JdbcClient db, TransactionTemplate tx, ObjectMapper json,
            @Value("${CU28_APPOINTMENT_REMINDER_LEAD_HOURS:48}") int leadHours) {
        this(db, tx, json, leadHours, Clock.systemUTC());
    }

    AppointmentReminders(JdbcClient db, TransactionTemplate tx, ObjectMapper json, int leadHours, Clock clock) {
        if (leadHours < 1 || leadHours > 168) throw new IllegalArgumentException("CU28_APPOINTMENT_REMINDER_LEAD_HOURS must be 1..168");
        this.db = db;
        this.tx = tx;
        this.json = json;
        this.leadHours = leadHours;
        this.clock = clock;
    }

    public record EventReference(UUID eventId, UUID aggregateId, int aggregateVersion) {}
    private record Candidate(UUID id, int version, Instant startsAt, Instant endsAt) {}
    record Window(Instant from, Instant to, Instant horizon) {}

    static Window window(Instant now, int leadHours) {
        var tomorrow = now.atZone(ZONE).toLocalDate().plusDays(1);
        return new Window(tomorrow.atStartOfDay(ZONE).toInstant(),
                tomorrow.plusDays(1).atStartOfDay(ZONE).toInstant(), now.plusSeconds(leadHours * 3600L));
    }

    public List<EventReference> create(String actor) {
        Instant now = clock.instant();
        Window window = window(now, leadHours);
        return tx.execute(status -> {
            var candidates = db.sql("""
                    SELECT id,version,starts_at,ends_at FROM operations.appointments
                    WHERE status='scheduled' AND starts_at>=? AND starts_at<? AND starts_at<=?
                    ORDER BY starts_at,id FOR UPDATE
                    """).params(Timestamp.from(window.from()), Timestamp.from(window.to()), Timestamp.from(window.horizon()))
                    .query((rs, n) -> new Candidate(rs.getObject("id", UUID.class), rs.getInt("version"),
                            rs.getTimestamp("starts_at").toInstant(), rs.getTimestamp("ends_at").toInstant())).list();
            return candidates.stream().map(candidate -> {
                UUID eventId = AutomationEvents.id(AutomationEvents.REMINDER, candidate.id(), candidate.version());
                var event = AutomationEvents.envelope(AutomationEvents.REMINDER, "appointment", candidate.id(),
                        candidate.version(), candidate.id(), eventId, now, actor,
                        Map.of("appointmentId", candidate.id().toString(), "version", candidate.version(),
                            "status", "scheduled", "startsAt", candidate.startsAt().toString(),
                            "endsAt", candidate.endsAt().toString(), "timeZone", ZONE.getId()));
                AutomationEvents.insert(db, event, json.writeValueAsString(event), now);
                return new EventReference(eventId, candidate.id(), candidate.version());
            }).toList();
        });
    }
}
