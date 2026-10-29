<?php

namespace App\Infrastructure\Cu15;

use App\Application\Cu15\EventPublisher;
use PhpAmqpLib\Connection\AMQPStreamConnection;
use PhpAmqpLib\Message\AMQPMessage;
use RuntimeException;

final class AmqpEventPublisher implements EventPublisher
{
    public function publish(string $eventId, string $routingKey, string $payload): void
    {
        if (strlen($payload) > 65536) {
            throw new RuntimeException('EVENT_TOO_LARGE');
        }
        $file = config('cu15.broker_client_file');
        if (!is_string($file) || !is_readable($file)) {
            throw new RuntimeException('BROKER_CONFIG_INVALID');
        }
        $config = json_decode((string) file_get_contents($file), true, 32, JSON_THROW_ON_ERROR);
        foreach (['host', 'vhost', 'username', 'password'] as $key) {
            if (!is_string($config[$key] ?? null) || $config[$key] === '') {
                throw new RuntimeException('BROKER_CONFIG_INVALID');
            }
        }
        if (!is_int($config['port'] ?? null) || $config['port'] < 1 || $config['port'] > 65535) {
            throw new RuntimeException('BROKER_CONFIG_INVALID');
        }
        $connection = new AMQPStreamConnection($config['host'], $config['port'], $config['username'], $config['password'],
            $config['vhost'], false, 'AMQPLAIN', null, 'en_US', 2.0, 5.0, null, false, 0, 5.0);
        try {
            $channel = $connection->channel();
            $acked = false;
            $nacked = false;
            $returned = false;
            $channel->confirm_select();
            $channel->set_ack_handler(function () use (&$acked) { $acked = true; });
            $channel->set_nack_handler(function () use (&$nacked) { $nacked = true; });
            $channel->set_return_listener(function () use (&$returned) { $returned = true; });
            $channel->basic_publish(new AMQPMessage($payload, [
                'content_type' => 'application/json', 'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
                'message_id' => $eventId, 'type' => $routingKey,
            ]), 'autonexus.business.v1', $routingKey, true);
            $channel->wait_for_pending_acks_returns(5.0);
            if (!$acked || $nacked || $returned) {
                throw new RuntimeException('BROKER_NOT_CONFIRMED');
            }
        } finally {
            $connection->close();
        }
    }
}
