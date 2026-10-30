package bo.edu.uagrm.autonexus.operations.infrastructure.evidence;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.EvidenceStorage;
import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts.Upload;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.domain.StoredObject;
import java.time.Duration;
import java.util.Optional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * CU16 evidence storage. Without private configuration the port is present but unavailable: the
 * rest of CU16 keeps working and the evidence flow reports its real state instead of failing late.
 */
@Configuration(proxyBeanMethods = false)
public class EvidenceConfiguration {

    @Bean
    EvidenceStorage evidenceStorage() {
        EvidenceStorageSettings settings = EvidenceStorageSettings.fromEnvironment();
        if (!settings.configured()) return new UnconfiguredEvidenceStorage();
        return S3EvidenceStorage.create(settings);
    }

    static final class UnconfiguredEvidenceStorage implements EvidenceStorage {
        private static OperationsError unavailable() {
            return new OperationsError(503, "EVIDENCE_STORAGE_UNAVAILABLE");
        }

        @Override
        public boolean configured() { return false; }

        @Override
        public Upload authorise(String objectKey, long sizeBytes, String contentType, String checksumSha256) {
            throw unavailable();
        }

        @Override
        public Optional<StoredObject> stat(String objectKey) { throw unavailable(); }

        @Override
        public byte[] prefix(String objectKey, int maxBytes) { throw unavailable(); }

        @Override
        public void delete(String objectKey) { throw unavailable(); }

        @Override
        public String download(String objectKey, String versionId, Duration ttl) { throw unavailable(); }
    }
}
