<?php

namespace App\Domain;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

final class CivilQuoteCalendar
{
    public static function valid(string $date): bool
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date)) {
            return false;
        }
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        return $parsed !== false && $parsed->format('Y-m-d') === $date;
    }

    public static function current(string $date, DateTimeInterface $instant): bool
    {
        return self::valid($date) && $date >= DateTimeImmutable::createFromInterface($instant)
            ->setTimezone(new DateTimeZone('America/La_Paz'))->format('Y-m-d');
    }
}
