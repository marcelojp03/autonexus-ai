package bo.edu.uagrm.autonexus.operations.infrastructure.executions;

import bo.edu.uagrm.autonexus.operations.application.ExecutionPorts;
import bo.edu.uagrm.autonexus.operations.application.ManageExecutions;
import bo.edu.uagrm.autonexus.operations.application.ManageVerification;
import bo.edu.uagrm.autonexus.operations.application.VerificationPorts;
import java.net.http.HttpClient;
import java.time.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import tools.jackson.databind.ObjectMapper;

@Configuration(proxyBeanMethods = false)
public class ExecutionConfiguration {
    @Bean
    ExecutionPorts.IdentityGateway empleadoExecutionGateway(
            @Value("${EMPLOYEES_API_URL:http://127.0.0.1:3002}") String base, ObjectMapper json) {
        return new HttpEmpleadoExecutionGateway(
                bo.edu.uagrm.autonexus.operations.infrastructure.config.TransportConfiguration.url(base, "EMPLOYEES_API_URL"),
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
                        .followRedirects(HttpClient.Redirect.NEVER).build(),
                json);
    }

    @Bean
    ManageExecutions manageExecutions(ExecutionPorts.Repository repository, ExecutionPorts.IdentityGateway employees,
            ExecutionPorts.EvidenceStorage storage, @Value("${S3_EVIDENCE_DOWNLOAD_TTL_SECONDS:120}") long downloadTtl) {
        if (downloadTtl < 30 || downloadTtl > 3600) throw new IllegalArgumentException("Invalid download TTL");
        return new ManageExecutions(repository, employees, storage, Clock.systemUTC(), Duration.ofSeconds(downloadTtl));
    }

    @Bean
    ManageVerification manageVerification(ExecutionPorts.Repository executions,
            VerificationPorts.Repository verifications, ExecutionPorts.IdentityGateway employees) {
        return new ManageVerification(executions, verifications, employees, Clock.systemUTC());
    }
}
