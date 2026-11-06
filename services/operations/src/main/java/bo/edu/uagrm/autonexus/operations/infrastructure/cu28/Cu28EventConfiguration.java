package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * CU28 publisher wiring. Without CU28_WEBHOOK_URL the publisher stays disabled and Outbox rows wait
 * in the owner's database; with a URL, a missing secret stops the start instead of sending
 * unauthenticated requests.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "CU28_WEBHOOK_URL")
public class Cu28EventConfiguration {

    @Bean
    ReviewEventPublisher reviewEventPublisher(JdbcClient db, TransactionTemplate tx,
            @Value("${CU28_WEBHOOK_URL}") String webhookUrl,
            @Value("${CU28_WEBHOOK_SECRET:}") String webhookSecret,
            @Value("${CU28_WEBHOOK_TIMEOUT_SECONDS:15}") int webhookTimeoutSeconds) {
        return new ReviewEventPublisher(db, tx, webhookUrl, webhookSecret,
                java.time.Duration.ofSeconds(webhookTimeoutSeconds));
    }

    @Bean
    ReviewEventPublisherWorker reviewEventPublisherWorker(ReviewEventPublisher publisher) {
        return new ReviewEventPublisherWorker(publisher);
    }

    static final class ReviewEventPublisherWorker {
        private static final Logger LOG = LoggerFactory.getLogger(ReviewEventPublisherWorker.class);
        private final ReviewEventPublisher publisher;

        ReviewEventPublisherWorker(ReviewEventPublisher publisher) {
            this.publisher = publisher;
        }

        @Scheduled(fixedDelay = 2000)
        public void tick() {
            try {
                var eventId = publisher.deliverNext();
                if (eventId != null) LOG.info("CU28 event processed: {}", eventId);
            } catch (RuntimeException failure) {
                LOG.warn("CU28 publisher deferred: {}", failure.getClass().getSimpleName());
            }
        }
    }
}
