import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { alerts } from '../db/schema.js';
import { BODY_MAX, type NotifyClient, type NotifyMessage, TITLE_MAX } from '../notify/client.js';

type Log = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

/** An alert not yet sent, with what its message names. */
export interface PendingAlert {
  key: string;
  kind: (typeof alerts.$inferSelect)['kind'];
  behind: number | null;
  titleId: string;
  show: string;
  season: number;
  number: number;
  episodeName: string | null;
  /** Sonarr's reasons, on a stuck download it asked a hand for. */
  detail: string | null;
}

/** Most alerts one pass sends; the rest go on the next. */
const PASS_LIMIT = 50;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  // Never between the halves of a surrogate pair, which arrives as U+FFFD.
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

function standing(behind: number | null): string | null {
  if (behind === null) return null;
  if (behind === 0) return "You're caught up: it's next.";
  return `${behind} ${behind === 1 ? 'episode' : 'episodes'} to watch before it.`;
}

/**
 * The message for one alert, under the alert's own key so the hub delivers it
 * once however often it is posted. Clipped to the hub's limits, since a
 * message past them is refused for good.
 */
export function composeMessage(alert: PendingAlert, webOrigin: string): NotifyMessage {
  const code = `S${String(alert.season).padStart(2, '0')}E${String(alert.number).padStart(2, '0')}`;
  const lines: string[] = [];
  if (alert.episodeName) lines.push(`“${alert.episodeName}”`);

  let verb: string;
  switch (alert.kind) {
    case 'ready': {
      verb = 'is ready';
      const line = standing(alert.behind);
      if (line) lines.push(line);
      break;
    }
    case 'stuck':
      verb = 'is stuck';
      lines.push(
        alert.detail ? `Sonarr needs a hand:\n${alert.detail}` : 'Grabbed, and not imported since.',
      );
      break;
    case 'overdue':
      verb = 'is overdue';
      lines.push('Aired, and nothing has grabbed it.');
      break;
  }

  const message: NotifyMessage = {
    key: alert.key,
    title: clip(`${alert.show} ${code} ${verb}`, TITLE_MAX),
    url: `${webOrigin}/titles/${alert.titleId}`,
  };
  if (lines.length > 0) message.body = clip(lines.join('\n'), BODY_MAX);
  return message;
}

interface PendingRow extends Record<string, unknown> {
  id: string;
  key: string;
  kind: PendingAlert['kind'];
  behind: number | null;
  title_id: string;
  show: string;
  season: number;
  number: number;
  episode_name: string | null;
  detail: string | null;
}

export interface DeliveryPass {
  delivered: number;
  refused: number;
  /** The hub was unavailable, and what was left waits for the next pass. */
  held: boolean;
}

/**
 * One pass: post every alert not yet sent, oldest first, and record what the
 * hub said.
 *
 * Taken marks it delivered. Refused marks it refused, logged, and never sent
 * again. Unavailable ends the pass with nothing marked, since every other
 * alert would meet the same hub. An alert marked late — the hub took it and
 * the update failed — is posted again next pass, and the hub's key makes that
 * a no-op.
 */
export async function deliverAlerts(
  db: Database,
  notify: NotifyClient,
  webOrigin: string,
  log: Log,
): Promise<DeliveryPass> {
  const rows = await db.execute<PendingRow>(sql`
    select
      a.id,
      a.key,
      a.kind,
      a.behind,
      a.title_id,
      t.name as show,
      e.season,
      e.number,
      e.name as episode_name,
      a.detail
    from alert a
      join title t on t.id = a.title_id
      join episode e on e.id = a.episode_id
    where a.delivered_at is null and a.refused_at is null
    order by a.decided_at, a.key
    limit ${PASS_LIMIT}
  `);

  const pass: DeliveryPass = { delivered: 0, refused: 0, held: false };
  for (const row of rows) {
    const message = composeMessage(
      {
        key: row.key,
        kind: row.kind,
        behind: row.behind,
        titleId: row.title_id,
        show: row.show,
        season: row.season,
        number: row.number,
        episodeName: row.episode_name,
        detail: row.detail,
      },
      webOrigin,
    );
    const outcome = await notify.post(message);

    if (outcome.outcome === 'unavailable') {
      // A 401 is Engram's secret, which waiting will not fix; anything else
      // is the hub's own trouble and usually passes.
      const level = outcome.status === 401 ? 'error' : 'warn';
      log[level]({ status: outcome.status }, 'notify hub unavailable, alerts held');
      pass.held = true;
      break;
    }
    if (outcome.outcome === 'refused') {
      await db.update(alerts).set({ refusedAt: new Date() }).where(eq(alerts.id, row.id));
      log.error(
        { key: row.key, status: outcome.status, reason: outcome.reason },
        'notify hub refused an alert',
      );
      pass.refused += 1;
      continue;
    }
    await db.update(alerts).set({ deliveredAt: new Date() }).where(eq(alerts.id, row.id));
    log.info({ key: row.key, duplicate: outcome.duplicate }, 'alert delivered');
    pass.delivered += 1;
  }
  return pass;
}

/**
 * Runs `deliverAlerts` every `intervalMs` for as long as the process lives,
 * never two passes at once. A pass that throws is logged and the next runs on
 * schedule; nothing is lost, since an alert is only marked once the hub has
 * answered.
 *
 * Returns what stops it, which waits for a pass in flight so the database is
 * not closed under it.
 */
export function startAlertDelivery(options: {
  db: Database;
  notify: NotifyClient;
  webOrigin: string;
  log: Log;
  intervalMs?: number;
}): () => Promise<void> {
  const { db, notify, webOrigin, log, intervalMs = 15_000 } = options;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight !== null) return;
    inFlight = deliverAlerts(db, notify, webOrigin, log)
      .then(() => undefined)
      .catch((error: unknown) => log.error({ err: error }, 'alert delivery pass failed'))
      .finally(() => {
        inFlight = null;
      });
  }, intervalMs);
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
