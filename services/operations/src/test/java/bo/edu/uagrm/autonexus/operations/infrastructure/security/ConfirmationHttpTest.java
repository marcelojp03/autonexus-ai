package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import bo.edu.uagrm.autonexus.operations.application.ConfirmationPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation;
import bo.edu.uagrm.autonexus.operations.domain.Confirmation.*;
import bo.edu.uagrm.autonexus.operations.infrastructure.http.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class ConfirmationHttpTest {
    AnnotationConfigWebApplicationContext context; MockMvc mvc; Repository store;
    final ObjectMapper json=new ObjectMapper();
    final String sagaId=UUID.randomUUID().toString(), orderId=UUID.randomUUID().toString();
    @Configuration(proxyBeanMethods=false) @EnableWebMvc @EnableWebSecurity
    @Import({SecurityConfiguration.class,ConfirmationController.class,OperationsExceptionHandler.class})
    static class Config {
        @Bean Repository repository() { return mock(Repository.class); }
        @Bean Time time() { return new Time() { public Instant now(){ return Instant.parse("2026-10-28T12:00:00Z"); } public double jitter(){ return 0; } }; }
        @Bean EmployeePermissionsClient permissions() { return new EmployeePermissionsClient("http://127.0.0.1:1",30); }
        @Bean @Primary JwtDecoder fakeDecoder() { return raw->{ throw new BadJwtException("synthetic fixture only"); }; }
    }
    void setup(boolean enabled) {
        context=new AnnotationConfigWebApplicationContext(); context.setEnvironment(new MockEnvironment().withProperty("CU15_ENABLED",Boolean.toString(enabled)));
        context.setServletContext(new MockServletContext()); context.register(Config.class); context.refresh();
        mvc=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build(); store=context.getBean(Repository.class);
    }
    @AfterEach void close() { if(context!=null) context.close(); }
    Map<String,Object> body() { return Map.of("operationId",UUID.randomUUID().toString(),"expectedVersion",1,"quoteId",UUID.randomUUID().toString(),"quoteVersion",1,
            "employeeId",UUID.randomUUID().toString(),"employeeVersion",2,"requiredSpecialty","frenos","startsAt","2026-11-01T08:00:00-04:00","endsAt","2026-11-01T09:00:00-04:00"); }
    Saga saga(Map<String,Object> input) {
        Saga s=new Saga(); s.id=sagaId; s.orderId=orderId; s.input=Confirmation.start(input); s.orderVersion=2; s.nextAttemptAt="2026-10-28T12:00:00Z";
        Confirmation.COMMANDS.forEach(c->s.steps.add(new Step(c))); return s;
    }
    @Test void authorizedStartIs202AndNeverClaimsConfirmed() throws Exception {
        setup(true); var input=body(); when(store.start(any(),anyMap(),anyString(),any())).thenReturn(saga(input));
        var response=mvc.perform(post("/orders/"+orderId+"/confirmations").with(jwt().jwt(j->j.subject("server-human")).authorities(new SimpleGrantedAuthority("confirmations:write")))
                .contentType("application/json").content(json.writeValueAsString(input))).andReturn().getResponse();
        assertEquals(202,response.getStatus()); Map<?,?> dto=json.readValue(response.getContentAsString(),Map.class);
        assertEquals("running",dto.get("status")); assertEquals(sagaId,dto.get("sagaId")); assertFalse(dto.containsKey("initiatedBy"));
        verify(store).start(eq(UUID.fromString(orderId)),argThat(b->b.get("startsAt").equals("2026-11-01T12:00:00.000Z")),eq("server-human"),any());
    }
    @Test void readRoutesUseConfirmationPermissionNotOrderPermission() throws Exception {
        setup(true); when(store.get(any())).thenReturn(saga(body()));
        assertEquals(401,mvc.perform(get("/confirmations/"+sagaId)).andReturn().getResponse().getStatus());
        assertEquals(403,mvc.perform(get("/confirmations/"+sagaId).with(jwt().authorities(new SimpleGrantedAuthority("orders:read")))).andReturn().getResponse().getStatus());
        assertEquals(200,mvc.perform(get("/confirmations/"+sagaId).with(jwt().authorities(new SimpleGrantedAuthority("confirmations:read")))).andReturn().getResponse().getStatus());
        assertEquals(403,mvc.perform(post("/orders/"+orderId+"/confirmations").with(jwt().authorities(new SimpleGrantedAuthority("orders:write")))) .andReturn().getResponse().getStatus());
    }
    @Test void operationOrderHistoryAndRetryHaveExactRoutes() throws Exception {
        setup(true); var s=saga(body()); String op=UUID.randomUUID().toString();
        when(store.operation(any())).thenReturn(s); when(store.order(any())).thenReturn(List.of(s)); when(store.retry(any(),any(),anyLong(),anyString(),any())).thenReturn(s);
        var read=jwt().authorities(new SimpleGrantedAuthority("confirmations:read"));
        assertEquals(200,mvc.perform(get("/confirmations/operations/"+op).with(read)).andReturn().getResponse().getStatus());
        assertEquals(200,mvc.perform(get("/orders/"+orderId+"/confirmations").with(read)).andReturn().getResponse().getStatus());
        assertEquals(202,mvc.perform(post("/confirmations/"+sagaId+"/retry").with(jwt().authorities(new SimpleGrantedAuthority("confirmations:write")))
                .contentType("application/json").content(json.writeValueAsString(Map.of("operationId",op,"expectedVersion",3)))).andReturn().getResponse().getStatus());
    }
    @Test void disabledReturns503WithoutUsingRepository() throws Exception {
        setup(false); var response=mvc.perform(get("/confirmations/"+sagaId).with(jwt().authorities(new SimpleGrantedAuthority("confirmations:read")))).andReturn().getResponse();
        assertEquals(503,response.getStatus()); assertTrue(response.getContentAsString().contains("CU15_DISABLED")); verifyNoInteractions(store);
    }
    @Test void forgedInitiatorAndUnknownFieldsAreRejectedAtBoundary() throws Exception {
        setup(true); var body=new HashMap<>(body()); body.put("initiatedBy","forged");
        assertEquals(400,mvc.perform(post("/orders/"+orderId+"/confirmations").with(jwt().authorities(new SimpleGrantedAuthority("confirmations:write")))
                .contentType("application/json").content(json.writeValueAsString(body))).andReturn().getResponse().getStatus()); verifyNoInteractions(store);
    }
}
