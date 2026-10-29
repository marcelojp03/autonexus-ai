package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import java.time.Instant;
import java.util.*;

public final class ConfirmationPorts {
    private ConfirmationPorts() {}
    public interface Time { Instant now(); double jitter(); }
    public interface Hash { String hash(Object value); }
    public record Claim(UUID sagaId, UUID owner, long fence) {}
    public interface Participant {
        Map<String,Object> lookup(Saga saga, Step step);
        Map<String,Object> execute(Saga saga, Step step);
        String clientId();
    }
    public interface Repository {
        Saga start(UUID order, Map<String,Object> body, String actor, Instant now);
        Saga get(UUID saga);
        Saga operation(UUID operation);
        List<Saga> order(UUID order);
        Saga retry(UUID saga, UUID operation, long expected, String actor, Instant now);
        Optional<Claim> claim(Instant now);
        Saga load(Claim claim, Instant now);
        boolean save(Claim claim, Saga saga, Instant now);
        void finish(Claim claim, Saga saga, Instant now);
    }
}
