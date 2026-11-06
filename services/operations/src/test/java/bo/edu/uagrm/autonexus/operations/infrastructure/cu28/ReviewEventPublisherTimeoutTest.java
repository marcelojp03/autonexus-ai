package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * The delivery budget must separate "the receiver is slow" from "the effect happened". A cold n8n
 * execution costs seconds, so a short budget reports a false unavailability; a slow answer that does
 * arrive inside the budget is a confirmation, and a timeout is never one.
 */
class ReviewEventPublisherTimeoutTest {
    private static final String SECRET = "0".repeat(64);

    private HttpServer server;
    private final AtomicInteger calls = new AtomicInteger();

    private ReviewEventPublisher publisherFor(long delayMillis, Duration timeout) throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/webhook", exchange -> {
            calls.incrementAndGet();
            try {
                if (delayMillis > 0) Thread.sleep(delayMillis);
                exchange.sendResponseHeaders(202, -1);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (IOException ignored) {
                // The publisher gave up first: the receiver still applied nothing to its own state.
            } finally {
                exchange.close();
            }
        });
        server.setExecutor(null);
        server.start();
        int port = server.getAddress().getPort();
        return new ReviewEventPublisher(null, null, "http://127.0.0.1:" + port + "/webhook", SECRET, timeout);
    }

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void aReceiverInsideTheBudgetConfirmsTheDelivery() throws IOException {
        ReviewEventPublisher publisher = publisherFor(0, Duration.ofSeconds(2));
        ReviewEventPublisher.Outcome outcome = publisher.send("{\"eventId\":\"probe\"}");
        assertTrue(outcome.delivered());
        assertEquals(null, outcome.errorCode());
    }

    @Test
    void aReceiverSlowerThanTheBudgetIsUnavailableAndNeverADelivery() throws IOException {
        ReviewEventPublisher publisher = publisherFor(3500, ReviewEventPublisher.MIN_REQUEST_TIMEOUT);
        ReviewEventPublisher.Outcome outcome = publisher.send("{\"eventId\":\"probe\"}");
        assertFalse(outcome.delivered(), "a timeout is not a confirmation");
        assertEquals("CU28_WEBHOOK_UNAVAILABLE", outcome.errorCode());
    }

    @Test
    void theDefaultBudgetCoversAColdReceiverButStaysBounded() {
        assertTrue(ReviewEventPublisher.REQUEST_TIMEOUT.compareTo(ReviewEventPublisher.MIN_REQUEST_TIMEOUT) > 0);
        assertTrue(ReviewEventPublisher.REQUEST_TIMEOUT.compareTo(ReviewEventPublisher.MAX_REQUEST_TIMEOUT) < 0);
        assertTrue(ReviewEventPublisher.REQUEST_TIMEOUT.compareTo(Duration.ofSeconds(7)) > 0,
                "the observed cold receiver costs ~7 s, so the budget has to exceed it");
    }

    @Test
    void theClientDoesNotNegotiateHttp2BecauseTheReceiverNeverAnswersTheUpgrade() throws IOException {
        ReviewEventPublisher publisher = publisherFor(0, ReviewEventPublisher.REQUEST_TIMEOUT);
        assertEquals(HttpClient.Version.HTTP_1_1, publisher.http.version(),
                "the cleartext HTTP/2 upgrade of the JDK client hangs against the receiver");
    }

    @Test
    void refusesABudgetThatCannotTellASlowReceiverFromADeadOne() {
        assertThrows(IllegalStateException.class,
                () -> new ReviewEventPublisher(null, null, "http://127.0.0.1:1/webhook", SECRET, Duration.ofSeconds(0)));
        assertThrows(IllegalStateException.class,
                () -> new ReviewEventPublisher(null, null, "http://127.0.0.1:1/webhook", SECRET, Duration.ofSeconds(61)));
        assertThrows(IllegalStateException.class,
                () -> new ReviewEventPublisher(null, null, "http://127.0.0.1:1/webhook", SECRET, null));
    }
}
