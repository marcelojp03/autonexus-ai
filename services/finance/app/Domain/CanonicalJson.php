<?php

namespace App\Domain;

final class CanonicalJson
{
    public static function encode(mixed $value): string
    {
        return json_encode(self::sort($value), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private static function sort(mixed $value): mixed
    {
        if (is_object($value)) {
            $properties = get_object_vars($value);
            ksort($properties, SORT_STRING);
            return (object) array_map(self::sort(...), $properties);
        }
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            ksort($value, SORT_STRING);
        }
        return array_map(self::sort(...), $value);
    }
}
