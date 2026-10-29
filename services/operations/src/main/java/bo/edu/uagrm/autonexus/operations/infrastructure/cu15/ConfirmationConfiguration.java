package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.*;
import bo.edu.uagrm.autonexus.operations.application.RunConfirmation;
import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.context.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.*;

@Configuration(proxyBeanMethods=false)
@EnableScheduling
public class ConfirmationConfiguration {
    @Bean Time confirmationTime() { return new Time() {
        public Instant now() { return Instant.now(); }
        public double jitter() { return ThreadLocalRandom.current().nextDouble(); }
    }; }
    @Bean @ConditionalOnProperty(name="CU15_ENABLED",havingValue="true")
    RunConfirmation runConfirmation(Repository store,Participant participant,Hash hash,Time clock) { return new RunConfirmation(store,participant,hash,clock); }
    @Bean @ConditionalOnProperty(name="CU15_ENABLED",havingValue="true")
    Worker confirmationWorker(RunConfirmation runner) { return new Worker(runner); }
    static final class Worker {
        private final RunConfirmation runner;
        Worker(RunConfirmation runner) { this.runner=runner; }
        @Scheduled(fixedDelay=1000) public void tick() {
            try { runner.tick(); }
            catch(RuntimeException failure) { org.slf4j.LoggerFactory.getLogger(Worker.class).warn("CU15 worker deferred; local transaction outcome will be reconciled"); }
        }
    }
}
