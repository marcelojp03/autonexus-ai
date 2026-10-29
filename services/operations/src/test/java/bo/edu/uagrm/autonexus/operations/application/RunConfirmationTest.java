package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.infrastructure.cu15.CanonicalJson;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

class RunConfirmationTest {
    final CanonicalJson json=new CanonicalJson(new ObjectMapper());
    final FakeClock clock=new FakeClock();
    final Store store=new Store();
    final Remote remote=new Remote();
    final RunConfirmation runner=new RunConfirmation(store,remote,json,clock);
    static String id() { return UUID.randomUUID().toString(); }
    static Map<String,Object> input() {
        return new TreeMap<>(Map.of("operationId",id(),"expectedVersion",1,"employeeId",id(),"employeeVersion",2,"quoteId",id(),"quoteVersion",1,
                "requiredSpecialty","frenos","startsAt","2026-11-01T12:00:00.000Z","endsAt","2026-11-01T13:00:00.000Z"));
    }
    Saga copy(Saga s) { return json.read(json.write(s),Saga.class); }
    class FakeClock implements Time {
        Instant now=Instant.parse("2026-10-28T12:00:00Z");
        public Instant now() { return now; } public double jitter() { return 0.5; }
        void advance() { now=now.plusSeconds(31); }
    }
    class Store implements Repository {
        Saga state; long fence; boolean stale; boolean finished;
        Store() {
            state=new Saga(); state.id=id(); state.orderId=id(); state.input=Confirmation.start(input()); state.initiatedBy="human-subject";
            state.authorizedAt=Confirmation.utc(clock.now()); state.orderVersion=2; state.nextAttemptAt=clock.now().toString();
            Confirmation.COMMANDS.forEach(c->state.steps.add(new Step(c)));
        }
        public Saga start(UUID order,Map<String,Object> body,String actor,Instant now) { throw new UnsupportedOperationException(); }
        public Saga get(UUID id) { return copy(state); } public Saga operation(UUID id) { return copy(state); }
        public List<Saga> order(UUID id) { return List.of(copy(state)); }
        public Saga retry(UUID id,UUID op,long v,String actor,Instant now) { throw new UnsupportedOperationException(); }
        public Optional<Claim> claim(Instant now) {
            if(state.terminal() || now.isBefore(Instant.parse(state.nextAttemptAt))) return Optional.empty();
            return Optional.of(new Claim(UUID.fromString(state.id),UUID.randomUUID(),++fence));
        }
        public Saga load(Claim c,Instant now) { return stale?null:copy(state); }
        public boolean save(Claim c,Saga s,Instant now) {
            if(stale || c.fence()!=fence || s.version!=state.version) return false;
            s.version++; state=copy(s); return true;
        }
        public void finish(Claim c,Saga s,Instant now) { finished=true; s.status=s.phase.equals("confirm_order")?"confirmed":"rejected"; s.phase=s.status; save(c,s,now); }
    }
    class Remote implements Participant {
        Map<String,Map<String,Object>> ledger=new HashMap<>();
        List<String> commands=new ArrayList<>(); List<String> bodies=new ArrayList<>();
        Set<String> reject=new HashSet<>(); Set<String> fail=new HashSet<>();
        boolean loseResponse, corrupt, lookup404, lookupFailure;
        int lookups;
        String assignment=id(),link=id();
        public String clientId() { return "autonexus-cu15-coordinator"; }
        public Map<String,Object> lookup(Saga s,Step step) {
            lookups++; if(lookupFailure) throw new IllegalStateException();
            return lookup404?null:ledger.get(step.operationId);
        }
        public Map<String,Object> execute(Saga s,Step step) {
            assertEquals("dispatched",store.state.step(step.command).status);
            assertEquals(json.write(step.body),json.write(store.state.step(step.command).body));
            commands.add(step.command); bodies.add(json.write(step.body));
            if(fail.contains(step.command)) throw new IllegalStateException("injected transport loss");
            var result=ledger.computeIfAbsent(step.operationId,key->{
                Map<String,Object> response=new LinkedHashMap<>();
                response.put("operationId",step.operationId); response.put("sagaId",s.id); response.put("command",step.command);
                response.put("fingerprint",corrupt?"invalid":step.fingerprint); response.put("committedAt",clock.now().toString()); response.put("replayed",false);
                boolean rejected=reject.contains(step.command); response.put("outcome",rejected?"rejected":"applied");
                response.put("errorCode",rejected?"BUSINESS_REJECTED":null);
                Map<String,Object> resource=new TreeMap<>(); resource.put("sagaId",s.id); resource.put("orderId",s.orderId);
                resource.put("id",step.command.contains("assignment")?assignment:link);
                resource.put("version",((Number)step.body.get("expectedVersion")).longValue()+1);
                for(String k:List.of("employeeId","requiredSpecialty","startsAt","endsAt","quoteId","quoteVersion")) resource.put(k,s.input.get(k));
                resource.put("status",switch(step.command) { case "reserve_assignment"->"reserved"; case "confirm_assignment"->"confirmed"; case "release_assignment"->"released"; case "authorize_quote"->"active"; default->"cancelled"; });
                response.put("resource",rejected?null:resource); return response;
            });
            if(loseResponse) { loseResponse=false; throw new IllegalStateException("injected response loss after commit"); }
            return result;
        }
    }
    void tick() { runner.tick(); clock.advance(); }
    @Test void goldenPathConfirmsOnlyInLocalCommit() {
        tick(); assertEquals("authorize_quote",store.state.phase); assertFalse(store.finished);
        tick(); assertEquals("confirm_assignment",store.state.phase); assertFalse(store.finished);
        tick(); assertEquals("confirm_order",store.state.phase); assertFalse(store.finished);
        tick(); assertEquals("confirmed",store.state.status); assertTrue(store.finished);
        assertEquals(List.of("reserve_assignment","authorize_quote","confirm_assignment"),remote.commands);
        assertEquals(0,((Number)store.state.step("reserve_assignment").body.get("expectedVersion")).longValue());
        assertEquals(0,((Number)store.state.step("authorize_quote").body.get("expectedVersion")).longValue());
    }
    @Test void lostResponseQueriesLedgerAndDoesNotDuplicateEffect() {
        remote.loseResponse=true; tick();
        assertEquals("recovery_pending",store.state.status); assertEquals("uncertain",store.state.steps.getFirst().status);
        tick(); assertEquals("authorize_quote",store.state.phase); assertEquals(1,remote.lookups); assertEquals(1,remote.commands.size());
    }
    @Test void missingLedgerReplaysExactlyTheFrozenBodyAndId() {
        remote.loseResponse=true; remote.lookup404=true; tick(); String first=remote.bodies.getFirst();
        tick(); assertEquals(first,remote.bodies.getLast()); assertEquals(1,remote.ledger.size()); assertEquals(2,remote.commands.size());
    }
    @Test void ledgerFailureNeverCompensatesOrSendsAnotherCommand() {
        remote.loseResponse=true; tick(); remote.lookupFailure=true; tick();
        assertEquals("reserve_assignment",store.state.phase); assertEquals("recovery_pending",store.state.status); assertEquals(1,remote.commands.size());
    }
    @Test void malformedResultIsUnknownNotARejection() {
        remote.corrupt=true; tick(); assertEquals("recovery_pending",store.state.status); assertEquals("reserve_assignment",store.state.phase);
    }
    @Test void financialRejectionReleasesOnlyKnownReservation() {
        remote.reject.add("authorize_quote"); tick(); tick(); assertEquals("release_assignment",store.state.phase);
        tick(); assertEquals("reject_order",store.state.phase); tick(); assertEquals("rejected",store.state.status);
        assertEquals(List.of("reserve_assignment","authorize_quote","release_assignment"),remote.commands);
    }
    @Test void employeeConfirmationRejectionCancelsFinanceThenReleases() {
        remote.reject.add("confirm_assignment"); for(int i=0;i<6;i++) tick();
        assertEquals("rejected",store.state.status);
        assertEquals(List.of("reserve_assignment","authorize_quote","confirm_assignment","cancel_quote_link","release_assignment"),remote.commands);
    }
    @Test void compensationFailureRetainsExclusionAndSameFrozenCommand() {
        remote.reject.add("authorize_quote"); tick(); tick(); remote.fail.add("release_assignment"); tick();
        assertEquals("compensation_pending",store.state.status); assertFalse(store.state.terminal()); String body=remote.bodies.getLast();
        remote.fail.clear(); tick(); assertEquals(body,remote.bodies.getLast()); tick(); assertEquals("rejected",store.state.status);
    }
    @Test void durableCompensationRejectionDoesNotReleaseSaga() {
        remote.reject.addAll(Set.of("authorize_quote","release_assignment")); tick(); tick(); tick();
        assertEquals("compensation_pending",store.state.status); assertEquals("release_assignment",store.state.phase); assertFalse(store.finished);
    }
    @Test void staleLeaseCannotDispatch() { store.stale=true; tick(); assertTrue(remote.commands.isEmpty()); }
    @Test void confirmedEmployeeMustBeReleasedBeforeFinancialLinkOnLocalRejection() {
        tick();tick();tick(); Saga s=store.state; s.status="compensating";
        assertEquals("release_assignment",s.nextCompensation());
        s.step("release_assignment").status="applied"; assertEquals("cancel_quote_link",s.nextCompensation());
        assertEquals(2L,((Number)s.prepare(s.step("release_assignment")).get("expectedVersion")).longValue());
    }
    @Test void backoffIsPersistedCappedAndPollingDoesNotBypassIt() {
        remote.fail.add("reserve_assignment"); runner.tick();
        assertTrue(Instant.parse(store.state.nextAttemptAt).isAfter(clock.now())); runner.tick(); assertEquals(1,remote.commands.size());
        for(int i=0;i<12;i++) tick();
        assertTrue(Instant.parse(store.state.nextAttemptAt).isBefore(clock.now().plusSeconds(31)));
    }
    @Test void closedInputCannotSupplyInitiatorOrFractionalVersions() {
        var body=input(); body.put("initiatedBy","forged"); assertThrows(OperationsError.class,()->Confirmation.start(body));
        body.remove("initiatedBy"); body.put("employeeVersion",1.5); assertThrows(OperationsError.class,()->Confirmation.start(body));
    }
    @Test void normalizesOffsetsAndCanonicalObjectOrdering() {
        var body=input(); body.put("startsAt","2026-11-01T08:00:00-04:00"); assertEquals("2026-11-01T12:00:00.000Z",Confirmation.start(body).get("startsAt"));
        assertEquals(json.hash(Map.of("a",List.of(Map.of("z",1,"b",2)),"c",3)),json.hash(Map.of("c",3,"a",List.of(Map.of("b",2,"z",1)))));
        assertNotEquals(json.hash(List.of(1,2)),json.hash(List.of(2,1)));
    }
}
