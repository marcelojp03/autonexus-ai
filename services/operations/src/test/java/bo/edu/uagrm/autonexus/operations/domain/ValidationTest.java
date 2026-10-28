package bo.edu.uagrm.autonexus.operations.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.Year;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ValidationTest {
    @Test
    void normalizesDocumentsAndRejectsInvalidOnes() {
        assertThat(Validation.document(" 12-345-678 ")).isEqualTo("12345678");
        assertThat(Validation.document("ab-123")).isEqualTo("AB123");
        for (String value : new String[] {"abc", "123", "123456789012345678901", "12#45"}) {
            assertThatThrownBy(() -> Validation.document(value)).isInstanceOf(OperationsError.class);
        }
    }

    @Test
    void normalizesPlatesAndRejectsInvalidOnes() {
        assertThat(Validation.plate("abc-123")).isEqualTo("ABC123");
        assertThatThrownBy(() -> Validation.plate("AB12")).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> Validation.plate("ABCDEFGHIJK")).isInstanceOf(OperationsError.class);
    }

    @Test
    void validatesPhonesAndEmails() {
        assertThat(Validation.phone("+591 700 00000")).isEqualTo("+591 700 00000");
        assertThatThrownBy(() -> Validation.phone("abcdefgh")).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> Validation.phone("123")).isInstanceOf(OperationsError.class);
        assertThat(Validation.email("cliente@example.invalid")).isEqualTo("cliente@example.invalid");
        assertThat(Validation.email("  ")).isNull();
        assertThat(Validation.email(null)).isNull();
        assertThatThrownBy(() -> Validation.email("sin-arroba")).isInstanceOf(OperationsError.class);
    }

    @Test
    void boundsVehicleYearAndFuel() {
        int current = Year.now().getValue();
        assertThat(Validation.year(current, current)).isEqualTo(current);
        assertThatThrownBy(() -> Validation.year(current + 2, current)).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> Validation.year(1949, current)).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> Validation.year("2020", current)).isInstanceOf(OperationsError.class);
        assertThat(Validation.fuelType("diesel")).isEqualTo("diesel");
        assertThatThrownBy(() -> Validation.fuelType("carbon")).isInstanceOf(OperationsError.class);
    }

    @Test
    void boundsServiceDurationAndRate() {
        assertThat(Validation.estimatedMinutes(60)).isEqualTo(60);
        assertThatThrownBy(() -> Validation.estimatedMinutes(10)).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> Validation.estimatedMinutes(481)).isInstanceOf(OperationsError.class);
        assertThat(Validation.rate(new BigDecimal("120.50"))).isEqualByComparingTo("120.50");
        assertThatThrownBy(() -> Validation.rate(new BigDecimal("-1"))).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> Validation.rate(new BigDecimal("1.001"))).isInstanceOf(OperationsError.class);
    }

    @Test
    void requiresAnExplicitOffsetForTimestamps() {
        assertThat(Validation.instant("2026-11-10T09:00:00-04:00")).isEqualTo(Instant.parse("2026-11-10T13:00:00Z"));
        assertThat(Validation.instant("2026-11-10T13:00:00Z")).isEqualTo(Instant.parse("2026-11-10T13:00:00Z"));
        for (String value : new String[] {"2026-11-10T09:00:00", "2026-11-10", "10/11/2026 09:00"}) {
            assertThatThrownBy(() -> Validation.instant(value)).isInstanceOf(OperationsError.class);
        }
    }

    @Test
    void rejectsUnknownPropertiesAndInvalidVersions() {
        Validation.onlyKeys(Map.of("operationId", UUID.randomUUID().toString()), Set.of("operationId"));
        assertThatThrownBy(() -> Validation.onlyKeys(Map.of("extra", 1), Set.of("operationId")))
                .isInstanceOf(OperationsError.class);
        assertThat(Validation.expectedVersion(3)).isEqualTo(3);
        assertThatThrownBy(() -> Validation.expectedVersion(0)).isInstanceOf(OperationsError.class);
        assertThatThrownBy(() -> Validation.expectedVersion("2")).isInstanceOf(OperationsError.class);
    }

    @Test
    void validatesIdentifierLists() {
        UUID id = UUID.randomUUID();
        assertThat(Validation.uuid(id.toString())).isEqualTo(id);
        assertThatThrownBy(() -> Validation.uuid("nope")).isInstanceOf(OperationsError.class);
        assertThat(Validation.pageInt(25, 20, 1, 100)).isEqualTo(25);
        assertThatThrownBy(() -> Validation.pageInt(101, 20, 1, 100)).isInstanceOf(OperationsError.class);
        assertThat(Validation.text("  Ana   María ", 1, 100)).isEqualTo("Ana María");
        assertThatThrownBy(() -> Validation.optionalText(List.of("x"), 10)).isInstanceOf(OperationsError.class);
    }
}
