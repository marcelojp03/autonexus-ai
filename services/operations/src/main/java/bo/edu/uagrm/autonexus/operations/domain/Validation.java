package bo.edu.uagrm.autonexus.operations.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Explicit input rules shared by the four operation use cases. */
public final class Validation {
    private static final Pattern DOCUMENT = Pattern.compile("^[0-9A-Z]{4,20}$");
    private static final Pattern PLATE = Pattern.compile("^[0-9A-Z]{5,10}$");
    private static final Pattern PHONE = Pattern.compile("^[0-9+().\\- ]{7,25}$");
    private static final Pattern EMAIL = Pattern.compile("^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$");
    private static final Set<String> FUELS = Set.of("gasolina", "diesel", "gas", "electrico", "hibrido");
    private static final Set<String> CATEGORIES = Set.of("mantenimiento", "reparacion", "diagnostico", "otros");

    private Validation() {}

    private static String collapse(String value) {
        return value.trim().replaceAll("\\s+", " ");
    }

    public static void onlyKeys(Map<String, Object> body, Set<String> allowed) {
        if (body == null || body.keySet().stream().anyMatch(key -> !allowed.contains(key))) {
            throw OperationsError.invalid();
        }
    }

    public static String text(Object value, int min, int max) {
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        String normalized = collapse(raw);
        if (normalized.length() < min || normalized.length() > max) throw OperationsError.invalid();
        if (normalized.chars().anyMatch(ch -> ch < 32)) throw OperationsError.invalid();
        return normalized;
    }

    public static String optionalText(Object value, int max) {
        if (value == null) return null;
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        String normalized = collapse(raw);
        if (normalized.isEmpty()) return null;
        if (normalized.length() > max) throw OperationsError.invalid();
        return normalized;
    }

    public static String document(Object value) {
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        String normalized = raw.trim().replaceAll("[\\s-]", "").toUpperCase();
        if (!DOCUMENT.matcher(normalized).matches()) throw OperationsError.invalid();
        return normalized;
    }

    public static String plate(Object value) {
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        String normalized = raw.trim().replaceAll("[\\s-]", "").toUpperCase();
        if (!PLATE.matcher(normalized).matches()) throw OperationsError.invalid();
        return normalized;
    }

    public static String phone(Object value) {
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        String normalized = collapse(raw);
        if (!PHONE.matcher(normalized).matches() || normalized.chars().noneMatch(Character::isDigit)) {
            throw OperationsError.invalid();
        }
        return normalized;
    }

    public static String email(Object value) {
        if (value == null) return null;
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        String normalized = raw.trim();
        if (normalized.isEmpty()) return null;
        if (normalized.length() > 254 || !EMAIL.matcher(normalized).matches()) throw OperationsError.invalid();
        return normalized;
    }

    public static int year(Object value, int currentYear) {
        if (!(value instanceof Number number) || number.intValue() != number.doubleValue()) throw OperationsError.invalid();
        int parsed = number.intValue();
        if (parsed < 1950 || parsed > currentYear + 1) throw OperationsError.invalid();
        return parsed;
    }

    public static String fuelType(Object value) {
        if (!(value instanceof String raw) || !FUELS.contains(raw)) throw OperationsError.invalid();
        return raw;
    }

    public static String category(Object value) {
        if (!(value instanceof String raw) || !CATEGORIES.contains(raw)) throw OperationsError.invalid();
        return raw;
    }

    public static int estimatedMinutes(Object value) {
        if (!(value instanceof Number number) || number.intValue() != number.doubleValue()) throw OperationsError.invalid();
        int parsed = number.intValue();
        if (parsed < 15 || parsed > 480) throw OperationsError.invalid();
        return parsed;
    }

    public static BigDecimal rate(Object value) {
        BigDecimal parsed;
        if (value instanceof BigDecimal decimal) {
            parsed = decimal;
        } else if (value instanceof Number number) {
            parsed = new BigDecimal(number.toString());
        } else {
            throw OperationsError.invalid();
        }
        if (parsed.scale() > 2 || parsed.signum() < 0 || parsed.compareTo(new BigDecimal("9999999.99")) > 0) {
            throw OperationsError.invalid();
        }
        return parsed;
    }

    public static UUID uuid(Object value) {
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException error) {
            throw OperationsError.invalid();
        }
    }

    public static int expectedVersion(Object value) {
        if (!(value instanceof Number number) || number.intValue() != number.doubleValue() || number.intValue() < 1) {
            throw OperationsError.invalid();
        }
        return number.intValue();
    }

    /** ISO-8601 with an explicit offset; the workshop zone is never inferred. */
    public static Instant instant(Object value) {
        if (!(value instanceof String raw)) throw OperationsError.invalid();
        String text = raw.trim();
        if (!(text.endsWith("Z") || text.matches(".*[+-]\\d{2}:\\d{2}$"))) throw OperationsError.invalid();
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (DateTimeParseException error) {
            throw OperationsError.invalid();
        }
    }

    public static int pageInt(Object value, int fallback, int min, int max) {
        if (value == null) return fallback;
        int parsed;
        if (value instanceof Number number && number.intValue() == number.doubleValue()) {
            parsed = number.intValue();
        } else {
            throw OperationsError.invalid();
        }
        if (parsed < min || parsed > max) throw OperationsError.invalid();
        return parsed;
    }
}
