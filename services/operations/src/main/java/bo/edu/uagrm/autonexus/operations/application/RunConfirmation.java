package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.*;
import java.time.Duration;
import java.util.*;

public final class RunConfirmation {
    private final Repository store;
    private final Participant remote;
    private final Hash hash;
    private final Time clock;
    public RunConfirmation(Repository store, Participant remote, Hash hash, Time clock) {
        this.store=store; this.remote=remote; this.hash=hash; this.clock=clock;
    }
    public void tick() { store.claim(clock.now()).ifPresent(this::run); }
    private void run(Claim claim) {
        Saga saga = store.load(claim,clock.now());
        if (saga == null || saga.terminal()) return;
        if (saga.phase.equals("confirm_order") || saga.phase.equals("reject_order")) {
            store.finish(claim,saga,clock.now()); return;
        }
        Step step = saga.step(saga.phase);
        boolean reconcile = step.status.equals("dispatched") || step.status.equals("uncertain") || step.status.equals("rejected");
        if (step.body == null) {
            step.body=saga.prepare(step);
            step.fingerprint=hash.hash(Map.of("clientId",remote.clientId(),"command",step.command,"sagaId",saga.id,"body",step.body));
        }
        step.status="dispatched"; step.attempts++;
        if (!store.save(claim,saga,clock.now())) return;
        try {
            Map<String,Object> result = reconcile ? remote.lookup(saga,step) : null;
            if (result == null) {
                if (store.load(claim,clock.now()) == null) return;
                result=remote.execute(saga,step);
            }
            try { validate(saga,step,result); }
            catch (ProtocolFailure failure) { throw failure; }
            catch (RuntimeException malformed) { throw new ProtocolFailure(ProtocolProblem.PARTICIPANT_PROTOCOL_INVALID); }
            step.result=result; step.errorCode=null;
            boolean applied="applied".equals(result.get("outcome"));
            step.status=applied ? "applied" : "rejected";
            if (!applied) {
                step.errorCode=(String)result.get("errorCode");
                if (step.direction.equals("compensation")) {
                    saga.status="compensation_pending"; saga.failures++; defer(saga);
                    store.save(claim,saga,clock.now()); return;
                }
                saga.errorCode=step.errorCode; saga.status="compensating";
            }
            if (saga.compensating()) saga.phase=saga.nextCompensation();
            else saga.phase=switch(step.command) {
                case "reserve_assignment" -> "authorize_quote";
                case "authorize_quote" -> "confirm_assignment";
                case "confirm_assignment" -> "confirm_order";
                default -> throw new IllegalStateException();
            };
            saga.failures=0; saga.nextAttemptAt=clock.now().toString();
            if (!saga.compensating()) saga.status="running";
        } catch (RuntimeException failure) {
            step.status="uncertain";
            step.errorCode=failure instanceof ProtocolFailure protocol ? protocol.code() : "PARTICIPANT_RESULT_UNKNOWN";
            saga.status=saga.compensating() ? "compensation_pending" : "recovery_pending";
            saga.failures++;
            defer(saga);
        }
        store.save(claim,saga,clock.now());
    }
    private void defer(Saga saga) {
        long millis=Math.min(30000, (long)(1000 * Math.pow(2,Math.min(5,saga.failures-1)) * (1+0.1*clock.jitter())));
        saga.nextAttemptAt=clock.now().plus(Duration.ofMillis(millis)).toString();
    }
    private static void validate(Saga saga, Step step, Map<String,Object> result) {
        if (result == null || !step.operationId.equals(result.get("operationId")) || !saga.id.equals(result.get("sagaId"))
                || !step.command.equals(result.get("command"))
                || !(result.get("committedAt") instanceof String committed)) throw new IllegalStateException();
        if (!step.fingerprint.equals(result.get("fingerprint"))) throw new ProtocolFailure(ProtocolProblem.PARTICIPANT_FINGERPRINT_MISMATCH);
        java.time.Instant.parse(committed);
        if ("rejected".equals(result.get("outcome"))) {
            if (!(result.get("errorCode") instanceof String code) || !code.matches("[A-Z][A-Z0-9_]{1,99}")
                    || result.get("resource") != null) throw new IllegalStateException();
            return;
        }
        if (!"applied".equals(result.get("outcome")) || !(result.get("resource") instanceof Map<?,?> r)
                || !saga.id.equals(r.get("sagaId")) || !saga.orderId.equals(r.get("orderId"))
                || !(r.get("version") instanceof Number version)
                || version.doubleValue()!=version.longValue() || version.longValue()!=((Number)step.body.get("expectedVersion")).longValue()+1) throw new IllegalStateException();
        UUID.fromString((String)r.get("id"));
        String status=switch(step.command) {
            case "reserve_assignment" -> "reserved"; case "confirm_assignment" -> "confirmed";
            case "release_assignment" -> "released"; case "authorize_quote" -> "active"; default -> "cancelled";
        };
        if (!status.equals(r.get("status"))) throw new IllegalStateException();
        if (step.command.contains("assignment")) {
            for (String k:List.of("employeeId","requiredSpecialty","startsAt","endsAt"))
                if (!Objects.equals(saga.input.get(k),r.get(k))) throw new IllegalStateException();
            if (!step.command.equals("reserve_assignment") && !saga.step("reserve_assignment").resource().get("id").equals(r.get("id"))) throw new IllegalStateException();
        } else {
            if (!saga.input.get("quoteId").equals(r.get("quoteId")) || !(r.get("quoteVersion") instanceof Number qv)
                    || qv.longValue()!=((Number)saga.input.get("quoteVersion")).longValue()) throw new IllegalStateException();
            if (step.command.equals("cancel_quote_link") && !saga.step("authorize_quote").resource().get("id").equals(r.get("id"))) throw new IllegalStateException();
        }
    }
}
