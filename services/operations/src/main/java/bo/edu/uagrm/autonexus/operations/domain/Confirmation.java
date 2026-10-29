package bo.edu.uagrm.autonexus.operations.domain;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;

public final class Confirmation {
    private Confirmation() {}
    public static final List<String> COMMANDS = List.of(
            "reserve_assignment", "authorize_quote", "confirm_assignment", "release_assignment", "cancel_quote_link");
    public static String utc(Instant time) {
        return new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(time);
    }
    public static long number(Object value, long minimum) {
        if (!(value instanceof Number n) || n instanceof Float || n instanceof Double || n.doubleValue() != n.longValue() || n.longValue() < minimum
                || n.longValue() > Integer.MAX_VALUE) throw OperationsError.invalid();
        return n.longValue();
    }
    public static Map<String, Object> start(Map<String, Object> input) {
        Set<String> keys = Set.of("operationId","expectedVersion","quoteId","quoteVersion","employeeId","employeeVersion",
                "requiredSpecialty","startsAt","endsAt");
        if (!input.keySet().equals(keys)) throw OperationsError.invalid();
        Map<String, Object> body = new TreeMap<>(input);
        for (String key : List.of("operationId","quoteId","employeeId")) body.put(key, Validation.uuid(input.get(key)).toString());
        for (String key : List.of("expectedVersion","quoteVersion","employeeVersion")) body.put(key, number(input.get(key), 1));
        body.put("requiredSpecialty", Validation.text(input.get("requiredSpecialty"), 1, 80));
        try {
            Instant start = OffsetDateTime.parse((String) input.get("startsAt")).toInstant();
            Instant end = OffsetDateTime.parse((String) input.get("endsAt")).toInstant();
            if (!start.isBefore(end)) throw OperationsError.invalid();
            body.put("startsAt", utc(start)); body.put("endsAt", utc(end));
        } catch (RuntimeException error) { throw OperationsError.invalid(); }
        return body;
    }
    public static final class Step {
        public String operationId = UUID.randomUUID().toString();
        public String command;
        public String status = "pending";
        public String direction;
        public Map<String, Object> body;
        public String fingerprint;
        public int attempts;
        public Map<String, Object> result;
        public String errorCode;
        public Step() {}
        public Step(String command) {
            this.command = command;
            this.direction = command.equals("release_assignment") || command.equals("cancel_quote_link") ? "compensation" : "forward";
        }
        @SuppressWarnings("unchecked")
        public Map<String, Object> resource() { return result == null ? null : (Map<String, Object>) result.get("resource"); }
        public boolean applied() { return status.equals("applied"); }
    }
    public static final class Saga {
        public String id, orderId, initiatedBy, authorizedAt;
        public String status = "running", phase = "reserve_assignment", errorCode;
        public long version = 1, orderVersion;
        public int failures;
        public String nextAttemptAt;
        public Map<String, Object> input;
        public List<Step> steps = new ArrayList<>();
        public Saga() {}
        public Step step(String command) { return steps.stream().filter(s -> s.command.equals(command)).findFirst().orElseThrow(); }
        public boolean terminal() { return status.equals("confirmed") || status.equals("rejected"); }
        public boolean compensating() { return status.equals("compensating") || status.equals("compensation_pending"); }
        public String nextCompensation() {
            boolean confirmed = step("confirm_assignment").applied();
            boolean release = step("reserve_assignment").applied() && !step("release_assignment").applied();
            boolean cancel = step("authorize_quote").applied() && !step("cancel_quote_link").applied();
            if (confirmed && release) return "release_assignment";
            if (cancel) return "cancel_quote_link";
            return release ? "release_assignment" : "reject_order";
        }
        public Map<String, Object> prepare(Step step) {
            Map<String, Object> body = new TreeMap<>();
            body.put("operationId", step.operationId); body.put("initiatedBy", initiatedBy); body.put("authorizedAt", authorizedAt);
            long expected = 0;
            switch (step.command) {
                case "reserve_assignment" -> {
                    for (String k : List.of("employeeId","employeeVersion","requiredSpecialty","startsAt","endsAt")) body.put(k,input.get(k));
                    body.put("orderId",orderId);
                }
                case "authorize_quote" -> {
                    body.put("orderId",orderId); body.put("quoteId",input.get("quoteId")); body.put("quoteVersion",input.get("quoteVersion"));
                }
                case "confirm_assignment" -> expected = ((Number) step("reserve_assignment").resource().get("version")).longValue();
                case "release_assignment" -> {
                    Step source = step("confirm_assignment").applied() ? step("confirm_assignment") : step("reserve_assignment");
                    expected = ((Number)source.resource().get("version")).longValue(); body.put("reasonCode","SAGA_REJECTED");
                }
                case "cancel_quote_link" -> {
                    expected = ((Number)step("authorize_quote").resource().get("version")).longValue(); body.put("reasonCode","SAGA_REJECTED");
                }
                default -> throw new IllegalStateException();
            }
            body.put("expectedVersion", expected); return body;
        }
    }
}
