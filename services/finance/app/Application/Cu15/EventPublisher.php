<?php

namespace App\Application\Cu15;

interface EventPublisher
{
    public function publish(string $eventId, string $routingKey, string $payload): void;
}
