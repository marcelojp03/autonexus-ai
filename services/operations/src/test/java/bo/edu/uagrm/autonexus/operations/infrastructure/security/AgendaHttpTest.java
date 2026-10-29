package bo.edu.uagrm.autonexus.operations.infrastructure.security;
import bo.edu.uagrm.autonexus.operations.application.*;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import bo.edu.uagrm.autonexus.operations.infrastructure.http.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.*;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class AgendaHttpTest {
    AnnotationConfigWebApplicationContext context; MockMvc mvc; Repository repository; EmpleadoAgendaGateway employees;
    UUID employee=UUID.randomUUID(),assignment=UUID.randomUUID(); Instant now=Instant.parse("2026-11-01T12:00:00Z");
    @Configuration(proxyBeanMethods=false) @EnableWebMvc @EnableWebSecurity
    @Import({SecurityConfiguration.class,AgendaController.class,OperationsExceptionHandler.class})
    static class Config {
        @Bean Repository repository() { return mock(Repository.class); }
        @Bean EmpleadoAgendaGateway employees() { return mock(EmpleadoAgendaGateway.class); }
        @Bean ReadAgenda agenda(Repository repository,EmpleadoAgendaGateway employees) { return new ReadAgenda(repository,employees,Clock.systemUTC()); }
        @Bean EmployeePermissionsClient permissions() { return mock(EmployeePermissionsClient.class); }
        @Bean @Primary JwtDecoder decoder() { return raw->{throw new BadJwtException("synthetic only");}; }
    }
    @BeforeEach void setup() {
        context=new AnnotationConfigWebApplicationContext(); context.setServletContext(new MockServletContext()); context.register(Config.class); context.refresh();
        mvc=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        repository=context.getBean(Repository.class); employees=context.getBean(EmpleadoAgendaGateway.class);
        var actor=new Actor(employee,"M","active",List.of("self","team"));
        when(employees.context(anyString(),anyString())).thenReturn(new Context(actor,now));
        when(repository.list(any(),nullable(UUID.class))).thenReturn(new Selection(List.of(),0));
        when(repository.detail(any(),nullable(UUID.class))).thenReturn(Optional.empty());
    }
    @AfterEach void close() {context.close();}
    org.springframework.test.web.servlet.request.RequestPostProcessor self() { return jwt().authorities(new SimpleGrantedAuthority("agenda:read:self")); }
    org.springframework.test.web.servlet.request.RequestPostProcessor team() { return jwt().authorities(new SimpleGrantedAuthority("agenda:read:team")); }
    @Test void permissionNotRoleOrGeneralCrudControlsRoutes() throws Exception {
        assertEquals(401,mvc.perform(get("/agenda/me")).andReturn().getResponse().getStatus());
        var denied=mvc.perform(get("/agenda/me").with(jwt().authorities(new SimpleGrantedAuthority("administrador"),new SimpleGrantedAuthority("orders:read")))).andReturn().getResponse();
        assertEquals(403,denied.getStatus()); assertTrue(denied.getContentAsString().contains("AGENDA_ACCESS_DENIED"));
        assertEquals(200,mvc.perform(get("/agenda/me").with(self())).andReturn().getResponse().getStatus());
        assertEquals(403,mvc.perform(get("/agenda/team").with(self())).andReturn().getResponse().getStatus());
        assertEquals(200,mvc.perform(get("/agenda/team").with(team())).andReturn().getResponse().getStatus());
    }
    @Test void unknownDuplicateAndSelfIdentityQueryAre400() throws Exception {
        for(String query:List.of("employeeId="+employee,"scope=team","limit=1&limit=2","from=2026-02-30","limit=101","offset=-1","status=released"))
            assertEquals(400,mvc.perform(get("/agenda/me?"+query).with(self())).andReturn().getResponse().getStatus(),query);
        verifyNoInteractions(repository,employees);
    }
    @Test void teamEmployeeIsFilterWhileHumanTokenIsForwarded() throws Exception {
        UUID target=UUID.randomUUID();
        assertEquals(200,mvc.perform(get("/agenda/team?employeeId="+target).with(team())).andReturn().getResponse().getStatus());
        verify(repository).list(any(),eq(target)); verify(employees).context("token","team");
    }
    @Test void detailRejectsAllQueryAndMalformedUuidAndUsesCorrectScope() throws Exception {
        assertEquals(400,mvc.perform(get("/agenda/me/"+assignment+"?from=2026-11-01").with(self())).andReturn().getResponse().getStatus());
        assertEquals(400,mvc.perform(get("/agenda/me/not-uuid").with(self())).andReturn().getResponse().getStatus());
        assertEquals(404,mvc.perform(get("/agenda/me/"+assignment).with(self())).andReturn().getResponse().getStatus());
        assertEquals(404,mvc.perform(get("/agenda/team/"+assignment).with(team())).andReturn().getResponse().getStatus());
        verify(repository).detail(assignment,employee); verify(repository).detail(assignment,null);
    }
    @Test void cachedAuthorityCannotOverrideFreshContextRevocationOrOutage() throws Exception {
        when(employees.context(anyString(),anyString())).thenThrow(ReadAgenda.denied());
        assertEquals(403,mvc.perform(get("/agenda/me").with(self())).andReturn().getResponse().getStatus());
        doThrow(new bo.edu.uagrm.autonexus.operations.domain.OperationsError(503,"AGENDA_DEPENDENCY_UNAVAILABLE")).when(employees).context(anyString(),anyString());
        var response=mvc.perform(get("/agenda/me").with(self())).andReturn().getResponse();
        assertEquals(503,response.getStatus()); assertTrue(response.getContentAsString().contains("AGENDA_DEPENDENCY_UNAVAILABLE")); verifyNoInteractions(repository);
    }
    @Test void writesAndTechnicalCoordinatorAuthorityDoNotOpenAgenda() throws Exception {
        assertEquals(403,mvc.perform(post("/agenda/me").with(self())).andReturn().getResponse().getStatus());
        assertEquals(403,mvc.perform(get("/agenda/team").with(jwt().authorities(new SimpleGrantedAuthority("cu15.staffing.read")))).andReturn().getResponse().getStatus());
        verifyNoInteractions(repository,employees);
    }
    @Test void sqlTransactionAcquisitionFailureIs503WithoutPrivateMessage() throws Exception {
        when(repository.list(any(),any())).thenThrow(new org.springframework.transaction.CannotCreateTransactionException("private database"));
        var response=mvc.perform(get("/agenda/me").with(self())).andReturn().getResponse();
        assertEquals(503,response.getStatus()); assertTrue(response.getContentAsString().contains("PERSISTENCE_UNAVAILABLE"));
        assertFalse(response.getContentAsString().contains("private"));
    }
}
