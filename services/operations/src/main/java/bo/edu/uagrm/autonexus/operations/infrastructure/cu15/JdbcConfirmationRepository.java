package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.stereotype.Component;

@Component
public class JdbcConfirmationRepository implements Repository {
    private final JdbcClient db;
    private final TransactionTemplate tx;
    private final CanonicalJson json;
    public JdbcConfirmationRepository(JdbcClient db, TransactionTemplate tx, CanonicalJson json) { this.db=db; this.tx=tx; this.json=json; }
    static Timestamp at(Instant now) { return Timestamp.from(now); }
    private void lockOperation(UUID operation) {
        db.sql("SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(?,15))").param(operation.toString()).query(Boolean.class).single();
    }
    private Saga replay(UUID operation, String fingerprint) {
        var rows=db.sql("SELECT saga_id,fingerprint FROM operations.cu15_ledger WHERE operation_id=?").param(operation).query((rs,n)->Map.entry(rs.getObject(1,UUID.class),rs.getString(2))).list();
        if (rows.isEmpty()) return null;
        if (!rows.getFirst().getValue().equals(fingerprint)) throw OperationsError.conflict("IDEMPOTENCY_CONFLICT");
        return get(rows.getFirst().getKey());
    }
    private void ledger(UUID operation, Saga s, String command, String fingerprint, String actor, Instant now) {
        db.sql("INSERT INTO operations.cu15_ledger(operation_id,saga_id,command,fingerprint,actor,committed_at) VALUES(?,?,?,?,?,?)")
          .params(operation,UUID.fromString(s.id),command,fingerprint,actor,at(now)).update();
    }
    @Override public Saga start(UUID order, Map<String,Object> body, String actor, Instant now) {
        return tx.execute(status->{
            UUID op=UUID.fromString((String)body.get("operationId"));
            String fp=json.hash(Map.of("command","start_confirmation","orderId",order.toString(),"body",body,"initiatedBy",actor));
            lockOperation(op); Saga replay=replay(op,fp); if(replay!=null) return replay;
            var row=db.sql("SELECT status,version FROM operations.work_orders WHERE id=? FOR UPDATE").param(order).query((rs,n)->Map.entry(rs.getString(1),rs.getLong(2))).optional().orElseThrow(()->OperationsError.notFound("ORDER_NOT_FOUND"));
            if (row.getKey().equals("confirmed")) throw OperationsError.conflict("ORDER_ALREADY_CONFIRMED");
            if (db.sql("SELECT count(*) FROM operations.cu15_sagas WHERE order_id=? AND status NOT IN ('confirmed','rejected')").param(order).query(Long.class).single()>0) throw OperationsError.conflict("ORDER_CONFIRMATION_IN_PROGRESS");
            if (row.getValue()!=((Number)body.get("expectedVersion")).longValue()) throw OperationsError.conflict("VERSION_CONFLICT");
            if (!row.getKey().equals("pending_quote")) throw OperationsError.conflict("ORDER_NOT_CONFIRMABLE");
            Saga s=new Saga(); s.id=UUID.randomUUID().toString(); s.orderId=order.toString(); s.input=body;
            s.initiatedBy=actor; s.authorizedAt=Confirmation.utc(now); s.orderVersion=row.getValue()+1; s.nextAttemptAt=now.toString();
            Confirmation.COMMANDS.forEach(c->s.steps.add(new Step(c)));
            db.sql("INSERT INTO operations.cu15_sagas(id,order_id,status,phase,version,document,next_attempt_at) VALUES(?,?,?,?,?,?::jsonb,?)")
              .params(UUID.fromString(s.id),order,s.status,s.phase,s.version,json.write(s),at(now)).update();
            db.sql("UPDATE operations.work_orders SET status='confirmation_pending',version=?,confirmation_saga_id=?,updated_at=?,updated_by=? WHERE id=?")
              .params(s.orderVersion,UUID.fromString(s.id),at(now),actor,order).update();
            ledger(op,s,"start_confirmation",fp,actor,now); persistSteps(s); audit(s,"started",actor,now); event(s,"operations.cu15.confirmation.updated.v1",op,now);
            db.sql("INSERT INTO operations.operations_history(id,entity,entity_id,action,actor_subject,occurred_at,version,snapshot) VALUES(?,'work-order',?,'confirmation_pending',?,?,?,?::jsonb)")
              .params(UUID.randomUUID(),order,actor,at(now),s.orderVersion,json.write(s)).update();
            return s;
        });
    }
    @Override public Saga get(UUID id) {
        return db.sql("SELECT document FROM operations.cu15_sagas WHERE id=?").param(id).query((rs,n)->json.read(rs.getString(1),Saga.class)).optional().orElseThrow(()->OperationsError.notFound("CONFIRMATION_NOT_FOUND"));
    }
    @Override public Saga operation(UUID op) {
        UUID id=db.sql("SELECT saga_id FROM operations.cu15_ledger WHERE operation_id=?").param(op).query(UUID.class).optional().orElseThrow(()->OperationsError.notFound("OPERATION_NOT_FOUND")); return get(id);
    }
    @Override public List<Saga> order(UUID id) {
        if (db.sql("SELECT count(*) FROM operations.work_orders WHERE id=?").param(id).query(Long.class).single()==0) throw OperationsError.notFound("ORDER_NOT_FOUND");
        return db.sql("SELECT document FROM operations.cu15_sagas WHERE order_id=? ORDER BY (document->>'authorizedAt') DESC").param(id).query((rs,n)->json.read(rs.getString(1),Saga.class)).list();
    }
    @Override public Saga retry(UUID id, UUID op, long expected, String actor, Instant now) {
        return tx.execute(status->{
            String fp=json.hash(Map.of("command","retry_confirmation","sagaId",id.toString(),"operationId",op.toString(),"expectedVersion",expected,"initiatedBy",actor));
            lockOperation(op); Saga replay=replay(op,fp); if(replay!=null) return replay;
            Saga s=db.sql("SELECT document FROM operations.cu15_sagas WHERE id=? FOR UPDATE").param(id).query((rs,n)->json.read(rs.getString(1),Saga.class)).optional().orElseThrow(()->OperationsError.notFound("CONFIRMATION_NOT_FOUND"));
            if(s.version!=expected) throw OperationsError.conflict("VERSION_CONFLICT");
            if(s.terminal()) throw OperationsError.conflict("CONFIRMATION_TERMINAL");
            Boolean leased=db.sql("SELECT lease_until>? FROM operations.cu15_sagas WHERE id=?").params(at(now),id).query(Boolean.class).optional().orElse(false);
            if(Boolean.TRUE.equals(leased)) throw OperationsError.conflict("CONFIRMATION_BUSY");
            s.version++; s.nextAttemptAt=now.toString();
            db.sql("UPDATE operations.cu15_sagas SET document=?::jsonb,version=?,next_attempt_at=?,fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE id=?")
              .params(json.write(s),s.version,at(now),id).update();
            ledger(op,s,"retry_confirmation",fp,actor,now); audit(s,"retry_requested",actor,now); event(s,"operations.cu15.confirmation.updated.v1",op,now); return s;
        });
    }
    @Override public Optional<Claim> claim(Instant now) {
        return tx.execute(status->{
            var ids=db.sql("SELECT id FROM operations.cu15_sagas WHERE status NOT IN ('confirmed','rejected') AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1")
                .params(at(now),at(now)).query(UUID.class).list();
            if(ids.isEmpty()) return Optional.empty();
            UUID owner=UUID.randomUUID(), id=ids.getFirst();
            long fence=db.sql("UPDATE operations.cu15_sagas SET lease_owner=?,lease_until=?,fence=fence+1 WHERE id=? RETURNING fence").params(owner,at(now.plusSeconds(30)),id).query(Long.class).single();
            return Optional.of(new Claim(id,owner,fence));
        });
    }
    @Override public Saga load(Claim c, Instant now) {
        return db.sql("SELECT document FROM operations.cu15_sagas WHERE id=? AND lease_owner=? AND fence=? AND lease_until>?")
            .params(c.sagaId(),c.owner(),c.fence(),at(now)).query((rs,n)->json.read(rs.getString(1),Saga.class)).optional().orElse(null);
    }
    @Override public boolean save(Claim c, Saga s, Instant now) {
        return Boolean.TRUE.equals(tx.execute(status->saveInside(c,s,now)));
    }
    private boolean saveInside(Claim c, Saga s, Instant now) {
        boolean dispatch=s.steps.stream().anyMatch(step->step.command.equals(s.phase)&&step.status.equals("dispatched"));
        long previous=s.version; s.version++;
        int changed=db.sql("UPDATE operations.cu15_sagas SET status=?,phase=?,version=?,document=?::jsonb,next_attempt_at=?,lease_until=?,lease_owner=? WHERE id=? AND version=? AND lease_owner=? AND fence=? AND lease_until>?")
            .params(s.status,s.phase,s.version,json.write(s),at(Instant.parse(s.nextAttemptAt)),dispatch?at(now.plusSeconds(30)):at(now),dispatch?c.owner():null,c.sagaId(),previous,c.owner(),c.fence(),at(now)).update();
        if(changed==0) { s.version=previous; return false; }
        persistSteps(s); audit(s,s.phase,"autonexus-cu15-coordinator",now);
        UUID cause=UUID.fromString(s.input.get("operationId").toString());
        event(s,"operations.cu15.confirmation.updated.v1",cause,now); return true;
    }
    private void persistSteps(Saga s) {
        for(Step step:s.steps) db.sql("INSERT INTO operations.cu15_steps(operation_id,saga_id,command,direction,status,body,fingerprint,attempts,result,next_attempt_at,last_error_code) VALUES(?,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?) ON CONFLICT(operation_id) DO UPDATE SET status=excluded.status,body=excluded.body,fingerprint=excluded.fingerprint,attempts=excluded.attempts,result=excluded.result,next_attempt_at=excluded.next_attempt_at,last_error_code=excluded.last_error_code")
            .params(UUID.fromString(step.operationId),UUID.fromString(s.id),step.command,step.direction,step.status,json.write(step.body),step.fingerprint,step.attempts,json.write(step.result),at(Instant.parse(s.nextAttemptAt)),step.errorCode).update();
    }
    private void audit(Saga s,String action,String actor,Instant now) {
        db.sql("INSERT INTO operations.cu15_history(id,saga_id,version,action,actor,occurred_at,snapshot) VALUES(?,?,?,?,?,?,?::jsonb)")
          .params(UUID.randomUUID(),UUID.fromString(s.id),s.version,action,actor,at(now),json.write(s)).update();
    }
    void event(Saga s,String type,UUID cause,Instant now) {
        Map<String,Object> envelope=buildEvent(s,type,cause,now);
        db.sql("INSERT INTO operations.cu15_outbox(id,event_type,aggregate_type,aggregate_id,aggregate_version,saga_id,causation_id,payload,occurred_at,next_attempt_at) VALUES(?,?,?,?,?,?,?,?::jsonb,?,?)")
          .params(UUID.fromString(envelope.get("eventId").toString()),type,envelope.get("aggregateType"),UUID.fromString(envelope.get("aggregateId").toString()),envelope.get("aggregateVersion"),UUID.fromString(s.id),cause,json.write(envelope),at(now),at(now)).update();
    }
    static Map<String,Object> buildEvent(Saga s,String type,UUID cause,Instant now) {
        UUID id=UUID.randomUUID(); Map<String,Object> data=new TreeMap<>();
        boolean orderEvent=type.equals("operations.order.confirmed.v1");
        String aggregateType=orderEvent?"order":"confirmation";
        UUID aggregateId=UUID.fromString(orderEvent?s.orderId:s.id);
        long aggregateVersion=orderEvent?s.orderVersion:s.version;
        data.put("sagaId",s.id); data.put("orderId",s.orderId); data.put("status",s.status); data.put("phase",s.phase); data.put("version",s.version);
        data.put("stepId",s.steps.stream().filter(step->step.command.equals(s.phase)).map(step->step.operationId).findFirst().orElse(cause.toString()));
        if(s.errorCode!=null) data.put("errorCode",s.errorCode);
        if(type.equals("operations.order.confirmed.v1")) {
            data.clear(); data.put("sagaId",s.id); data.put("orderId",s.orderId);
            for(String k:List.of("employeeId","startsAt","endsAt","quoteId","quoteVersion")) data.put(k,s.input.get(k));
            data.put("assignmentId",s.step("confirm_assignment").resource().get("id")); data.put("quoteLinkId",s.step("authorize_quote").resource().get("id"));
        }
        Map<String,Object> envelope=new TreeMap<>();
        envelope.put("eventId",id.toString()); envelope.put("schemaVersion",1); envelope.put("eventType",type); envelope.put("producer","operations");
        envelope.put("aggregateType",aggregateType); envelope.put("aggregateId",aggregateId.toString()); envelope.put("aggregateVersion",aggregateVersion);
        envelope.put("correlationId",s.id); envelope.put("causationId",cause.toString()); envelope.put("occurredAt",Confirmation.utc(now));
        envelope.put("initiatedBy",s.initiatedBy); envelope.put("executedBy","autonexus-cu15-coordinator"); envelope.put("data",data);
        return envelope;
    }
    @Override public void finish(Claim c, Saga ignored, Instant now) {
        tx.executeWithoutResult(status->{
            // A lost SQL commit is resolved by reloading the local saga, never by remote compensation.
            var rows=db.sql("SELECT document FROM operations.cu15_sagas WHERE id=? AND lease_owner=? AND fence=? AND lease_until>? FOR UPDATE")
                .params(c.sagaId(),c.owner(),c.fence(),at(now)).query((rs,n)->json.read(rs.getString(1),Saga.class)).list();
            if(rows.isEmpty()) return; Saga s=rows.getFirst(); if(s.terminal()) return;
            var order=db.sql("SELECT status,version,confirmation_saga_id FROM operations.work_orders WHERE id=? FOR UPDATE").param(UUID.fromString(s.orderId))
                .query((rs,n)->new Object[]{rs.getString(1),rs.getLong(2),rs.getObject(3,UUID.class)}).single();
            if(!c.sagaId().equals(order[2])) throw new IllegalStateException("LOCAL_ORDER_OWNERSHIP_CONFLICT");
            if("confirmed".equals(order[0])) throw new IllegalStateException("LOCAL_COMMIT_INVARIANT");
            boolean confirm=s.phase.equals("confirm_order");
            if(confirm && (!s.step("reserve_assignment").applied() || !s.step("authorize_quote").applied() || !s.step("confirm_assignment").applied())) throw new IllegalStateException();
            if(!"confirmation_pending".equals(order[0]) || (long)order[1]!=s.orderVersion) {
                if(!"confirmation_pending".equals(order[0])) throw new IllegalStateException("LOCAL_ORDER_STATE_CONFLICT");
                s.orderVersion=(long)order[1];
                s.status="compensating"; s.errorCode="LOCAL_ORDER_VERSION_CONFLICT"; s.phase=s.nextCompensation(); s.nextAttemptAt=now.toString(); saveInside(c,s,now); return;
            }
            if(!confirm && !s.nextCompensation().equals("reject_order")) throw new IllegalStateException();
            int changed;
            if(confirm) changed=db.sql("UPDATE operations.work_orders SET status='confirmed',version=version+1,quote_id=?,quote_version=?,quote_link_id=?,assignment_id=?,employee_id=?,starts_at=?::timestamptz,ends_at=?::timestamptz,updated_at=?,updated_by=? WHERE id=? AND version=? AND confirmation_saga_id=?")
                .params(UUID.fromString(s.input.get("quoteId").toString()),s.input.get("quoteVersion"),UUID.fromString(s.step("authorize_quote").resource().get("id").toString()),UUID.fromString(s.step("confirm_assignment").resource().get("id").toString()),UUID.fromString(s.input.get("employeeId").toString()),s.input.get("startsAt"),s.input.get("endsAt"),at(now),"autonexus-cu15-coordinator",UUID.fromString(s.orderId),s.orderVersion,c.sagaId()).update();
            else changed=db.sql("UPDATE operations.work_orders SET status='pending_quote',version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=? AND confirmation_saga_id=?")
                .params(at(now),"autonexus-cu15-coordinator",UUID.fromString(s.orderId),s.orderVersion,c.sagaId()).update();
            if(changed!=1) throw new IllegalStateException();
            s.orderVersion++; s.status=confirm?"confirmed":"rejected"; s.phase=s.status; s.nextAttemptAt=now.toString();
            if(!saveInside(c,s,now)) throw new IllegalStateException("LEASE_LOST");
            event(s,confirm?"operations.order.confirmed.v1":"operations.cu15.confirmation.rejected.v1",UUID.fromString(s.input.get("operationId").toString()),now);
            db.sql("INSERT INTO operations.operations_history(id,entity,entity_id,action,actor_subject,occurred_at,version,snapshot) VALUES(?,'work-order',?,?,?,?,?,?::jsonb)")
              .params(UUID.randomUUID(),UUID.fromString(s.orderId),s.status,s.initiatedBy,at(now),s.orderVersion,json.write(s)).update();
        });
    }
}
