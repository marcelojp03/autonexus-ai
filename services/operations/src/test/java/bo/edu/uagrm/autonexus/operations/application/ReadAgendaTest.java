package bo.edu.uagrm.autonexus.operations.application;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ReadAgendaTest {
    Repository repository=mock(Repository.class);
    EmpleadoAgendaGateway employees=mock(EmpleadoAgendaGateway.class);
    Instant now=Instant.parse("2026-11-01T12:00:00Z");
    Clock clock=Clock.fixed(now,ZoneOffset.UTC);
    UUID employee=UUID.randomUUID(), assignment=UUID.randomUUID(), order=UUID.randomUUID(), saga=UUID.randomUUID();
    Actor actor=new Actor(employee,"Mecánico","active",List.of("self","team"));
    ReadAgenda useCase=new ReadAgenda(repository,employees,clock);
    Candidate row=new Candidate(assignment,saga,order,"WO-2026-1",employee,new Vehicle(UUID.randomUUID(),"123ABC","Toyota","Corolla"),
        now,now.plusSeconds(3600),"alta","Frenos","Nota",List.of(new Service(UUID.randomUUID(),"Revisión",1,60)),3,2);
    AgendaFilter filter=AgendaFilter.parse(Map.of(),"self",clock);
    AssignmentCheck check(String status,long version,UUID owner,boolean observed) {
        return new AssignmentCheck(assignment,saga,order,owner,"Mecánico","active",now,now.plusSeconds(3600),status,version,observed);
    }
    @BeforeEach void setup() {
        when(employees.context("human","self")).thenReturn(new Context(actor,now));
        when(employees.context("human","team")).thenReturn(new Context(actor,now));
        when(repository.list(any(),any())).thenReturn(new Selection(List.of(row),1));
        when(repository.detail(assignment,employee)).thenReturn(Optional.of(row));
        when(employees.check(eq("human"),anyString(),anyList())).thenReturn(new Checked(actor,List.of(check("confirmed",2,employee,true)),now));
    }
    @Test void ownIdentityOnlyComesFromFreshContextEveryRequest() {
        useCase.list("human","self",filter); useCase.detail("human","self",assignment);
        verify(employees,times(2)).context("human","self");
        verify(repository).list(filter,employee); verify(repository).detail(assignment,employee);
        verify(employees,times(2)).check("human","self",List.of(assignment));
    }
    @Test void teamEmployeeFilterDoesNotReplaceActor() {
        UUID other=UUID.randomUUID(); var f=AgendaFilter.parse(Map.of("employeeId",List.of(other.toString())),"team",clock);
        var result=useCase.list("human","team",f); assertEquals(employee,result.actor().employeeId());
        verify(repository).list(f,other); verify(employees).context("human","team");
    }
    @Test void pendingObservationDoesNotHideConfirmedWork() {
        when(employees.check(anyString(),anyString(),anyList())).thenReturn(new Checked(actor,List.of(check("confirmed",2,employee,false)),now));
        var result=useCase.list("human","self",filter);
        assertEquals(1,result.total()); assertEquals("pending",result.items().getFirst().confirmationObservation());
        assertEquals("confirmed",result.items().getFirst().status());
    }
    @Test void releasedReservedVersionOrReferencesChangedAreExplicitStateFailures() {
        for(var current:List.of(check("released",2,employee,true),check("reserved",2,employee,true),check("confirmed",3,employee,true),
                new AssignmentCheck(assignment,UUID.randomUUID(),order,employee,"M","active",now,now.plusSeconds(3600),"confirmed",2,true),
                new AssignmentCheck(assignment,saga,order,employee,"M","active",now.plusSeconds(1),now.plusSeconds(3600),"confirmed",2,true))) {
            when(employees.check(anyString(),anyString(),anyList())).thenReturn(new Checked(actor,List.of(current),now));
            assertEquals("AGENDA_STATE_UNAVAILABLE",assertThrows(OperationsError.class,()->useCase.list("human","self",filter)).code());
        }
    }
    @Test void noPermissionOrInactiveContextNeverQueriesSql() {
        for(var denied:List.of(new Actor(employee,"M","inactive",List.of("self")),new Actor(employee,"M","active",List.of("team")))) {
            when(employees.context("human","self")).thenReturn(new Context(denied,now));
            assertEquals(403,assertThrows(OperationsError.class,()->useCase.list("human","self",filter)).statusCode());
        }
        verifyNoInteractions(repository);
    }
    @Test void authorizedEmptyIsNotDependencyFailure() {
        when(repository.list(any(),any())).thenReturn(new Selection(List.of(),0));
        assertEquals(0,useCase.list("human","self",filter).total()); verify(employees,never()).check(anyString(),anyString(),anyList());
        when(employees.context("human","self")).thenThrow(new OperationsError(503,"AGENDA_DEPENDENCY_UNAVAILABLE"));
        assertEquals(503,assertThrows(OperationsError.class,()->useCase.list("human","self",filter)).statusCode());
    }
    @Test void absentAndForeignDetailHaveSame404BeforeRemotePrivateData() {
        when(repository.detail(any(),any())).thenReturn(Optional.empty());
        assertEquals("AGENDA_WORK_NOT_FOUND",assertThrows(OperationsError.class,()->useCase.detail("human","self",assignment)).code());
        verify(employees,never()).check(anyString(),anyString(),anyList());
    }
    @Test void movedAssignmentDuringDetailRecheckIs404NotData() {
        when(employees.check(anyString(),anyString(),anyList())).thenReturn(new Checked(actor,List.of(check("confirmed",2,UUID.randomUUID(),true)),now));
        assertEquals(404,assertThrows(OperationsError.class,()->useCase.detail("human","self",assignment)).statusCode());
    }
    @Test void permissionRevokedBetweenContextAndCheckFailsClosed() {
        when(employees.check(anyString(),anyString(),anyList())).thenThrow(ReadAgenda.denied());
        assertEquals(403,assertThrows(OperationsError.class,()->useCase.detail("human","self",assignment)).statusCode());
    }
    @Test void missingCurrentItemIsNeverPrunedOrReturnedAsEmpty() {
        when(employees.check(anyString(),anyString(),anyList())).thenThrow(ReadAgenda.missing());
        assertEquals("AGENDA_STATE_UNAVAILABLE",assertThrows(OperationsError.class,()->useCase.list("human","self",filter)).code());
        doReturn(new Checked(actor,List.of(),now)).when(employees).check(anyString(),anyString(),anyList());
        assertEquals(503,assertThrows(OperationsError.class,()->useCase.list("human","self",filter)).statusCode());
    }
    @Test void dtoHasExactMinimalShapeAndNoPrivateGeneralModels() {
        var json=new ObjectMapper(); var work=useCase.detail("human","self",assignment);
        Map<?,?> dto=json.readValue(json.writeValueAsString(work),Map.class);
        assertEquals(Set.of("assignmentId","orderId","orderNumber","employee","vehicle","startsAt","endsAt","priority","status",
            "description","notes","services","orderVersion","assignmentVersion","observedAt","confirmationObservation"),dto.keySet());
        assertEquals(Set.of("id","fullName","status"),((Map<?,?>)dto.get("employee")).keySet());
        assertEquals(Set.of("serviceId","serviceName","quantity","estimatedMinutes"),((Map<?,?>)((List<?>)dto.get("services")).getFirst()).keySet());
    }
}
