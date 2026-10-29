import { EventEmitter } from 'node:events';
import type { ConfirmChannel } from 'amqplib';
import { publishConfirmed } from './cu15-messaging.js';
describe('CU15 publisher confirm ordering (channel fake, not RabbitMQ)', () => {
  const item = {
    id: '11111111-1111-4111-8111-111111111111',
    event_type: 'employees.cu15.assignment.reserved.v1',
    payload: { eventId: 'stable' },
    lease_owner: 'lease',
  };
  function channel(mode: 'ack' | 'return' | 'nack' | 'close') {
    const emitter = new EventEmitter();
    const publish = vi.fn(
      (_exchange, _routing, _content, _options, callback) => {
        if (mode === 'return')
          emitter.emit('return', { properties: { messageId: item.id } });
        if (mode === 'close') emitter.emit('close');
        else callback(mode === 'nack' ? new Error('nacked') : null);
        return true;
      },
    );
    return { channel: Object.assign(emitter, { publish }) as unknown as ConfirmChannel, publish };
  }
  it('requires confirm and sends persistent mandatory stable-id messages', async () => {
    const { channel: c, publish } = channel('ack');
    await expect(publishConfirmed(c, item)).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledWith(
      'autonexus.business.v1',
      item.event_type,
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        mandatory: true,
        messageId: item.id,
      }),
      expect.any(Function),
    );
    expect(c.listenerCount('return')).toBe(0);
  });
  it.each(['return', 'nack', 'close'] as const)(
    'does not accept %s as published',
    async (mode) => {
      const { channel: c } = channel(mode);
      await expect(publishConfirmed(c, item)).rejects.toThrow();
      expect(c.listenerCount('return')).toBe(0);
    },
  );
});
