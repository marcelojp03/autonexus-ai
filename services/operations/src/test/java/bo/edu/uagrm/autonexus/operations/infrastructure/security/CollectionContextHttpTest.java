package bo.edu.uagrm.autonexus.operations.infrastructure.security;

import bo.edu.uagrm.autonexus.operations.application.CollectionContextRepository;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import bo.edu.uagrm.autonexus.operations.infrastructure.http.*;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

class CollectionContextHttpTest {
    AnnotationConfigWebApplicationContext context; MockMvc mvc;
    CollectionContextRepository repository; EmployeePermissionsClient permissions;
    UUID order=UUID.randomUUID();
    @Configuration(proxyBeanMethods=false) @EnableWebMvc @EnableWebSecurity
    @Import({SecurityConfiguration.class,CollectionContextController.class,OperationsExceptionHandler.class})
    static class Config {
        @Bean CollectionContextRepository repository() { return mock(CollectionContextRepository.class); }
        @Bean EmployeePermissionsClient permissions() { return mock(EmployeePermissionsClient.class); }
        @Bean @Primary JwtDecoder fakeDecoder() { return raw->{throw new BadJwtException("synthetic");}; }
    }
    @BeforeEach void setup() {
        context=new AnnotationConfigWebApplicationContext(); context.setServletContext(new MockServletContext());
        context.register(Config.class); context.refresh();
        mvc=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        repository=context.getBean(CollectionContextRepository.class); permissions=context.getBean(EmployeePermissionsClient.class);
    }
    @AfterEach void close() { context.close(); }
    String route() { return "/orders/"+order+"/collection-context"; }
    @Test void noTokenIs401WithoutReadingData() throws Exception {
        assertEquals(401,mvc.perform(get(route())).andReturn().getResponse().getStatus()); verifyNoInteractions(repository);
    }
    @Test void unboundOrMissingPermissionIs403BeforeDataAccess() throws Exception {
        when(permissions.requireBoundAnyPermission(anyString(),anySet())).thenThrow(new OperationsError(403,"COLLECTION_ACCESS_DENIED"));
        assertEquals(403,mvc.perform(get(route()).with(jwt().authorities(new SimpleGrantedAuthority("administrador")))).andReturn().getResponse().getStatus());
        verifyNoInteractions(repository);
    }
    @Test void eitherPaymentPermissionUsesFreshCheckWithoutBroadConfirmationPermission() throws Exception {
        when(permissions.requireBoundAnyPermission(anyString(),anySet())).thenReturn(UUID.randomUUID());
        for(String permission:List.of("payments:read","payments:write")) {
            assertEquals(200,mvc.perform(get(route()).with(jwt().authorities(new SimpleGrantedAuthority(permission)))).andReturn().getResponse().getStatus());
        }
        verify(permissions,times(2)).requireBoundAnyPermission(anyString(),eq(Set.of("payments:read","payments:write")));
        verify(repository,times(2)).get(order);
    }
    @Test void unavailableAuthorizationIs503AndUnknownOrderIs404() throws Exception {
        when(permissions.requireBoundAnyPermission(anyString(),anySet())).thenThrow(new OperationsError(503,"EMPLOYEE_AUTHORIZATION_UNAVAILABLE"));
        assertEquals(503,mvc.perform(get(route()).with(jwt())).andReturn().getResponse().getStatus());
        verifyNoInteractions(repository);
        doReturn(UUID.randomUUID()).when(permissions).requireBoundAnyPermission(anyString(),anySet());
        when(repository.get(order)).thenThrow(new OperationsError(404,"ORDER_NOT_FOUND"));
        assertEquals(404,mvc.perform(get(route()).with(jwt())).andReturn().getResponse().getStatus());
    }
}
