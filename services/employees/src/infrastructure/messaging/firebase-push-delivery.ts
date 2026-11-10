import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export class FirebasePushDelivery {
  private messaging?: ReturnType<typeof getMessaging>;

  constructor(private readonly mockSend?: (message: {
    fid: string;
    notification: {title: string; body: string};
    data: {eventKind: string; assignmentId: string};
    android: {priority: 'high'};
  }) => Promise<void>) {}

  enabled(): boolean {
    return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT);
  }

  async send(fid: string, assignmentId: string): Promise<'sent' | 'invalid'> {
    if (!this.mockSend && !this.enabled()) throw new Error('PUSH_DISABLED');
    try {
      const message = {
        fid,
        notification: { title: 'Trabajo asignado', body: 'Tenés un trabajo nuevo en tu agenda.' },
        data: { eventKind: 'cu15.assignment.confirmed', assignmentId },
        android: { priority: 'high' as const },
      };
      if (this.mockSend) {
        await this.mockSend(message);
        return 'sent';
      }
      if (!this.messaging) {
        const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
        this.messaging = getMessaging(app);
      }
      await this.messaging.send(message);
      return 'sent';
    } catch (error) {
      const code = (error as {code?: string})?.code;
      if (code === 'messaging/installation-id-not-registered') return 'invalid';
      throw new Error('PUSH_DELIVERY_UNCERTAIN');
    }
  }
}
