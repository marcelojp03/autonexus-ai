package bo.edu.uagrm.autonexus.operations.application;
import java.time.Instant;
import java.util.*;

public final class AgendaPorts {
    private AgendaPorts() {}
    public record Actor(UUID employeeId, String fullName, String status, List<String> scopes) {}
    public record Context(Actor actor, Instant observedAt) {}
    public record AssignmentCheck(UUID assignmentId, UUID sagaId, UUID orderId, UUID employeeId,
            String fullName, String employeeStatus, Instant startsAt, Instant endsAt, String status,
            long version, Boolean orderConfirmedObserved) {}
    public record Checked(Actor actor, List<AssignmentCheck> items, Instant observedAt) {}
    public record Employee(UUID id, String fullName, String status) {}
    public record Vehicle(UUID id, String plate, String make, String model) {}
    public record Service(UUID serviceId, String serviceName, int quantity, int estimatedMinutes) {}
    /** CU16 progress. Confirmation still comes from the saga; this only says how the work is going. */
    public record ExecutionProgress(int advances, Instant lastAdvanceAt, int availableEvidence) {}
    public record Candidate(UUID assignmentId, UUID sagaId, UUID orderId, String orderNumber, UUID employeeId,
            Vehicle vehicle, Instant startsAt, Instant endsAt, String priority, String description, String notes,
            List<Service> services, long orderVersion, long assignmentVersion,
            String executionStatus, int advanceCount, Instant lastAdvanceAt, int availableEvidence) {}
    public record Work(UUID assignmentId, UUID orderId, String orderNumber, Employee employee, Vehicle vehicle,
            Instant startsAt, Instant endsAt, String priority, String status, String description, String notes,
            List<Service> services, long orderVersion, long assignmentVersion, Instant observedAt, String confirmationObservation,
            String executionStatus, ExecutionProgress executionProgress) {}
    public record Result(Actor actor, List<Work> items, long total, int limit, int offset,
            java.time.LocalDate from, java.time.LocalDate to, String timeZone, Instant observedAt) {}
    public record Selection(List<Candidate> items, long total) {}
    public interface Repository {
        Selection list(AgendaFilter filter, UUID employeeId);
        Optional<Candidate> detail(UUID assignmentId, UUID employeeId);
    }
    public interface EmpleadoAgendaGateway {
        Context context(String token, String scope);
        Checked check(String token, String scope, List<UUID> assignmentIds);
    }
}
