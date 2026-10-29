package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

public record AgendaFilter(LocalDate from, LocalDate to, String priority, UUID employeeId, int limit, int offset) {
    public static final ZoneId ZONE = ZoneId.of("America/La_Paz");
    public Instant start() { return from.atStartOfDay(ZONE).toInstant(); }
    public Instant end() { return to.plusDays(1).atStartOfDay(ZONE).toInstant(); }
    public static UUID id(String value) {
        if (value == null || !value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) throw OperationsError.invalid();
        return UUID.fromString(value);
    }
    public static AgendaFilter parse(Map<String, ? extends List<String>> query, String scope, Clock clock) {
        Set<String> keys = new HashSet<>(Set.of("from", "to", "status", "priority", "limit", "offset"));
        if (scope.equals("team")) keys.add("employeeId");
        if (!keys.containsAll(query.keySet()) || query.values().stream().anyMatch(v -> v == null || v.size() != 1 || v.getFirst() == null)) throw OperationsError.invalid();
        Map<String, String> q = new HashMap<>(); query.forEach((k,v) -> q.put(k, v.getFirst()));
        try {
            LocalDate from = date(q.getOrDefault("from", q.getOrDefault("to", LocalDate.now(clock.withZone(ZONE)).toString())));
            LocalDate to = date(q.getOrDefault("to", from.toString()));
            long days = ChronoUnit.DAYS.between(from, to) + 1;
            if (days < 1 || days > 31 || (q.containsKey("status") && !q.get("status").equals("confirmed"))
                    || (q.containsKey("priority") && !Set.of("baja", "normal", "alta", "urgente").contains(q.get("priority")))) throw OperationsError.invalid();
            return new AgendaFilter(from, to, q.get("priority"), q.containsKey("employeeId") ? id(q.get("employeeId")) : null,
                    integer(q.getOrDefault("limit", "20"), 1, 100), integer(q.getOrDefault("offset", "0"), 0, Integer.MAX_VALUE));
        } catch (DateTimeException | NumberFormatException error) { throw OperationsError.invalid(); }
    }
    private static LocalDate date(String value) {
        if (!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw OperationsError.invalid();
        return LocalDate.parse(value);
    }
    private static int integer(String value, int min, int max) {
        if (!value.matches("[0-9]+")) throw OperationsError.invalid();
        int n = Integer.parseInt(value); if (n < min || n > max) throw OperationsError.invalid(); return n;
    }
}
