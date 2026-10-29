package bo.edu.uagrm.autonexus.operations.infrastructure.agenda;
import bo.edu.uagrm.autonexus.operations.application.*;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.*;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AgendaConfigurationTest {
    @Configuration(proxyBeanMethods=false) @Import(AgendaConfiguration.class)
    static class Config {
        @Bean Repository repository() { return mock(Repository.class); }
        @Bean ObjectMapper json() { return new ObjectMapper(); }
    }
    @Test void composesAgendaWithoutCu15OrNetworkOrDatabase() {
        try(var context=new AnnotationConfigApplicationContext(Config.class)) {
            assertNotNull(context.getBean(ReadAgenda.class));
            assertInstanceOf(HttpEmpleadoAgendaGateway.class,context.getBean(EmpleadoAgendaGateway.class));
        }
    }
}
