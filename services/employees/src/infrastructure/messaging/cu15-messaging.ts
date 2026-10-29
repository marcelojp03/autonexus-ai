import { randomUUID } from 'node:crypto';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';
import { EmployeeError } from '../../domain/employee.js';
import { Cu15Database } from '../postgres/cu15-database.js';
import { PostgresCu15Inbox } from '../postgres/postgres-cu15-inbox.js';
import { brokerConfiguration } from './broker-configuration.js';

type Pending = {
  id: string;
  event_type: string;
  payload: unknown;
  lease_owner: string;
};
export function publishConfirmed(
  channel: ConfirmChannel,
  item: Pending,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let returned = false;
    const onReturn = (message: ConsumeMessage) => {
      if (message.properties.messageId === item.id) returned = true;
    };
    const onClose = () => finish(new Error('BROKER_CHANNEL_CLOSED'));
    const timeout = setTimeout(
      () => finish(new Error('BROKER_CONFIRM_TIMEOUT')),
      5000,
    );
    const finish = (error?: Error | null) => {
      clearTimeout(timeout);
      channel.off('return', onReturn);
      channel.off('close', onClose);
      if (error || returned)
        reject(
          new Error(
            returned ? 'BROKER_MESSAGE_RETURNED' : 'BROKER_CONFIRM_FAILED',
          ),
        );
      else resolve();
    };
    channel.on('return', onReturn);
    channel.once('close', onClose);
    try {
      channel.publish(
        'autonexus.business.v1',
        item.event_type,
        Buffer.from(JSON.stringify(item.payload)),
        {
          persistent: true,
          mandatory: true,
          messageId: item.id,
          contentType: 'application/json',
          type: item.event_type,
        },
        (error) => finish(error),
      );
    } catch {
      finish(new Error('BROKER_PUBLISH_FAILED'));
    }
  });
}
export class Cu15Messaging extends Cu15Database {
  private connection?: ChannelModel;
  private publisher?: ConfirmChannel;
  private consumer?: Channel;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private running?: Promise<void>;
  constructor(private readonly inbox: PostgresCu15Inbox) {
    super();
  }
  onApplicationBootstrap(): void {
    if (process.env.CU15_MESSAGING_ENABLED !== 'true') return;
    this.schedule();
  }
  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
        this.schedule();
      });
    }, 1000);
    this.timer.unref();
  }
  private async disconnect(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.publisher = undefined;
    this.consumer = undefined;
    if (connection)
      try {
        await connection.close();
      } catch {
        /* disconnected */
      }
  }
  private async ensureConnected(): Promise<void> {
    if (this.connection && this.publisher && this.consumer) return;
    await this.disconnect();
    const connection = await connect(await brokerConfiguration(), {
      timeout: 2000,
    });
    this.connection = connection;
    connection.on('error', () => {});
    connection.on('close', () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.publisher = undefined;
        this.consumer = undefined;
      }
    });
    const publisher = await connection.createConfirmChannel();
    publisher.on('error', () => {});
    publisher.on('close', () => {
      if (this.publisher === publisher) this.publisher = undefined;
    });
    this.publisher = publisher;
    const consumer = await connection.createChannel();
    consumer.on('error', () => {});
    consumer.on('close', () => {
      if (this.consumer === consumer) this.consumer = undefined;
    });
    this.consumer = consumer;
    await consumer.prefetch(1);
    await consumer.consume(
      'cu15.employees.order-confirmed.v1',
      (message) => {
        if (message) void this.consume(consumer, message);
      },
      { noAck: false },
    );
  }
  private async consume(
    channel: Channel,
    message: ConsumeMessage,
  ): Promise<void> {
    try {
      if (message.content.length > 65536)
        throw new EmployeeError(400, 'INVALID_EVENT');
      let value: unknown;
      try {
        value = JSON.parse(message.content.toString('utf8'));
      } catch {
        throw new EmployeeError(400, 'INVALID_EVENT');
      }
      await this.inbox.receive(value);
      channel.ack(message);
    } catch (error) {
      if (error instanceof EmployeeError && error.status !== 503) {
        try {
          channel.nack(message, false, false);
        } catch {
          /* redelivery remains safe */
        }
      } else {
        await this.disconnect();
      }
    }
  }
  private claim(): Promise<Pending | null> {
    return this.transaction(async (r) => {
      const rows = (await r.query(
        'SELECT id FROM employees.cu15_outbox WHERE published_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT 1',
      )) as Array<{ id: string }>;
      if (!rows[0]) return null;
      const owner = randomUUID();
      await r.query(
        "UPDATE employees.cu15_outbox SET lease_owner=$2,lease_until=now()+interval '30 seconds',attempts=attempts+1 WHERE id=$1",
        [rows[0].id, owner],
      );
      const claimed = (await r.query(
        'SELECT id,event_type,payload,lease_owner FROM employees.cu15_outbox WHERE id=$1',
        [rows[0].id],
      )) as Pending[];
      return claimed[0]!;
    });
  }
  private async tick(): Promise<void> {
    let item: Pending | null = null;
    try {
      await this.ensureConnected();
      item = await this.claim();
      if (!item) return;
      await publishConfirmed(this.publisher!, item);
      await this.transaction(async (r) => {
        await r.query(
          'UPDATE employees.cu15_outbox SET published_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE id=$1 AND lease_owner=$2 AND published_at IS NULL',
          [item!.id, item!.lease_owner],
        );
      });
    } catch {
      if (item)
        try {
          await this.transaction(async (r) => {
            await r.query(
              "UPDATE employees.cu15_outbox SET lease_owner=NULL,lease_until=NULL,last_error_code='BROKER_DELIVERY_UNCERTAIN',next_attempt_at=now()+interval '5 seconds' WHERE id=$1 AND lease_owner=$2 AND published_at IS NULL",
              [item!.id, item!.lease_owner],
            );
          });
        } catch {
          /* lease permits recovery */
        }
      await this.disconnect();
    }
  }
  override async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
    await this.disconnect();
    await super.onApplicationShutdown();
  }
}
