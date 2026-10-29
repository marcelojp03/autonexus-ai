package bo.edu.uagrm.autonexus.operations.infrastructure.agenda;
import bo.edu.uagrm.autonexus.operations.application.*;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import java.net.http.HttpClient;
import java.time.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import tools.jackson.databind.ObjectMapper;

@Configuration(proxyBeanMethods=false)
public class AgendaConfiguration {
    @Bean EmpleadoAgendaGateway empleadoAgendaGateway(@Value("${EMPLOYEES_API_URL:http://127.0.0.1:3002}") String base,ObjectMapper json) {
        return new HttpEmpleadoAgendaGateway(bo.edu.uagrm.autonexus.operations.infrastructure.config.TransportConfiguration.url(base,"EMPLOYEES_API_URL"),HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NEVER).build(),json);
    }
    @Bean ReadAgenda readAgenda(AgendaPorts.Repository repository,EmpleadoAgendaGateway employees) {
        return new ReadAgenda(repository,employees,Clock.systemUTC());
    }
}
