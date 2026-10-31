package bo.edu.uagrm.autonexus.operations.application;
import bo.edu.uagrm.autonexus.operations.application.AgendaPorts.*;
import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.*;
import java.util.*;

public final class ReadAgenda {
    private final Repository repository;
    private final EmpleadoAgendaGateway employees;
    private final Clock clock;
    public ReadAgenda(Repository repository, EmpleadoAgendaGateway employees, Clock clock) {
        this.repository = repository; this.employees = employees; this.clock = clock;
    }
    public static OperationsError state() { return new OperationsError(503, "AGENDA_STATE_UNAVAILABLE"); }
    public static OperationsError denied() { return new OperationsError(403, "AGENDA_ACCESS_DENIED"); }
    public static OperationsError missing() { return OperationsError.notFound("AGENDA_WORK_NOT_FOUND"); }
    public static void authorize(Actor actor, String scope) {
        if (actor == null || actor.employeeId() == null || actor.fullName() == null || actor.fullName().isBlank()
                || !"active".equals(actor.status()) || actor.scopes() == null || !actor.scopes().contains(scope)
                || !Set.of("self", "team").containsAll(actor.scopes())) throw denied();
    }
    private Actor context(String token, String scope) {
        Context context = employees.context(token, scope);
        if (context == null || context.observedAt() == null) throw state();
        authorize(context.actor(), scope); return context.actor();
    }
    public Result list(String token, String scope, AgendaFilter filter) {
        Actor actor = context(token, scope);
        UUID employee = scope.equals("self") ? actor.employeeId() : filter.employeeId();
        Selection page = repository.list(filter, employee);
        List<Work> works = verify(token, scope, actor, page.items(), false, false);
        return new Result(actor, works, page.total(), filter.limit(), filter.offset(), filter.from(), filter.to(),
                "America/La_Paz", clock.instant());
    }
    public Result history(String token, String scope, AgendaFilter filter) {
        Actor actor = context(token, scope);
        UUID employee = scope.equals("self") ? actor.employeeId() : filter.employeeId();
        Selection page = repository.history(filter, employee);
        List<Work> works = verify(token, scope, actor, page.items(), false, true);
        return new Result(actor, works, page.total(), filter.limit(), filter.offset(), filter.from(), filter.to(),
                "America/La_Paz", clock.instant());
    }

    public Work detail(String token, String scope, UUID id) {
        Actor actor = context(token, scope);
        Candidate row = repository.detail(id, scope.equals("self") ? actor.employeeId() : null).orElseThrow(ReadAgenda::missing);
        if (scope.equals("self") && !actor.employeeId().equals(row.employeeId())) throw missing();
        return verify(token, scope, actor, List.of(row), true, "completed".equals(row.executionStatus())).getFirst();
    }
    private List<Work> verify(String token, String scope, Actor actor, List<Candidate> rows, boolean detail, boolean completed) {
        if (rows.isEmpty()) return List.of();
        Checked checked;
        try { checked = employees.check(token, scope, rows.stream().map(Candidate::assignmentId).toList()); }
        catch (OperationsError failure) {
            if (failure.statusCode() == 404 && !detail) throw state();
            throw failure;
        }
        if (checked == null || checked.observedAt() == null) throw state();
        authorize(checked.actor(), scope);
        if (!actor.employeeId().equals(checked.actor().employeeId())) throw denied();
        if (checked.items() == null || checked.items().size() != rows.size()) throw state();
        Map<UUID, AssignmentCheck> current = new HashMap<>();
        for (AssignmentCheck a : checked.items()) {
            if (a == null || a.assignmentId() == null || current.put(a.assignmentId(), a) != null) throw state();
        }
        List<Work> result = new ArrayList<>();
        for (Candidate row : rows) {
            AssignmentCheck a = current.get(row.assignmentId());
            if (a != null && scope.equals("self") && !actor.employeeId().equals(a.employeeId())) {
                if (detail) throw missing(); else throw state();
            }
            if (a == null || !Objects.equals(row.sagaId(), a.sagaId()) || !Objects.equals(row.orderId(), a.orderId())
                    || !Objects.equals(row.employeeId(), a.employeeId()) || !Objects.equals(row.startsAt(), a.startsAt())
                    || !Objects.equals(row.endsAt(), a.endsAt()) || !"confirmed".equals(a.status())
                    || a.version() < 1 || row.assignmentVersion() != a.version() || a.fullName() == null || a.fullName().isBlank()
                    || !Set.of("active", "inactive").contains(a.employeeStatus() == null ? "" : a.employeeStatus())
                    || a.orderConfirmedObserved() == null) throw state();
            result.add(new Work(row.assignmentId(), row.orderId(), row.orderNumber(), new Employee(a.employeeId(), a.fullName(), a.employeeStatus()),
                    row.vehicle(), row.startsAt(), row.endsAt(), row.priority(), completed ? "completed" : "confirmed", row.description(), row.notes(), row.services(),
                    row.orderVersion(), a.version(), checked.observedAt(), a.orderConfirmedObserved() ? "observed" : "pending",
                    row.executionStatus(), new ExecutionProgress(row.advanceCount(), row.lastAdvanceAt(), row.availableEvidence())));
        }
        return List.copyOf(result);
    }
}
