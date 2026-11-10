import { randomUUID } from 'node:crypto';
import { Cu15Database } from '../postgres/cu15-database.js';
import { FirebasePushDelivery } from './firebase-push-delivery.js';

type Notice = { event_id: string; assignment_id: string; employee_id: string; lease_id: string };

/** Polls only committed notification rows; network calls are never part of the business transaction. */
export class PushNotificationDispatcher extends Cu15Database {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private running?: Promise<void>;

  constructor(private readonly delivery: FirebasePushDelivery) { super(); }

  onApplicationBootstrap(): void { this.schedule(); }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => { this.running = undefined; this.schedule(); });
    }, 1000);
    this.timer.unref();
  }

  private async claim(): Promise<Notice | null> {
    return this.transaction(async (runner) => {
      const rows = await runner.query(`SELECT n.event_id,n.assignment_id,n.employee_id
        FROM employees.cu15_notifications n
        WHERE n.push_state IN ('pending','sending') AND n.push_next_attempt_at<=now()
          AND (n.push_lease_until IS NULL OR n.push_lease_until<now()) AND n.push_attempts<5
        ORDER BY n.created_at,n.event_id FOR UPDATE SKIP LOCKED LIMIT 1`) as Array<Omit<Notice,'lease_id'>>;
      if (!rows[0]) return null;
      const lease = randomUUID();
      await runner.query(`UPDATE employees.cu15_notifications SET push_state='sending',push_attempts=push_attempts+1,
        push_lease_id=$2,push_lease_until=now()+interval '60 seconds',push_next_attempt_at=now()+interval '60 seconds'
        WHERE event_id=$1`, [rows[0].event_id, lease]);
      return {...rows[0], lease_id: lease};
    });
  }

  private async tick(): Promise<void> {
    let notice: Notice | null = null;
    try {
      notice = await this.claim();
      if (!notice) return;
      if (!this.delivery.enabled()) {
        await this.finish(notice, 'disabled');
        return;
      }
      const fids = await this.transaction(async (runner) => runner.query(
        "SELECT fid FROM employees.push_installations WHERE employee_id=$1 AND state='active'",
        [notice!.employee_id],
      ) as Promise<Array<{fid: string}>>);
      if (fids.length === 0) { await this.finish(notice!, 'sent'); return; }
      for (const {fid} of fids) {
        try {
          const result = await this.delivery.send(fid, notice.assignment_id);
          if (result === 'invalid') await this.transaction(async (runner) => {
            await runner.query("UPDATE employees.push_installations SET state='inactive',updated_at=now() WHERE fid=$1 AND employee_id=$2", [fid, notice!.employee_id]);
          });
        } catch {
          await this.retry(notice);
          return;
        }
      }
      await this.finish(notice, 'sent');
    } catch {
      if (notice) await this.retry(notice).catch(() => {});
    }
  }

  private async finish(notice: Notice, state: 'sent'|'disabled'): Promise<void> {
    await this.transaction(async (runner) => runner.query(`UPDATE employees.cu15_notifications
      SET push_state=$2,push_sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END,push_lease_until=NULL,push_lease_id=NULL
      WHERE event_id=$1 AND push_state='sending' AND push_lease_id=$3`, [notice.event_id, state, notice.lease_id]));
  }

  private async retry(notice: Notice): Promise<void> {
    await this.transaction(async (runner) => runner.query(`UPDATE employees.cu15_notifications SET
      push_state=CASE WHEN push_attempts>=5 THEN 'disabled' ELSE 'pending' END,
      push_next_attempt_at=now()+make_interval(secs => LEAST(60,power(2,LEAST(push_attempts,6))::int)),
      push_lease_until=NULL,push_lease_id=NULL WHERE event_id=$1 AND push_state='sending' AND push_lease_id=$2`, [notice.event_id, notice.lease_id]));
  }

  override async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
    await super.onApplicationShutdown();
  }
}
