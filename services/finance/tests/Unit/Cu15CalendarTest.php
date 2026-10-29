<?php

namespace Tests\Unit;

use App\Domain\CanonicalJson;
use App\Domain\CivilQuoteCalendar;
use PHPUnit\Framework\TestCase;

final class Cu15CalendarTest extends TestCase
{
    public function test_inclusive_la_paz_date_not_utc_date(): void
    {
        $this->assertTrue(CivilQuoteCalendar::current('2026-10-28', new \DateTimeImmutable('2026-10-29T03:59:59.999Z')));
        $this->assertFalse(CivilQuoteCalendar::current('2026-10-28', new \DateTimeImmutable('2026-10-29T04:00:00Z')));
    }

    public function test_calendar_rejects_impossible_dates_and_accepts_leap_day(): void
    {
        foreach (['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '2026-10-28 extra'] as $date) {
            $this->assertFalse(CivilQuoteCalendar::valid($date));
        }
        $this->assertTrue(CivilQuoteCalendar::valid('2028-02-29'));
    }

    public function test_canonical_json_recursively_sorts_objects_but_preserves_arrays(): void
    {
        $a = ['z' => ['b' => 'á/', 'a' => 1], 'a' => [3, 2, 1]];
        $b = ['a' => [3, 2, 1], 'z' => ['a' => 1, 'b' => 'á/']];
        $this->assertSame(CanonicalJson::encode($a), CanonicalJson::encode($b));
        $this->assertSame('{}', CanonicalJson::encode((object) []));
        $this->assertNotSame(CanonicalJson::encode([1, 2]), CanonicalJson::encode([2, 1]));
        $this->assertStringContainsString('á/', CanonicalJson::encode($a));
    }
}
