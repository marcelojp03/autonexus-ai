package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * CU28 Outbox publisher. A due row is claimed with a lease in its own transaction, delivered over
 * HTTP after the producing business transaction and only then marked delivered; a failed delivery schedules
 * the same eventId again. Nothing here can roll back the CU17 repair that produced the row, and
 * neither can it confirm it: the review request is already committed before the first attempt.
 */
public final class ReviewEventPublisher {
    private static final Logger LOG = LoggerFactory.getLogger(ReviewEventPublisher.class);

    static final int MAX_ATTEMPTS = 10;
    static final Duration LEASE = Duration.ofSeconds(30);
    /**
     * Budget for the whole delivery exchange. The receiver is n8n running the workflow's Code nodes in
     * task runners: a warm execution answers in ~0.9 s, but the first execution after the runner went
     * idle costs ~7 s (measured 2026-11-06, see docs/evidence/cu28-20261106.md), so the 5 s budget in
     * use before turned every cold delivery into a false CU28_WEBHOOK_UNAVAILABLE and exhausted the row.
     */
    static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);
    static final Duration MIN_REQUEST_TIMEOUT = Duration.ofSeconds(2);
    static final Duration MAX_REQUEST_TIMEOUT = Duration.ofSeconds(60);
    private static final long BASE_DELAY_MILLIS = 1000;
    private static final long MAX_DELAY_MILLIS = 10000;

    private final JdbcClient db;
    private final TransactionTemplate tx;
    private final String webhookUrl;
    private final String secret;
    private final Duration requestTimeout;
    /**
     * HTTP/1.1 is pinned because the receiver accepts the cleartext HTTP/2 upgrade of the JDK client
     * and never answers it: the same request measured from this container hung until the client
     * timeout with the default version and answered in ~1-3 s with HTTP/1.1 (2026-11-06). The whole
     * exchange is a single small POST, so nothing is lost by not negotiating HTTP/2.
     */
    final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    public ReviewEventPublisher(JdbcClient db, TransactionTemplate tx, String webhookUrl, String secret) {
        this(db, tx, webhookUrl, secret, REQUEST_TIMEOUT);
    }

    /** A shorter budget hides a slow receiver behind false unavailability; a longer one hides a dead one. */
    public ReviewEventPublisher(JdbcClient db, TransactionTemplate tx, String webhookUrl, String secret,
            Duration requestTimeout) {
        if (secret == null || secret.isBlank()) throw new IllegalStateException("CU28_WEBHOOK_SECRET must be configured and non-empty");
        URI uri = URI.create(webhookUrl);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
            throw new IllegalStateException("Invalid configuration: CU28_WEBHOOK_URL");
        }
        if (requestTimeout == null || requestTimeout.compareTo(MIN_REQUEST_TIMEOUT) < 0
                || requestTimeout.compareTo(MAX_REQUEST_TIMEOUT) > 0) {
            throw new IllegalStateException("Invalid configuration: CU28_WEBHOOK_TIMEOUT_SECONDS must be between "
                    + MIN_REQUEST_TIMEOUT.toSeconds() + " and " + MAX_REQUEST_TIMEOUT.toSeconds());
        }
        this.db = db;
        this.tx = tx;
        this.webhookUrl = webhookUrl;
        this.secret = secret;
        this.requestTimeout = requestTimeout;
    }

    /** Never throws: a deferred delivery is retried, never turned into a business failure. */
    public void tick() {
        try {
            deliverNext();
        } catch (RuntimeException failure) {
            LOG.warn("CU28 delivery deferred: {}", failure.getClass().getSimpleName());
        }
    }

    /** Delivers at most one pending event and returns its eventId, or null when nothing was due. */
    UUID deliverNext() {
        Instant now = Instant.now();
        Claim claim = claim(now);
        if (claim == null) return null;
        tx.executeWithoutResult(status -> {
            // Appointment before Outbox matches reminder creation. UPDATE in CU10 takes this same row lock.
            if (AutomationEvents.REMINDER.equals(claim.eventType())) {
                db.sql("SELECT true FROM operations.appointments WHERE id=? FOR UPDATE")
                        .param(claim.aggregateId()).query(Boolean.class).optional();
            }
            boolean owned = db.sql("""
                    SELECT true FROM operations.cu28_outbox
                    WHERE event_id=? AND lease_owner=? AND lease_until>?
                      AND delivered_at IS NULL AND suppressed_at IS NULL AND abandoned_at IS NULL
                    FOR UPDATE
                    """).params(claim.eventId(), claim.owner(), java.sql.Timestamp.from(Instant.now()))
                    .query(Boolean.class).optional().orElse(false);
            if (!owned) return;
            boolean current = !AutomationEvents.REMINDER.equals(claim.eventType()) || db.sql("""
                    SELECT EXISTS (SELECT 1 FROM operations.appointments
                    WHERE id=? AND version=? AND status='scheduled' AND starts_at>?
                      AND starts_at=(?::jsonb->'data'->>'startsAt')::timestamptz)
                    """).params(claim.aggregateId(), claim.aggregateVersion(),
                            java.sql.Timestamp.from(Instant.now()), claim.payload()).query(Boolean.class).single();
            if (!current) {
                db.sql("""
                        UPDATE operations.cu28_outbox
                        SET suppressed_at=?,last_error_code='CU28_APPOINTMENT_REMINDER_STALE',lease_owner=NULL,lease_until=NULL
                        WHERE event_id=? AND lease_owner=? AND lease_until>?
                          AND delivered_at IS NULL AND suppressed_at IS NULL AND abandoned_at IS NULL
                        """).params(java.sql.Timestamp.from(Instant.now()), claim.eventId(), claim.owner(),
                                java.sql.Timestamp.from(Instant.now())).update();
                return;
            }
            record(claim, send(claim.payload()));
        });
        return claim.eventId();
    }

    private Claim claim(Instant now) {
        return tx.execute(status -> {
            List<Claim> due = db.sql("""
                    SELECT event_id,payload,attempts,event_type,aggregate_id,aggregate_version FROM operations.cu28_outbox
                    WHERE delivered_at IS NULL AND abandoned_at IS NULL AND suppressed_at IS NULL AND next_attempt_at<=?
                      AND (lease_until IS NULL OR lease_until<=?)
                    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1
                    """).params(java.sql.Timestamp.from(now), java.sql.Timestamp.from(now))
                    .query((rs, index) -> new Claim(rs.getObject("event_id", UUID.class), rs.getString("payload"),
                            rs.getInt("attempts"), UUID.randomUUID(), rs.getString("event_type"),
                            rs.getObject("aggregate_id", UUID.class), rs.getInt("aggregate_version"))).list();
            if (due.isEmpty()) return null;
            Claim found = due.getFirst();
            if (found.attempts() >= MAX_ATTEMPTS) {
                db.sql("""
                        UPDATE operations.cu28_outbox
                        SET abandoned_at=?,last_error_code='CU28_DELIVERY_ATTEMPTS_EXHAUSTED',lease_owner=NULL,lease_until=NULL
                        WHERE event_id=?
                        """).params(java.sql.Timestamp.from(now), found.eventId()).update();
                return null;
            }
            int attempts = db.sql("""
                    UPDATE operations.cu28_outbox SET lease_owner=?,lease_until=?,attempts=attempts+1
                    WHERE event_id=? RETURNING attempts
                    """).params(found.owner(), java.sql.Timestamp.from(now.plus(LEASE)), found.eventId())
                    .query(Integer.class).single();
            return new Claim(found.eventId(), found.payload(), attempts, found.owner(), found.eventType(),
                    found.aggregateId(), found.aggregateVersion());
        });
    }

    Outcome send(String payload) {
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(webhookUrl))
                    .timeout(requestTimeout)
                    .header("content-type", "application/json")
                    .header("x-autonexus-secret", secret)
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
        } catch (RuntimeException failure) {
            return new Outcome(false, "CU28_WEBHOOK_REQUEST_INVALID");
        }
        try {
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            int status = response.statusCode();
            if (status >= 200 && status < 300) return new Outcome(true, null);
            return new Outcome(false, "CU28_WEBHOOK_HTTP_" + status);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return new Outcome(false, "CU28_WEBHOOK_INTERRUPTED");
        } catch (Exception failure) {
            // Timeout or refused connection: the event stays pending, never treated as confirmed.
            return new Outcome(false, "CU28_WEBHOOK_UNAVAILABLE");
        }
    }

    private void record(Claim claim, Outcome outcome) {
        Instant now = Instant.now();
        if (outcome.delivered()) {
            db.sql("""
                    UPDATE operations.cu28_outbox
                    SET delivered_at=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,last_error_code=NULL
                    WHERE event_id=? AND lease_owner=? AND lease_until>?
                      AND delivered_at IS NULL AND suppressed_at IS NULL AND abandoned_at IS NULL
                    """).params(java.sql.Timestamp.from(now), java.sql.Timestamp.from(now), claim.eventId(),
                    claim.owner(), java.sql.Timestamp.from(now)).update();
            return;
        }
        boolean exhausted = claim.attempts() >= MAX_ATTEMPTS;
        Instant next = now.plusMillis(delayMillis(claim.attempts()));
        db.sql("""
                UPDATE operations.cu28_outbox
                SET next_attempt_at=?,abandoned_at=?,lease_owner=NULL,lease_until=NULL,last_error_code=?
                WHERE event_id=? AND lease_owner=? AND lease_until>?
                  AND delivered_at IS NULL AND suppressed_at IS NULL AND abandoned_at IS NULL
                """).params(java.sql.Timestamp.from(next), exhausted ? java.sql.Timestamp.from(now) : null,
                exhausted ? "CU28_DELIVERY_ATTEMPTS_EXHAUSTED" : outcome.errorCode(), claim.eventId(),
                claim.owner(), java.sql.Timestamp.from(now)).update();
        LOG.info("CU28 delivery scheduled again: attempt={} code={}", claim.attempts(), outcome.errorCode());
    }

    /** Capped exponential backoff: 1s, 2s, 4s, 8s and then every 10s until the cap. */
    static long delayMillis(int attempts) {
        int exponent = Math.max(0, Math.min(6, attempts - 1));
        return Math.min(MAX_DELAY_MILLIS, BASE_DELAY_MILLIS * (1L << exponent));
    }

    private record Claim(UUID eventId, String payload, int attempts, UUID owner, String eventType,
            UUID aggregateId, int aggregateVersion) {}

    record Outcome(boolean delivered, String errorCode) {}
}
