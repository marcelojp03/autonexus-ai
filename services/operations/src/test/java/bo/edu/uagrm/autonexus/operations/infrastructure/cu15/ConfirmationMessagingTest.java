package bo.edu.uagrm.autonexus.operations.infrastructure.cu15;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ConfirmationMessagingTest {
    @Test void finalOrderEventMatchesClosedEmployeeConsumerShape() {
        var saga=new bo.edu.uagrm.autonexus.operations.domain.Confirmation.Saga();
        saga.id=UUID.randomUUID().toString();saga.orderId=UUID.randomUUID().toString();saga.initiatedBy="human";saga.status="confirmed";saga.phase="confirmed";saga.version=9;saga.orderVersion=3;
        saga.input=Map.of("operationId",UUID.randomUUID().toString(),"employeeId",UUID.randomUUID().toString(),"quoteId",UUID.randomUUID().toString(),"quoteVersion",1,
                "startsAt","2026-11-01T12:00:00.000Z","endsAt","2026-11-01T13:00:00.000Z");
        for(String command:bo.edu.uagrm.autonexus.operations.domain.Confirmation.COMMANDS) {
            var step=new bo.edu.uagrm.autonexus.operations.domain.Confirmation.Step(command);
            step.result=Map.of("resource",Map.of("id",UUID.randomUUID().toString()));saga.steps.add(step);
        }
        Map<String,Object> event=JdbcConfirmationRepository.buildEvent(saga,"operations.order.confirmed.v1",UUID.randomUUID(),java.time.Instant.parse("2026-10-28T12:00:00Z"));
        assertEquals("order",event.get("aggregateType"));assertEquals(saga.orderId,event.get("aggregateId"));assertEquals(3L,event.get("aggregateVersion"));
        assertEquals(Set.of("sagaId","orderId","assignmentId","employeeId","startsAt","endsAt","quoteId","quoteVersion","quoteLinkId"),((Map<?,?>)event.get("data")).keySet());
    }
    @Test void listenerIsManualAckAndDoesNotDeclareTopology() {
        var config=new ConfirmationMessaging(); var cf=mock(CachingConnectionFactory.class);
        var container=config.cu15Listener(cf,mock(ConfirmationMessaging.Inbox.class));
        assertEquals(AcknowledgeMode.MANUAL,container.getAcknowledgeMode());
        assertArrayEquals(new String[]{"cu15.operations.events.v1"},container.getQueueNames());
        assertEquals(false,org.springframework.test.util.ReflectionTestUtils.getField(container,"autoDeclare"));
        assertFalse(container.isRunning());verifyNoInteractions(cf);
    }
    @Test void participantRejectionRequiresMatchingCausalOperationAndClosedCommand() {
        UUID cause=UUID.randomUUID(); var data=new HashMap<String,Object>();
        data.put("operationId",cause.toString());data.put("command","reserve_assignment");data.put("errorCode","EMPLOYEE_UNAVAILABLE");
        assertDoesNotThrow(()->ConfirmationMessaging.Inbox.validateData("employees.cu15.command.rejected.v1",data,cause));
        data.put("command","authorize_quote");assertThrows(ConfirmationMessaging.InvalidEvent.class,()->ConfirmationMessaging.Inbox.validateData("employees.cu15.command.rejected.v1",data,cause));
        data.put("command","reserve_assignment");data.put("operationId",UUID.randomUUID().toString());
        assertThrows(ConfirmationMessaging.InvalidEvent.class,()->ConfirmationMessaging.Inbox.validateData("employees.cu15.command.rejected.v1",data,cause));
    }
    @Test void assignmentNotificationMustMatchItsEventStateAndInterval() {
        var data=new HashMap<String,Object>();data.put("assignmentId",UUID.randomUUID().toString());data.put("employeeId",UUID.randomUUID().toString());
        data.put("startsAt","2026-11-01T12:00:00.000Z");data.put("endsAt","2026-11-01T13:00:00.000Z");data.put("version",1);data.put("status","reserved");
        UUID cause=UUID.randomUUID();
        assertDoesNotThrow(()->ConfirmationMessaging.Inbox.validateData("employees.cu15.assignment.reserved.v1",data,cause));
        data.put("status","confirmed");assertThrows(ConfirmationMessaging.InvalidEvent.class,()->ConfirmationMessaging.Inbox.validateData("employees.cu15.assignment.reserved.v1",data,cause));
        data.put("status","reserved");data.put("endsAt",data.get("startsAt"));
        assertThrows(ConfirmationMessaging.InvalidEvent.class,()->ConfirmationMessaging.Inbox.validateData("employees.cu15.assignment.reserved.v1",data,cause));
    }
    @Test void financialNotificationMustHavePositiveVersionsAndResourceState() {
        var data=new HashMap<String,Object>();data.put("quoteLinkId",UUID.randomUUID().toString());data.put("quoteId",UUID.randomUUID().toString());
        data.put("quoteVersion",1);data.put("version",1);data.put("status","active"); UUID cause=UUID.randomUUID();
        assertDoesNotThrow(()->ConfirmationMessaging.Inbox.validateData("finance.cu15.quote_link.authorized.v1",data,cause));
        data.put("version",0);assertThrows(ConfirmationMessaging.InvalidEvent.class,()->ConfirmationMessaging.Inbox.validateData("finance.cu15.quote_link.authorized.v1",data,cause));
    }
}
