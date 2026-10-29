package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.Time;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.*;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.springframework.amqp.rabbit.listener.api.ChannelAwareMessageListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="CU15_MESSAGING_ENABLED",havingValue="true")
public class ConfirmationMessaging {
    @Bean CachingConnectionFactory cu15ConnectionFactory(CanonicalJson json,@Value("${CU15_BROKER_CLIENT_FILE:}") String file) {
        try {
            Map<?,?> c=json.read(Files.readString(Path.of(file)),Map.class);
            if(!c.keySet().equals(Set.of("host","port","vhost","username","password")) || !"autonexus".equals(c.get("vhost"))) throw new IllegalStateException();
            var factory=new CachingConnectionFactory((String)c.get("host"),((Number)c.get("port")).intValue());
            factory.setVirtualHost((String)c.get("vhost")); factory.setUsername((String)c.get("username")); factory.setPassword((String)c.get("password"));
            factory.setConnectionTimeout(2000); factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED); factory.setPublisherReturns(true); return factory;
        } catch(Exception failure) { throw new IllegalStateException("CU15_BROKER_CONFIGURATION_INVALID"); }
    }
    @Bean RabbitTemplate cu15RabbitTemplate(CachingConnectionFactory cf) {
        RabbitTemplate template=new RabbitTemplate(cf); template.setMandatory(true);
        template.setReturnsCallback(returned->{}); return template;
    }
    @Bean Publisher cu15Publisher(JdbcClient db,TransactionTemplate tx,CanonicalJson json,Time clock,RabbitTemplate template) { return new Publisher(db,tx,clock,template); }
    @Bean Inbox cu15Inbox(JdbcClient db,TransactionTemplate tx,CanonicalJson json,Time clock) { return new Inbox(db,tx,json,clock); }
    @Bean SimpleMessageListenerContainer cu15Listener(CachingConnectionFactory cf,Inbox inbox) {
        var container=new SimpleMessageListenerContainer(cf);
        container.setQueueNames("cu15.operations.events.v1"); container.setAutoDeclare(false); container.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        container.setDefaultRequeueRejected(false); container.setPrefetchCount(10);
        container.setMessageListener((ChannelAwareMessageListener)(message,channel)->{
            long tag=message.getMessageProperties().getDeliveryTag();
            try { inbox.receive(message.getBody(),message.getMessageProperties().getReceivedRoutingKey()); }
            catch(InvalidEvent failure) { channel.basicReject(tag,false); return; }
            catch(RuntimeException transientFailure) { channel.basicNack(tag,false,true); return; }
            channel.basicAck(tag,false);
        }); return container;
    }
    static final class InvalidEvent extends RuntimeException {}
    public static final class Publisher {
        private final JdbcClient db; private final TransactionTemplate tx; private final Time clock; private final RabbitTemplate rabbit;
        Publisher(JdbcClient db,TransactionTemplate tx,Time clock,RabbitTemplate rabbit) { this.db=db;this.tx=tx;this.clock=clock;this.rabbit=rabbit; }
        private record Event(UUID id,UUID owner,String type,String payload,int attempts) {}
        @Scheduled(fixedDelay=1000) public void publish() {
            Event e;
            try {
                e=tx.execute(status->{
                    var rows=db.sql("SELECT id,event_type,payload,attempts FROM operations.cu15_outbox WHERE published_at IS NULL AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1")
                        .params(JdbcConfirmationRepository.at(clock.now()),JdbcConfirmationRepository.at(clock.now())).query((rs,n)->new Event(rs.getObject(1,UUID.class),UUID.randomUUID(),rs.getString(2),rs.getString(3),rs.getInt(4))).list();
                    if(rows.isEmpty()) return null; Event event=rows.getFirst();
                    db.sql("UPDATE operations.cu15_outbox SET lease_owner=?,lease_until=?,attempts=attempts+1 WHERE id=?")
                        .params(event.owner(),JdbcConfirmationRepository.at(clock.now().plusSeconds(30)),event.id()).update(); return event;
                });
            } catch(RuntimeException failure) { return; }
            if(e==null) return;
            boolean published=false;
            try {
                MessageProperties props=new MessageProperties(); props.setContentType("application/json"); props.setContentEncoding("UTF-8"); props.setMessageId(e.id().toString()); props.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                CorrelationData correlation=new CorrelationData(e.id().toString());
                rabbit.send("autonexus.business.v1",e.type(),new Message(e.payload().getBytes(StandardCharsets.UTF_8),props),correlation);
                published=correlation.getFuture().get(5,TimeUnit.SECONDS).ack() && correlation.getReturned()==null;
            } catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            catch(Exception failure) { published=false; }
            try {
                Instant now=clock.now(); long delay=Math.min(30000,(long)(1000*Math.pow(2,Math.min(5,e.attempts()))*(1+clock.jitter()*0.1)));
                db.sql("UPDATE operations.cu15_outbox SET published_at=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,last_error_code=? WHERE id=? AND lease_owner=? AND lease_until>?")
                    .params(published?JdbcConfirmationRepository.at(now):null,JdbcConfirmationRepository.at(now.plusMillis(delay)),published?null:"BROKER_CONFIRM_UNKNOWN",e.id(),e.owner(),JdbcConfirmationRepository.at(now)).update();
            } catch(RuntimeException failure) { /* A confirmed publication may be delivered again after lease recovery. */ }
        }
    }
    public static final class Inbox {
        private final JdbcClient db; private final TransactionTemplate tx; private final CanonicalJson json; private final Time clock;
        private static final Set<String> TYPES=Set.of("employees.cu15.assignment.reserved.v1","employees.cu15.assignment.confirmed.v1","employees.cu15.assignment.released.v1","employees.cu15.command.rejected.v1", "finance.cu15.quote_link.authorized.v1","finance.cu15.quote_link.cancelled.v1","finance.cu15.command.rejected.v1", "operations.cu15.confirmation.updated.v1","operations.cu15.confirmation.rejected.v1","operations.order.confirmed.v1");
        Inbox(JdbcClient db,TransactionTemplate tx,CanonicalJson json,Time clock) {this.db=db;this.tx=tx;this.json=json;this.clock=clock;}
        public void receive(byte[] bytes,String routingKey) {
            Map<?,?> event; UUID id,saga,cause; String type,fp; Map<?,?> data;
            try {
                if(bytes.length>65536) throw new InvalidEvent();
                event=json.read(new String(bytes,StandardCharsets.UTF_8),Map.class); type=(String)event.get("eventType");
                if(!TYPES.contains(type) || !type.equals(routingKey) || !type.substring(0,type.indexOf('.')).equals(event.get("producer"))
                        || !(event.get("schemaVersion") instanceof Number schema) || schema.doubleValue()!=1
                        || !(event.get("aggregateVersion") instanceof Number version) || version.doubleValue()!=version.longValue()
                        || version.longValue()<(type.contains("command.rejected")?0:1)
                        || !(event.get("aggregateType") instanceof String aggregate) || aggregate.isBlank()
                        || !(event.get("initiatedBy") instanceof String initiator) || initiator.isBlank()
                        || !(event.get("executedBy") instanceof String executor) || executor.isBlank()) throw new InvalidEvent();
                UUID.fromString((String)event.get("aggregateId")); Instant.parse((String)event.get("occurredAt"));
                id=UUID.fromString((String)event.get("eventId")); saga=UUID.fromString((String)event.get("correlationId")); cause=UUID.fromString((String)event.get("causationId"));
                data=(Map<?,?>)event.get("data"); if(!saga.toString().equals(data.get("sagaId"))) throw new InvalidEvent();
                if(!type.contains("command.rejected") || data.containsKey("orderId")) UUID.fromString((String)data.get("orderId"));
                fp=json.hash(event);
                validateData(type,data,cause);
            } catch(RuntimeException failure) { throw new InvalidEvent(); }
            tx.executeWithoutResult(status->{
                int inserted=db.sql("INSERT INTO operations.cu15_inbox(event_id,fingerprint,received_at) VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING")
                    .params(id,fp,JdbcConfirmationRepository.at(clock.now())).update();
                if(inserted==0) {
                    String previous=db.sql("SELECT fingerprint FROM operations.cu15_inbox WHERE event_id=?").param(id).query(String.class).single();
                    if(!fp.equals(previous)) throw new InvalidEvent(); return;
                }
                String order=db.sql("SELECT order_id FROM operations.cu15_sagas WHERE id=?").param(saga).query(String.class).optional().orElseThrow(InvalidEvent::new);
                if(data.containsKey("orderId") && !order.equals(data.get("orderId"))) throw new InvalidEvent();
                if(type.startsWith("operations.")) return;
                String producer=type.startsWith("employees.")?"employees":"finance";
                db.sql("UPDATE operations.cu15_sagas s SET next_attempt_at=?,document=jsonb_set(document,'{nextAttemptAt}',to_jsonb(CAST(? AS text))) WHERE s.id=? AND s.status IN ('recovery_pending','compensation_pending') AND (lease_until IS NULL OR lease_until<=?) AND EXISTS(SELECT 1 FROM operations.cu15_steps p WHERE p.saga_id=s.id AND p.command=s.phase AND p.operation_id=? AND ((?='employees' AND p.command LIKE '%assignment') OR (?='finance' AND p.command IN ('authorize_quote','cancel_quote_link'))))")
                    .params(JdbcConfirmationRepository.at(clock.now()),clock.now().toString(),saga,JdbcConfirmationRepository.at(clock.now()),cause,producer,producer).update();
            });
        }
        static void validateData(String type,Map<?,?> data,UUID cause) {
            if(type.contains("command.rejected")) {
                if(!cause.toString().equals(data.get("operationId")) || !(data.get("errorCode") instanceof String code)
                        || !code.matches("[A-Z][A-Z0-9_]{1,99}")) throw new InvalidEvent();
                Set<String> commands=type.startsWith("employees.")?Set.of("reserve_assignment","confirm_assignment","release_assignment"):Set.of("authorize_quote","cancel_quote_link");
                if(!commands.contains(data.get("command"))) throw new InvalidEvent(); return;
            }
            if(type.startsWith("employees.")) {
                UUID.fromString((String)data.get("assignmentId")); UUID.fromString((String)data.get("employeeId"));
                Instant starts=Instant.parse((String)data.get("startsAt")), ends=Instant.parse((String)data.get("endsAt"));
                if(!starts.isBefore(ends) || !(data.get("version") instanceof Number version) || version.longValue()<1) throw new InvalidEvent();
                String expected=type.contains(".reserved.")?"reserved":type.contains(".confirmed.")?"confirmed":"released";
                if(!expected.equals(data.get("status"))) throw new InvalidEvent();
            } else if(type.startsWith("finance.")) {
                UUID.fromString((String)data.get("quoteLinkId")); UUID.fromString((String)data.get("quoteId"));
                if(!(data.get("quoteVersion") instanceof Number quoteVersion) || quoteVersion.longValue()<1
                        || !(data.get("version") instanceof Number version) || version.longValue()<1) throw new InvalidEvent();
                if(!(type.contains(".authorized.")?"active":"cancelled").equals(data.get("status"))) throw new InvalidEvent();
            } else if(type.equals("operations.cu15.confirmation.updated.v1")) {
                UUID.fromString((String)data.get("stepId"));
                if(!(data.get("phase") instanceof String phase) || phase.isBlank()
                        || !(data.get("version") instanceof Number version) || version.longValue()<1
                        || !Set.of("running","recovery_pending","compensating","compensation_pending","confirmed","rejected").contains(data.get("status"))) throw new InvalidEvent();
            }
        }
    }
}
