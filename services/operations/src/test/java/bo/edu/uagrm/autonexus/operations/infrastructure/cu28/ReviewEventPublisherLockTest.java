package bo.edu.uagrm.autonexus.operations.infrastructure.cu28;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

class ReviewEventPublisherLockTest {
    @ParameterizedTest
    @ValueSource(strings = {"cancel", "reschedule"})
    void mutationCrossingFinalSendWaitsForDeliveryCommit(String mutation) throws Exception {
        var fixture = new Fixture();
        var sending = new CountDownLatch(1);
        var releaseSend = new CountDownLatch(1);
        var mutationStarted = new CountDownLatch(1);
        doAnswer(call -> {
            assertTrue(fixture.appointmentLock.isHeldByCurrentThread());
            assertEquals(List.of("appointment", "outbox", "check"), fixture.order);
            sending.countDown();
            assertTrue(releaseSend.await(5, TimeUnit.SECONDS));
            assertTrue(fixture.current);
            return new ReviewEventPublisher.Outcome(true, null);
        }).when(fixture.publisher).send(anyString());
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var delivery = workers.submit(fixture.publisher::deliverNext);
            assertTrue(sending.await(5, TimeUnit.SECONDS));
            var changing = workers.submit(() -> {
                mutationStarted.countDown();
                fixture.appointmentLock.lock();
                try {
                    assertTrue(fixture.delivered, mutation + " must serialize after the send transaction");
                    fixture.current = false;
                } finally {
                    fixture.appointmentLock.unlock();
                }
            });
            try {
                assertTrue(mutationStarted.await(5, TimeUnit.SECONDS));
                assertThrows(java.util.concurrent.TimeoutException.class, () -> changing.get(100, TimeUnit.MILLISECONDS));
            } finally {
                releaseSend.countDown();
            }
            assertEquals(fixture.eventId, delivery.get(5, TimeUnit.SECONDS));
            changing.get(5, TimeUnit.SECONDS);
        }
        assertTrue(fixture.delivered);
        assertFalse(fixture.suppressed);
        assertFalse(fixture.abandoned);
        assertFalse(fixture.appointmentLock.isLocked());
    }

    @ParameterizedTest
    @ValueSource(strings = {"cancel", "reschedule"})
    void mutationWinningBeforeFinalLockSuppressesWithoutSending(String mutation) throws Exception {
        var fixture = new Fixture();
        var tryingLock = new CountDownLatch(1);
        fixture.tryingLock = tryingLock;
        fixture.appointmentLock.lock();
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var delivery = workers.submit(fixture.publisher::deliverNext);
            try {
                assertTrue(tryingLock.await(5, TimeUnit.SECONDS));
                fixture.current = false;
            } finally {
                fixture.appointmentLock.unlock();
            }
            assertEquals(fixture.eventId, delivery.get(5, TimeUnit.SECONDS));
        }
        assertTrue(fixture.suppressed, mutation);
        assertFalse(fixture.delivered);
        verify(fixture.publisher, never()).send(anyString());
    }

    @Test
    void lostOrExpiredLeaseCannotSendOrRecord() throws Exception {
        var fixture = new Fixture();
        fixture.owned = false;
        fixture.publisher.deliverNext();
        verify(fixture.publisher, never()).send(anyString());
        assertFalse(fixture.delivered);
        assertFalse(fixture.suppressed);
        assertFalse(fixture.appointmentLock.isLocked());
    }

    @Test
    void crashedFinalAttemptIsAbandonedWithoutAnEleventhSend() throws Exception {
        var fixture = new Fixture();
        fixture.attempts = ReviewEventPublisher.MAX_ATTEMPTS;
        assertNull(fixture.publisher.deliverNext());
        assertTrue(fixture.abandoned);
        verify(fixture.publisher, never()).send(anyString());
        assertTrue(fixture.order.isEmpty());
    }

    @Test
    void failedLastSendAbandonsAndReleasesLocksWithoutFalseDelivery() throws Exception {
        var fixture = new Fixture();
        fixture.attempts = ReviewEventPublisher.MAX_ATTEMPTS - 1;
        doReturn(new ReviewEventPublisher.Outcome(false, "CU28_WEBHOOK_UNAVAILABLE"))
                .when(fixture.publisher).send(anyString());
        fixture.publisher.deliverNext();
        assertTrue(fixture.abandoned);
        assertFalse(fixture.delivered);
        assertFalse(fixture.suppressed);
        assertFalse(fixture.appointmentLock.isLocked());
    }

    @Test
    void uncertainSendRemainsPendingBelowAttemptLimit() throws Exception {
        var fixture = new Fixture();
        doReturn(new ReviewEventPublisher.Outcome(false, "CU28_WEBHOOK_UNAVAILABLE"))
                .when(fixture.publisher).send(anyString());
        fixture.publisher.deliverNext();
        assertEquals(1, fixture.attempts);
        assertFalse(fixture.abandoned);
        assertFalse(fixture.delivered);
        assertFalse(fixture.suppressed);
        assertFalse(fixture.appointmentLock.isLocked());
    }

    // A transaction-scoped row-lock model, not evidence of PostgreSQL integration.
    private static final class Fixture {
        final UUID eventId = UUID.randomUUID();
        final ReentrantLock appointmentLock = new ReentrantLock();
        final List<String> order = new ArrayList<>();
        final ReviewEventPublisher publisher;
        volatile boolean current = true;
        boolean owned = true;
        boolean delivered;
        boolean suppressed;
        boolean abandoned;
        int attempts;
        CountDownLatch tryingLock = new CountDownLatch(0);

        @SuppressWarnings({"unchecked", "rawtypes"})
        Fixture() throws Exception {
            var manager = mock(PlatformTransactionManager.class);
            when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
            doAnswer(call -> {
                if (appointmentLock.isHeldByCurrentThread()) appointmentLock.unlock();
                return null;
            }).when(manager).commit(any());
            doAnswer(call -> {
                if (appointmentLock.isHeldByCurrentThread()) appointmentLock.unlock();
                return null;
            }).when(manager).rollback(any());
            var db = mock(JdbcClient.class);
            var rs = mock(ResultSet.class);
            when(rs.getObject("event_id", UUID.class)).thenReturn(eventId);
            when(rs.getObject("aggregate_id", UUID.class)).thenReturn(UUID.randomUUID());
            when(rs.getString("payload")).thenReturn("{}");
            when(rs.getString("event_type")).thenReturn(AutomationEvents.REMINDER);
            when(rs.getInt("aggregate_version")).thenReturn(1);
            when(rs.getInt("attempts")).thenAnswer(call -> attempts);
            when(db.sql(anyString())).thenAnswer(call -> {
                String sql = call.getArgument(0);
                var statement = mock(JdbcClient.StatementSpec.class, RETURNS_SELF);
                when(statement.query(any(RowMapper.class))).thenAnswer(query -> {
                    RowMapper mapper = query.getArgument(0);
                    var result = mock(JdbcClient.MappedQuerySpec.class);
                    Object mapped = mapper.mapRow(rs, 0);
                    when(result.list()).thenReturn(List.of(mapped));
                    return result;
                });
                when(statement.query(Integer.class)).thenAnswer(query -> {
                    var result = mock(JdbcClient.MappedQuerySpec.class);
                    when(result.single()).thenAnswer(ignored -> ++attempts);
                    return result;
                });
                when(statement.query(Boolean.class)).thenAnswer(query -> {
                    var result = mock(JdbcClient.MappedQuerySpec.class);
                    when(result.optional()).thenAnswer(ignored -> {
                        if (sql.contains("appointments") && sql.contains("FOR UPDATE")) {
                            tryingLock.countDown();
                            appointmentLock.lock();
                            order.add("appointment");
                            return Optional.of(true);
                        }
                        assertTrue(sql.contains("FOR UPDATE"));
                        assertTrue(sql.contains("lease_owner=? AND lease_until>?"));
                        assertTrue(appointmentLock.isHeldByCurrentThread());
                        order.add("outbox");
                        return owned ? Optional.of(true) : Optional.empty();
                    });
                    when(result.single()).thenAnswer(ignored -> {
                        assertTrue(appointmentLock.isHeldByCurrentThread());
                        assertTrue(sql.contains("version=? AND status='scheduled' AND starts_at>?"));
                        assertTrue(sql.contains("starts_at=(?::jsonb->'data'->>'startsAt')::timestamptz"));
                        order.add("check");
                        return current;
                    });
                    return result;
                });
                when(statement.update()).thenAnswer(ignored -> {
                    if (sql.contains("SET delivered_at=")) {
                        assertTrue(appointmentLock.isHeldByCurrentThread());
                        assertTrue(sql.contains("suppressed_at IS NULL"));
                        delivered = true;
                    }
                    if (sql.contains("SET suppressed_at=")) suppressed = true;
                    if (sql.contains("SET abandoned_at=")
                            || (sql.contains("SET next_attempt_at=") && attempts >= ReviewEventPublisher.MAX_ATTEMPTS)) {
                        abandoned = true;
                    }
                    return 1;
                });
                return statement;
            });
            publisher = spy(new ReviewEventPublisher(db, new TransactionTemplate(manager),
                    "http://127.0.0.1:1", "test-only"));
        }
    }
}
