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
 * HTTP outside any business transaction and only then marked delivered; a failed delivery schedules
 * the same eventId again. Nothing here can roll back the CU17 repair that produced the row, and
 * neither can it confirm it: the review request is already committed before the first attempt.
 */
public final class ReviewEventPublisher {
    private static final Logger LOG = LoggerFactory.getLogger(ReviewEventPublisher.class);

    static final int MAX_ATTEMPTS = 10;
    static final Duration LEASE = Duration.ofSeconds(30);
    static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(5);
    private static final long BASE_DELAY_MILLIS = 1000;
    private static final long MAX_DELAY_MILLIS = 10000;

    private final JdbcClient db;
    private final TransactionTemplate tx;
    private final String webhookUrl;
    private final String secret;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    public ReviewEventPublisher(JdbcClient db, TransactionTemplate tx, String webhookUrl, String secret) {
        if (secret == null || secret.isBlank()) throw new IllegalStateException("CU28_WEBHOOK_SECRET must be configured and non-empty");
        URI uri = URI.create(webhookUrl);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
            throw new IllegalStateException("Invalid configuration: CU28_WEBHOOK_URL");
        }
        this.db = db;
        this.tx = tx;
        this.webhookUrl = webhookUrl;
        this.secret = secret;
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
        Outcome outcome = send(claim.payload());
        record(claim, outcome);
        return claim.eventId();
    }

    private Claim claim(Instant now) {
        return tx.execute(status -> {
            List<Claim> due = db.sql("""
                    SELECT event_id,payload,attempts FROM operations.cu28_outbox
                    WHERE delivered_at IS NULL AND abandoned_at IS NULL AND next_attempt_at<=?
                      AND (lease_until IS NULL OR lease_until<=?)
                    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1
                    """).params(java.sql.Timestamp.from(now), java.sql.Timestamp.from(now))
                    .query((rs, index) -> new Claim(rs.getObject("event_id", UUID.class), rs.getString("payload"),
                            rs.getInt("attempts"), UUID.randomUUID())).list();
            if (due.isEmpty()) return null;
            Claim found = due.getFirst();
            int attempts = db.sql("""
                    UPDATE operations.cu28_outbox SET lease_owner=?,lease_until=?,attempts=attempts+1
                    WHERE event_id=? RETURNING attempts
                    """).params(found.owner(), java.sql.Timestamp.from(now.plus(LEASE)), found.eventId())
                    .query(Integer.class).single();
            return new Claim(found.eventId(), found.payload(), attempts, found.owner());
        });
    }

    private Outcome send(String payload) {
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(webhookUrl))
                    .timeout(REQUEST_TIMEOUT)
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

    private record Claim(UUID eventId, String payload, int attempts, UUID owner) {}

    private record Outcome(boolean delivered, String errorCode) {}
}
