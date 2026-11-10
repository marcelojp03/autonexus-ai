import { describe, expect, it, vi } from 'vitest';
import { FirebasePushDelivery } from './firebase-push-delivery.js';

describe('FirebasePushDelivery', () => {
  it('sends only generic copy, event kind and opaque assignment ID to the FID', async () => {
    const sent: unknown[] = [];
    const send = vi.fn(async (message: unknown) => { sent.push(message); });
    const delivery = new FirebasePushDelivery(send);
    await expect(delivery.send('fid-private', 'assignment-opaque')).resolves.toBe('sent');
    expect(send).toHaveBeenCalledWith({
      fid: 'fid-private',
      notification: {title: 'Trabajo asignado', body: 'Tenés un trabajo nuevo en tu agenda.'},
      data: {eventKind: 'cu15.assignment.confirmed', assignmentId: 'assignment-opaque'},
      android: {priority: 'high'},
    });
    const serialized = JSON.stringify(sent[0]);
    for (const forbidden of ['customer', 'plate', 'diagnosis', 'photo', 'finance', 'token', 'jwt']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('marks an explicitly unregistered FID without exposing the provider error', async () => {
    const send = vi.fn(async () => { throw {code: 'messaging/installation-id-not-registered'}; });
    const delivery = new FirebasePushDelivery(send);
    await expect(delivery.send('fid-private', 'assignment-opaque')).resolves.toBe('invalid');
  });
});
