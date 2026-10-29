package bo.edu.uagrm.autonexus.operations.application;

import bo.edu.uagrm.autonexus.operations.domain.OperationsError;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AgendaFilterTest {
    final Clock clock = Clock.fixed(Instant.parse("2026-11-01T02:00:00Z"), ZoneOffset.UTC);
    @Test void defaultsUseLaPazNotUtc() {
        var f = AgendaFilter.parse(Map.of(), "self", clock);
        assertEquals(LocalDate.parse("2026-10-31"), f.from());
        assertEquals(Instant.parse("2026-10-31T04:00:00Z"), f.start());
        assertEquals(20, f.limit());
    }
    @Test void singleBoundaryMeansSameDayAndInclusiveEnd() {
        var f = AgendaFilter.parse(Map.of("to", List.of("2026-11-01")), "team", clock);
        assertEquals(f.from(), f.to());
        assertEquals(Instant.parse("2026-11-02T04:00:00Z"), f.end());
    }
    @Test void rejectsClosedKeysDuplicatesInvalidDatesAndNumbers() {
        for (var q : List.of(Map.of("employeeId", List.of(UUID.randomUUID().toString())),
                Map.of("scope", List.of("team")), Map.of("limit", List.of("1", "2")),
                Map.of("from", List.of("2026-02-30")), Map.of("status", List.of("reserved")),
                Map.of("offset", List.of("2147483648")), Map.of("limit", List.of("1.0")),
                Map.of("from", List.of("2026-01-01"), "to", List.of("2026-02-01")))) {
            assertThrows(OperationsError.class, () -> AgendaFilter.parse(q, "self", clock));
        }
    }
    @Test void permitsExactly31DaysAndMaximumInt32OffsetAndRejectsReverseRange() {
        var f=AgendaFilter.parse(Map.of("from",List.of("2026-11-01"),"to",List.of("2026-12-01"),
            "offset",List.of("2147483647"),"limit",List.of("100")),"self",clock);
        assertEquals(2147483647,f.offset()); assertEquals(100,f.limit());
        assertThrows(OperationsError.class,()->AgendaFilter.parse(Map.of("from",List.of("2026-11-02"),"to",List.of("2026-11-01")),"self",clock));
    }
}
